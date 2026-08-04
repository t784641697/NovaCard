require('dotenv').config();
const db = require('../src/db');
const rows = db.prepare(`
  SELECT u.id as user_id, u.email, u.balance,
    (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE user_id=u.id AND type IN ('充值','管理员充值')) as topup_total,
    COALESCE((SELECT SUM(ABS(amount)) FROM transactions WHERE user_id=u.id AND type IN ('消费','管理员扣款')),0) - COALESCE((SELECT SUM(ABS(amount)) FROM transactions WHERE user_id=u.id AND type='退款'),0) as total_spend,
    COALESCE((SELECT SUM(ABS(amount)) FROM transactions WHERE user_id=u.id AND type='退款'),0) as total_refund,
    (SELECT COALESCE(SUM(available_amount),0) FROM cards WHERE user_id=u.id AND status!='deleted') as card_balance
  FROM users u WHERE u.id=36
`).all();
console.log(JSON.stringify(rows, null, 2));
