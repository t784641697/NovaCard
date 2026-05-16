/**
 * 检查数据库中的用户
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.resolve(__dirname, './data/vcc.db');

if (!fs.existsSync(DB_PATH)) {
  console.error('❌ 数据库文件不存在:', DB_PATH);
  process.exit(1);
}

const db = new Database(DB_PATH);

console.log('👥 检查数据库用户...');

const users = db.prepare("SELECT id, email, role, balance FROM users ORDER BY id").all();

console.log('📋 用户列表:');
users.forEach(user => {
  console.log(`  ID: ${user.id}, 邮箱: ${user.email}, 角色: ${user.role}, 余额: $${user.balance}`);
});

// 检查 user@vcc.hub 是否存在
const userEmail = db.prepare("SELECT id FROM users WHERE email = ?").get('user@vcc.hub');
if (userEmail) {
  console.log(`\n✅ user@vcc.hub 存在，用户ID: ${userEmail.id}`);
} else {
  console.log('\n❌ user@vcc.hub 不存在');
  
  // 尝试创建用户
  const bcrypt = require('bcryptjs');
  console.log('🔄 尝试创建 user@vcc.hub...');
  
  try {
    const hash = bcrypt.hashSync('user123', 12);
    const result = db.prepare(`
      INSERT INTO users (email, password, name, role, balance)
      VALUES (?, ?, ?, 'user', 1000)
    `).run('user@vcc.hub', hash, 'Test User');
    
    console.log(`✅ 已创建 user@vcc.hub，用户ID: ${result.lastInsertRowid}`);
  } catch (err) {
    console.log('❌ 创建用户失败:', err.message);
  }
}

// 检查 admin@vcc.hub
const adminEmail = db.prepare("SELECT id FROM users WHERE email = ?").get('admin@vcc.hub');
if (adminEmail) {
  console.log(`\n✅ admin@vcc.hub 存在，用户ID: ${adminEmail.id}`);
} else {
  console.log('\n❌ admin@vcc.hub 不存在');
}

db.close();
console.log('\n✅ 用户检查完成！');