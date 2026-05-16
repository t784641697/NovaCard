/**
 * 完整修复 cards 表结构
 */
require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.resolve(__dirname, './data/vcc.db');

if (!fs.existsSync(DB_PATH)) {
  console.error('❌ 数据库文件不存在:', DB_PATH);
  process.exit(1);
}

const db = new Database(DB_PATH);

console.log('🔧 完整检查和修复 cards 表结构...');

// 创建新表或添加缺失字段的完整逻辑
try {
  // 先尝试创建完整的新表
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS cards_new (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      card_id          TEXT    UNIQUE NOT NULL,   -- vmcardio card_id
      card_number      TEXT    NOT NULL DEFAULT '',  -- 卡号（虚拟卡号）
      product_code     TEXT    NOT NULL DEFAULT '',
      label            TEXT    NOT NULL DEFAULT '',
      card_type        TEXT    NOT NULL DEFAULT 'virtual',
      status           TEXT    NOT NULL DEFAULT 'active',
      available_amount REAL    NOT NULL DEFAULT 0,   -- 卡内余额（vmcardio 同步）
      expiry_month     INTEGER NOT NULL DEFAULT 0,   -- 到期月
      expiry_year      INTEGER NOT NULL DEFAULT 0,   -- 到期年
      cvv              TEXT    NOT NULL DEFAULT '',  -- CVV（加密存储）
      created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `;
  
  db.exec(createTableSQL);
  console.log('✅ 创建/确认 cards 表结构');
  
  // 检查是否有旧表数据需要迁移
  const oldTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cards_old'").get();
  
  if (!oldTableExists) {
    // 重命名旧表
    db.exec("ALTER TABLE cards RENAME TO cards_old");
    console.log('📦 重命名旧表为 cards_old');
    
    // 复制数据（如果有）
    const oldCount = db.prepare("SELECT COUNT(*) as count FROM cards_old").get().count;
    if (oldCount > 0) {
      console.log(`🔀 迁移 ${oldCount} 条旧数据...`);
      db.exec(`
        INSERT OR IGNORE INTO cards_new (id, user_id, card_id, product_code, label, status, created_at, updated_at)
        SELECT id, user_id, card_id, product_code, label, status, created_at, datetime('now')
        FROM cards_old
      `);
      console.log('✅ 旧数据迁移完成');
    }
    
    // 删除旧表
    db.exec("DROP TABLE cards_old");
    console.log('🗑️  已删除旧表');
  }
  
  // 重命名回 cards
  db.exec("ALTER TABLE cards_new RENAME TO cards");
  console.log('🏷️  表名恢复为 cards');
  
  // 创建索引
  db.exec("CREATE INDEX IF NOT EXISTS idx_cards_user_id ON cards(user_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_cards_card_id  ON cards(card_id)");
  console.log('📈 索引创建完成');
  
} catch (err) {
  console.log('❌ 修复过程出错:', err.message);
  
  // 回退方案：直接添加缺失字段
  console.log('🔄 尝试回退方案：直接添加缺失字段...');
  const addColumns = [
    "ALTER TABLE cards ADD COLUMN card_number TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE cards ADD COLUMN card_type TEXT NOT NULL DEFAULT 'virtual'",
    "ALTER TABLE cards ADD COLUMN available_amount REAL NOT NULL DEFAULT 0",
    "ALTER TABLE cards ADD COLUMN expiry_month INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE cards ADD COLUMN expiry_year INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE cards ADD COLUMN cvv TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE cards ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))"
  ];
  
  let added = 0;
  for (const sql of addColumns) {
    try {
      db.exec(sql);
      console.log(`✅ 执行: ${sql.split(' ')[3]}`);
      added++;
    } catch (err2) {
      if (err2.message.includes('duplicate column')) {
        console.log(`ℹ️  字段已存在: ${sql.split(' ')[3]}`);
      } else {
        console.log(`⚠️  执行失败: ${err2.message}`);
      }
    }
  }
  
  console.log(`📊 共添加 ${added} 个字段`);
}

// 验证最终表结构
console.log('\n📋 验证最终表结构:');
const finalColumns = db.prepare("SELECT name FROM pragma_table_info('cards') ORDER BY cid").all();
console.log('  字段列表:', finalColumns.map(c => c.name).join(', '));

// 检查是否有数据
const finalCount = db.prepare("SELECT COUNT(*) as count FROM cards").get().count;
console.log(`  卡片总数: ${finalCount}`);

db.close();
console.log('\n✅ 表修复完成！');