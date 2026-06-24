// 测 ledger 筛选
const http = require('http');
const Database = require('better-sqlite3');
const db = new Database('/opt/vcc-hub/data/vcc.db');

const PORT = 5000;
function req(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { host: '127.0.0.1', port: PORT, path, method, headers: { ...headers, 'Content-Length': data ? Buffer.byteLength(data) : 0 } };
    const r = http.request(opts, res => {
      let o = ''; res.on('data', d => o += d); res.on('end', () => resolve({ status: res.statusCode, body: o }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  // 1) 登录拿 token
  const loginRes = await req('POST', '/api/auth/login', { 'Content-Type': 'application/json' }, { email: 'taoliang.ligh@gmail.com', password: 'User@20261' });
  const login = JSON.parse(loginRes.body);
  const token = login.data?.token;
  if (!token) { console.log('LOGIN FAIL:', loginRes.status, login); return; }
  console.log('✅ 登录成功, user_id=' + login.data.user.id);

  // 2) 无筛选
  const all = JSON.parse((await req('GET', '/api/ledger?page_size=5', { Authorization: 'Bearer ' + token })).body);
  console.log('📊 无筛选 total=' + all.data.total + ' first 3:');
  for (const x of (all.data.list || []).slice(0,3)) console.log('  ' + x.type + ' $' + x.amount + ' ' + (x.description||'').slice(0,40));

  // 3) type=充值
  const t1 = JSON.parse((await req('GET', '/api/ledger?type=' + encodeURIComponent('充值') + '&page_size=10', { Authorization: 'Bearer ' + token })).body);
  console.log('🔍 type=充值 total=' + t1.data.total);
  for (const x of (t1.data.list || []).slice(0,3)) console.log('  ' + x.type + ' $' + x.amount + ' ' + (x.description||'').slice(0,40));

  // 4) type=管理员充值 (前端传错的那个)
  const t2 = JSON.parse((await req('GET', '/api/ledger?type=' + encodeURIComponent('管理员充值') + '&page_size=10', { Authorization: 'Bearer ' + token })).body);
  console.log('🔍 type=管理员充值 total=' + t2.data.total + ' (前端传错)');

  // 5) type=管理员扣款
  const t3 = JSON.parse((await req('GET', '/api/ledger?type=' + encodeURIComponent('管理员扣款') + '&page_size=10', { Authorization: 'Bearer ' + token })).body);
  console.log('🔍 type=管理员扣款 total=' + t3.data.total);

  // 6) dateFrom/dateTo 2026-06-25
  const t4 = JSON.parse((await req('GET', '/api/ledger?dateFrom=2026-06-25&dateTo=2026-06-25&page_size=10', { Authorization: 'Bearer ' + token })).body);
  console.log('🔍 date 06-25 total=' + t4.data.total);
  for (const x of (t4.data.list || []).slice(0,3)) console.log('  ' + x.type + ' $' + x.amount + ' ' + (x.description||'').slice(0,40));

  // 7) 测 export.csv
  const exp = await req('GET', '/api/ledger/export.csv?limit=100', { Authorization: 'Bearer ' + token });
  console.log('📥 export.csv HTTP=' + exp.status + ' content-type=' + (JSON.stringify(exp).slice(0,50)));
  console.log('   X-Export-Count=' + exp.headers['x-export-count']);
  console.log('   body head=' + exp.body.slice(0,200));
})();
