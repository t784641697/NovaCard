const http = require('http');

const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwicm9sZSI6ImFkbWluIiwiaWF0IjoxNzQzMzgwMDk3LCJleHAiOjE3NDM5ODQ4OTd9.KdxOrzTSSoZjNVt-FTKDWLpxpwezERDbsU8BcrU0nXg';

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/admin/merchant-balance',
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
};

const req = http.request(options, (res) => {
  console.log(`状态码: ${res.statusCode}`);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const result = JSON.parse(data);
      console.log('API返回的数据:');
      console.log(JSON.stringify(result, null, 2));
      console.log('\n显示的余额应该是:', result.data?.balance);
    } catch (e) {
      console.log('解析JSON失败:', e.message);
      console.log('原始响应:', data);
    }
  });
});

req.on('error', (e) => {
  console.error(`请求失败: ${e.message}`);
});

req.end();