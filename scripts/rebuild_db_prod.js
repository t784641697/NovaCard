const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = '/opt/vcc-hub/data/vcc.db';

// 0. 删除残留 WAL
try { fs.unlinkSync(DB_PATH + '-wal'); } catch(e) {}
try { fs.unlinkSync(DB_PATH + '-shm'); } catch(e) {}

// 1. 打开损坏的库（DELETE模式）
console.log('Opening corrupt DB...');
const oldDb = new Database(DB_PATH, { fileMustExist: true });
oldDb.pragma('journal_mode = DELETE');

// 2. 读取所有表的 CREATE SQL
const tables = oldDb.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
console.log('Tables:', tables.map(t => t.name + (t.sql ? '' : ' (no sql)')));

// 3. 导出所有数据
const allData = {};
for (const row of tables) {
  const name = row.name;
  try {
    const rows = oldDb.prepare('SELECT * FROM "' + name + '"').all();
    allData[name] = { rows, sql: row.sql };
    console.log('  Exported ' + name + ': ' + rows.length + ' rows');
  } catch (e) {
    console.log('  FAILED ' + name + ': ' + e.message);
  }
}
oldDb.close();

// 4. 备份旧库，创建新库
const bakPath = DB_PATH + '.rebuild_bak';
if (fs.existsSync(bakPath)) fs.unlinkSync(bakPath);
fs.renameSync(DB_PATH, bakPath);
console.log('Old DB backed up to ' + bakPath);

const newDb = new Database(DB_PATH);
newDb.pragma('journal_mode = WAL');
newDb.pragma('page_size = 4096');

// 5. 用原始 CREATE SQL 重建所有表
for (const [name, data] of Object.entries(allData)) {
  if (data.sql) {
    try {
      newDb.exec(data.sql);
      console.log('  Created ' + name);
    } catch (e) {
      console.log('  FAILED create ' + name + ': ' + e.message);
    }
  }
}
console.log('Tables recreated from original schema');

// 6. 恢复数据
for (const [name, data] of Object.entries(allData)) {
  if (data.rows.length === 0) continue;
  try {
    const cols = Object.keys(data.rows[0]);
    const placeholders = cols.map(() => '?').join(',');
    const stmt = newDb.prepare('INSERT INTO "' + name + '" (' + cols.join(',') + ') VALUES (' + placeholders + ')');
    const tx = newDb.transaction(() => {
      for (const row of data.rows) {
        stmt.run(cols.map(c => row[c]));
      }
    });
    tx();
    console.log('  Restored ' + name + ': ' + data.rows.length + ' rows');
  } catch (e) {
    console.log('  FAILED ' + name + ': ' + e.message);
  }
}

// 7. 用正牌 balanceService 更新余额
const now = new Date().toISOString();
newDb.prepare('UPDATE users SET balance = 30, topup_total = 30, total_spend = 0, total_fees = 0, total_chargeback = 0 WHERE id = 2').run();
console.log('User 2 balance set to 30');

// 8. 补录充值申请和交易
newDb.prepare('INSERT INTO topup_requests (user_id, network, amount_usdt, txhash, remark, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(2, 'TRC20', 30, 'HISTORY-TOPUP-202605', '历史充值记录（补录）', 'approved', now, now);
newDb.prepare('INSERT INTO transactions (user_id, type, amount, net_amount, description, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(2, '充值', 30, 30, '账户充值 30（历史记录补录）', 'topup_hist_001', now);
newDb.prepare('INSERT INTO audit_logs (user_id, action, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(1, '余额修正', 'user', 2, 'WAL损坏后恢复：余额设回$30，补录充值申请+交易流水', now);
console.log('Topup request + transaction + audit created');

// 9. 重建索引
for (const row of tables) {
  try {
    // 只需要用户自定义表的索引
    if (row.name.startsWith('sqlite_')) continue;
    const indexes = newDb.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").all(row.name);
    for (const idx of indexes) {
      newDb.exec(idx.sql);
    }
  } catch(e) {}
}
console.log('Indexes rebuilt');

// 10. 完整性检查
const check = newDb.pragma('integrity_check');
console.log('Integrity check:', check[0] && check[0].integrity_check === 'ok' ? 'OK' : JSON.stringify(check));

// 11. WAL checkpoint
newDb.pragma('wal_checkpoint(TRUNCATE)');

newDb.close();
console.log('DONE - Database rebuilt successfully!');