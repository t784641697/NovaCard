const Database = require('better-sqlite3');
const db = new Database('/opt/vcc-hub/data/vcc.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 检查当前状态
const u = db.prepare('SELECT id, balance, topup_total FROM users WHERE id=2').get();
console.log('用户状态:', JSON.stringify(u));

// 创建充值申请记录 (适配表结构)
const reqCols = db.prepare("PRAGMA table_info(topup_requests)").all().map(c => c.name);
console.log('topup_requests 列:', reqCols);

// 插入 topup_request
const sql = 'INSERT INTO topup_requests (' + reqCols.filter(c => !['id','created_at','updated_at'].includes(c)).join(',') + 
            ') VALUES (' + reqCols.filter(c => !['id','created_at','updated_at'].includes(c)).map(() => '?').join(',') + ')';
const vals = reqCols.filter(c => !['id','created_at','updated_at'].includes(c)).map(c => {
  switch(c) {
    case 'user_id': return 2;
    case 'network': return 'USDT-TRC20';
    case 'amount_usdt': return 30;
    case 'status': return 'completed';
    case 'txhash': return 'MANUAL-TOPUP-20260604';
    case 'remark': return '账户充值';
    default: return null;
  }
});

try {
  const r = db.prepare(sql).run(...vals);
  console.log('充值申请已创建, id=' + r.lastInsertRowid);
} catch(e) {
  console.log('插入topup_requests失败:', e.message);
}

// 插入交易记录
try {
  const result = db.prepare('INSERT INTO transactions (user_id, type, amount, net_amount, fee_type, fee_amount, description, ref_id) VALUES (2, ?, 30, 30, ?, 0, ?, ?)').run('topup', '', '账户充值 $30', 'TXN-20260604-topup');
  console.log('交易记录已创建, id=' + result.lastInsertRowid);
} catch(e) {
  console.log('插入transactions失败:', e.message);
}

// WAL checkpoint - 确保持久化
db.pragma('wal_checkpoint(TRUNCATE)');

// 验证
const v = db.prepare("SELECT id, user_id, type, amount, description FROM transactions WHERE user_id=2").all();
console.log('交易:', JSON.stringify(v));
const r2 = db.prepare("SELECT id, user_id, amount_usdt, status FROM topup_requests WHERE user_id=2").all();
console.log('充值:', JSON.stringify(r2));

db.close();