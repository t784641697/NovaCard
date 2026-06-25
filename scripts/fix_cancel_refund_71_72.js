/**
 * 修复 id=71 和 id=72 的退款记录（卡注销退款参数传错）
 * 错误: recordRefund(userId, 20, 0, 20, ...) → netReturn = 20-20 = 0
 * 正确: recordRefund(userId, 20, 'card_delete_refund', 0, ...) → netReturn = 20-0 = 20
 */
const path = require('path');
const db = require(path.join(__dirname, '..', 'src', 'db'));

db.transaction(() => {
  // 修复 id=71 (S5395YL ****1127)
  db.prepare('UPDATE transactions SET amount = ?, fee_type = ?, fee_amount = ?, net_amount = ? WHERE id = ?')
    .run(20, 'card_delete_refund', 0, 20, 71);
  console.log('id=71 已修复: amount=20, fee_type=card_delete_refund, fee_amount=0, net_amount=20');

  // 修复 id=72 (S5331GL ****3108)
  db.prepare('UPDATE transactions SET amount = ?, fee_type = ?, fee_amount = ?, net_amount = ? WHERE id = ?')
    .run(20, 'card_delete_refund', 0, 20, 72);
  console.log('id=72 已修复: amount=20, fee_type=card_delete_refund, fee_amount=0, net_amount=20');

  // 用户余额修正: 两笔退款各少加了20，共少40
  const u = db.prepare('SELECT balance FROM users WHERE id = 3').get();
  const newBalance = parseFloat((u.balance + 40).toFixed(2));
  db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBalance, 3);
  console.log(`用户3余额: ${u.balance} → ${newBalance}`);
})();
