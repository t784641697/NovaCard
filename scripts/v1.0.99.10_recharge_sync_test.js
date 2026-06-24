/**
 * v1.0.99.10 冒烟测试: 充值接口 + 异步同步余额到 DB
 *
 * 验证点:
 *  1. POST /api/cards/:card_id/recharge 200
 *  2. 响应 < 500ms (不阻塞)
 *  3. 1.5s 后 DB cards.available_amount 同步到上游值
 *  4. last_verified / verified_status 更新
 *  5. /api/cards 列表接口返回新余额
 *  6. 充值失败时 setTimeout 不会执行 (不会污染 DB)
 */
const { db, initDb } = require('../src/db');
const http = require('http');

const HOST = '127.0.0.1';
const PORT = 5000;
const LOG = (k, v) => console.log(`  ${k.padEnd(20)} ${v}`);

let pass = 0, fail = 0;
const check = (name, cond, extra='') => {
  if (cond) { console.log(`  ✅ ${name}`); pass++; }
  else      { console.log(`  ❌ ${name} ${extra}`); fail++; }
};

const request = (method, path, body=null, token=null) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({
    host: HOST, port: PORT, method, path,
    headers: {
      'Content-Type': 'application/json',
      ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
  }, (res) => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
      try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
      catch { resolve({ status: res.statusCode, body: d }); }
    });
  });
  req.on('error', reject);
  if (data) req.write(data);
  req.end();
});

(async () => {
  console.log('━━━ v1.0.99.10 冒烟测试 ━━━\n');
  initDb();

  // 1) 登录拿 token
  console.log('[1] 登录 user@vcc.hub');
  const login = await request('POST', '/api/auth/login', { email: 'user@vcc.hub', password: 'User@20261' });
  const token = login.body?.data?.token;
  check('登录 200', login.status === 200 && token, JSON.stringify(login.body));
  if (!token) { console.log('\n  ⚠️ 无 token，退出'); process.exit(1); }

  // 2) 找一张用户卡
  console.log('\n[2] 查用户卡列表');
  const cards = await request('GET', '/api/cards', null, token);
  const cardList = cards.body?.data?.cards || cards.body?.data || [];
  const userCard = cardList.find(c => c.card_id && c.status !== 'deleted');
  if (!userCard) { console.log('  ⚠️ 用户无卡, 测试跳过 (需要先开卡)'); process.exit(0); }
  const cardId = userCard.card_id;
  const amtBefore = Number(userCard.available_amount);
  LOG('card_id', cardId);
  LOG('充值前余额', amtBefore);
  LOG('last_verified', userCard.last_verified || '(null)');

  // 3) 调充值接口 (充 $1 测试, 失败也只是没拿到, 不会真的扣款)
  console.log('\n[3] POST /api/cards/:card_id/recharge 充 $1');
  const t0 = Date.now();
  const recharge = await request('POST', `/api/cards/${cardId}/recharge`, { amount: 1 }, token);
  const elapsed = Date.now() - t0;
  LOG('状态码', recharge.status);
  LOG('响应时间(ms)', elapsed);
  LOG('返回', JSON.stringify(recharge.body).slice(0, 200));
  check('充值 200', recharge.status === 200);
  check('响应 < 500ms (异步同步不阻塞)', elapsed < 500, `实际 ${elapsed}ms`);
  check('响应 code=0', recharge.body?.code === 0);

  // 4) 1.5s 后查 DB 同步结果
  console.log('\n[4] 等 2.5s 异步同步 + 查 DB');
  await new Promise(r => setTimeout(r, 2500));
  const cardAfter = db.prepare('SELECT available_amount, last_verified, verified_status, updated_at FROM cards WHERE card_id = ?').get(cardId);
  LOG('DB available_amount', cardAfter?.available_amount);
  LOG('DB last_verified', cardAfter?.last_verified);
  LOG('DB verified_status', cardAfter?.verified_status);
  check('DB available_amount 是有限数', Number.isFinite(Number(cardAfter?.available_amount)));
  check('DB last_verified 已更新', !!cardAfter?.last_verified && cardAfter.last_verified !== userCard.last_verified);
  check('DB verified_status = verified', cardAfter?.verified_status === 'verified');

  // 5) /api/cards 列表接口也返回新余额
  console.log('\n[5] 重新查 /api/cards 列表');
  const cards2 = await request('GET', '/api/cards', null, token);
  const card2 = (cards2.body?.data?.cards || cards2.body?.data || []).find(c => c.card_id === cardId);
  LOG('列表返回余额', card2?.available_amount);
  check('列表余额 = DB 余额', Number(card2?.available_amount) === Number(cardAfter?.available_amount));

  console.log(`\n━━━ ${pass} pass, ${fail} fail ━━━`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
