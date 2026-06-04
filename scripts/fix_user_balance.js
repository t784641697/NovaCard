/**
 * 修复用户2 (user@vcc.hub) 的余额与充值记录
 * 
 * 用户确认：只充值过一次 $30，没有任何消费
 * 
 * 当前错误状态：topup_total=200，但充值记录表为空
 * 修复：topup_total=30，balance=30，补充充值记录
 */
const db = require('./src/db');
const BalanceService = require('./src/services/balanceService');

const userId = 2;
const correctBalance = 30;

// 查看当前状态
const user = db.prepare("SELECT id, email, balance, topup_total, total_spend, total_fees, total_chargeback FROM users WHERE id = ?").get(userId);
console.log("===== 当前状态 =====");
console.log(JSON.stringify(user, null, 2));

// 检查是否有任何充值记录
const topups = db.prepare("SELECT COUNT(*) as c FROM topup_requests WHERE user_id = ?").get(userId);
console.log("充值记录数:", topups.c);

// 检查是否有任何交易记录
const txns = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE user_id = ?").get(userId);
console.log("交易记录数:", txns.c);

// 开始修复事务
const fix = db.transaction(() => {
  // 1. 修正 topup_total 和 balance
  db.prepare(`
    UPDATE users 
    SET balance = ?,
        topup_total = ?,
        total_spend = 0,
        total_fees = 0,
        total_chargeback = 0,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(correctBalance, correctBalance, userId);
  
  // 2. 补充一条充值记录
  db.prepare(`
    INSERT INTO topup_requests (user_id, amount_usdt, status, created_at, updated_at)
    VALUES (?, ?, 'completed', datetime('now'), datetime('now'))
  `).run(userId, correctBalance);
  
  // 3. 补充交易记录
  db.prepare(`
    INSERT INTO transactions (user_id, type, amount, net_amount, description, created_at)
    VALUES (?, 'topup', ?, ?, '余额修正：用户确认仅充值$30', datetime('now'))
  `).run(userId, correctBalance, correctBalance);
});

// 执行修复
try {
  fix();
  console.log("\n===== 修复成功 =====");
  const fixed = db.prepare("SELECT id, email, balance, topup_total, total_spend, total_fees, total_chargeback FROM users WHERE id = ?").get(userId);
  console.log(JSON.stringify(fixed, null, 2));
  const newTopups = db.prepare("SELECT * FROM topup_requests WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(userId);
  console.log("\n新充值记录:", JSON.stringify(newTopups, null, 2));
} catch (e) {
  console.error("修复失败:", e.message);
  process.exit(1);
}