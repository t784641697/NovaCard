/**
 * v1.0.99 删卡接口冒烟测试
 * 跑法: node scripts/v1.0.99_delete_card_test.js
 */
'use strict';

const path = require('path');
const http = require('http');
const Database = require('better-sqlite3');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DB_PATH = path.join(__dirname, '..', 'data', 'vcc.db');
const BASE = 'http://localhost:5000';

// 5 张测试卡
const TEST_CARDS = [
  { card_id: 'TEST_BALANCE_10',  user_id: 2, balance: 10,  status: 'active',  desc: '余额>0 → 期望 701004 (上游失败, v1.0.99.1 余额不再拦截)' },
  { card_id: 'TEST_DELETED',     user_id: 2, balance: 0,   status: 'deleted', desc: '已删除 → 期望 701001' },
  { card_id: 'TEST_PENDING',     user_id: 2, balance: 0,   status: 'active',  desc: '有 pending → 期望 701003' },
  { card_id: 'TEST_OWNER3',      user_id: 3, balance: 0,   status: 'active',  desc: 'user2 越权删 user3 卡 → 期望 403' },
  { card_id: 'TEST_FAKE_NORMAL', user_id: 2, balance: 0,   status: 'active',  desc: '假卡 (上游不存在) → 期望 701004' },
];

let pass = 0, fail = 0;
const results = [];

function log(tag, ...args) { console.log(`  [${tag}]`, ...args); }

function httpDelete(path, token) {
  return new Promise((resolve) => {
    const url = new URL(BASE + path);
    const req = http.request({
      method: 'DELETE',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Length': '0' },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', (e) => resolve({ status: 0, body: String(e) }));
    req.end();
  });
}

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

function insertTestCards() {
  const db = new Database(DB_PATH);
  console.log('\n=== 0. 清理旧测试卡 + 插入 5 张 ===');
  for (const c of TEST_CARDS) {
    db.prepare('DELETE FROM cards WHERE card_id = ?').run(c.card_id);
  }
  // TEST_PENDING 还要插 1 笔 PENDING 交易
  db.prepare('DELETE FROM card_transactions WHERE card_id = ?').run('TEST_PENDING');
  // 审计日志也要清理
  db.prepare("DELETE FROM audit_logs WHERE action = 'admin_delete_card' AND json_extract(detail, '$.card_id') IN ('TEST_BALANCE_10','TEST_DELETED','TEST_PENDING','TEST_OWNER3','TEST_FAKE_NORMAL')").run();
  // 重新插入 (显式传 created_at/updated_at, 避免 DEFAULT 触发 nowiso() 报错)
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO cards (user_id, card_id, card_number, product_code, label, status, available_amount, expiry_month, expiry_year, cvv, created_at, updated_at)
    VALUES (?, ?, ?, 'VC102', 'test', ?, ?, 12, 2030, '123', ?, ?)
  `);
  for (const c of TEST_CARDS) {
    stmt.run(c.user_id, c.card_id, '5258' + c.card_id.padEnd(12, '0').slice(0, 12), c.status, c.balance, now, now);
  }
  // 插 1 笔 PENDING 交易给 TEST_PENDING (显式传 sync_time, 避免 DEFAULT 触发 nowiso())
  db.prepare(`
    INSERT INTO card_transactions (card_id, type, status, auth_amount, settle_amount, auth_currency, settle_currency, create_time, sync_time)
    VALUES ('TEST_PENDING', 'Authorization', 'PENDING', 5.00, 0, 'USD', 'USD', ?, ?)
  `).run(now, now);
  log('OK', '5 张测试卡 + 1 笔 PENDING tx 已插入');
  db.close();
}

async function runTest(name, expected, actual, body) {
  const ok = actual === expected;
  const sym = ok ? '✅' : '❌';
  if (ok) pass++; else fail++;
  const tag = `${sym} [${actual === expected ? 'PASS' : 'FAIL'}] ${name}`;
  log(tag, `expect=${expected} actual=${actual}`, body);
  results.push({ name, expected, actual, body });
}

async function main() {
  console.log('=== 1. 准备测试数据 ===');
  insertTestCards();

  console.log('\n=== 2. 拿 token ===');
  const adminToken = await login('admin@vcc.hub', 'Admin@2026');
  const userToken  = await login('user@vcc.hub', 'User@20261');
  log('INFO', 'admin token:', adminToken ? adminToken.slice(0, 30) + '...' : 'FAIL');
  log('INFO', 'user  token:', userToken ? userToken.slice(0, 30) + '...' : 'FAIL');
  if (!adminToken || !userToken) {
    console.log('❌ 拿不到 token, 测试终止');
    process.exit(1);
  }

  console.log('\n=== 3. 跑测试 (admin 视角) ===');
  // 3.1 余额>0 → 701004 (v1.0.99.1 余额不再拦截, 由上游自动退)
  let r = await httpDelete('/api/cards/TEST_BALANCE_10', adminToken);
  await runTest('3.1 余额>0 → 701004 (上游失败)', 701004, JSON.parse(r.body).code, r.body);

  // 3.2 已删除 → 701001
  r = await httpDelete('/api/cards/TEST_DELETED', adminToken);
  await runTest('3.2 已删除 → 701001', 701001, JSON.parse(r.body).code, r.body);

  // 3.3 pending → 701003
  r = await httpDelete('/api/cards/TEST_PENDING', adminToken);
  await runTest('3.3 pending → 701003', 701003, JSON.parse(r.body).code, r.body);

  // 3.4 假卡 (上游不存在) → 701004
  r = await httpDelete('/api/cards/TEST_FAKE_NORMAL', adminToken);
  await runTest('3.4 假卡 → 701004', 701004, JSON.parse(r.body).code, r.body);

  // 3.5 验证: 假卡本地 status 没变 (因为 701004 提前 return, 不软删)
  const dbRO3 = new Database(DB_PATH, { readonly: true });
  const fakeAfter = dbRO3.prepare("SELECT status FROM cards WHERE card_id = 'TEST_FAKE_NORMAL'").get();
  dbRO3.close();
  await runTest('3.5 假卡本地 status=active (未软删)', 'active', fakeAfter?.status, JSON.stringify(fakeAfter));

  console.log('\n=== 4. 跑测试 (普通 user 视角) ===');
  // 4.1 user 越权删 user3 的卡 → 403
  r = await httpDelete('/api/cards/TEST_OWNER3', userToken);
  await runTest('4.1 越权 → 403', 403, JSON.parse(r.body).code, r.body);

  // 4.2 user 删自己的"假"卡 (上游失败) → 701004 (会调上游, 不会 403 因为是 user 自己的)
  // 注: TEST_FAKE_NORMAL 是 user_id=2 的, user2 token 应该能通过权限校验
  r = await httpDelete('/api/cards/TEST_FAKE_NORMAL', userToken);
  await runTest('4.2 user 删自己假卡 → 701004 (上游失败)', 701004, JSON.parse(r.body).code, r.body);

  console.log('\n=== 5. 验证审计日志 ===');
  // 5.1 看看 audit_logs 是否有 admin_delete_card 记录
  // 注意: 我们的失败测试都没到第 7 步 (审计), 所以 audit_logs 应该没记录
  // 让我先看下
  const dbRO2 = new Database(DB_PATH, { readonly: true });
  const auditCount = dbRO2.prepare("SELECT COUNT(*) as c FROM audit_logs WHERE action = 'admin_delete_card' AND json_extract(detail, '$.card_id') LIKE 'TEST_%'").get().c;
  dbRO2.close();
  log('INFO', `admin_delete_card 审计记录数: ${auditCount} (应为 0, 因为所有测试都没成功)`);
  await runTest('5.1 失败测试不写审计日志', 0, auditCount, '');

  console.log('\n=== 6. 清理测试卡 ===');
  const db2 = new Database(DB_PATH);
  for (const c of TEST_CARDS) {
    db2.prepare('DELETE FROM cards WHERE card_id = ?').run(c.card_id);
  }
  db2.prepare('DELETE FROM card_transactions WHERE card_id LIKE ?').run('TEST_%');
  db2.close();
  log('OK', '已清理 5 张测试卡 + 1 笔 PENDING tx');

  console.log('\n=== 7. 测试结果 ===');
  console.log(`  ✅ PASS: ${pass}`);
  console.log(`  ❌ FAIL: ${fail}`);
  console.log(`  📊 覆盖率: ${pass + fail} / ${TEST_CARDS.length + 1} (剩余: 200 成功路径需要真卡)`);
  if (fail > 0) {
    console.log('\n=== 失败详情 ===');
    for (const r of results.filter(x => x.expected !== x.actual)) {
      console.log(`  ❌ ${r.name}: expect=${r.expected} actual=${r.actual} body=${r.body.slice(0, 200)}`);
    }
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('❌ 测试脚本异常:', e);
  process.exit(1);
});
