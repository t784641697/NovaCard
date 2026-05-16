/**
 * 测试服务器上的卡片API
 */
const axios = require('axios');

async function testServerCards() {
  console.log('🔍 测试服务器卡片API...');
  
  try {
    // 1. 获取验证码
    console.log('1. 获取验证码...');
    const captchaRes = await axios.get('http://43.135.26.36/api/auth/captcha');
    const captchaToken = captchaRes.data.data.token;
    console.log('✅ 验证码token获取成功');
    
    // 2. 使用固定验证码登录（简化测试）
    console.log('\n2. 登录获取token...');
    const loginRes = await axios.post('http://43.135.26.36/api/auth/login', {
      email: 'admin@vcc.hub',
      password: 'admin123',
      captcha_token: captchaToken,
      captcha_code: '1234' // 简化测试
    });
    
    if (loginRes.data.code !== 0) {
      console.log('❌ 登录失败:', loginRes.data.msg);
      console.log('提示: 可能需要手动获取验证码图像并输入');
      return;
    }
    
    const token = loginRes.data.data.token;
    console.log('✅ 登录成功，token:', token.substring(0, 30) + '...');
    
    // 3. 测试卡片API
    console.log('\n3. 测试卡片API...');
    const cardsRes = await axios.get('http://43.135.26.36/api/cards?page=1&pageSize=10', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    console.log('✅ 卡片API响应状态:', cardsRes.status);
    console.log('卡片API响应数据:');
    
    if (cardsRes.data.code === 0) {
      const data = cardsRes.data.data;
      console.log('  总数:', data.total);
      console.log('  页码:', data.page);
      console.log('  每页大小:', data.pageSize);
      console.log('  卡片列表:', data.list.length, '张');
      
      data.list.forEach((card, i) => {
        console.log(`  ${i+1}. ${card.card_number} - $${card.available_amount} - ${card.status}`);
      });
      
      if (data.list.length === 0) {
        console.log('⚠️  卡片列表为空，可能存在以下问题:');
        console.log('   - 数据库user_id不匹配');
        console.log('   - API接口问题');
        console.log('   - 权限问题');
      }
    } else {
      console.log('❌ 卡片API错误:', cardsRes.data.msg);
    }
    
  } catch (error) {
    console.log('❌ 测试失败:');
    if (error.response) {
      console.log('  状态码:', error.response.status);
      console.log('  响应数据:', error.response.data);
    } else {
      console.log('  错误信息:', error.message);
    }
  }
}

// 执行测试
testServerCards();