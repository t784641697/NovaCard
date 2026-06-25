/**
 * 注销两张卡 + 退余额到用户可用余额
 */
const path = require('path');
const db = require('../src/db');
const BalanceService = require('../src/services/balanceService');

const cards = [
  { card_id: '2070026247985041410', product_code: 'S5395YL', amount: 20, last4: '1127' },
  { card_id: '2070014407300485121', product_code: 'S5331GL', amount: 20, last4: '3108' }
];

const userId = 3;

try {
  db.transaction(() => {
    for (const card of cards) {
      // 1. 更新卡状态为 cancelled
      const r1 = db.prepare('UPDATE cards SET status = ?, available_amount = 0 WHERE card_id = ?').run('cancelled', card.card_id);
      console.log(`卡 ${card.card_id} 状态 → cancelled, available_amount → 0, changes: ${r1.changes}`);

      // 2. 退回余额到用户可用余额
      BalanceService.recordRefund(
        userId, 
        card.amount, 
        0, 
        card.amount, 
        `[卡注销退款] ${card.product_code} ****${card.last4} 余额退还 $${card.amount.toFixed(2)}`, 
        card.card_id
      );
      console.log(`卡 ${card.card_id} 余额 $${card.amount} 已退回用户 ${userId}`);
    }

    const u = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
    console.log(`\n用户 ${userId} 最新余额: $${u.balance}`);
  })();
} catch (err) {
  console.error('执行失败:', err.message);
  process.exit(1);
}
