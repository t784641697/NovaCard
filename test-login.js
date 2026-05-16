const http = require('http');

// 先获取验证码
const captchaReq = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/auth/captcha',
  method: 'GET'
}, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const captcha = JSON.parse(data);
      console.log('验证码获取成功，token:', captcha.data.token);
      
      // 现在登录
      const loginData = JSON.stringify({
        email: 'admin@vcc.hub',
        password: 'admin123',
        captchaToken: captcha.data.token,
        captchaAnswer: '1234' // 验证码通常是1234
      });
      
      const loginReq = http.request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/auth/login',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(loginData)
        }
      }, (loginRes) => {
        let loginData = '';
        loginRes.on('data', (chunk) => { loginData += chunk; });
        loginRes.on('end', () => {
          try {
            const result = JSON.parse(loginData);
            if (result.code === 0) {
              console.log('登录成功! Token:', result.data.token);
              console.log('用户ID:', result.data.user.id);
              console.log('邮箱:', result.data.user.email);
              console.log('角色:', result.data.user.role);
            } else {
              console.log('登录失败:', result.msg);
            }
          } catch (e) {
            console.error('解析登录响应失败:', e);
            console.log('原始响应:', loginData);
          }
        });
      });
      
      loginReq.on('error', (e) => {
        console.error('登录请求失败:', e.message);
      });
      
      loginReq.write(loginData);
      loginReq.end();
      
    } catch (e) {
      console.error('解析验证码失败:', e);
      console.log('原始响应:', data);
    }
  });
});

captchaReq.on('error', (e) => {
  console.error('验证码请求失败:', e.message);
});

captchaReq.end();