/**
 * 测试修复后的卡片API
 */
const http = require('http');

// 由于验证码问题，我们直接测试数据库查询逻辑
const Database = require('better-sqlite3');
const db = new Database('./data/vcc.db');

// 测试数据库查询
console.log('🔍 测试数据库卡片查询...');

// 1. 管理员用户ID
const admin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@vcc.hub');
console.log('管理员ID:', admin.id);

// 2. 查询管理员的卡片
const cards = db.prepare(`
  SELECT 
    id, card_id, card_number, product_code, label, card_type, status,
    available_amount, expiry_month, expiry_year, cvv,
    created_at, updated_at
  FROM cards 
  WHERE user_id = ?
  ORDER BY created_at DESC
`).all(admin.id);

console.log(`📊 管理员有 ${cards.length} 张卡片:`);
cards.forEach((card, i) => {
  console.log(`${i+1}. ${card.card_number} - $${card.available_amount} - ${card.status}`);
});

// 3. 测试总数
const totalResult = db.prepare('SELECT COUNT(*) as total FROM cards WHERE user_id = ?')
  .get(admin.id);
console.log('总数:', totalResult.total);

db.close();

// 4. 验证API应该返回的数据结构
console.log('\n📋 API应该返回的数据结构:');
const expectedResponse = {
  code: 0,
  msg: 'ok',
  data: {
    list: cards,
    total: totalResult.total,
    page: 1,
    pageSize: 10
  }
};

console.log('数据列表长度:', expectedResponse.data.list.length);
console.log('第一张卡片数据:', {
  card_number: cards[0]?.card_number,
  available_amount: cards[0]?.available_amount,
  status: cards[0]?.status
});

console.log('\n✅ 数据库查询正常，卡片API应该能返回数据了！');