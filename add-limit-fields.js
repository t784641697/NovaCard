const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'data/vcc.db'));

console.log('🔧 添加限额字段到cards表...\n');

try {
  // 1. 检查当前表结构
  const tableInfo = db.prepare(`
    SELECT name, type FROM pragma_table_info('cards')
  `).all();
  
  console.log('当前字段列表:');
  tableInfo.forEach(col => console.log(`  - ${col.name} (${col.type})`));
  
  // 2. 检查是否缺少限额字段
  const existingFields = tableInfo.map(col => col.name);
  const neededFields = ['single_limit', 'day_limit', 'month_limit'];
  const missingFields = neededFields.filter(field => !existingFields.includes(field));
  
  if (missingFields.length === 0) {
    console.log('\n✅ 所有限额字段已存在');
    db.close();
    return;
  }
  
  console.log('\n❌ 缺少字段:', missingFields);
  
  // 3. 添加缺失的字段
  for (const field of missingFields) {
    console.log(`\n添加字段: ${field}`);
    
    // 使用ALTER TABLE ADD COLUMN
    try {
      db.prepare(`ALTER TABLE cards ADD COLUMN ${field} DECIMAL(10,2) DEFAULT 0.00`).run();
      console.log(`✅ ${field} 字段添加成功`);
    } catch (err) {
      console.log(`⚠️  添加 ${field} 失败: ${err.message}`);
      console.log('  尝试使用表重建策略...');
      
      // 如果ALTER失败，使用表重建策略
      const tempTable = `cards_temp_${Date.now()}`;
      
      // 创建包含所有字段的新表
      const createTableSQL = `
        CREATE TABLE ${tempTable} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          card_id TEXT NOT NULL UNIQUE,
          card_number TEXT,
          product_code TEXT,
          label TEXT,
          card_type TEXT,
          status TEXT DEFAULT 'active',
          available_amount DECIMAL(10,2) DEFAULT 0.00,
          expiry_month INTEGER,
          expiry_year INTEGER,
          cvv TEXT,
          single_limit DECIMAL(10,2) DEFAULT 0.00,
          day_limit DECIMAL(10,2) DEFAULT 0.00,
          month_limit DECIMAL(10,2) DEFAULT 0.00,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `;
      
      db.prepare(createTableSQL).run();
      console.log(`✅ 创建临时表: ${tempTable}`);
      
      // 复制数据
      const columns = existingFields.join(', ');
      const insertSQL = `
        INSERT INTO ${tempTable} (${columns}, single_limit, day_limit, month_limit)
        SELECT ${columns}, 0.00, 0.00, 0.00 FROM cards
      `;
      
      const result = db.prepare(insertSQL).run();
      console.log(`✅ 复制数据: ${result.changes} 条记录`);
      
      // 重命名表
      db.prepare('DROP TABLE cards').run();
      db.prepare(`ALTER TABLE ${tempTable} RENAME TO cards`).run();
      console.log('✅ 表替换完成');
      
      break; // 跳出循环，因为已经重建了表
    }
  }
  
  // 4. 验证最终结构
  const finalInfo = db.prepare(`
    SELECT name, type FROM pragma_table_info('cards')
  `).all();
  
  console.log('\n✅ 最终字段列表:');
  finalInfo.forEach(col => console.log(`  - ${col.name} (${col.type})`));
  
  // 5. 创建索引
  db.prepare('CREATE INDEX IF NOT EXISTS idx_cards_user_id ON cards(user_id)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_cards_created_at ON cards(created_at)').run();
  console.log('✅ 索引创建完成');
  
  console.log(`\n📊 当前卡片数据: ${db.prepare('SELECT COUNT(*) as c FROM cards').get().c} 张`);
  
} catch (error) {
  console.error('\n❌ 修复失败:', error.message);
} finally {
  db.close();
  console.log('\n🔒 数据库连接已关闭');
}