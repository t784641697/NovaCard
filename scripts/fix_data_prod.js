const DB = require('better-sqlite3')('/opt/vcc-hub/data/vcc.db');
DB.pragma('journal_mode = WAL');

const now = new Date().toISOString();

// 用户余额
DB.prepare('UPDATE users SET balance = 30, topup_total = 30 WHERE id = 2').run();
console.log('Balance set to 30');

// 充值申请
DB.prepare("INSERT INTO topup_requests (user_id, network, amount_usdt, txhash, remark, status, created_at, updated_at) VALUES (2, 'TRC20', 30, 'HISTORY-TOPUP-202605', '历史充值记录（补录）', 'approved', ?, ?)").run(now, now);
console.log('Topup request created');

// 交易流水
DB.prepare('INSERT INTO transactions (user_id, type, amount, net_amount, description, ref_id, created_at) VALUES (2, ?, 30, 30, ?, ?, ?)').run('充值', '账户充值 30（历史记录补录）', 'topup_hist_001', now);
console.log('Transaction created');

DB.pragma('wal_checkpoint(TRUNCATE)');
DB.close();
console.log('ALL DONE');