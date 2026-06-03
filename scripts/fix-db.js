const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.resolve(__dirname, '../data/vcc.db');
console.log('DB path:', dbPath);

const db = new Database(dbPath);

const cols = db.prepare('PRAGMA table_info(card_applications)').all();
const hasAmount = cols.some(c => c.name === 'amount');
const hasTopup = cols.some(c => c.name === 'topup_amount');
console.log('has amount:', hasAmount, 'has topup_amount:', hasTopup);

if (hasAmount && !hasTopup) {
  db.exec('BEGIN TRANSACTION');
  
  const createSQL = `CREATE TABLE card_applications_new (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id),
    product_code  TEXT    NOT NULL,
    first_name    TEXT    NOT NULL DEFAULT '',
    last_name     TEXT    NOT NULL DEFAULT '',
    label         TEXT    NOT NULL DEFAULT '',
    topup_amount  REAL    NOT NULL DEFAULT 0,
    single_limit  REAL    NOT NULL DEFAULT 0,
    day_limit     REAL    NOT NULL DEFAULT 0,
    month_limit   REAL    NOT NULL DEFAULT 0,
    area_code     TEXT    DEFAULT '',
    mobile        TEXT    DEFAULT '',
    email         TEXT    DEFAULT '',
    card_address  TEXT    DEFAULT '',
    status        TEXT    NOT NULL DEFAULT 'pending',
    reject_reason TEXT    DEFAULT '',
    card_id       TEXT    DEFAULT '',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  )`;
  db.exec(createSQL);
  
  const insertSQL = `INSERT INTO card_applications_new 
    (id, user_id, product_code, first_name, last_name, label, 
     topup_amount, single_limit, day_limit, month_limit,
     area_code, mobile, email, card_address,
     status, reject_reason, card_id, created_at, updated_at)
    SELECT id, user_id, product_code, first_name, last_name, label,
           amount, single_limit, day_limit, month_limit,
           area_code, mobile, email, card_address,
           status, reject_reason, card_id, created_at, updated_at
    FROM card_applications`;
  db.exec(insertSQL);
  
  db.exec('DROP TABLE card_applications');
  db.exec('ALTER TABLE card_applications_new RENAME TO card_applications');
  db.exec('COMMIT');
  
  console.log('Migration OK: amount -> topup_amount');
} else {
  console.log('No migration needed');
}

// Clean WAL
db.pragma('journal_mode=DELETE');
db.exec('VACUUM');
console.log('DB fix done');
db.close();