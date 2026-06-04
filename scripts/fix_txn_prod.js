const Database = require('better-sqlite3');
const db = new Database('/opt/vcc-hub/data/vcc.db');
db.pragma('journal_mode = WAL');

// 全量重建索引
db.exec('REINDEX');
console.log('REINDEX OK');

// 检查完整性
const qi = db.prepare('PRAGMA quick_check').get();
console.log('quick_check:', JSON.stringify(qi));

// 插入交易记录
const sql = "INSERT INTO transactions (user_id, type, amount, net_amount, fee_type, fee_amount, description, ref_id) VALUES (2, 'topup', 30, 30, '', 0, '账户充值 $30', 'TXN-20260604-topup')";
const result = db.prepare(sql).run();
console.log('已创建交易记录, id=' + result.lastInsertRowid);

// WAL checkpoint
db.pragma('wal_checkpoint(TRUNCATE)');

// 验证
const v = db.prepare('SELECT id, user_id, type, amount, description FROM transactions WHERE user_id=2').all();
console.log('交易记录:', JSON.stringify(v));
db.close();