#!/usr/bin/env node
/**
 * 测试用户冻结功能 - 同步冻结卡片
 * 测试普通用户（ID=2）的冻结和解冻流程
 */

const fetch = require('node-fetch');
const readline = require('readline');

const API_BASE = 'http://localhost:3000/api';
const ADMIN_TOKEN = 'YOUR_ADMIN_TOKEN_HERE'; // 需要先登录获取

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function loginAdmin() {
  console.log('🔐 管理员登录...');
  try {
    // 首先获取验证码
    const captchaRes = await fetch(`${API_BASE}/auth/captcha`);
    const captchaData = await captchaRes.json();
    
    if (captchaData.code !== 0) {
      console.error('❌ 获取验证码失败:', captchaData.msg);
      return null;
    }
    
    // 登录
    const loginRes = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@vcc.hub',
        password: 'admin123',
        captchaToken: captchaData.data.token,
        captchaAnswer: captchaData.data.text
      })
    });
    
    const loginData = await loginRes.json();
    if (loginData.code !== 0) {
      console.error('❌ 登录失败:', loginData.msg);
      return null;
    }
    
    console.log('✅ 管理员登录成功');
    return loginData.data.token;
  } catch (err) {
    console.error('❌ 登录异常:', err.message);
    return null;
  }
}

async function getUserCards(userId) {
  console.log(`📋 获取用户ID=${userId}的卡片列表...`);
  try {
    const res = await fetch(`${API_BASE}/admin/cards?user_id=${userId}`, {
      headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` }
    });
    const data = await res.json();
    
    if (data.code !== 0) {
      console.error('❌ 获取卡片列表失败:', data.msg);
      return [];
    }
    
    const cards = data.data?.cards || [];
    console.log(`📊 用户有 ${cards.length} 张卡片:`);
    cards.forEach((card, i) => {
      console.log(`  ${i+1}. ${card.card_id} - ${card.card_number} - 余额: $${card.available_amount} - 状态: ${card.status}`);
    });
    
    return cards;
  } catch (err) {
    console.error('❌ 获取卡片异常:', err.message);
    return [];
  }
}

async function freezeUser(userId) {
  console.log(`🔒 冻结用户ID=${userId}...`);
  try {
    const res = await fetch(`${API_BASE}/admin/users/${userId}/status`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'disabled' })
    });
    
    const data = await res.json();
    console.log('📋 冻结结果:', data);
    return data;
  } catch (err) {
    console.error('❌ 冻结用户异常:', err.message);
    return null;
  }
}

async function unfreezeUser(userId) {
  console.log(`🔓 解冻用户ID=${userId}...`);
  try {
    const res = await fetch(`${API_BASE}/admin/users/${userId}/status`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'active' })
    });
    
    const data = await res.json();
    console.log('📋 解冻结果:', data);
    return data;
  } catch (err) {
    console.error('❌ 解冻用户异常:', err.message);
    return null;
  }
}

async function testUserFreezeFlow() {
  console.log('🚀 开始测试用户冻结功能');
  console.log('='.repeat(50));
  
  // 1. 登录获取token
  const token = await loginAdmin();
  if (!token) {
    console.error('❌ 无法获取管理员token，测试终止');
    return;
  }
  global.ADMIN_TOKEN = token;
  
  const TEST_USER_ID = 2; // 普通用户TestUser
  
  // 2. 查看用户当前卡片
  await getUserCards(TEST_USER_ID);
  
  console.log('\n1️⃣ 第一步：冻结用户（应该同步冻结所有卡片）');
  console.log('-'.repeat(40));
  
  const freezeResult = await freezeUser(TEST_USER_ID);
  if (!freezeResult || freezeResult.code !== 0) {
    console.error('❌ 冻结失败，测试终止');
    return;
  }
  
  console.log('\n⏸️ 等待3秒查看卡片状态...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // 3. 再次查看卡片（卡片应该被冻结）
  await getUserCards(TEST_USER_ID);
  
  console.log('\n2️⃣ 第二步：解冻用户（应该同步解冻所有卡片）');
  console.log('-'.repeat(40));
  
  const unfreezeResult = await unfreezeUser(TEST_USER_ID);
  if (!unfreezeResult || unfreezeResult.code !== 0) {
    console.error('❌ 解冻失败');
    return;
  }
  
  console.log('\n⏸️ 等待3秒查看卡片状态...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // 4. 再次查看卡片（卡片应该被解冻）
  await getUserCards(TEST_USER_ID);
  
  console.log('\n='.repeat(50));
  console.log('✅ 测试完成！');
  console.log('总结：');
  console.log(`  - 冻结用户时，同步处理了 ${freezeResult.data?.cardsCount || 0} 张卡片`);
  console.log(`  - vmcardio成功: ${freezeResult.data?.vmcardioSuccess || 0}, 失败: ${freezeResult.data?.vmcardioFailed || 0}`);
  console.log(`  - 解冻用户时，同步处理了 ${unfreezeResult.data?.cardsCount || 0} 张卡片`);
  console.log(`  - vmcardio成功: ${unfreezeResult.data?.vmcardioSuccess || 0}, 失败: ${unfreezeResult.data?.vmcardioFailed || 0}`);
  
  if (freezeResult.data?.vmcardioFailed > 0 || unfreezeResult.data?.vmcardioFailed > 0) {
    console.warn('⚠️  警告：有卡片冻结/解冻失败，请检查IP白名单和vmcardio连接');
  }
}

// 主执行
(async () => {
  try {
    await testUserFreezeFlow();
  } catch (err) {
    console.error('❌ 测试流程异常:', err);
  } finally {
    rl.close();
    process.exit(0);
  }
})();