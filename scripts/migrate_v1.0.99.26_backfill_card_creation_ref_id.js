/**
 * v1.0.99.26: 回填 card_creation 流水的 ref_id
 * 
 * 问题：历史 card_creation 流水 ref_id 为空，导致前端「关联卡号」列只能显示产品名（如 S5258LL）而非掩码卡号
 * 修复：通过 card_applications 表关联，将 ref_id 更新为：
 *   - approved 申请 → 真实 card_id（前端 LEFT JOIN 能拿到 card_number）
 *   - rejected 申请 → app_rejected:N:CODE（前端显示"未开卡成功"）
 *   - pending 申请 → app:N（前端显示"审批中"）
 * 
 * 匹配策略：按 user_id + product_code + created_at 时间接近度匹配
 */
const path = require('path');
const db = require(path.join(__dirname, '..', 'src', 'db'));

console.log('=== v1.0.99.26 回填 card_creation 流水 ref_id ===\n');

// 1. 获取所有 card_creation 流水（ref_id 为空的）
const txns = db.prepare(`
  SELECT t.id, t.user_id, t.description, t.ref_id, t.created_at
  FROM transactions t
  WHERE t.fee_type = 'card_creation' AND (t.ref_id IS NULL OR t.ref_id = '')
`).all();
console.log(`找到 ${txns.length} 条 card_creation 流水待处理\n`);

let updated = 0;
let skipped = 0;

for (const txn of txns) {
  // 从 description 提取 product_code（格式：申请 N 张虚拟卡 XXXX（...））
  const codeMatch = txn.description.match(/虚拟卡\s+([A-Z0-9]+)/);
  if (!codeMatch) {
    console.log(`  [SKIP] txn#${txn.id}: 无法从 description 提取产品代码: "${txn.description}"`);
    skipped++;
    continue;
  }
  const productCode = codeMatch[1];

  // 查找匹配的 card_application（同 user_id + 同 product_code + 时间接近）
  // 创建时间：application 的 created_at 应该 ≈ transaction 的 created_at
  const app = db.prepare(`
    SELECT id, user_id, product_code, status, card_id, created_at
    FROM card_applications
    WHERE user_id = ? AND product_code = ?
    ORDER BY ABS(julianday(created_at) - julianday(?))
    LIMIT 1
  `).get(txn.user_id, productCode, txn.created_at);

  if (!app) {
    console.log(`  [SKIP] txn#${txn.id}: 找不到匹配的申请记录 (user_id=${txn.user_id}, product_code=${productCode})`);
    skipped++;
    continue;
  }

  let newRefId;
  if (app.status === 'approved' && app.card_id) {
    // 已审批通过 → 用 card_id（前端 LEFT JOIN 能找到 card_number）
    newRefId = app.card_id.split(',')[0]; // 取第一个 card_id（多卡场景）
  } else if (app.status === 'rejected') {
    // 已拒绝 → app_rejected:N:CODE
    newRefId = `app_rejected:${app.id}:${app.product_code}`;
  } else {
    // 仍待审批 → app:N
    newRefId = `app:${app.id}`;
  }

  db.prepare('UPDATE transactions SET ref_id = ? WHERE id = ?').run(newRefId, txn.id);
  console.log(`  [OK] txn#${txn.id}: ref_id = "${newRefId}" (app#${app.id}, status=${app.status})`);
  updated++;
}

// 2. 同步回填退款流水的 ref_id（rejected 申请的退款流水）
const refundTxns = db.prepare(`
  SELECT t.id, t.user_id, t.description, t.ref_id, t.type
  FROM transactions t
  WHERE t.type = '退款' AND t.fee_type = 'card_creation' AND (t.ref_id IS NULL OR t.ref_id = '')
`).all();
console.log(`\n找到 ${refundTxns.length} 条退款流水待处理\n`);

for (const txn of refundTxns) {
  // 从 description 提取 product_code
  // 格式1: "开卡申请（G5237OH x 1）被拒绝，退还开卡费+充值冻结"
  // 格式2: "开卡申请-开卡失败，退还开卡费+充值冻结" (无产品代码)
  const codeMatch = txn.description.match(/[（(]([A-Z0-9]+)\s*x/);
  if (!codeMatch) {
    console.log(`  [SKIP] refund#${txn.id}: 无法提取产品代码: "${txn.description}"`);
    skipped++;
    continue;
  }
  const productCode = codeMatch[1];

  // 查找匹配的 rejected application
  const app = db.prepare(`
    SELECT id, user_id, product_code, status
    FROM card_applications
    WHERE user_id = ? AND product_code = ? AND status = 'rejected'
    ORDER BY id DESC
    LIMIT 1
  `).get(txn.user_id, productCode);

  if (!app) {
    console.log(`  [SKIP] refund#${txn.id}: 找不到匹配的拒绝申请`);
    skipped++;
    continue;
  }

  const newRefId = `app_rejected:${app.id}:${app.product_code}`;
  db.prepare('UPDATE transactions SET ref_id = ? WHERE id = ?').run(newRefId, txn.id);
  console.log(`  [OK] refund#${txn.id}: ref_id = "${newRefId}"`);
  updated++;
}

console.log(`\n=== 完成: 更新 ${updated} 条, 跳过 ${skipped} 条 ===`);
