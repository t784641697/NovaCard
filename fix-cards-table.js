/**
 * 修复 cards 表结构，添加缺失字段
 */
require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.resolve(__dirname, './data/vcc.db');

// 确保数据库文件存在
if (!fs.existsSync(DB_PATH)) {
  console.error('❌ 数据库文件不存在:', DB_PATH);
  process.exit(1);
}

const db = new Database(DB_PATH);

console.log('🔧 开始检查和修复 cards 表结构...');

// 检查 cards 表所有字段
const tableInfo = db.prepare("SELECT name, type, notnull, dflt_value FROM pragma_table_info('cards')").all();
console.log('📋 cards 表现有字段结构:');
tableInfo.forEach(col => {
  console.log(`  - ${col.name} (${col.type}) ${col.notnull ? 'NOT NULL' : ''} ${col.dflt_value ? `DEFAULT ${col.dflt_value}` : ''}`);
});

// 检查并添加缺失字段
const requiredFields = [
  { name: 'card_number', type: 'TEXT', notnull: false, defaultValue: "''" },
  { name: 'card_type', type: 'TEXT', notnull: false, defaultValue: "'virtual'" },
  { name: 'available_amount', type: 'REAL', notnull: false, defaultValue: '0' },
  { name: 'expiry_month', type: 'INTEGER', notnull: false, defaultValue: '0' },
  { name: 'expiry_year', type: 'INTEGER', notnull: false, defaultValue: '0' },
  { name: 'cvv', type: 'TEXT', notnull: false, defaultValue: "''" }
];

let fixedCount = 0;
for (const field of requiredFields) {
  const exists = tableInfo.some(col => col.name === field.name);
  if (!exists) {
    console.log(`⚠️  添加缺失字段: ${field.name} (${field.type})`);
    try {
      const sql = `ALTER TABLE cards ADD COLUMN ${field.name} ${field.type} ${field.notnull ? 'NOT NULL' : ''} DEFAULT ${field.defaultValue}`;
      db.exec(sql);
      console.log(`✅  已添加字段: ${field.name}`);
      fixedCount++;
    } catch (err) {
      console.log(`❌  添加字段 ${field.name} 失败:`, err.message);
    }
  }
}

if (fixedCount === 0) {
  console.log('✅ cards 表结构完整，无需修复');
} else {
  console.log(`🎉 修复完成，共添加 ${fixedCount} 个字段`);
}

// 检查现有数据
console.log('\n📊 检查现有卡片数据...');
try {
  const cardCount = db.prepare("SELECT COUNT(*) as count FROM cards").get().count;
  console.log(`  当前有 ${cardCount} 张卡片`);
  
  if (cardCount > 0) {
    const sampleCards = db.prepare("SELECT * FROM cards LIMIT 3").all();
    console.log('  样本数据:');
    sampleCards.forEach((card, i) => {
      console.log(`  ${i+1}. card_id: ${card.card_id}, card_number: ${card.card_number || '(空)'}`);
    });
  }
} catch (err) {
  console.log('❌ 查询现有卡片失败:', err.message);
}

db.close();
console.log('\n✅ 表结构检查完成！');