/**
 * v1.0.97 给 cards 表加账单地址字段 + 回填脚本
 *
 * 背景：
 *   v1.0.96 之前, cards 表完全没地址字段。
 *   但 v1.0.17 申请开卡时 admin.js 已经传 VMCARDIO_DEFAULT_BILLING_ADDRESS 给上游,
 *   上游 vmcardio 把地址写入 card_address 字段, SDK 拍平后存于 detail.city/state/...
 *   persistCardDetailToDb (cards.js:295) 只写限额没写地址 → /api/cards 列表拿不到
 *   前端 cardData.address_line_one 等都是 undefined → '—'
 *
 * 修复：
 *   1) ALTER TABLE cards 加 6 列 (address_line_one, address_line_two, address_city, address_state, address_country, address_post_code)
 *   2) 遍历所有 card_id 调 vmcardio cardDetail 拿地址 → UPDATE cards
 *   3) 跳过已经填过地址的卡 (NULLIF(?,'') 只在空时覆盖)
 *
 * 使用:
 *   node scripts/migrate_v1.0.97_add_card_addresses.js
 *
 * 幂等: ALTER TABLE 加列用 IF NOT EXISTS, UPDATE 用 COALESCE + NULLIF 跳过非空字段。
 */

const path = require('path');
const Database = require('better-sqlite3');
const VmcardioSDK = require('../src/services/vmcardioSDK');

const DB_PATH = process.argv[2] || path.join(__dirname, '..', 'data', 'vcc.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

console.log(`[v1.0.97] DB: ${DB_PATH}`);

// ── 1) ALTER TABLE 加列 (SQLite 不支持 IF NOT EXISTS, 捕获重复错误) ──
const newCols = [
  'address_line_one',
  'address_line_two',
  'address_city',
  'address_state',
  'address_country',
  'address_post_code',
];

console.log('\n[1/2] ALTER TABLE cards 加 6 个地址列...');
for (const col of newCols) {
  try {
    db.exec(`ALTER TABLE cards ADD COLUMN ${col} TEXT DEFAULT ''`);
    console.log(`  ✓ 加 ${col}`);
  } catch (e) {
    if (e.code === 'SQLITE_ERROR' && /duplicate column/i.test(e.message)) {
      console.log(`  · ${col} 已存在, 跳过`);
    } else {
      throw e;
    }
  }
}

// ── 2) 回填现有卡的地址 ──
console.log('\n[2/2] 回填现有卡的地址 (调 vmcardio cardDetail)...');
const sdk = VmcardioSDK; // 单例

const cards = db.prepare(`SELECT card_id FROM cards ORDER BY id ASC`).all();
console.log(`  共 ${cards.length} 张卡`);

const updateAddr = db.prepare(`
  UPDATE cards SET
    address_line_one   = COALESCE(NULLIF(?, ''), address_line_one),
    address_line_two   = COALESCE(NULLIF(?, ''), address_line_two),
    address_city       = COALESCE(NULLIF(?, ''), address_city),
    address_state      = COALESCE(NULLIF(?, ''), address_state),
    address_country    = COALESCE(NULLIF(?, ''), address_country),
    address_post_code  = COALESCE(NULLIF(?, ''), address_post_code)
  WHERE card_id = ?
`);

let updatedCount = 0;
let skippedCount = 0;
let failedCount = 0;

(async () => {
  for (const card of cards) {
    try {
      const detail = await sdk.cardDetail(card.card_id);
      if (!detail) {
        console.log(`  · ${card.card_id} 上游返回空, 跳过`);
        skippedCount++;
        continue;
      }
      const r = updateAddr.run(
        detail.address_line_one || '',
        detail.address_line_two || '',
        detail.city || '',
        detail.state || '',
        detail.country || '',
        detail.post_code || '',
        card.card_id
      );
      if (r.changes > 0) {
        updatedCount++;
        console.log(`  ✓ ${card.card_id} | ${detail.city || ''} ${detail.country || ''}`);
      } else {
        skippedCount++;
        console.log(`  · ${card.card_id} 无变化`);
      }
    } catch (e) {
      failedCount++;
      console.log(`  ✗ ${card.card_id} 失败: ${e.message}`);
    }
  }

  console.log(`\n=== 汇总 ===`);
  console.log(`  更新: ${updatedCount}`);
  console.log(`  跳过: ${skippedCount}`);
  console.log(`  失败: ${failedCount}`);
  console.log(`  总计: ${cards.length}`);

  db.close();
})();
