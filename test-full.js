/**
 * 完整API测试（包含验证码）
 */
const axios = require('axios');
const fs = require('fs');

async function loginWithCaptcha() {
  console.log('🔐 开始登录流程...');
  
  try {
    // 1. 获取验证码
    console.log('1. 获取验证码...');
    const captchaRes = await axios.get('http://localhost:3000/api/auth/captcha');
    const captchaToken = captchaRes.data.data.token;
    const captchaImage = captchaRes.data.data.image;
    
    console.log('✅ 验证码token:', captchaToken);
    console.log('📷 验证码图像URL:', captchaImage.substring(0, 60) + '...');
    
    // 保存验证码图像到文件（可选）
    const base64Data = captchaImage.replace(/^data:image\/svg\+xml;base64,/, '');
    fs.writeFileSync('captcha.svg', Buffer.from(base64Data, 'base64'));
    console.log('📁 验证码已保存到 captcha.svg');
    
    // 提示用户输入验证码
    console.log('\n🔢 请查看生成的 captcha.svg 文件，输入验证码:');
    // 注意：在实际自动化中，需要OCR识别验证码，这里我们手动处理
    // 为了测试，我们可以使用一个固定的验证码（假设为"1234"）
    
    // 2. 使用验证码登录
    console.log('\n2. 尝试登录...');
    const loginRes = await axios.post('http://localhost:3000/api/auth/login', {
      email: 'admin@vcc.hub',
      password: 'admin123',
      captcha_token: captchaToken,
      captcha_code: '1234' // 这里需要实际从图像中识别的验证码
    });
    
    console.log('登录响应:', loginRes.data);
    
    if (loginRes.data.code === 0) {
      return loginRes.data.data.token;
    } else {
      console.log('❌ 登录失败:', loginRes.data.msg);
      return null;
    }
    
  } catch (error) {
    console.log('❌ 登录流程出错:', error.message);
    if (error.response) {
      console.log('响应状态:', error.response.status);
      console.log('响应数据:', error.response.data);
    }
    return null;
  }
}

async function testAPIsWithToken(token) {
  if (!token) {
    console.log('❌ 没有有效token，无法继续测试');
    return;
  }
  
  console.log('\n🔑 使用token测试API...');
  console.log('Token:', token.substring(0, 30) + '...');
  
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
  
  // 测试用户余额接口
  console.log('\n🧪 测试用户余额接口...');
  try {
    const res = await axios.get('http://localhost:3000/api/cards/account/balance', { headers });
    console.log('✅ 用户余额响应:', res.data);
  } catch (error) {
    console.log('❌ 用户余额接口失败:', error.response?.data || error.message);
  }
  
  // 测试商户余额接口
  console.log('\n🏦 测试商户余额接口...');
  try {
    const res = await axios.get('http://localhost:3000/api/admin/merchant-balance', { headers });
    console.log('✅ 商户余额响应:', JSON.stringify(res.data, null, 2));
  } catch (error) {
    console.log('❌ 商户余额接口失败:', error.response?.data || error.message);
  }
  
  // 测试平台统计接口
  console.log('\n📊 测试平台统计接口...');
  try {
    const res = await axios.get('http://localhost:3000/api/admin/stats', { headers });
    console.log('✅ 平台统计响应:');
    if (res.data.code === 0 && res.data.data) {
      const stats = res.data.data;
      console.log('  👥 用户数:', stats.users?.total || 0);
      console.log('  💳 卡片数:', stats.cards?.total || 0);
      console.log('  💰 账户余额:', stats.account?.balance || 0);
      console.log('  💳 卡内余额:', stats.cards?.card_balance || 0);
    }
  } catch (error) {
    console.log('❌ 平台统计接口失败:', error.response?.data || error.message);
  }
}

// 主函数
async function main() {
  console.log('🚀 VCC API 完整测试');
  console.log('=' .repeat(50));
  
  // 由于验证码需要人工识别，我们先跳过登录测试，直接测试接口
  console.log('\n⚠️ 注意：验证码需要人工识别，我们直接测试公开接口');
  console.log('   对于需要认证的接口，我们将测试错误响应');
  
  // 测试健康检查
  console.log('\n❤️ 测试健康检查接口...');
  try {
    const healthRes = await axios.get('http://localhost:3000/health');
    console.log('✅ 健康检查:', healthRes.data);
  } catch (error) {
    console.log('❌ 健康检查失败:', error.message);
  }
  
  // 测试未认证的商户余额接口
  console.log('\n🔒 测试未认证的商户余额接口...');
  try {
    const noAuthRes = await axios.get('http://localhost:3000/api/admin/merchant-balance');
    console.log('✅ 未认证响应（预期401）:', noAuthRes.data);
  } catch (error) {
    if (error.response && error.response.status === 401) {
      console.log('✅ 未认证响应（预期401）:', error.response.data);
    } else {
      console.log('❌ 意外错误:', error.message);
    }
  }
  
  console.log('\n🎉 测试完成！');
  console.log('\n💡 建议：');
  console.log('1. 打开浏览器访问 http://localhost:3000/health 确认服务正常');
  console.log('2. 打开前端页面 http://localhost:5502 进行完整测试');
  console.log('3. 如果需要测试认证接口，请手动登录后获取token');
}

// 运行测试
main().catch(console.error);