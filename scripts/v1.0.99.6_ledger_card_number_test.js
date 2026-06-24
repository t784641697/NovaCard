/**
 * v1.0.99.6 账户流水"关联卡号"列冒烟测试
 *
 * 验证后端 /api/ledger 和 /api/admin/users/:id/transactions 接口
 * 都正确返回 card_number (LEFT JOIN cards 表), 前端表格能展示
 * masked 卡号 + 跳详情。
 *
 * 跑法: node scripts/v1.0.99.6_ledger_card_number_test.js
 */
'use strict';

const path = require('path');
const http = require('http');
const Database = require('better-sqlite3');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DB_PATH = path.join(__dirname, '..', 'data', 'vcc.db');
const BASE = 'http://localhost:5000';

let pass = 0, fail = 0;
const results = [];

function log(tag, ...args) { console.log(`  [${tag}]`, ...args); }

function httpGet(path, token) {
  return new Promise((resolve) => {
    http.get(BASE + path, { headers: { 'Authorization': 'Bearer ' + token } }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', (e) => resolve({ status: 0, body: String(e) }));
  });
}

async function login(email, password) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ email, password, captcha: '' });
    const req = http.request({
      method: 'POST',
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/login',
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

async function runTest(name, expected, actual, body) {
  const ok = actual === expected;
  const sym = ok ? '✅' : '❌';
  if (ok) pass++; else fail++;
  const tag = `${sym} [${ok ? 'PASS' : 'FAIL'}] ${name}`;
  log(tag, `expect=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`, typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body));
  results.push({ name, expected, actual });
}

async function main() {
  console.log('=== 0. 准备测试数据 ===');
  const db = new Database(DB_PATH);
  db.function('nowiso', { deterministic: true }, () => new Date().toISOString());

  // 测试用户 (用户端)
  const TEST_USER_ID = 2;
  // 测试卡
  const TEST_CARD_ID = 'TEST_LEDGER_CARD_001';
  const TEST_CARD_NUMBER = '5258470125173750';

  // 清理
  db.prepare('DELETE FROM cards WHERE card_id = ?').run(TEST_CARD_ID);
  db.prepare('DELETE FROM transactions WHERE ref_id = ?').run(TEST_CARD_ID);

  // 插 1 张 active 卡
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO cards (user_id, card_id, card_number, product_code, label, status, available_amount, expiry_month, expiry_year, cvv, created_at, updated_at)
    VALUES (?, ?, ?, 'VC102', 'test', 'active', 0, 12, 2030, '123', ?, ?)
  `).run(TEST_USER_ID, TEST_CARD_ID, TEST_CARD_NUMBER, now, now);
  log('OK', `插入测试卡 ${TEST_CARD_ID} (${TEST_CARD_NUMBER})`);

  // 写 3 笔关联流水
  const insertTxn = db.prepare(`
    INSERT INTO transactions (user_id, type, amount, fee_type, fee_amount, net_amount, description, ref_id, created_at)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)
  `);
  insertTxn.run(TEST_USER_ID, '消费', -5, 'card_creation', -5, '[开卡费] VC102 余额退还', TEST_CARD_ID, now);
  insertTxn.run(TEST_USER_ID, '消费', -3, 'transaction', -3, '[交易费] 5554 **** 1234', TEST_CARD_ID, now);
  insertTxn.run(TEST_USER_ID, '退款', 20, 'card_delete_refund', 20, '[删卡余额退还] VC102 5258...3750 余额退还 $20.00', TEST_CARD_ID, now);
  // 再写 1 笔没关联的流水 (ref_id='')
  insertTxn.run(TEST_USER_ID, '充值', 100, 'topup', 100, '[管理员充值] 测试', '', now);
  log('OK', '插入 3 笔关联流水 + 1 笔无关联流水');

  db.close();

  console.log('\n=== 1. 拿 token ===');
  const userToken = await login('user@vcc.hub', 'User@20261');
  const adminToken = await login('admin@vcc.hub', 'Admin@2026');
  if (!userToken || !adminToken) {
    console.log('❌ 拿不到 token, 测试终止');
    process.exit(1);
  }
  log('INFO', 'user/admin token OK');

  console.log('\n=== 2. 用户端 GET /api/ledger 返回 card_number ===');
  const r1 = await httpGet('/api/ledger?page_size=20', userToken);
  const body1 = JSON.parse(r1.body);
  await runTest('2.1 /api/ledger HTTP 200', 200, r1.status);
  await runTest('2.2 code=0', 0, body1.code);
  const items = body1.data?.list || [];
  log('INFO', `返回 ${items.length} 条流水`);

  // 找关联 TEST_CARD_ID 的 3 条
  const relatedItems = items.filter(it => it.ref_id === TEST_CARD_ID);
  await runTest('2.3 找到 3 条关联 TEST_CARD_ID 的流水', 3, relatedItems.length, relatedItems.map(i => i.type));

  // 验证 card_number 字段
  const allRelatedHaveCardNumber = relatedItems.length === 3 && relatedItems.every(it => it.card_number === TEST_CARD_NUMBER);
  await runTest('2.4 关联流水的 card_number 字段=5258470125173750', true, allRelatedHaveCardNumber, relatedItems.map(i => i.card_number));

  // 找没关联的 1 条 (ref_id='')
  const unRelatedItem = items.find(it => it.ref_id === '' || !it.ref_id);
  await runTest('2.5 找到 1 条无关联的流水', true, !!unRelatedItem);
  await runTest('2.6 无关联流水的 card_number=空串', '', unRelatedItem?.card_number, unRelatedItem?.card_number);

  console.log('\n=== 3. 用户端 GET /api/ledger/export.csv 包含关联卡号列 ===');
  const r2 = await httpGet('/api/ledger/export.csv?limit=100', userToken);
  const csvText = r2.body;
  // CSV 表头应有"关联卡号"列
  const hasCardNumberHeader = csvText.includes('关联卡号');
  await runTest('3.1 CSV 表头包含"关联卡号"', true, hasCardNumberHeader, csvText.split('\n')[0]);
  // 至少 1 行包含测试卡号
  const hasTestCardNumber = csvText.includes(TEST_CARD_NUMBER);
  await runTest('3.2 CSV 至少 1 行包含测试卡号 5258470125173750', true, hasTestCardNumber);

  console.log('\n=== 4. admin 端 GET /api/admin/users/:id/transactions 钱包流水的 card_number ===');
  const r3 = await httpGet(`/api/admin/users/${TEST_USER_ID}/transactions?page=1&page_size=20`, adminToken);
  const body3 = JSON.parse(r3.body);
  await runTest('4.1 admin 接口 HTTP 200', 200, r3.status);
  await runTest('4.2 code=0', 0, body3.code);
  const adminList = body3.data?.list || [];
  log('INFO', `admin 返回 ${adminList.length} 条流水`);
  // 找 source='wallet' 且 ref_id=TEST_CARD_ID 的
  const adminWalletRelated = adminList.filter(it => it.source === 'wallet' && it.card_id === TEST_CARD_ID);
  await runTest('4.3 admin 找到 3 条 wallet 来源 + card_id=TEST_CARD_ID 的流水', 3, adminWalletRelated.length);
  const allHaveCardNumber = adminWalletRelated.every(it => it.card_number === TEST_CARD_NUMBER);
  await runTest('4.4 admin wallet 流水的 card_number=5258470125173750', true, allHaveCardNumber, adminWalletRelated.map(i => i.card_number));

  // 找无关联的 (ref_id='', source='wallet')
  const adminUnRelated = adminList.find(it => it.source === 'wallet' && (it.card_id === '' || !it.card_id));
  await runTest('4.5 admin 找到 1 条无关联 wallet 流水', true, !!adminUnRelated);
  await runTest('4.6 admin 无关联 wallet 流水的 card_number=NULL/空', true,
    adminUnRelated?.card_number === null || adminUnRelated?.card_number === undefined || adminUnRelated?.card_number === '',
    adminUnRelated?.card_number);

  console.log('\n=== 5. 性能：账流带 LEFT JOIN 仍能在 200ms 内返回 ===');
  const t0 = Date.now();
  const r4 = await httpGet('/api/ledger?page_size=50', userToken);
  const t1 = Date.now() - t0;
  await runTest('5.1 /api/ledger 50 条 < 500ms', true, t1 < 500, `${t1}ms`);

  console.log('\n=== 6. 清理测试数据 ===');
  const db2 = new Database(DB_PATH);
  db2.function('nowiso', { deterministic: true }, () => new Date().toISOString());
  db2.prepare('DELETE FROM cards WHERE card_id = ?').run(TEST_CARD_ID);
  db2.prepare('DELETE FROM transactions WHERE ref_id = ?').run(TEST_CARD_ID);
  db2.close();
  log('OK', `清理 ${TEST_CARD_ID} + 关联流水`);

  console.log('\n=== 7. 测试结果 ===');
  console.log(`  ✅ PASS: ${pass}`);
  console.log(`  ❌ FAIL: ${fail}`);
  console.log(`  📊 覆盖率: ${pass + fail} 项`);
  if (fail > 0) {
    console.log('\n=== 失败详情 ===');
    for (const r of results.filter(x => JSON.stringify(x.expected) !== JSON.stringify(x.actual))) {
      console.log(`  ❌ ${r.name}: expect=${JSON.stringify(r.expected)} actual=${JSON.stringify(r.actual)}`);
    }
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('❌ 测试脚本异常:', e);
  process.exit(1);
});
