/**
 * v1.0.94 历史数据补 records 脚本
 *
 * 背景：
 *   v1.0.94 之前，cards.js 申请开卡时只走 recordSpend($1 开卡费) + UPDATE balance -$20(充值冻结)
 *   不写"充值冻结"的 transactions 记录。
 *   admin.js 拒绝/失败时也只 UPDATE balance +$21(退还)，不写"退款" transactions 记录。
 *   → 用户看 transactions 流水只见"开卡费 -$1"，不见"充值冻结 -$20"和"退款 +$21"，
 *     误以为"2 笔开卡费没退"。
 *   实际余额是对的。
 *
 * 修复：
 *   给历史数据补 transactions 记录，让流水显示完整：
 *   - 申请时补 1 条 "消费 -$20 充值冻结"（type='消费', fee_type='card_creation', amount=-20, fee_amount=0）
 *   - 拒绝/失败时补 1 条 "退款 +$21"（type='退款', amount=+21）
 *
 * 使用：
 *   node scripts/migrate_v1.0.94_backfill_transactions.js
 *
 * 幂等：检查同 description + created_at 是否已存在，存在则跳过。
 */

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.argv[2] || path.join(__dirname, '..', 'data', 'vcc.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const insertTxn = db.prepare(`
  INSERT INTO transactions
    (user_id, type, amount, fee_type, fee_amount, net_amount, description, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const exists = db.prepare(`
  SELECT id FROM transactions
  WHERE user_id = ? AND type = ? AND amount = ? AND description = ? AND created_at = ?
`);

let insertedCount = 0;
let skippedCount = 0;

const apps = db.prepare(`
  SELECT id, user_id, product_code, status, fee_amount, topup_amount, quantity, created_at, updated_at
  FROM card_applications
  WHERE created_at >= '2026-01-01'
  ORDER BY id ASC
`).all();

console.log(`共 ${apps.length} 条开卡申请记录，检查可补流水...`);

db.transaction(() => {
  for (const app of apps) {
    const feeAmount = Number(app.fee_amount) || 0;
    const topupAmount = Number(app.topup_amount) || 0;
    const qty = Math.max(1, Number(app.quantity) || 1);
    const frozenTotal = topupAmount * qty;       // 申请时冻结的充值总额

    // ── 1) 补"充值冻结 -$X"流水（申请时点） ──
    if (frozenTotal > 0) {
      const desc1 = `[补 v1.0.94] 申请 #${app.id} 充值冻结 $${frozenTotal.toFixed(2)} (${app.product_code} x ${qty})`;
      const row1 = exists.get(app.user_id, '消费', -frozenTotal, desc1, app.created_at);
      if (row1) {
        skippedCount++;
      } else {
        insertTxn.run(
          app.user_id,
          '消费',
          -frozenTotal,
          'card_creation',  // 共用 fee_type 标识开卡场景
          0,                // fee_amount=0（开卡费在另一条流水）
          -frozenTotal,
          desc1,
          app.created_at
        );
        insertedCount++;
        console.log(`  + 申请 #${app.id} (${app.product_code} x ${qty}) 补 充值冻结 -$${frozenTotal}`);
      }
    }

    // ── 2) 补"退款 +$X"流水（拒绝/失败时点） ──
    if (app.status === 'rejected') {
      const refundTotal = feeAmount + frozenTotal;
      if (refundTotal > 0) {
        const desc2 = `[补 v1.0.94] 申请 #${app.id} 被拒绝/失败，退还开卡费+充值 $${refundTotal.toFixed(2)} (${app.product_code} x ${qty})`;
        const row2 = exists.get(app.user_id, '退款', refundTotal, desc2, app.updated_at);
        if (row2) {
          skippedCount++;
        } else {
          insertTxn.run(
            app.user_id,
            '退款',
            refundTotal,
            'card_creation',
            0,
            refundTotal,
            desc2,
            app.updated_at
          );
          insertedCount++;
          console.log(`  + 申请 #${app.id} (${app.product_code} x ${qty}) 补 拒绝退款 +$${refundTotal}`);
        }
      }
    }
  }
})();

console.log(`\n完成: 补 ${insertedCount} 条流水, 跳过 ${skippedCount} 条已存在`);
console.log('提示: 余额字段未修改（实际余额已正确，流水仅用于显示）');

// 验证：列出 user 3 现在的所有流水
const user3 = db.prepare(`
  SELECT id, type, amount, fee_type, description, created_at
  FROM transactions WHERE user_id = 3
  ORDER BY created_at ASC
`).all();
console.log(`\nuser 3 当前 ${user3.length} 条流水:`);
for (const t of user3) {
  console.log(`  ${t.created_at}  ${t.type.padEnd(4)}  ${t.amount.toString().padStart(7)}  ${t.description}`);
}

db.close();
