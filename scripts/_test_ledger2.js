const http = require('http');
function req(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { host: '127.0.0.1', port: 5000, path, method, headers: { ...headers, 'Content-Length': data ? Buffer.byteLength(data) : 0 } };
    const r = http.request(opts, res => {
      let o = ''; res.on('data', d => o += d); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: o }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
(async () => {
  // admin 登录
  const login = JSON.parse((await req('POST', '/api/auth/login', { 'Content-Type': 'application/json' }, { email: 'admin@vcc.hub', password: 'Admin@2026' })).body);
  console.log('login:', login.code, login.msg);
  const token = login.data?.token;
  if (!token) return;
  console.log('admin token = ' + token.slice(0,30) + '...');
  // 测 ledger 各种 type
  for (const t of ['', '充值', '管理员充值', '管理员扣款', '消费', '退款']) {
    const path = '/api/ledger?type=' + encodeURIComponent(t) + '&page_size=5';
    const r = JSON.parse((await req('GET', path, { Authorization: 'Bearer ' + token })).body);
    console.log('  type=' + (t||'(空)') + ' -> total=' + (r.data?.total ?? r.code) + ' first type=' + (r.data?.list?.[0]?.type || '-'));
  }
  // 测 export.csv (admin 视角)
  const exp = await req('GET', '/api/ledger/export.csv?limit=5', { Authorization: 'Bearer ' + token });
  console.log('\nexport.csv HTTP=' + exp.status + ' ct=' + exp.headers['content-type']);
  console.log('body first 300 chars:');
  console.log(exp.body.slice(0,300));
})();
