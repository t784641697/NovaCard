// 测试管理员商户余额API
const http = require('http');
const querystring = require('querystring');

// 先获取验证码
function getCaptchaToken() {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/auth/captcha',
      method: 'GET'
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.code === 0) {
            resolve({
              token: result.data.token,
              answer: result.data.answer
            });
          } else {
            reject(new Error('获取验证码失败: ' + result.msg));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// 登录获取token
function login(email, password, captcha) {
  return new Promise((resolve, reject) => {
    const postData = querystring.stringify({
      email: email,
      password: password,
      captchaToken: captcha.token,
      captchaAnswer: captcha.answer
    });
    
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.code === 0) {
            resolve(result.data.token);
          } else {
            reject(new Error('登录失败: ' + result.msg));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// 测试商户余额API
function testMerchantBalance(token) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/admin/merchant-balance',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch (e) {
          resolve({ raw: data, error: e.message });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// 主函数
async function main() {
  try {
    console.log('🔍 测试商户余额API');
    
    // 1. 获取验证码
    console.log('1. 获取验证码...');
    const captcha = await getCaptchaToken();
    console.log('   验证码token:', captcha.token.substring(0, 20) + '...');
    console.log('   验证码答案:', captcha.answer);
    
    // 2. 登录
    console.log('\n2. 登录...');
    const token = await login('admin@vcc.hub', 'admin123', captcha);
    console.log('   登录成功，token:', token.substring(0, 20) + '...');
    
    // 3. 测试商户余额API
    console.log('\n3. 测试商户余额API...');
    const result = await testMerchantBalance(token);
    
    console.log('\n📊 API返回结果:');
    console.log(JSON.stringify(result, null, 2));
    
    if (result.code === 0) {
      console.log('\n✅ 成功获取商户余额:');
      console.log('   余额:', result.data.balance);
      console.log('   钱包余额:', result.data.wallet_balance || 0);
      console.log('   最后同步:', result.data.last_sync || '无');
      console.log('   缓存余额:', result.data.cached_balance || '无');
    } else {
      console.log('\n❌ API错误:', result.msg);
    }
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

main();