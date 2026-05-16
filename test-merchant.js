const http = require('http');

// 测试商户余额API
const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/admin/merchant-balance',
  method: 'GET'
};

const req = http.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const result = JSON.parse(data);
      console.log('商户余额API响应:');
      console.log('balance (实时余额):', result.data.balance);
      console.log('wallet_balance (钱包余额):', result.data.wallet_balance);
      console.log('cached_balance (缓存余额):', result.data.cached_balance);
      console.log('vmcardio_available:', result.data.vmcardio_available);
      console.log('last_error:', result.data.last_error);
    } catch (e) {
      console.error('解析错误:', e);
      console.log('原始数据:', data);
    }
  });
});

req.on('error', (e) => {
  console.error('请求错误:', e.message);
});

req.end();