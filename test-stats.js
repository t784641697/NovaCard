const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/admin/stats',
  method: 'GET',
  headers: {
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjMsImVtYWlsIjoiYWRtaW5AdmNjLmh1YiIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTc0MzUzMDc3OCwiZXhwIjoxNzQzNjE3MTc4fQ.E4x56Sx7w2VE3OQx2m7JtbaD9cdlLYPNwslLw0B1V7w' // 测试token
  }
};

const req = http.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const result = JSON.parse(data);
      console.log('账户数据:');
      console.log('system_balance (系统内余额):', result.data.account.system_balance);
      console.log('vmcardio_balance (vmcardio实时):', result.data.account.vmcardio_balance);
      console.log('wallet_balance (钱包余额):', result.data.account.wallet_balance);
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