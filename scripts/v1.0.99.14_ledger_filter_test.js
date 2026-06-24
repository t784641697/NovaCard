/**
 * v1.0.99.14 冒烟测试 — 验证账户流水筛选修复
 * 测试项: type=充值 / type=管理员扣款 / dateFrom / dateTo / 组合 / 导出 CSV
 */
const http = require('http');
function req(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { host: '127.0.0.1', port: 5000, path, method, headers: { ...headers, 'Content-Length': data ? Buffer.byteLength(data) : 0 } };
    const r = http.request(opts, res => {
      let chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
(async () => {
  let pass = 0, fail = 0;
  function check(name, got, expected) {
    const ok = got === expected;
    console.log((ok ? '✅' : '❌') + ' ' + name + ': got=' + got + ' expected=' + expected);
    ok ? pass++ : fail++;
  }
  // 1. admin 登录
  const login = JSON.parse((await req('POST', '/api/auth/login', { 'Content-Type': 'application/json' }, { email: 'admin@vcc.hub', password: 'Admin@2026' })).body);
  if (!login.data?.token) { console.log('❌ admin login failed:', login); return; }
  const adminTok = login.data.token;
  console.log('admin token ok\n');
  // 2. admin 测 /api/ledger 各种 type (admin 看自己流水为空)
  console.log('=== admin /api/ledger 筛选测试 (admin user_id=1 无流水, 全部应 0) ===');
  for (const t of ['', '充值', '管理员充值', '管理员扣款', '消费', '退款']) {
    const r = JSON.parse((await req('GET', '/api/ledger?type=' + encodeURIComponent(t), { Authorization: 'Bearer ' + adminTok })).body);
    check('admin type=' + (t||'(空)'), r.data?.total ?? -1, 0);
  }
  // 3. 找有流水的非 admin 用户
  console.log('\n=== 找有流水的非 admin 用户 ===');
  // 用 sqlite 看 (生产环境 .env 配 DB 路径)
  const Database = require('better-sqlite3');
  const path = require('path');
  const dbPath = process.env.DB_PATH || '/opt/vcc-hub/data/vcc.db';
  const db = new Database(dbPath, { readonly: true });
  const targetUser = db.prepare("SELECT user_id, COUNT(*) as cnt FROM transactions WHERE user_id > 1 GROUP BY user_id ORDER BY cnt DESC LIMIT 1").get();
  console.log('target user_id =', targetUser.user_id, '流水数 =', targetUser.cnt);
  // admin 查这个用户的 ledger (admin 视角)
  console.log('\n=== admin 查 user ' + targetUser.user_id + ' 的 ledger (isAdmin 视角) ===');
  // 4. admin 查 user 3 ledger (假定 user 3 流水最多)
  const allRows = db.prepare("SELECT id, type, amount, created_at FROM transactions WHERE user_id=" + targetUser.user_id + " ORDER BY id").all();
  console.log('user ' + targetUser.user_id + ' 全部 ' + allRows.length + ' 条流水:');
  for (const r of allRows) console.log('  id=' + r.id + ' ' + r.type + ' $' + r.amount + ' ' + r.created_at);
  // 5. 用 admin token 测 export.csv (admin 视角拿所有用户)
  const exp = await req('GET', '/api/ledger/export.csv?dateFrom=2026-06-24&dateTo=2026-06-24&limit=100', { Authorization: 'Bearer ' + adminTok });
  console.log('\n=== admin /api/ledger/export.csv?dateFrom=2026-06-24&dateTo=2026-06-24 ===');
  console.log('HTTP', exp.status, 'X-Export-Count:', exp.headers['x-export-count']);
  console.log('body 前 800 chars:');
  console.log(exp.body.slice(0, 800));
  console.log('...');
  // 验证表头含"关联卡号"
  check('CSV 表头含关联卡号', exp.body.split('\r\n')[0].includes('关联卡号'), true);
  // 6. 测试 type=充值 (修复前应是 0, 修复后应该是 '充值' 的总条数)
  const rechargeOnly = await req('GET', '/api/ledger/export.csv?type=' + encodeURIComponent('充值') + '&limit=100', { Authorization: 'Bearer ' + adminTok });
  console.log('\n=== admin /api/ledger/export.csv?type=充值 ===');
  console.log('X-Export-Count:', rechargeOnly.headers['x-export-count']);
  console.log('first 3 data rows:');
  rechargeOnly.body.split('\r\n').slice(1, 4).forEach(l => console.log('  ' + l));
  const expectedRecharge = db.prepare("SELECT COUNT(*) as cnt FROM transactions WHERE type='充值'").get().cnt;
  check('type=充值 count', parseInt(rechargeOnly.headers['x-export-count']), expectedRecharge);
  // 7. 测试 dateFrom 2026-06-18
  const dateAll = await req('GET', '/api/ledger/export.csv?dateFrom=2026-06-18&dateTo=2026-06-18&limit=100', { Authorization: 'Bearer ' + adminTok });
  const expectedDate = db.prepare("SELECT COUNT(*) as cnt FROM transactions WHERE date(created_at)='2026-06-18'").get().cnt;
  check('dateFrom=2026-06-18 count (fix 字符串比较 bug)', parseInt(dateAll.headers['x-export-count']), expectedDate);
  // 8. 测试 dateFrom 2026-06-24
  const date0624 = await req('GET', '/api/ledger/export.csv?dateFrom=2026-06-24&dateTo=2026-06-24&limit=100', { Authorization: 'Bearer ' + adminTok });
  const expectedDate24 = db.prepare("SELECT COUNT(*) as cnt FROM transactions WHERE date(created_at)='2026-06-24'").get().cnt;
  check('dateFrom=2026-06-24 count', parseInt(date0624.headers['x-export-count']), expectedDate24);
  // 9. 测试 type=管理员扣款
  const deduct = await req('GET', '/api/ledger/export.csv?type=' + encodeURIComponent('管理员扣款') + '&limit=100', { Authorization: 'Bearer ' + adminTok });
  const expectedDeduct = db.prepare("SELECT COUNT(*) as cnt FROM transactions WHERE type='管理员扣款'").get().cnt;
  check('type=管理员扣款 count', parseInt(deduct.headers['x-export-count']), expectedDeduct);
  // 10. 测试 type=管理员充值 (前端修复前用的 key, 应该 0 条)
  const adminRecharge = await req('GET', '/api/ledger/export.csv?type=' + encodeURIComponent('管理员充值') + '&limit=100', { Authorization: 'Bearer ' + adminTok });
  check('type=管理员充值 count (错误 key, 应为 0)', parseInt(adminRecharge.headers['x-export-count']), 0);
  console.log('\n=== 总结 ===');
  console.log('PASS: ' + pass + ', FAIL: ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})();
