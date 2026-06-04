const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DB = new Database('/opt/vcc-hub/data/vcc.db');
DB.pragma('journal_mode = WAL');
DB.pragma('foreign_keys = OFF');

console.log('Dropping all tables...');

DB.exec('DROP TABLE IF EXISTS cards');
DB.exec('DROP TABLE IF EXISTS card_applications');
DB.exec('DROP TABLE IF EXISTS transactions');
DB.exec('DROP TABLE IF EXISTS topup_requests');
DB.exec('DROP TABLE IF EXISTS audit_logs');
DB.exec('DROP TABLE IF EXISTS user_fee_configs');
DB.exec('DROP TABLE IF EXISTS fee_configs');
DB.exec('DROP TABLE IF EXISTS users');
DB.exec('DROP TABLE IF EXISTS settings');
DB.exec('DROP TABLE IF EXISTS sms_codes');
DB.exec('DROP TABLE IF EXISTS captcha_store');

console.log('Creating all tables...');

DB.exec(`
  CREATE TABLE users (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    email            TEXT    UNIQUE NOT NULL,
    password         TEXT    NOT NULL,
    name             TEXT,
    role             TEXT    NOT NULL DEFAULT 'user',
    balance          REAL    NOT NULL DEFAULT 0,
    topup_total      REAL    NOT NULL DEFAULT 0,
    total_spend      REAL    NOT NULL DEFAULT 0,
    total_fees       REAL    NOT NULL DEFAULT 0,
    total_chargeback REAL    NOT NULL DEFAULT 0,
    total_dispute    REAL    NOT NULL DEFAULT 0,
    phone            TEXT,
    status           TEXT    NOT NULL DEFAULT 'active',
    login_fail_cnt   INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE fee_configs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    fee_type    TEXT    UNIQUE NOT NULL,
    description TEXT    NOT NULL,
    fee_rate    REAL    NOT NULL DEFAULT 0,
    fee_fixed   REAL    NOT NULL DEFAULT 0,
    min_amount  REAL    NOT NULL DEFAULT 0,
    max_amount  REAL    NOT NULL DEFAULT 0,
    currency    TEXT    NOT NULL DEFAULT 'USD',
    is_active   INTEGER NOT NULL DEFAULT 1,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_fee_configs_type ON fee_configs(fee_type, is_active);
  CREATE TABLE user_fee_configs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fee_type    TEXT    NOT NULL,
    fee_rate    REAL    DEFAULT NULL,
    fee_fixed   REAL    DEFAULT NULL,
    min_amount  REAL    DEFAULT NULL,
    max_amount  REAL    DEFAULT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1,
    notes       TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, fee_type)
  );
  CREATE INDEX IF NOT EXISTS idx_user_fee_configs ON user_fee_configs(user_id, fee_type, is_active);
  CREATE TABLE transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    type        TEXT    NOT NULL,
    amount      REAL    NOT NULL DEFAULT 0,
    fee_type    TEXT    DEFAULT '',
    fee_amount  REAL    DEFAULT 0,
    fee_rate    REAL    DEFAULT 0,
    fee_fixed   REAL    DEFAULT 0,
    net_amount  REAL    DEFAULT 0,
    description TEXT    DEFAULT '',
    ref_id      TEXT    DEFAULT '',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_txn_user ON transactions(user_id);
  CREATE INDEX IF NOT EXISTS idx_txn_created ON transactions(created_at);
  CREATE INDEX IF NOT EXISTS idx_txn_ref_id ON transactions(ref_id);
  CREATE INDEX IF NOT EXISTS idx_txn_type ON transactions(type);
  CREATE TABLE topup_requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    network     TEXT    DEFAULT 'TRC20',
    amount_usdt REAL    DEFAULT 0,
    txhash      TEXT    DEFAULT '',
    remark      TEXT    DEFAULT '',
    status      TEXT    DEFAULT 'pending',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_topup_user ON topup_requests(user_id);
  CREATE INDEX IF NOT EXISTS idx_topup_status ON topup_requests(status);
  CREATE TABLE audit_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id),
    action      TEXT    NOT NULL,
    target_type TEXT,
    target_id   INTEGER,
    details     TEXT,
    ip          TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE sms_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE card_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    product_code TEXT,
    card_bin TEXT,
    first_name TEXT,
    last_name TEXT,
    topup_amount REAL DEFAULT 0,
    quantity INTEGER DEFAULT 1,
    status TEXT DEFAULT 'pending',
    reject_reason TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_card_app_user ON card_applications(user_id);
  CREATE INDEX IF NOT EXISTS idx_card_app_status ON card_applications(status);
  CREATE TABLE cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER,
    user_id INTEGER NOT NULL REFERENCES users(id),
    product_code TEXT,
    card_bin TEXT,
    first_name TEXT,
    last_name TEXT,
    card_number TEXT,
    expire_date TEXT,
    cvv TEXT,
    status TEXT DEFAULT 'active',
    balance REAL DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_card_user ON cards(user_id);
  CREATE TABLE captcha_store (
    id TEXT PRIMARY KEY,
    text TEXT,
    expires_at TEXT
  );
`);

console.log('Tables created, seeding data...');

// Seed users
const now = new Date().toISOString();
const hashAdmin = bcrypt.hashSync('Admin@2026', 10);
const hashUser = bcrypt.hashSync('User@20261', 10);

DB.prepare('INSERT INTO users (email, password, name, role, balance, created_at) VALUES (?,?,?,?,?,?)').run('admin@vcc.hub', hashAdmin, '管理员', 'admin', 0, now);
DB.prepare('INSERT INTO users (email, password, name, role, balance, topup_total, created_at) VALUES (?,?,?,?,?,?,?)').run('user@vcc.hub', hashUser, '用户', 'user', 30, 30, now);
console.log('Users seeded: admin + user');

// Seed fee_configs
const fees = [
  ['card_creation', '开卡费', 0, 10.00, 0, 0, 'USD', 1, 10],
  ['transaction', '交易手续费', 0.03, 0.30, 0, 0, 'USD', 1, 20],
  ['refund', '退款手续费', 0.05, 0.50, 0, 0, 'USD', 1, 30],
  ['chargeback', '拒付手续费', 0.08, 2.00, 0, 0, 'USD', 1, 40],
  ['cross_border', '跨境交易费', 0.01, 0.45, 0, 0, 'USD', 1, 50],
  ['small_transaction', '小额授权费', 0, 0.50, 0, 0, 'USD', 1, 55],
  ['withdrawal', '提现手续费', 0.02, 1.00, 0, 0, 'USD', 1, 60],
  ['auth_reversal', '撤销手续费', 0.05, 0.50, 0, 0, 'USD', 1, 65],
  ['management', '管理费', 0, 0, 0, 0, 'USD', 1, 70],
];
const insertFee = DB.prepare('INSERT INTO fee_configs (fee_type, description, fee_rate, fee_fixed, min_amount, max_amount, currency, is_active, sort_order) VALUES (?,?,?,?,?,?,?,?,?)');
for (const f of fees) insertFee.run(...f);
console.log('Fee configs: 9 types seeded');

// Seed settings
const settings = [
  ['site_name', 'NovaCard'],
  ['site_desc', '虚拟信用卡管理平台'],
  ['platform_fee_rate', '0.05'],
  ['default_currency', 'USD'],
  ['min_topup', '20'],
  ['max_cards_per_user', '5'],
  ['system_version', '1.0.14'],
  ['maintenance_mode', '0'],
];
const insertSetting = DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)');
for (const [k, v] of settings) insertSetting.run(k, v);
console.log('Settings: 8 seeded');

// Topup request + transaction for user 2
DB.prepare('INSERT INTO topup_requests (user_id, network, amount_usdt, txhash, remark, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run(2, 'TRC20', 30, 'HISTORY-TOPUP-202605', '历史充值记录（补录）', 'approved', now, now);
DB.prepare('INSERT INTO transactions (user_id, type, amount, net_amount, description, ref_id, created_at) VALUES (?,?,?,?,?,?,?)').run(2, '充值', 30, 30, '账户充值 30（历史记录补录）', 'topup_hist_001', now);
console.log('Topup request + transaction created');

DB.pragma('wal_checkpoint(TRUNCATE)');
DB.close();

console.log('ALL DONE - Database is clean!');