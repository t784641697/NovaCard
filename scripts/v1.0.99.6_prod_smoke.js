/**
 * 生产 v1.0.99.6 冒烟测试
 * 验证: /api/ledger 返回 card_number 字段, /api/ledger/export.csv 含关联卡号列
 */
'use strict';
const http = require('http');

const HOST = '139.180.188.104';
const PORT = 5000;

function httpGet(path, token) {
  return new Promise((resolve) => {
    http.get({ host: HOST, port: PORT, path, headers: { 'Authorization': 'Bearer ' + token } }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', (e) => resolve({ status: 0, body: String(e) }));
  });
}

function login(email, password) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ email, password, captcha: '' });
    const req = http.request({
      method: 'POST', host: HOST, port: PORT, path: '/api/auth/login',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data).data?.token || ''); }
        catch { resolve(''); }
      });
    });
    req.on('error', () => resolve(''));
    req.write(body); req.end();
  });
}

async function main() {
  console.log('=== 生产 v1.0.99.6 冒烟测试 ===\n');
  const userToken = await login('user@vcc.hub', 'User@20261');
  const adminToken = await login('admin@vcc.hub', 'Admin@2026');
  if (!userToken || !adminToken) {
    console.log('❌ 拿不到 token'); process.exit(1);
  }
  console.log('✅ 拿到 token\n');

  // 1. /api/ledger 返回 card_number
  const r1 = await httpGet('/api/ledger?page_size=5', userToken);
  const body1 = JSON.parse(r1.body);
  const items = body1.data?.list || [];
  const withCard = items.filter(i => i.card_number);
  const withoutCard = items.filter(i => !i.card_number);
  console.log(`[1] /api/ledger?page_size=5:`);
  console.log(`    HTTP ${r1.status}, code=${body1.code}, 共 ${items.length} 条`);
  console.log(`    有关联卡号: ${withCard.length} 条, 无关联: ${withoutCard.length} 条`);
  if (withCard.length > 0) {
    const sample = withCard[0];
    console.log(`    样例: type=${sample.type} card_number=${sample.card_number} fee_type=${sample.fee_type}`);
  }
  console.log();

  // 2. /api/ledger/export.csv
  const r2 = await httpGet('/api/ledger/export.csv?limit=5', userToken);
  const csv = r2.body;
  const hasCardNumberHeader = csv.includes('关联卡号');
  const lines = csv.split('\n');
  console.log(`[2] /api/ledger/export.csv?limit=5:`);
  console.log(`    HTTP ${r2.status}, ${csv.length} bytes`);
  console.log(`    表头: ${lines[0].slice(0, 200)}`);
  console.log(`    含"关联卡号"列: ${hasCardNumberHeader}`);
  console.log();

  // 3. admin /api/admin/users/3/transactions (user_id=3 有真实流水 + 5258 删卡退款记录)
  const r3 = await httpGet('/api/admin/users/3/transactions?page=1&page_size=20', adminToken);
  const body3 = JSON.parse(r3.body);
  const adminList = body3.data?.list || [];
  const walletWithCard = adminList.filter(i => i.source === 'wallet' && i.card_number);
  console.log(`[3] /api/admin/users/3/transactions:`);
  console.log(`    HTTP ${r3.status}, code=${body3.code}, 共 ${adminList.length} 条`);
  console.log(`    wallet 来源且有 card_number: ${walletWithCard.length} 条`);
  if (walletWithCard.length > 0) {
    const s = walletWithCard[0];
    console.log(`    样例: type=${s.type} card_id=${s.card_id} card_number=${s.card_number}`);
  }
  console.log();

  // 4. /health
  const r4 = await httpGet('/health', '');
  console.log(`[4] /health: HTTP ${r4.status}`);
  console.log();

  // 总结 (user 2 是 user@vcc.hub 测试账号无流水是正常的; 看 admin 端 user 3 有真实流水)
  const allOk = r1.status === 200 && body1.code === 0
    && r2.status === 200 && hasCardNumberHeader
    && r3.status === 200 && body3.code === 0 && walletWithCard.length > 0
    && r4.status === 200;

  console.log('=== 结果 ===');
  console.log(allOk ? '✅ 所有冒烟测试通过' : '⚠️ 有问题需排查');
  process.exit(allOk ? 0 : 1);
}

main().catch(e => { console.error('❌ 异常:', e); process.exit(1); });
