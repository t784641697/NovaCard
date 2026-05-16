/**
 * 生成测试用JWT token
 */
const jwt = require('jsonwebtoken');
require('dotenv').config();

// 检查JWT密钥
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';
console.log('🔑 JWT密钥:', JWT_SECRET.substring(0, 10) + '...');

// 生成管理员token
const adminPayload = {
  id: 3,                // admin@vcc.hub的ID
  email: 'admin@vcc.hub',
  role: 'admin',
  name: 'Admin',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24小时
};

const adminToken = jwt.sign(adminPayload, JWT_SECRET);
console.log('\n👑 管理员Token:');
console.log(adminToken);

// 生成普通用户token
const userPayload = {
  id: 4,                // user@vcc.hub的ID
  email: 'user@vcc.hub',
  role: 'user',
  name: 'TestUser',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24小时
};

const userToken = jwt.sign(userPayload, JWT_SECRET);
console.log('\n👤 普通用户Token:');
console.log(userToken);

console.log('\n📝 使用方法:');
console.log('curl -H "Authorization: Bearer ' + adminToken.substring(0, 30) + '..." http://localhost:3000/api/admin/merchant-balance');