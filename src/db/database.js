/**
 * SQLite 数据库初始化
 * 表：users, cards
 */
const Database = require('better-sqlite3');
const path     = require('path');
const bcrypt   = require('bcryptjs');

const DB_PATH = path.resolve(__dirname, '../../data/vcc.db');

// 确保 data 目录存在
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// 使用 DELETE 模式避免 PM2 重启时 WAL 损坏
db.pragma('journal_mode = DELETE');
db.pragma('foreign_keys = ON');

// 注册 nowiso() SQL 函数 → 输出 ISO 8601 UTC 时间戳
// 统一项目中所有 SQL 侧的时间戳格式：nowiso() 替代 datetime('now')
db.function('nowiso', { deterministic: true }, () => new Date().toISOString());

// ── 建表 ─────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT    UNIQUE NOT NULL,
    password        TEXT    NOT NULL,
    name            TEXT    NOT NULL DEFAULT '',
    role            TEXT    NOT NULL DEFAULT 'user',  -- 'user' | 'admin'
    balance         REAL    NOT NULL DEFAULT 0,
    status          TEXT    NOT NULL DEFAULT 'active', -- active / locked / disabled
    login_fail_cnt  INTEGER NOT NULL DEFAULT 0,        -- 连续失败次数
    locked_until    TEXT    NOT NULL DEFAULT '',       -- 锁定到期时间（ISO 字符串）
    last_login_at   TEXT    NOT NULL DEFAULT '',
    last_login_ip   TEXT    NOT NULL DEFAULT '',
    created_at      TEXT    NOT NULL DEFAULT (nowiso()),
    updated_at      TEXT    NOT NULL DEFAULT (nowiso())
  );

  -- 审计日志表
  CREATE TABLE IF NOT EXISTS audit_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,              -- 可为 NULL（未登录请求）
    action     TEXT    NOT NULL,     -- login_ok / login_fail / register / logout / ...
    ip         TEXT    NOT NULL DEFAULT '',
    ua         TEXT    NOT NULL DEFAULT '',
    detail     TEXT    NOT NULL DEFAULT '',  -- JSON 附加信息
    created_at TEXT    NOT NULL DEFAULT (nowiso())
  );
  CREATE INDEX IF NOT EXISTS idx_audit_user_id   ON audit_logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_action    ON audit_logs(action);
  CREATE INDEX IF NOT EXISTS idx_audit_created   ON audit_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_ip        ON audit_logs(ip);

  -- 图形验证码存储表
  CREATE TABLE IF NOT EXISTS captcha_store (
    token      TEXT    PRIMARY KEY,
    text       TEXT    NOT NULL,    -- 答案（小写）
    expires_at TEXT    NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0
  );

  -- 短信验证码表
  CREATE TABLE IF NOT EXISTS sms_codes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    phone       TEXT    NOT NULL,
    code        TEXT    NOT NULL,
    purpose     TEXT    NOT NULL DEFAULT 'register',  -- register / login / reset
    expires_at  TEXT    NOT NULL,
    used        INTEGER NOT NULL DEFAULT 0,
    ip          TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL DEFAULT (nowiso())
  );
  CREATE INDEX IF NOT EXISTS idx_sms_phone ON sms_codes(phone);
  CREATE INDEX IF NOT EXISTS idx_sms_expires ON sms_codes(expires_at);

  CREATE TABLE IF NOT EXISTS cards (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id          TEXT    UNIQUE NOT NULL,   -- vmcardio card_id
    card_number      TEXT    NOT NULL DEFAULT '',  -- 卡号（虚拟卡号）
    product_code     TEXT    NOT NULL DEFAULT '',
    label            TEXT    NOT NULL DEFAULT '',
    status           TEXT    NOT NULL DEFAULT 'active',
    available_amount REAL    NOT NULL DEFAULT 0,   -- 卡内余额（vmcardio 同步）
    expiry_month     INTEGER NOT NULL DEFAULT 0,   -- 到期月
    expiry_year      INTEGER NOT NULL DEFAULT 0,   -- 到期年
    cvv              TEXT    NOT NULL DEFAULT '',  -- CVV（加密存储）
    created_at       TEXT    NOT NULL DEFAULT (nowiso()),
    updated_at       TEXT    NOT NULL DEFAULT (nowiso())
  );

  CREATE INDEX IF NOT EXISTS idx_cards_user_id ON cards(user_id);
  CREATE INDEX IF NOT EXISTS idx_cards_card_id  ON cards(card_id);

  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (nowiso())
  );

  -- 公告表
  CREATE TABLE IF NOT EXISTS announcements (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT    NOT NULL DEFAULT '',
    content    TEXT    NOT NULL DEFAULT '',
    type       TEXT    NOT NULL DEFAULT '运营公告',
    is_active  INTEGER NOT NULL DEFAULT 1,
    created_at TEXT    NOT NULL DEFAULT (nowiso()),
    updated_at TEXT    NOT NULL DEFAULT (nowiso())
  );

  -- 兼容升级：已有表补 type 列
  ALTER TABLE announcements ADD COLUMN type TEXT DEFAULT '运营公告';

  CREATE TABLE IF NOT EXISTS upstream_fees (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    fee_type       TEXT    UNIQUE NOT NULL,
    name           TEXT    NOT NULL DEFAULT '',
    upstream_rate  REAL    NOT NULL DEFAULT 0,
    upstream_fixed REAL    NOT NULL DEFAULT 0,
    rules          TEXT    NOT NULL DEFAULT '{}',
    notes          TEXT    NOT NULL DEFAULT '',
    updated_at     TEXT    NOT NULL DEFAULT (nowiso())
  );

  -- upstream_fees 种子数据（与 fee_configs 类型对应）
  INSERT OR IGNORE INTO upstream_fees (fee_type, name, upstream_rate, upstream_fixed, rules) VALUES
    ('card_creation',     '开卡费',          0,    10.00, '{"charge_timing":"创建时收取"}'),
    ('transaction',       '交易手续费',      0.03,  0.30, '{"free_count":"5","charge_timing":"逐笔"}'),
    ('refund',            '退款手续费',      0.05,  0.50, '{"charge_timing":"退款时"}'),
    ('chargeback',        '拒付手续费',      0.08,  2.00, '{"charge_timing":"拒付发生时"}'),
    ('auth_reversal',     '授权撤销费',      0,     0,    '{"exempt":"免费"}'),
    ('cross_border',      '跨境交易附加费',  0.01,  0.45, '{"threshold":"单笔≥$100","charge_timing":"超额部分"}'),
    ('small_transaction', '小额交易附加费',  0,     0,    '{"threshold":"<$3","charge_timing":"每笔"}'),
    ('card_monthly',      '卡片月管理费',    0,     3.00, '{"charge_timing":"每月","exempt":"首月免费"}');

  CREATE TABLE IF NOT EXISTS topup_requests (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    network      TEXT    NOT NULL DEFAULT '',   -- TRC20 / ERC20 / BEP20 / SOL
    amount_usdt  REAL    NOT NULL DEFAULT 0,    -- 用户填写的 USDT 金额（选填则为0）
    txhash       TEXT    NOT NULL DEFAULT '',   -- 链上哈希（选填）
    remark       TEXT    NOT NULL DEFAULT '',
    status       TEXT    NOT NULL DEFAULT 'pending',  -- pending / approved / rejected
    created_at   TEXT    NOT NULL DEFAULT (nowiso()),
    updated_at   TEXT    NOT NULL DEFAULT (nowiso())
  );

  CREATE INDEX IF NOT EXISTS idx_topup_user_id ON topup_requests(user_id);
  CREATE INDEX IF NOT EXISTS idx_topup_status  ON topup_requests(status);

  -- 上游交易流水表（同步 vmcardio /cardTransaction）
  CREATE TABLE IF NOT EXISTS card_transactions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    auth_id       TEXT,
    card_id       TEXT    NOT NULL,
    type          TEXT    NOT NULL,             -- Authorization / Settlement / Refund / Reversal
    status        TEXT,                          -- COMPLETE / DECLINED / PENDING
    auth_amount   REAL    DEFAULT 0,
    settle_amount REAL    DEFAULT 0,
    auth_currency TEXT    DEFAULT 'USD',
    settle_currency TEXT   DEFAULT 'USD',
    merchant_name TEXT,
    create_time   TEXT,
    auth_time     TEXT,
    sync_time     TEXT    DEFAULT (nowiso())
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ct_auth_id ON card_transactions(auth_id);
  CREATE INDEX IF NOT EXISTS idx_ct_card_id ON card_transactions(card_id);
  CREATE INDEX IF NOT EXISTS idx_ct_type ON card_transactions(type);
  CREATE INDEX IF NOT EXISTS idx_ct_create_time ON card_transactions(create_time);

  CREATE TABLE IF NOT EXISTS card_applications (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- 申请参数（完整存储，审批通过时直接用来调 vmcardio）
    product_code TEXT    NOT NULL DEFAULT '',
    card_bin     TEXT    NOT NULL DEFAULT '',
    first_name   TEXT    NOT NULL DEFAULT '',
    last_name    TEXT    NOT NULL DEFAULT '',
    label        TEXT    NOT NULL DEFAULT '',
    -- 新开卡参数：充值金额（每张卡最低$20） + 开卡数量
    topup_amount REAL    NOT NULL DEFAULT 0,
    quantity     INTEGER NOT NULL DEFAULT 1,
    email        TEXT    NOT NULL DEFAULT '',
    -- 审批状态
    status       TEXT    NOT NULL DEFAULT 'pending',  -- pending / approved / rejected
    reject_reason TEXT   NOT NULL DEFAULT '',
    -- 审批通过后 vmcardio 返回的 card_id
    card_id      TEXT    NOT NULL DEFAULT '',
    -- 时间
    created_at   TEXT    NOT NULL DEFAULT (nowiso()),
    updated_at   TEXT    NOT NULL DEFAULT (nowiso())
  );

  CREATE INDEX IF NOT EXISTS idx_card_app_user_id ON card_applications(user_id);
  CREATE INDEX IF NOT EXISTS idx_card_app_status  ON card_applications(status);

  -- 交易流水表
  CREATE TABLE IF NOT EXISTS transactions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            TEXT    NOT NULL DEFAULT '',      -- 消费 / 退款 / 拒付 / 充值 / 手续费 / ...
    amount          REAL    NOT NULL DEFAULT 0,        -- 交易金额（正数表示收入，负数表示支出）
    fee_type        TEXT    NOT NULL DEFAULT '',        -- 费用类型：transaction/cross_border/small_transaction/...
    fee_amount      REAL    NOT NULL DEFAULT 0,        -- 手续费金额
    fee_rate        REAL    NOT NULL DEFAULT 0,        -- 使用的费率
    fee_fixed       REAL    NOT NULL DEFAULT 0,        -- 使用的固定费
    net_amount      REAL    NOT NULL DEFAULT 0,        -- 净变动额
    description     TEXT    NOT NULL DEFAULT '',
    ref_id          TEXT    NOT NULL DEFAULT '',        -- 外部引用ID（如 auth_id）
    created_at      TEXT    NOT NULL DEFAULT (nowiso())
  );
  CREATE INDEX IF NOT EXISTS idx_txn_user_id  ON transactions(user_id);
  CREATE INDEX IF NOT EXISTS idx_txn_type     ON transactions(type);
  CREATE INDEX IF NOT EXISTS idx_txn_fee_type ON transactions(fee_type);
  CREATE INDEX IF NOT EXISTS idx_txn_ref_id   ON transactions(ref_id);
  CREATE INDEX IF NOT EXISTS idx_txn_created  ON transactions(created_at);

  -- 全局费率配置表
  CREATE TABLE IF NOT EXISTS fee_configs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    fee_type    TEXT    UNIQUE NOT NULL,              -- card_creation / transaction / refund / chargeback / cross_border / small_transaction / withdrawal / auth_reversal / management
    description TEXT    NOT NULL,
    fee_rate    REAL    NOT NULL DEFAULT 0,           -- 百分比费率，如 0.05=5%
    fee_fixed   REAL    NOT NULL DEFAULT 0,           -- 固定费用（美元）
    min_amount  REAL    NOT NULL DEFAULT 0,
    max_amount  REAL    NOT NULL DEFAULT 0,           -- 0=无限制
    currency    TEXT    NOT NULL DEFAULT 'USD',
    is_active   INTEGER NOT NULL DEFAULT 1,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (nowiso()),
    updated_at  TEXT    NOT NULL DEFAULT (nowiso())
  );
  CREATE INDEX IF NOT EXISTS idx_fee_configs_type ON fee_configs(fee_type, is_active);

  -- 用户级自定义费率表
  CREATE TABLE IF NOT EXISTS user_fee_configs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fee_type    TEXT    NOT NULL,
    fee_rate    REAL    DEFAULT NULL,
    fee_fixed   REAL    DEFAULT NULL,
    min_amount  REAL    DEFAULT NULL,
    max_amount  REAL    DEFAULT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1,
    notes       TEXT,
    created_at  TEXT    NOT NULL DEFAULT (nowiso()),
    updated_at  TEXT    NOT NULL DEFAULT (nowiso()),
    UNIQUE(user_id, fee_type)
  );
  CREATE INDEX IF NOT EXISTS idx_user_fee_configs ON user_fee_configs(user_id, fee_type, is_active);
`);

// ── Schema 迁移：补全旧版本缺少的字段 ───────────────────────────────────
(function migrate() {
  // users 表迁移
  const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  const add = (col, def) => {
    if (!cols.includes(col)) {
      db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
      console.log(`[DB Migration] users 表已添加列: ${col}`);
    }
  };
  add('status',         "TEXT    NOT NULL DEFAULT 'active'");
  add('login_fail_cnt', "INTEGER NOT NULL DEFAULT 0");
  add('locked_until',   "TEXT    NOT NULL DEFAULT ''");
  add('last_login_at',  "TEXT    NOT NULL DEFAULT ''");
  add('last_login_ip',  "TEXT    NOT NULL DEFAULT ''");
  // 余额相关统计字段
  add('phone',          "TEXT    DEFAULT NULL");
  add('initial_balance',"REAL    DEFAULT 0");
  add('topup_total',    "REAL    DEFAULT 0");
  add('total_spend',    "REAL    DEFAULT 0");
  add('total_refund',   "REAL    DEFAULT 0");
  add('total_dispute',  "REAL    DEFAULT 0");
  add('total_fees',     "REAL    DEFAULT 0");
  add('last_fee_update',"TEXT");
  add('total_chargeback',"REAL   DEFAULT 0");

  // cards 表迁移
  const cardCols = db.prepare("PRAGMA table_info(cards)").all().map(c => c.name);
  const addCard = (col, def) => {
    if (!cardCols.includes(col)) {
      db.exec(`ALTER TABLE cards ADD COLUMN ${col} ${def}`);
      console.log(`[DB Migration] cards 表已添加列: ${col}`);
    }
  };
  addCard('card_type',        "TEXT    DEFAULT ''");
  addCard('single_limit',     "REAL    DEFAULT 0");
  addCard('day_limit',        "REAL    DEFAULT 0");
  addCard('month_limit',      "REAL    DEFAULT 0");
  addCard('last_verified',    "TEXT    DEFAULT ''");
  addCard('verified_status',  "TEXT    DEFAULT ''");
  addCard('verification_error',"TEXT   DEFAULT ''");

  // fee_configs 种子数据（INSERT OR IGNORE 保证幂等）
  // 迁移：将旧的 dispute 记录删除（已被 chargeback 替代）
  db.prepare(`DELETE FROM fee_configs WHERE fee_type = 'dispute'`).run();

  const seedFees = [
    ['card_creation',     '开卡费',       0,     10.00,  0,  0,  10],
    ['transaction',       '交易手续费',   0.03,   0.30,  0,  0,  20],
    ['refund',            '退款手续费',   0.05,   0.50,  0,  0,  30],
    ['chargeback',        '拒付手续费',   0.08,   2.00,  0,  0,  40],
    ['cross_border',      '跨境交易费',   0.01,   0.45,  0,  0,  50],
    ['small_transaction', '小额授权费',   0,      0.50,  0,  0,  55],
    ['withdrawal',        '提现手续费',   0.02,   1.00,  0,  0,  60],
    ['auth_reversal',     '撤销手续费',   0.05,   0.50,  0,  0,  65],
    ['management',        '管理费',       0,      0,     0,  0,  70],
  ];
  const insertFee = db.prepare(`
    INSERT OR IGNORE INTO fee_configs (fee_type, description, fee_rate, fee_fixed, min_amount, max_amount, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const [feeType, desc, rate, fixed, minAmt, maxAmt, sort] of seedFees) {
    const r = insertFee.run(feeType, desc, rate, fixed, minAmt, maxAmt, sort);
    if (r.changes > 0) console.log(`[DB Seed] fee_configs: ${feeType}`);
  }

  // 更新已存在的 cross_border 为正确的值（1% + $0.45）
  db.prepare(`UPDATE fee_configs SET fee_rate = 0.01, fee_fixed = 0.45, updated_at = nowiso() WHERE fee_type = 'cross_border'`).run();
})();

// ── 种子数据（首次运行插入默认账号）──────────────────────────────────────

// ── 默认账号密码（符合强度规则：8-16位/大写/小写/数字/特殊字符）──
// 管理员：admin@vcc.hub / Admin@2026
// 测试用：user@vcc.hub  / User@20261
const seedAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@vcc.hub');
if (!seedAdmin) {
  const hash = bcrypt.hashSync('Admin@2026', 12);
  db.prepare(`
    INSERT INTO users (email, password, name, role, balance)
    VALUES (?, ?, ?, 'admin', 0)
  `).run('admin@vcc.hub', hash, 'Admin');
  console.log('[DB] 已插入默认管理员账号 admin@vcc.hub / Admin@2026');
}

const seedUser = db.prepare('SELECT id FROM users WHERE email = ?').get('user@vcc.hub');
if (!seedUser) {
  const hash = bcrypt.hashSync('User@20261', 12);
  db.prepare(`
    INSERT INTO users (email, password, name, role, balance)
    VALUES (?, ?, ?, 'user', 0)
  `).run('user@vcc.hub', hash, 'TestUser');
  console.log('[DB] 已插入默认用户账号 user@vcc.hub / User@20261');
}

// ── 重建所有索引，防止跨版本 schema 不一致导致 SQLITE_CORRUPT ──
try { db.exec('REINDEX'); } catch(e) { console.error('[DB] REINDEX failed:', e.message); }

module.exports = db;
