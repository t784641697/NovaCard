const http = require('http');

const captchaToken = '6bcc691b-b3c8-482f-8eb7-a0deede17fd8';
const captchaAnswer = 'yk4g'; // 从数据库查到的答案

console.log('使用验证码:', captchaToken, captchaAnswer);

// 1. 登录
const loginOptions = {
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
  captchaToken: captchaToken,
  captchaAnswer: captchaAnswer
});

const loginReq = http.request(loginOptions, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    try {
      const result = JSON.parse(data);
      if (result.code === 0 && result.data && result.data.token) {
        console.log('✅ 登录成功，token:', result.data.token.substring(0, 30) + '...');
        testStats(result.data.token);
      } else {
        console.log('❌ 登录失败:', result.msg);
        console.log('完整响应:', result);
      }
    } catch (e) {
      console.log('❌ 解析错误:', e.message);
      console.log('原始响应:', data);
    }
  });
});

loginReq.on('error', (e) => {
  console.log('❌ 登录请求错误:', e.message);
});

loginReq.write(loginData);
loginReq.end();

function testStats(token) {
  console.log('\n测试 /admin/stats...');
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
          console.log('\n=== 账户数据 ===');
          console.log(JSON.stringify(result.data.account, null, 2));
          
          console.log('\n=== 问题分析 ===');
          console.log('1. 系统商户余额 (account_balance):', result.data.account.system_balance);
          console.log('2. vmcardio实时余额 (vmcardio_balance):', result.data.account.vmcardio_balance);
          console.log('3. 钱包余额 (wallet_balance):', result.data.account.wallet_balance);
          console.log('4. 总充值 (total_topup):', result.data.account.total_topup);
          console.log('5. 总消费 (total_spend):', result.data.account.total_spend);
          
          // 检查是否有 balance 字段（旧版）
          if (result.data.account.balance !== undefined) {
            console.log('⚠️  发现旧字段 balance:', result.data.account.balance, '(应该去掉)');
          }
        } else {
          console.log('❌ stats 失败:', result.msg);
        }
      } catch (e) {
        console.log('❌ 解析错误:', e.message);
        console.log('原始响应:', data);
      }
    });
  });

  statsReq.on('error', (e) => {
    console.log('❌ stats请求错误:', e.message);
  });

  statsReq.end();
}