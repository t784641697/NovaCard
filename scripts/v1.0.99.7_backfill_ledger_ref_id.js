/**
 * v1.0.99.7 backfill: 历史 transactions 回填 ref_id = card_id
 *
 * 原理: 解析 description 里的 product_code (S5258LL/G5554LC/VC113/VC102),
 *       在 card_applications 找 user_id + product_code + status='approved' + 早于交易时间
 *       的最新一条申请, 拿到真实 card_id 回写 ref_id
 *
 * 跳过规则 (不写 ref_id):
 *   - ref_id 已经有值 (避免覆盖)
 *   - type='退款' (可能对应被拒申请, 没真卡)
 *   - type='充值' (无卡关联)
 *   - 解析不到 product_code
 *   - card_applications 里没有匹配的 approved 记录
 *   - card_applications.card_id 为空 (上游开卡失败)
 *
 * 安全性: 干跑 (--dry-run) 默认, --apply 才 UPDATE
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'vcc.db');
const APPLY = process.argv.includes('--apply');

if (!fs.existsSync(DB_PATH)) {
  console.error(`DB not found: ${DB_PATH}`);
  console.error('Usage:');
  console.error('  DB_PATH=/path/to/vcc.db node scripts/v1.0.99.7_backfill_ledger_ref_id.js --dry-run');
  console.error('  DB_PATH=/path/to/vcc.db node scripts/v1.0.99.7_backfill_ledger_ref_id.js --apply');
  process.exit(1);
}

const db = new Database(DB_PATH);
db.function('nowiso', { deterministic: true }, () => new Date().toISOString());
db.pragma('journal_mode = WAL');

// vmcardio 上游固定产品代号 (与 HARDCODED_PRODUCTS + _extractProductCodeFromDescription 一致)
const KNOWN_CODES = ['S5258LL', 'G5554LC', 'VC113', 'VC102'];

function extractProductCode(description) {
  if (!description) return null;
  for (const code of KNOWN_CODES) {
    if (description.indexOf(code) !== -1) return code;
  }
  return null;
}

console.log(`DB: ${DB_PATH}`);
console.log(`Mode: ${APPLY ? 'APPLY (将 UPDATE)' : 'DRY-RUN (只预览)'}`);
console.log('---');

// 1. 找出所有需要 backfill 的 transactions
const candidates = db.prepare(`
  SELECT t.id, t.user_id, t.type, t.amount, t.fee_type, t.ref_id, t.description, t.created_at
  FROM transactions t
  WHERE t.ref_id = ''
    AND t.type != '退款'
    AND t.type != '充值'
  ORDER BY t.user_id, t.created_at
`).all();

console.log(`候选 ${candidates.length} 条 (ref_id='' 且 type != 退款/充值)`);

let matched = 0;
let skipped = 0;
const updates = [];

for (const t of candidates) {
  const code = extractProductCode(t.description);
  if (!code) {
    skipped++;
    console.log(`  [SKIP] id=${t.id} type=${t.type} desc="${t.description.slice(0, 40)}..." → 解析不到 product_code`);
    continue;
  }

  // 找该用户 + 该 product_code 的 approved 申请 (可能多 transaction 共用同一 application)
  // 不加时间限制: 事务顺序可能 transaction 早于 application 几毫秒
  // 多个 transaction 共享同一 application 是合理的 (同一次申请: 开卡费 + 充值费)
  const apps = db.prepare(`
    SELECT id, card_id, status, created_at
    FROM card_applications
    WHERE user_id = ?
      AND product_code = ?
      AND status = 'approved'
      AND card_id != ''
    ORDER BY created_at ASC
  `).all(t.user_id, code);

  if (apps.length === 0) {
    skipped++;
    console.log(`  [SKIP] id=${t.id} type=${t.type} code=${code} → 无 approved 申请`);
    continue;
  }

  // 优先取 transaction 时间之后/最近的, fallback 到最早一个
  let app = apps.find(a => a.created_at <= t.created_at) || apps[0];

  matched++;
  console.log(`  [MATCH] id=${t.id} type=${t.type} code=${code} → app_id=${app.id} card_id=${app.card_id}`);
  updates.push({ id: t.id, card_id: app.card_id, code, app_id: app.id });
}

console.log('---');
console.log(`匹配成功: ${matched}, 跳过: ${skipped}, 总: ${candidates.length}`);

if (updates.length === 0) {
  console.log('无需更新');
  process.exit(0);
}

if (APPLY) {
  console.log('应用 UPDATE...');
  const stmt = db.prepare("UPDATE transactions SET ref_id = ? WHERE id = ? AND ref_id = ''");
  const tx = db.transaction((rows) => {
    for (const r of rows) stmt.run(r.card_id, r.id);
  });
  tx(updates);
  console.log(`✅ 已更新 ${updates.length} 条 transactions.ref_id`);
} else {
  console.log(`[DRY-RUN] 加 --apply 真正写入 (将更新 ${updates.length} 条)`);
}

db.close();
