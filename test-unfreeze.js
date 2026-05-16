// 测试解冻用户功能
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 创建axios实例，包含共享的headers
const api = axios.create({
  baseURL: 'http://localhost:3000/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
});

// 创建一个简单的验证码识别（模拟用户手动输入）
async function getCaptchaAndLogin(email, password) {
  try {
    // 1. 获取验证码
    console.log('  获取验证码...');
    const captchaRes = await api.get('/auth/captcha');
    const captchaToken = captchaRes.data.data.token;
    console.log('  验证码Token:', captchaToken);
    
    // 注意：在实际使用中，用户需要手动输入验证码
    // 这里我们假设验证码是 "1234"（根据系统实际情况调整）
    const captchaAnswer = '1234'; // 需要根据实际情况调整
    
    // 2. 登录
    console.log('  使用验证码登录...');
    const loginRes = await api.post('/auth/login', {
      email,
      password,
      captchaToken,
      captchaAnswer
    });
    
    const token = loginRes.data.data.token;
    console.log('  登录成功，Token:', token.substring(0, 20) + '...');
    return token;
    
  } catch (err) {
    console.error('登录失败:', err.response?.data || err.message);
    throw err;
  }
}

async function testUnfreeze() {
  try {
    console.log('=== 测试解冻用户功能 ===');
    
    // 1. 先登录获取管理员token
    console.log('1. 管理员登录...');
    const token = await getCaptchaAndLogin('admin@vcc.hub', 'admin123');
    
    // 设置认证头
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    
    // 2. 尝试解冻用户 (user_id=2，即 TestUser)
    console.log('\n2. 解冻用户 (ID: 2)...');
    try {
      const unfreezeRes = await api.patch('/admin/users/2/status', {
        status: 'active'
      });
      
      console.log('✅ 解冻成功:', JSON.stringify(unfreezeRes.data, null, 2));
      return true;
    } catch (err) {
      console.error('❌ 解冻失败:');
      if (err.response) {
        console.error('状态码:', err.response.status);
        console.error('响应数据:', JSON.stringify(err.response.data, null, 2));
      } else {
        console.error('错误信息:', err.message);
      }
      return false;
    }
    
  } catch (err) {
    console.error('❌ 测试失败:');
    console.error('错误信息:', err.message);
    if (err.response) {
      console.error('响应数据:', err.response.data);
    }
    return false;
  }
}

// 运行测试
testUnfreeze().then(success => {
  console.log(success ? '\n✅ 测试完成，解冻功能正常' : '\n❌ 测试失败，请检查错误');
  process.exit(success ? 0 : 1);
});