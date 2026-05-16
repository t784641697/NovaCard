// 检查用户角色数据
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.resolve(__dirname, 'data/vcc.db');
const db = new Database(DB_PATH);

console.log('=== 用户角色检查 ===');
console.log('数据库路径:', DB_PATH);

// 查询所有用户
const users = db.prepare('SELECT id, email, name, role, balance, status FROM users ORDER BY id').all();

console.log(`\n总共 ${users.length} 个用户:`);
users.forEach(user => {
  console.log(`\n用户 ID: ${user.id}`);
  console.log(`  邮箱: ${user.email}`);
  console.log(`  姓名: ${user.name || '(空)'}`);
  console.log(`  角色: ${user.role || '(空)'}`);
  console.log(`  余额: $${user.balance}`);
  console.log(`  状态: ${user.status}`);
});

// 检查特定管理员账号
console.log('\n=== 检查管理员账号 ===');
const adminUser = db.prepare('SELECT * FROM users WHERE email = ?').get('admin@vcc.hub');
if (adminUser) {
  console.log('找到管理员账号:');
  console.log('  ID:', adminUser.id);
  console.log('  邮箱:', adminUser.email);
  console.log('  角色:', adminUser.role);
  console.log('  所有字段:', Object.keys(adminUser).join(', '));
} else {
  console.log('未找到 admin@vcc.hub 账号');
}

// 检查数据库表结构
console.log('\n=== users表结构 ===');
try {
  const tableInfo = db.prepare('PRAGMA table_info(users)').all();
  tableInfo.forEach(col => {
    console.log(`  ${col.name} (${col.type}) ${col.notnull ? 'NOT NULL' : ''} ${col.dflt_value ? `DEFAULT ${col.dflt_value}` : ''}`);
  });
} catch (e) {
  console.log('无法获取表结构:', e.message);
}

// 如果管理员角色不是'admin'，修复它
if (adminUser && adminUser.role !== 'admin') {
  console.log('\n=== 需要修复管理员角色 ===');
  console.log(`当前角色: ${adminUser.role}，需要改为: admin`);
  
  const result = db.prepare('UPDATE users SET role = ?, updated_at = datetime("now") WHERE email = ?').run('admin', 'admin@vcc.hub');
  console.log(`修复完成，影响行数: ${result.changes}`);
  
  // 验证修复
  const updatedAdmin = db.prepare('SELECT email, role FROM users WHERE email = ?').get('admin@vcc.hub');
  console.log(`修复后角色: ${updatedAdmin.role}`);
} else if (adminUser) {
  console.log('\n=== 管理员角色已正确设置 ===');
}

db.close();
console.log('\n=== 检查完成 ===');