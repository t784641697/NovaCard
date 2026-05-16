/**
 * 测试API接口
 */
const axios = require('axios');

async function testAPIs() {
  console.log('🧪 开始测试API接口...');
  
  // 1. 先登录获取token
  console.log('\n1. 登录获取token...');
  try {
    const loginRes = await axios.post('http://localhost:3000/api/auth/login', {
      email: 'admin@vcc.hub',
      password: 'admin123'
    });
    
    if (loginRes.data.code !== 0) {
      console.log('❌ 登录失败:', loginRes.data.msg);
      return;
    }
    
    const token = loginRes.data.data.token;
    console.log('✅ 登录成功，token:', token.substring(0, 20) + '...');
    
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
    
    // 2. 测试用户余额接口
    console.log('\n2. 测试用户余额接口...');
    try {
      const userBalanceRes = await axios.get('http://localhost:3000/api/cards/account/balance', { headers });
      console.log('✅ 用户余额:', userBalanceRes.data);
    } catch (error) {
      console.log('❌ 用户余额接口失败:', error.response?.data || error.message);
    }
    
    // 3. 测试管理员商户余额接口
    console.log('\n3. 测试管理员商户余额接口...');
    try {
      const merchantBalanceRes = await axios.get('http://localhost:3000/api/admin/merchant-balance', { headers });
      console.log('✅ 商户余额:', merchantBalanceRes.data);
    } catch (error) {
      console.log('❌ 商户余额接口失败:', error.response?.data || error.message);
    }
    
    // 4. 测试平台统计接口
    console.log('\n4. 测试平台统计接口...');
    try {
      const statsRes = await axios.get('http://localhost:3000/api/admin/stats', { headers });
      console.log('✅ 平台统计:', JSON.stringify(statsRes.data, null, 2));
    } catch (error) {
      console.log('❌ 平台统计接口失败:', error.response?.data || error.message);
    }
    
  } catch (error) {
    console.log('❌ 测试过程中出错:', error.message);
    if (error.response) {
      console.log('响应状态:', error.response.status);
      console.log('响应数据:', error.response.data);
    }
  }
}

testAPIs().catch(console.error);