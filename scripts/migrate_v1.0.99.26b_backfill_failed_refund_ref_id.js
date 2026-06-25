/**
 * v1.0.99.26b: 回填剩余"开卡失败"退款流水的 ref_id
 * 
 * 这些退款流水 description = "开卡申请-开卡失败，退还开卡费+充值冻结"
 * 没有产品代码，无法直接提取。策略：找同一用户、时间最近的 card_creation 消费流水，
 * 复用其 ref_id。
 */
const path = require('path');
const db = require(path.join(__dirname, '..', 'src', 'db'));

console.log('=== v1.0.99.26b 回填"开卡失败"退款流水 ref_id ===\n');

// 找到所有 ref_id 为空的"开卡失败"退款
const refundTxns = db.prepare(`
  SELECT id, user_id, description, ref_id, created_at
  FROM transactions
  WHERE type = '退款' AND fee_type = 'card_creation' AND (ref_id IS NULL OR ref_id = '')
`).all();
console.log(`找到 ${refundTxns.length} 条"开卡失败"退款待处理\n`);

let updated = 0;
let skipped = 0;

for (const txn of refundTxns) {
  // 找同一用户、时间最近的 card_creation 消费流水（在退款之前几秒内创建）
  const spend = db.prepare(`
    SELECT id, ref_id, description, created_at
    FROM transactions
    WHERE user_id = ? AND type = '消费' AND fee_type = 'card_creation'
      AND ref_id IS NOT NULL AND ref_id != ''
      AND julianday(created_at) <= julianday(?)
      AND julianday(?) - julianday(created_at) < 0.01
    ORDER BY ABS(julianday(created_at) - julianday(?))
    LIMIT 1
  `).get(txn.user_id, txn.created_at, txn.created_at, txn.created_at);

  if (!spend) {
    console.log(`  [SKIP] refund#${txn.id}: 找不到匹配的消费流水`);
    skipped++;
    continue;
  }

  db.prepare('UPDATE transactions SET ref_id = ? WHERE id = ?').run(spend.ref_id, txn.id);
  console.log(`  [OK] refund#${txn.id}: ref_id = "${spend.ref_id}" (匹配 spend#${spend.id})`);
  updated++;
}

console.log(`\n=== 完成: 更新 ${updated} 条, 跳过 ${skipped} 条 ===`);
