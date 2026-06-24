/**
 * v1.0.99.12 资金安全冒烟测试
 *
 * 不启 express, 纯单元: mock SDK 验证 /recharge 路由的核心逻辑顺序:
 *   1. recordSpend 成功 → 调 SDK → 成功 → 返回 200
 *   2. recordSpend 失败 (余额不足) → 不调 SDK → 返回 400
 *   3. SDK 失败 → recordRefund 回滚 → 返回 500
 *   4. recordSpend + recordRefund 后, 账户回到原值 (资金守恒)
 *
 * 用一个内联 mini-balanceService + mini-DB 避免 better-sqlite3 依赖
 */
const assert = require('assert');

class MiniDB {
  constructor() {
    this.users = new Map();
    this.transactions = [];
    this.id = 1;
  }
  prepare(sql) {
    if (sql.includes('SELECT balance FROM users')) {
      return {
        get: (uid) => ({ balance: this.users.get(uid)?.balance ?? 0 })
      };
    }
    if (sql.includes('UPDATE users SET balance')) {
      return {
        run: (newBal, uid) => { this.users.get(uid).balance = newBal; return { changes: 1 }; }
      };
    }
    if (sql.includes('INSERT INTO transactions')) {
      return {
        run: (uid, type, amount, balAfter, feeType, feeAmt, desc, refId) => {
          this.transactions.push({ id: this.id++, user_id: uid, type, amount, balance_after: balAfter, fee_type: feeType, fee_amount: feeAmt, description: desc, ref_id: refId });
          return { lastInsertRowid: this.id - 1 };
        }
      };
    }
    throw new Error('Unknown SQL: ' + sql);
  }
}

class MiniBalanceService {
  constructor(db) { this.db = db; }
  recordSpend(userId, amount, feeType, feeAmount, description, refId = '') {
    const u = this.db.users.get(userId);
    if (!u || u.balance < amount) throw new Error(`用户 ${userId} 余额不足: 当前 $${u?.balance ?? 0}, 需要 $${amount}`);
    const newBal = +(u.balance - amount).toFixed(2);
    this.db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBal, userId);
    this.db.prepare('INSERT INTO transactions').run(userId, '消费', -amount, newBal, feeType, feeAmount, description, refId);
    return { ok: true, balance_after: newBal };
  }
  recordRefund(userId, amount, feeType, feeAmount, description, refId = '') {
    const u = this.db.users.get(userId);
    if (!u) throw new Error(`用户 ${userId} 不存在`);
    const newBal = +(u.balance + amount).toFixed(2);
    this.db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBal, userId);
    this.db.prepare('INSERT INTO transactions').run(userId, '退款', amount, newBal, feeType, feeAmount, description, refId);
    return { ok: true, balance_after: newBal };
  }
}

// === 路由核心逻辑 (从 cards.js:439 提取 + 简化) ===
async function rechargeLogic(body, user, sdk, BS) {
  const { card_id, amount } = body;
  if (typeof amount !== 'number' || amount <= 0) return { status: 400, body: { code: 400, msg: '金额必须 > 0' } };

  // v1.0.99.12 新增: 先扣账户
  try {
    BS.recordSpend(user.id, amount, 'card_recharge', 0, `卡充值 ${card_id}`, card_id);
  } catch (e) {
    return { status: 400, body: { code: 400, msg: e.message } };
  }

  // 再调上游
  try {
    const result = await sdk.rechargeCard(card_id, amount);
    return { status: 200, body: { code: 0, data: result } };
  } catch (sdkErr) {
    // 失败回滚
    try {
      BS.recordRefund(user.id, amount, 'card_recharge_refund', 0, `卡充值失败退款 ${card_id}: ${sdkErr.message}`, card_id);
    } catch (refundErr) {
      // 退款失败是 critical, 应该触发人工干预
    }
    return { status: 500, body: { code: 500, msg: '上游失败, 已退回账户余额', data: { upstream_error: sdkErr.message } } };
  }
}

async function main() {
  const db = new MiniDB();
  db.users.set(1, { id: 1, email: 'test@vcc.hub', balance: 100 });
  const BS = new MiniBalanceService(db);
  let sdkSuccess = 0, sdkFail = 0;
  const stubSdk = {
    rechargeCard: async (cardId, amount) => {
      if (cardId === 'CARD_FAIL') { sdkFail++; throw new Error('Upstream 700011'); }
      sdkSuccess++;
      return { code: 0, transaction_id: 'tx_' + Date.now() };
    }
  };

  const cases = [
    { name: 'CASE 1: 正常充值 (余额 100, 充 10)', run: async () => {
        const r = await rechargeLogic({ card_id: 'CARD_OK', amount: 10 }, { id: 1 }, stubSdk, BS);
        assert.strictEqual(r.status, 200);
        assert.strictEqual(db.users.get(1).balance, 90, '账户 100 → 90');
        assert.strictEqual(sdkSuccess, 1, 'SDK 调 1 次');
        assert.strictEqual(db.transactions.length, 1);
        assert.strictEqual(db.transactions[0].type, '消费');
        assert.strictEqual(db.transactions[0].amount, -10);
        assert.strictEqual(db.transactions[0].fee_type, 'card_recharge');
        console.log('  ✓ 账户 100→90, 流水消费-10');
      }
    },
    { name: 'CASE 2: 余额不足 (余额 90, 充 200)', run: async () => {
        const sdkBefore = sdkSuccess;
        const r = await rechargeLogic({ card_id: 'CARD_OK', amount: 200 }, { id: 1 }, stubSdk, BS);
        assert.strictEqual(r.status, 400);
        assert.ok(r.body.msg.includes('余额不足'));
        assert.strictEqual(db.users.get(1).balance, 90, '账户不变');
        assert.strictEqual(sdkSuccess, sdkBefore, 'SDK 未调');
        console.log('  ✓ 拒绝, 账户不变, SDK 未调');
      }
    },
    { name: 'CASE 3: SDK 失败 → 退款回滚', run: async () => {
        const balBefore = db.users.get(1).balance;
        const r = await rechargeLogic({ card_id: 'CARD_FAIL', amount: 5 }, { id: 1 }, stubSdk, BS);
        const balAfter = db.users.get(1).balance;
        assert.strictEqual(r.status, 500);
        assert.strictEqual(balAfter, balBefore, '账户应回滚 (扣 5 + 退 5 = 0)');
        assert.strictEqual(sdkFail, 1);
        // 应有 1 笔消费 + 1 笔退款
        const lastTwo = db.transactions.slice(-2);
        assert.strictEqual(lastTwo[0].type, '消费');
        assert.strictEqual(lastTwo[0].amount, -5);
        assert.strictEqual(lastTwo[1].type, '退款');
        assert.strictEqual(lastTwo[1].amount, 5);
        assert.strictEqual(lastTwo[1].fee_type, 'card_recharge_refund');
        assert.ok(lastTwo[1].description.includes('700011'), '退款流水应记录上游错误');
        console.log('  ✓ 账户守恒 ' + balBefore + '=' + balAfter + ', 流水 消费-5 + 退款+5');
      }
    },
    { name: 'CASE 4: 非法金额 (amount=0/-1/字符串)', run: async () => {
        const balBefore = db.users.get(1).balance;
        for (const bad of [0, -1, 'abc', null]) {
          const r = await rechargeLogic({ card_id: 'CARD_OK', amount: bad }, { id: 1 }, stubSdk, BS);
          assert.strictEqual(r.status, 400, '应拒 ' + JSON.stringify(bad));
        }
        assert.strictEqual(db.users.get(1).balance, balBefore, '账户不变');
        console.log('  ✓ 拒绝所有非法金额');
      }
    },
    { name: 'CASE 5: 资金守恒 (4 笔交易后 100 仍 = 用户+退款)', run: async () => {
        const u = db.users.get(1);
        // 总消费 = 10 + 5 = 15, 总退款 = 5, 净支出 = 10
        // 余额应 = 100 - 10 = 90
        const totalSpend = db.transactions.filter(t => t.type === '消费').reduce((s,t) => s + Math.abs(t.amount), 0);
        const totalRefund = db.transactions.filter(t => t.type === '退款').reduce((s,t) => s + t.amount, 0);
        console.log('  📊 总消费 $' + totalSpend + ' + 总退款 $' + totalRefund + ' = 净支出 $' + (totalSpend - totalRefund));
        console.log('  📊 起始 $100 - 净支出 $' + (totalSpend - totalRefund) + ' = 当前 $' + u.balance);
        assert.strictEqual(u.balance, 100 - (totalSpend - totalRefund), '资金守恒');
      }
    }
  ];

  let pass = 0, fail = 0;
  for (const t of cases) {
    try { await t.run(); pass++; console.log('✅ ' + t.name); }
    catch (e) { fail++; console.error('❌ ' + t.name + '\n  ' + e.message); }
  }
  console.log('\n=== v1.0.99.12 冒烟: ' + pass + '/' + (pass+fail) + ' ===');
  process.exit(fail > 0 ? 1 : 0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
