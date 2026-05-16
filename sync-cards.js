/**
 * 同步 vmcardio 沙盒卡片数据到本地数据库
 */
require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.resolve(__dirname, './data/vcc.db');

// 确保数据库文件存在
if (!fs.existsSync(DB_PATH)) {
  console.error('❌ 数据库文件不存在:', DB_PATH);
  console.log('请先启动后端服务以创建数据库');
  process.exit(1);
}

const db = new Database(DB_PATH);

// vmcardio 沙盒卡片数据（根据用户提供的截图信息）
const vmcardioCards = [
  {
    card_id: "XR2037028791028551680",  // 示例 card_id
    card_number: "1111111262391666",
    available_amount: 10,
    expiry_month: 7,
    expiry_year: 2026,
    product_code: "PRD001",
    label: "测试卡1",
    status: "active",
    user_id: 2,  // user@vcc.hub 的 user_id
    cvv: "123"
  },
  {
    card_id: "XR2037150794163163136",
    card_number: "1111111502734022",
    available_amount: 10,
    expiry_month: 7,
    expiry_year: 2026,
    product_code: "PRD002",
    label: "测试卡2",
    status: "active",
    user_id: 2,
    cvv: "456"
  },
  {
    card_id: "XR2037152474518786048",
    card_number: "1111111502734022",  // 注意：可能有重复卡号
    available_amount: 20,  // 合计 $30
    expiry_month: 7,
    expiry_year: 2026,
    product_code: "PRD002",
    label: "测试卡3",
    status: "active",
    user_id: 2,
    cvv: "789"
  },
  {
    card_id: "XR2037152474518786049",  // 示例
    card_number: "1111110739370139",
    available_amount: 10,
    expiry_month: 7,
    expiry_year: 2026,
    product_code: "PRD003",
    label: "测试卡4",
    status: "active",
    user_id: 2,
    cvv: "321"
  },
  {
    card_id: "XR2037152474518786050",  // 示例
    card_number: "1111114951614307",
    available_amount: 10,
    expiry_month: 7,
    expiry_year: 2026,
    product_code: "PRD004",
    label: "测试卡5",
    status: "active",
    user_id: 2,
    cvv: "654"
  }
];

console.log('🔄 开始同步卡片数据到本地数据库...');
console.log('📊 准备同步', vmcardioCards.length, '张卡片');

// 先检查 cards 表是否需要扩展字段
const tableInfo = db.prepare("SELECT name FROM pragma_table_info('cards')").all();
const columnNames = tableInfo.map(col => col.name);
console.log('📋 cards 表现有字段:', columnNames);

// 检查是否有 card_type 字段（可能需要添加）
if (!columnNames.includes('card_type')) {
  console.log('⚠️  cards 表缺少 card_type 字段，尝试添加...');
  try {
    db.exec("ALTER TABLE cards ADD COLUMN card_type TEXT NOT NULL DEFAULT 'virtual'");
    console.log('✅  已添加 card_type 字段');
  } catch (err) {
    console.log('ℹ️  card_type 字段可能已存在，跳过:', err.message);
  }
}

// 同步卡片数据
let inserted = 0;
let updated = 0;

const insertCard = db.prepare(`
  INSERT OR REPLACE INTO cards (
    card_id, card_number, product_code, label, status, 
    available_amount, expiry_month, expiry_year, cvv, 
    user_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateTimestamp = db.prepare("SELECT datetime('now') as now").get().now;

for (const card of vmcardioCards) {
  // 检查是否已存在
  const existing = db.prepare("SELECT id FROM cards WHERE card_id = ?").get(card.card_id);
  
  try {
    insertCard.run(
      card.card_id,
      card.card_number,
      card.product_code,
      card.label,
      card.status,
      card.available_amount,
      card.expiry_month,
      card.expiry_year,
      card.cvv,
      card.user_id,
      updateTimestamp,
      updateTimestamp
    );
    
    if (existing) {
      updated++;
    } else {
      inserted++;
    }
  } catch (err) {
    console.error(`❌ 处理卡片 ${card.card_id} 失败:`, err.message);
  }
}

console.log('\n🎉 同步完成！');
console.log('📊 同步统计:');
console.log('  ✅ 新增卡片:', inserted);
console.log('  🔄 更新卡片:', updated);
console.log('  📈 总计卡片:', inserted + updated);

// 验证同步结果
const totalCards = db.prepare("SELECT COUNT(*) as count FROM cards").get().count;
const totalBalance = db.prepare("SELECT SUM(available_amount) as total FROM cards WHERE status = 'active'").get().total || 0;

console.log('\n📋 验证结果:');
console.log('  💳 数据库总卡片数:', totalCards);
console.log('  💰 卡内总余额: $', totalBalance.toFixed(2));

// 显示所有卡片
console.log('\n📋 卡片列表:');
const allCards = db.prepare(`
  SELECT 
    c.card_id, 
    c.card_number, 
    c.available_amount,
    c.status,
    u.email as user_email
  FROM cards c
  LEFT JOIN users u ON c.user_id = u.id
  ORDER BY c.id
`).all();

allCards.forEach((card, index) => {
  console.log(`  ${index + 1}. ${card.card_number} (${card.card_id})`);
  console.log(`     余额: $${card.available_amount}, 状态: ${card.status}, 用户: ${card.user_email}`);
});

db.close();
console.log('\n✅ 卡片同步脚本执行完毕！');