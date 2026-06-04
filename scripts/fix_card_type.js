const DB = require('better-sqlite3')('./data/vcc.db');
DB.pragma('journal_mode = DELETE');

// 检查 cards 表是否存在 card_type 列
const cols = DB.prepare("PRAGMA table_info(cards)").all();
const hasCardType = cols.some(c => c.name === 'card_type');
console.log('Has card_type:', hasCardType);

if (!hasCardType) {
  DB.exec("ALTER TABLE cards ADD COLUMN card_type TEXT NOT NULL DEFAULT 'virtual'");
  console.log('Added card_type column');
}

// 检查 fee_configs 完整性
const check = DB.pragma('integrity_check');
console.log('Integrity:', JSON.stringify(check));

DB.pragma('wal_checkpoint(TRUNCATE)');
DB.close();
console.log('Done');