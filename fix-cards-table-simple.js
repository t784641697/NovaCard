/**
 * 修复 cards 表结构，添加缺失字段（简化版）
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

// 简化SQL语句
const addColumnQueries = [
  "ALTER TABLE cards ADD COLUMN card_number TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE cards ADD COLUMN card_type TEXT NOT NULL DEFAULT 'virtual'",
  "ALTER TABLE cards ADD COLUMN available_amount REAL NOT NULL DEFAULT 0",
  "ALTER TABLE cards ADD COLUMN expiry_month INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE cards ADD COLUMN expiry_year INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE cards ADD COLUMN cvv TEXT NOT NULL DEFAULT ''"
];

let fixedCount = 0;
for (const sql of addColumnQueries) {
  try {
    const columnName = sql.match(/ADD COLUMN (\w+)/)[1];
    console.log(`🔄 尝试添加字段: ${columnName}`);
    db.exec(sql);
    console.log(`✅ 已添加字段: ${columnName}`);
    fixedCount++;
  } catch (err) {
    if (err.message.includes('duplicate column name')) {
      console.log(`ℹ️  字段已存在: ${sql.match(/ADD COLUMN (\w+)/)[1]}`);
    } else {
      console.log(`❌ 执行失败: ${err.message}`);
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