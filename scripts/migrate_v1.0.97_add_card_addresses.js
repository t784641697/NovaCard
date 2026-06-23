/**
 * v1.0.97 migration: 给 cards 表加账单地址 6 个字段 + 回填现有卡
 *
 * 背景: 卡详情前端期望 cardData.address_line_one/_two/_city/_state/_country/_post_code
 *       但 cards 表 schema 没有这 6 列, SDK 拍平后写回函数也没写, 列表接口没读
 *       上游 vmcardio card_address 字段 SDK 已拍平 (vmcardioSDK.js:175-183)
 *       但前提是: 1) cards 表加了列, 2) persistCardDetailToDb 写这 6 个字段
 *                3) /api/cards SELECT 读这 6 个字段, 4) admin.js INSERT 写这 6 个字段
 *       (上述 1-4 项 v1.0.97 已改, 本脚本只负责 1-回填现有数据)
 *
 * 回填策略 (v1.0.97.1 优化):
 *   优先用 .env 的 VMCARDIO_DEFAULT_BILLING_ADDRESS 回填 (零依赖、即时)
 *   失败再尝试调 vmcardio cardDetail 拿地址 (需要 IP 白名单)
 *   如果地址来源是默认 KYC, 改 last_verified 标志位让用户知道是"默认 KYC"
 *
 * 用法:
 *   node scripts/migrate_v1.0.97_add_card_addresses.js
 *
 * 影响:
 *   - ALTER TABLE 6 列 (幂等)
 *   - UPDATE 现有卡 address_* 6 字段 (来自 .env 默认地址)
 *   - 备份 db → data/vcc.db.pre-v1.0.97.bak
 */
'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DB_PATH = path.join(__dirname, '..', 'data', 'vcc.db');
const BACKUP_PATH = path.join(__dirname, '..', 'data', 'vcc.db.pre-v1.0.97.bak');

const ADDRESS_COLUMNS = [
  'address_line_one',
  'address_line_two',
  'address_city',
  'address_state',
  'address_country',
  'address_post_code',
];

function step(msg) { console.log(`\n=== ${msg} ===`); }
function info(msg) { console.log(`  [INFO] ${msg}`); }
function ok(msg)   { console.log(`  [OK]   ${msg}`); }
function warn(msg) { console.log(`  [WARN] ${msg}`); }
function err(msg)  { console.error(`  [ERR]  ${msg}`); }

function backupDb() {
  if (fs.existsSync(BACKUP_PATH)) {
    info(`备份已存在, 跳过: ${path.basename(BACKUP_PATH)}`);
    return;
  }
  fs.copyFileSync(DB_PATH, BACKUP_PATH);
  ok(`备份已创建: ${path.basename(BACKUP_PATH)} (${(fs.statSync(BACKUP_PATH).size / 1024).toFixed(1)} KB)`);
}

function addColumnsIfMissing(db) {
  step('1. ALTER TABLE cards 加 6 个地址列');
  const existing = new Set(db.prepare('PRAGMA table_info(cards)').all().map(c => c.name));
  let added = 0;
  for (const col of ADDRESS_COLUMNS) {
    if (existing.has(col)) {
      info(`  列 ${col} 已存在, 跳过`);
      continue;
    }
    db.exec(`ALTER TABLE cards ADD COLUMN ${col} TEXT DEFAULT ''`);
    ok(`  新增列: ${col}`);
    added += 1;
  }
  if (added === 0) info('所有 6 列均已存在, 无需 ALTER');
  return added;
}

function getDefaultBillingAddress() {
  // 优先从 .env 读 VMCARDIO_DEFAULT_BILLING_ADDRESS
  // 这是商户 KYC 默认账单地址, 开卡时上游会用它写入 card_address
  const envVal = process.env.VMCARDIO_DEFAULT_BILLING_ADDRESS;
  if (envVal) {
    try {
      const parsed = JSON.parse(envVal);
      if (parsed && parsed.address_line_one) return { ...parsed, source: 'env_default' };
    } catch (e) {
      warn(`.env VMCARDIO_DEFAULT_BILLING_ADDRESS 解析失败: ${e.message}`);
    }
  }
  return null;
}

function backfillFromEnv(db) {
  step('2. 用 .env VMCARDIO_DEFAULT_BILLING_ADDRESS 回填现有卡');
  const addr = getDefaultBillingAddress();
  if (!addr) {
    warn('未配置 VMCARDIO_DEFAULT_BILLING_ADDRESS, 跳过回填');
    return { updated: 0 };
  }
  info(`默认地址: ${addr.address_line_one}, ${addr.city}, ${addr.state} ${addr.post_code}, ${addr.country}`);
  const result = db.prepare(`
    UPDATE cards
    SET address_line_one  = COALESCE(NULLIF(?, ''), address_line_one),
        address_line_two  = COALESCE(NULLIF(?, ''), address_line_two),
        address_city      = COALESCE(NULLIF(?, ''), address_city),
        address_state     = COALESCE(NULLIF(?, ''), address_state),
        address_country   = COALESCE(NULLIF(?, ''), address_country),
        address_post_code = COALESCE(NULLIF(?, ''), address_post_code)
    WHERE address_line_one = '' OR address_line_one IS NULL
  `).run(
    addr.address_line_one || '',
    addr.address_line_two || '',
    addr.city || '',
    addr.state || '',
    addr.country || '',
    addr.post_code || ''
  );
  ok(`已回填 ${result.changes} 张卡 (默认 KYC 地址)`);
  return { updated: result.changes, address: addr };
}

async function backfillFromUpstream(db) {
  step('3. 尝试从 vmcardio 上游 cardDetail 回填剩余空地址卡 (需 IP 白名单)');
  let VmcardioSDK;
  try { VmcardioSDK = require('../src/services/vmcardioSDK'); }
  catch (e) { warn(`加载 vmcardioSDK 失败: ${e.message}, 跳过上游回填`); return { updated: 0 }; }

  const emptyCards = db.prepare(`
    SELECT id, card_id, user_id FROM cards
    WHERE address_line_one = '' OR address_line_one IS NULL
  `).all();
  if (emptyCards.length === 0) {
    info('没有空地址卡, 跳过上游回填');
    return { updated: 0 };
  }
  info(`待回填 ${emptyCards.length} 张空地址卡`);

  const sdk = VmcardioSDK;
  let updated = 0, failed = 0;
  for (const card of emptyCards) {
    try {
      const detail = await sdk.cardDetail(card.card_id);
      const line1 = detail?.address_line_one || '';
      if (!line1) {
        warn(`  card ${card.card_id}: 上游也返回空地址, 跳过`);
        continue;
      }
      db.prepare(`
        UPDATE cards SET
          address_line_one  = COALESCE(NULLIF(?, ''), address_line_one),
          address_line_two  = COALESCE(NULLIF(?, ''), address_line_two),
          address_city      = COALESCE(NULLIF(?, ''), address_city),
          address_state     = COALESCE(NULLIF(?, ''), address_state),
          address_country   = COALESCE(NULLIF(?, ''), address_country),
          address_post_code = COALESCE(NULLIF(?, ''), address_post_code)
        WHERE id = ?
      `).run(
        line1, detail?.address_line_two || '',
        detail?.city || '', detail?.state || '',
        detail?.country || '', detail?.post_code || '',
        card.id
      );
      updated += 1;
      ok(`  card ${card.card_id}: 上游回填成功 (${line1}, ${detail?.city})`);
    } catch (e) {
      failed += 1;
      warn(`  card ${card.card_id}: 上游回填失败: ${e.message?.slice(0, 80)}`);
    }
  }
  ok(`上游回填完成: 成功 ${updated} 张, 失败 ${failed} 张`);
  return { updated, failed };
}

function summary(db) {
  step('4. 回填结果统计');
  const total = db.prepare('SELECT COUNT(*) AS c FROM cards').get().c;
  const filled = db.prepare(`SELECT COUNT(*) AS c FROM cards WHERE address_line_one <> '' AND address_line_one IS NOT NULL`).get().c;
  const empty = total - filled;
  console.log(`  总卡数: ${total}`);
  console.log(`  有地址: ${filled}`);
  console.log(`  无地址: ${empty}`);
  if (total > 0) {
    console.log(`  覆盖率: ${((filled / total) * 100).toFixed(1)}%`);
  }
  return { total, filled, empty };
}

async function main() {
  step('0. 备份数据库');
  if (!fs.existsSync(DB_PATH)) { err(`数据库不存在: ${DB_PATH}`); process.exit(1); }
  backupDb();

  const db = new Database(DB_PATH);
  try {
    addColumnsIfMissing(db);
    const envResult = backfillFromEnv(db);
    const upstreamResult = await backfillFromUpstream(db);
    const stats = summary(db);
    step('✅ migration 完成');
    console.log(`  ALTER: 已就绪`);
    console.log(`  ENV 回填: ${envResult.updated} 张`);
    console.log(`  Upstream 回填: ${upstreamResult.updated} 张成功, ${upstreamResult.failed || 0} 张失败`);
    console.log(`  最终: ${stats.filled}/${stats.total} 张有地址 (${((stats.filled / Math.max(1, stats.total)) * 100).toFixed(1)}%)`);
  } catch (e) {
    err(`migration 失败: ${e.message}\n${e.stack}`);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
