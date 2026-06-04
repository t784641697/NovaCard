const DB = require('better-sqlite3')('./data/vcc.db');
DB.pragma('journal_mode = WAL');

// 检查数据库完整性
const check = DB.pragma('integrity_check');
console.log('Integrity:', JSON.stringify(check));

// 检查 cards 表是否有 card_type
const cardCols = DB.prepare("PRAGMA table_info(cards)").all();
const cardTypes = cardCols.map(c => c.name);
console.log('Cards cols:', cardTypes.join(', '));
console.log('Has card_type:', cardTypes.includes('card_type'));

// 检查 fee_configs
const feeCount = DB.prepare('SELECT COUNT(*) c FROM fee_configs').get();
console.log('Fee configs:', feeCount.c);

// 检查用户
const users = DB.prepare('SELECT id, email, balance, role FROM users').all();
console.log('Users:', JSON.stringify(users));

// 补录历史数据
const now = new Date().toISOString();

// 设置用户余额
DB.prepare("UPDATE users SET balance = 30, topup_total = 30 WHERE id = 2").run();
console.log('Balance set');

// Topup request
DB.prepare("INSERT INTO topup_requests (user_id, network, amount_usdt, txhash, remark, status, created_at, updated_at) VALUES (2, 'TRC20', 30, 'HISTORY-TOPUP-202605', '历史充值记录（补录）', 'approved', ?, ?)").run(now, now);
console.log('Topup request created');

// Transaction
DB.prepare("INSERT INTO transactions (user_id, type, amount, net_amount, description, ref_id, created_at) VALUES (2, '充值', 30, 30, '账户充值 30（历史记录补录）', 'topup_hist_001', ?)").run(now);
console.log('Transaction created');

// Audit log - 只插入存在的列
const auditCols = DB.prepare("PRAGMA table_info(audit_logs)").all().map(c => c.name);
if (auditCols.includes('target_type')) {
  DB.prepare("INSERT INTO audit_logs (user_id, action, target_type, target_id, details, created_at) VALUES (1, '余额修正', 'user', 2, '删库重建后恢复：余额设回30，补录充值申请+交易流水', ?)").run(now);
} else if (auditCols.includes('detail')) {
  DB.prepare("INSERT INTO audit_logs (user_id, action, detail, created_at) VALUES (1, '余额修正', '删库重建后恢复：余额设回30，补录充值申请+交易流水', ?)").run(now);
}
console.log('Audit log created (if cols exist)');

DB.pragma('wal_checkpoint(TRUNCATE)');
DB.close();
console.log('ALL DONE');