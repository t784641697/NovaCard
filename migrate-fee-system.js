/**
 * 费率系统数据库迁移脚本
 * 可重复执行（安全幂等）
 */
const db = require('./src/db/database.js');

console.log('开始执行费率系统迁移...');

try {
  // 1. 创建 fee_configs 表
  db.prepare(`CREATE TABLE IF NOT EXISTS fee_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fee_type TEXT NOT NULL,
    description TEXT NOT NULL,
    fee_rate DECIMAL(5,4) DEFAULT 0,
    fee_fixed DECIMAL(10,2) DEFAULT 0,
    min_amount DECIMAL(10,2) DEFAULT 0,
    max_amount DECIMAL(10,2) DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    is_active BOOLEAN DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(fee_type)
  )`).run();
  console.log('✓ fee_configs 表已创建');

  // 2. 创建 user_fee_configs 表
  db.prepare(`CREATE TABLE IF NOT EXISTS user_fee_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    fee_type TEXT NOT NULL,
    fee_rate DECIMAL(5,4) DEFAULT NULL,
    fee_fixed DECIMAL(10,2) DEFAULT NULL,
    min_amount DECIMAL(10,2) DEFAULT NULL,
    max_amount DECIMAL(10,2) DEFAULT NULL,
    is_active BOOLEAN DEFAULT 1,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, fee_type)
  )`).run();
  console.log('✓ user_fee_configs 表已创建');

  // 3. 安全地为 users 表添加字段（已存在则跳过）
  const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  const newUserCols = [
    ['phone', 'TEXT DEFAULT NULL'],
    ['initial_balance', 'DECIMAL(10,2) DEFAULT 0'],
    ['topup_total', 'DECIMAL(10,2) DEFAULT 0'],
    ['total_spend', 'DECIMAL(10,2) DEFAULT 0'],
    ['total_refund', 'DECIMAL(10,2) DEFAULT 0'],
    ['total_dispute', 'DECIMAL(10,2) DEFAULT 0'],
    ['total_fees', 'DECIMAL(10,2) DEFAULT 0'],
    ['last_fee_update', 'TIMESTAMP']
  ];
  for (const [col, def] of newUserCols) {
    if (!userCols.includes(col)) {
      db.prepare(`ALTER TABLE users ADD COLUMN ${col} ${def}`).run();
      console.log(`✓ 添加字段 users.${col}`);
    } else {
      console.log(`- 跳过 users.${col} (已存在)`);
    }
  }

  // 4. 插入默认费率数据
  const insertFee = db.prepare(`
    INSERT OR IGNORE INTO fee_configs 
    (fee_type, description, fee_rate, fee_fixed, min_amount, max_amount, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const fees = [
    ['card_creation', '开卡费',       0, 10.00, 0, 0, 10],
    ['transaction',   '交易手续费',   0.03, 0.30, 0, 0, 20],
    ['refund',        '退款手续费',   0.05, 0.50, 0, 0, 30],
    ['dispute',       '争议费',       0.08, 2.00, 0, 0, 40],
    ['cross_border',  '跨境交易费', 0.015, 0,   0, 0, 50],
    ['withdrawal',    '提现手续费',   0.02, 1.00, 0, 0, 60]
  ];
  for (const f of fees) {
    const r = insertFee.run(...f);
    if (r.changes > 0) {
      console.log(`✓ 插入费率: ${f[0]}`);
    } else {
      console.log(`- 跳过费率: ${f[0]} (已存在)`);
    }
  }

  // 5. 创建索引
  db.prepare('CREATE INDEX IF NOT EXISTS idx_fee_configs_type ON fee_configs(fee_type, is_active)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_user_fee_configs ON user_fee_configs(user_id, fee_type, is_active)').run();
  console.log('✓ 索引已创建');

  // 6. 验证结果
  const feeCount = db.prepare('SELECT COUNT(*) as cnt FROM fee_configs').get();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('\n✅ 迁移完成！');
  console.log('fee_configs 记录数:', feeCount.cnt);
  console.log('所有表:', tables.map(t => t.name).join(', '));

} catch (e) {
  console.error('❌ 迁移失败:', e.message);
  process.exit(1);
}
