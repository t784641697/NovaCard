const http = require('http');

// 这是一个快速测试，获取新的token然后测试stats接口
const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
};

const loginData = JSON.stringify({
  email: 'admin@vcc.hub',
  password: 'admin123',
  captchaToken: 'test',
  captchaAnswer: 'test'
});

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    try {
      const result = JSON.parse(data);
      if (result.code === 0 && result.data && result.data.token) {
        console.log('✅ 登录成功');
        testStats(result.data.token);
      } else {
        console.log('❌ 登录失败:', result.msg);
      }
    } catch (e) {
      console.log('❌ 解析错误:', e.message);
    }
  });
});

req.on('error', (e) => {
  console.log('❌ 请求错误:', e.message);
});

req.write(loginData);
req.end();

function testStats(token) {
  console.log('测试 /admin/stats...');
  const statsOptions = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/admin/stats',
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + token,
    },
  };

  const statsReq = http.request(statsOptions, (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      try {
        const result = JSON.parse(data);
        if (result.code === 0 && result.data) {
          console.log('✅ stats 成功');
          console.log('账户数据:', JSON.stringify(result.data.account, null, 2));
          
          // 检查问题
          if (result.data.account.system_balance) {
            console.log('\n📊 资金检查:');
            console.log(`系统商户余额 (account_balance): $${result.data.account.system_balance}`);
            console.log(`vmcardio实时余额 (merchant_balance): $${result.data.account.vmcardio_balance || '未定义'}`);
          }
        } else {
          console.log('❌ stats 失败:', result.msg);
        }
      } catch (e) {
        console.log('❌ 解析错误:', e.message);
      }
    });
  });

  statsReq.on('error', (e) => {
    console.log('❌ stats请求错误:', e.message);
  });

  statsReq.end();
}