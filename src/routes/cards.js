/**
 * 卡片路由（真实联调 vmcardio）
 *
 * POST   /api/cards                      - 提交开卡申请（写入审批队列）
 * GET    /api/cards/applications         - 查询我的开卡申请列表
 * GET    /api/cards                      - 查询我的卡列表（含实时详情）
 * GET    /api/cards/:card_id             - 查单张卡详情
 * POST   /api/cards/:card_id/freeze      - 冻结/解冻
 * POST   /api/cards/:card_id/recharge    - 充值
 * DELETE /api/cards/:card_id             - 删卡
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const db      = require('../db/database');
const sdk     = require('../services/vmcardioSDK');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// ── 开卡申请频率限制：10次/分钟（只限制POST /api/cards）─────────────────────
const createCardLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { code: 429, msg: '开卡请求过于频繁，请稍后再试' },
  skip: (req) => req.method !== 'POST'  // 只限制POST方法
});

const FeeCalculator = require('../services/feeCalculator');
const BalanceService = require('../services/balanceService');

// ── 提交开卡申请（写入审批队列，不直接调 vmcardio）─────────────────────────
router.post('/', createCardLimiter, async (req, res, next) => {
  try {
    const {
      product_code, card_bin, first_name, last_name, label,
      topup_amount, quantity
    } = req.body;

    if (!product_code || !first_name || !last_name) {
      return res.status(400).json({ code: 400, msg: '缺少必填参数：product_code / first_name / last_name' });
    }

    const topupAmt = Number(topup_amount) || 0;
    const qty = Math.max(1, Math.floor(Number(quantity) || 1));

    // 上游要求：每张卡充值金额 ≥ $20
    if (topupAmt < 20) {
      return res.status(400).json({ code: 400, msg: '卡内充值金额不能低于 $20' });
    }

    // 开卡数量限制
    if (qty > 50) {
      return res.status(400).json({ code: 400, msg: '单次开卡数量不能超过 50 张' });
    }

    // 计算总开卡费（每张卡收取固定开卡费）
    const feeResult = FeeCalculator.calculateFee('card_creation', 0, req.user.id);
    const cardCreationFee = feeResult.fee_fixed * qty;
    const totalAmount = topupAmt * qty; // 充值总额（冻结在余额里）

    // 检查用户余额是否足够（开卡费 + 充值费）
    const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user.id);
    const userBalance = Number(user?.balance || 0);
    const totalCost = cardCreationFee + totalAmount;
    if (userBalance < totalCost) {
      return res.status(400).json({ code: 400, msg: `余额不足。需要 $${totalCost.toFixed(2)}（开卡费 $${cardCreationFee.toFixed(2)} + 充值 $${totalAmount.toFixed(2)}），当前余额 $${userBalance.toFixed(2)}` });
    }

    // 通过余额服务扣除开卡费（计入 total_spend 和 total_fees）
    const spendResult = BalanceService.recordSpend(
      req.user.id,
      totalAmount, // 充值金额计入消费
      'card_creation',
      cardCreationFee,
      `申请 ${qty} 张虚拟卡 ${product_code || ''}，每张充值 $${topupAmt}`
    );

    // 冻结充值金额（余额扣除，审批通过后转到卡上）
    db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(totalAmount, req.user.id);

    // 插入申请记录（待审批）
    const result = db.prepare(`
      INSERT INTO card_applications
        (user_id, product_code, card_bin, first_name, last_name, label,
         topup_amount, quantity, email, fee_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      product_code,
      card_bin || '',
      first_name,
      last_name,
      label || '',
      topupAmt,
      qty,
      req.body.email || req.user.email,
      cardCreationFee
    );

    res.status(201).json({
      code: 0,
      msg: '申请已提交，等待管理员审批',
      data: { 
        application_id: result.lastInsertRowid, 
        status: 'pending',
        fee_charged: cardCreationFee,
        new_balance: spendResult.new_balance
      }
    });
  } catch (err) {
    next(err);
  }
});

// ── 查询我的开卡申请列表 ──────────────────────────────────────────────────────
router.get('/applications', (req, res, next) => {
  try {
    const rows = db.prepare(`
      SELECT id, product_code, first_name, last_name, label,
             topup_amount, quantity,
             status, reject_reason, card_id, created_at, updated_at
      FROM card_applications
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(req.user.id);

    res.json({ code: 0, msg: 'ok', data: rows });
  } catch (err) {
    next(err);
  }
});

// ── 我的卡列表（直接从数据库返回，避免vmcardio沙盒API限制）──────────────────
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, pageSize = 10 } = req.query;
    const offset = (page - 1) * pageSize;
    
    // 查询用户的所有卡片（从数据库直接获取）
    const cards = db.prepare(`
      SELECT 
        id, card_id, card_number, product_code, label, card_type, status,
        available_amount, expiry_month, expiry_year, cvv,
        created_at, updated_at
      FROM cards 
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(req.user.id, pageSize, offset);
    
    // 查询总数
    const totalResult = db.prepare('SELECT COUNT(*) as total FROM cards WHERE user_id = ?')
      .get(req.user.id);
    
    res.json({ 
      code: 0, 
      msg: 'ok', 
      data: {
        list: cards,
        total: totalResult.total,
        page: parseInt(page),
        pageSize: parseInt(pageSize)
      }
    });
  } catch (err) {
    next(err);
  }
});

// ── 单张卡详情 ────────────────────────────────────────────────────────────
router.get('/:card_id', async (req, res, next) => {
  try {
    const { card_id } = req.params;

    // 检查归属（管理员可查所有）
    if (req.user.role !== 'admin') {
      const owned = db.prepare('SELECT id FROM cards WHERE card_id = ? AND user_id = ?')
        .get(card_id, req.user.id);
      if (!owned) return res.status(403).json({ code: 403, msg: '无权限' });
    }

    const detail = await sdk.cardDetail(card_id);
    res.json({ code: 0, msg: 'ok', data: detail });
  } catch (err) {
    next(err);
  }
});

// ── 冻结 / 解冻 ───────────────────────────────────────────────────────────
router.post('/:card_id/freeze', async (req, res, next) => {
  const { card_id } = req.params;  // 提到 try 外面，catch 块需要访问
  const rawStatus = req.body.status;
  // 实测有效值：CANCELLED（冻结）/ ACTIVE（解冻）
  // 文档写的 freeze/unfreeze 经测试无效（400003 Status Error）
  const status = String(rawStatus || '').toUpperCase();  // 提到 try 外面，catch 块需要访问
  try {

    if (!['CANCELLED', 'ACTIVE'].includes(status)) {
      return res.status(400).json({ code: 400, msg: 'status 必须为 CANCELLED（冻结）或 ACTIVE（解冻）' });
    }

    if (req.user.role !== 'admin') {
      const owned = db.prepare('SELECT id FROM cards WHERE card_id = ? AND user_id = ?')
        .get(card_id, req.user.id);
      if (!owned) return res.status(403).json({ code: 403, msg: '无权限' });
    }

    const result = await sdk.freezeCard(card_id, status);

    // 同步更新本地 DB 卡片状态
    db.prepare('UPDATE cards SET status = ? WHERE card_id = ?')
      .run(status, card_id);

    res.json({ code: 0, msg: 'ok', data: result });
  } catch (err) {
    const msg = err?.vmMsg || err?.message || '';
    // vmcardio 冻结/解冻失败时，同步真实状态到本地DB并返回友好提示
    if (msg.includes('Canceled') || msg.includes('cancelled') || msg.includes('status') || msg.includes('Status') || msg.includes('400') || msg.includes('Card')) {
      let realStatus = '';
      try {
        const detail = await sdk.cardDetail(card_id);
        realStatus = detail?.status || '';
        if (realStatus) {
          db.prepare('UPDATE cards SET status = ?, verified_status = ? WHERE card_id = ?')
            .run(realStatus, 'invalid', card_id);
        }
      } catch (_) {
        realStatus = 'cancelled';
        db.prepare('UPDATE cards SET status = ?, verified_status = ? WHERE card_id = ?')
          .run('cancelled', 'invalid', card_id);
      }
      // 失效卡片：余额自动退回用户总余额
      try {
        const card = db.prepare('SELECT user_id, available_amount FROM cards WHERE card_id = ?').get(card_id);
        if (card && Number(card.available_amount) > 0) {
          const refundAmt = Number(card.available_amount);
          db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(refundAmt, card.user_id);
          db.prepare('UPDATE cards SET available_amount = 0 WHERE card_id = ?').run(card_id);
          // 记录交易流水
          db.prepare("INSERT INTO transactions (user_id, type, amount, description, created_at) VALUES (?, 'card_refund', ?, ?, nowiso())")
            .run(card.user_id, refundAmt, '卡片失效，余额自动退还 $' + refundAmt.toFixed(2));
        }
      } catch (refundErr) {
        console.error('[freeze] 余额退还失败:', refundErr.message);
      }
      // 根据真实状态生成友好提示
      const statusUpper = realStatus.toUpperCase();
      let userMsg;
      if (status === 'ACTIVE') {
        // 用户想解冻
        if (statusUpper === 'CANCELLED' || statusUpper === 'CLOSED') {
          userMsg = '该卡片已失效，无法解冻';
        } else if (statusUpper === 'ACTIVE') {
          userMsg = '该卡片当前为正常状态，无需解冻';
        } else {
          userMsg = '当前卡片状态不支持解冻操作';
        }
      } else {
        // 用户想冻结
        if (statusUpper === 'CANCELLED' || statusUpper === 'CLOSED') {
          userMsg = '该卡片已失效，无法冻结';
        } else if (statusUpper === 'CANCELLED') {
          userMsg = '该卡片当前已被冻结';
        } else {
          userMsg = '当前卡片状态不支持冻结操作';
        }
      }
      return res.status(422).json({ code: 422, msg: userMsg });
    }
    next(err);
  }
});

// ── 充值（储值卡）────────────────────────────────────────────────────────
router.post('/:card_id/recharge', async (req, res, next) => {
  try {
    const { card_id } = req.params;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ code: 400, msg: '充值金额必须大于 0' });
    }

    if (req.user.role !== 'admin') {
      const owned = db.prepare('SELECT id FROM cards WHERE card_id = ? AND user_id = ?')
        .get(card_id, req.user.id);
      if (!owned) return res.status(403).json({ code: 403, msg: '无权限' });
    }

    const result = await sdk.rechargeCard(card_id, amount);
    res.json({ code: 0, msg: 'ok', data: result });
  } catch (err) {
    next(err);
  }
});

// ── 删卡 ──────────────────────────────────────────────────────────────────
router.delete('/:card_id', async (req, res, next) => {
  try {
    const { card_id } = req.params;

    if (req.user.role !== 'admin') {
      const owned = db.prepare('SELECT id FROM cards WHERE card_id = ? AND user_id = ?')
        .get(card_id, req.user.id);
      if (!owned) return res.status(403).json({ code: 403, msg: '无权限' });
    }

    const result = await sdk.deleteCard(card_id);
    db.prepare('DELETE FROM cards WHERE card_id = ?').run(card_id);

    res.json({ code: 0, msg: 'ok', data: result });
  } catch (err) {
    next(err);
  }
});

// ── 用户账户余额（管理员手动充值的余额）────────────────────────────────────
router.get('/account/balance', (req, res, next) => {
  try {
    // 管理员没有个人余额概念，直接返回 0
    if (req.user.role === 'admin') {
      return res.json({ code: 0, msg: 'ok', data: { balance: 0 } });
    }
    const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user.id);
    res.json({ code: 0, msg: 'ok', data: { balance: Number(user?.balance || 0) } });
  } catch (err) {
    next(err);
  }
});

// ── FB 验证码查询 ────────────────────────────────────────────────────────
// 从交易记录中筛选 Facebook 商户，提取附言中的 4 位验证码
router.get('/:cardId/fb-codes', async (req, res, next) => {
  try {
    const { cardId } = req.params;
    const userId = req.user.id;

    // 验证卡片归属
    const card = db.prepare('SELECT card_id, card_number, user_id FROM cards WHERE card_id = ?').get(cardId);
    if (!card) return res.json({ code: 404, msg: '卡片不存在' });
    // 管理员可以查看任意卡，普通用户只能查自己的
    if (req.user.role !== 'admin' && card.user_id !== userId) {
      return res.json({ code: 403, msg: '无权查看该卡片' });
    }

    // 查交易记录（多拉几页确保覆盖）
    const allItems = [];
    let page = 1;
    const pageSize = 50;
    while (page <= 3) { // 最多查 3 页 = 150 条
      const result = await sdk.cardTransaction({ card_id: cardId, page, page_size: pageSize });
      const items = result?.list || result || [];
      if (items.length === 0) break;
      allItems.push(...items);
      if (items.length < pageSize) break;
      page++;
    }

    // 筛选包含 FACEBK / FACEBOOK 的商户名
    const fbPattern = /FACEB[KO]/i;
    const codes = [];
    for (const tx of allItems) {
      const merchant = tx.merchant_name || '';
      if (fbPattern.test(merchant)) {
        // 提取验证码：FACEBK *XXXX 格式，提取 * 后面的 4-6 位字母数字
        const match = merchant.match(/\*([A-Za-z0-9]{3,6})\b/);
        const code = match ? match[1] : null;
        codes.push({
          card_id: cardId,
          card_number: card.card_number || '',
          merchant_name: merchant,
          verification_code: code,
          amount: tx.amount !== undefined ? Number(tx.amount) : null,
          transaction_type: tx.transaction_type || '',
          status: tx.status || '',
          time: tx.start_time || '',
        });
      }
    }

    // 去重（同一验证码只保留最新的一条）
    const seen = new Set();
    const unique = codes.filter(c => {
      if (!c.verification_code) return true; // 无验证码的也展示
      const key = c.verification_code;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    res.json({ code: 0, msg: 'ok', data: { codes: unique, total: unique.length } });
  } catch (err) {
    next(err);
  }
});

// ── 产品码列表（开卡选项）────────────────────────────────────────────────
// 硬编码已知产品（Web API 独有的卡段可能不会被 Merchant API 返回）
const HARDCODED_PRODUCTS = [
  {
    product_code: 'S5395YL',
    bin: '539502',
    network: 'Mastercard',
    issuing_area: 'Hong Kong SAR',
    type: 'save',
    card_price: '1.50',
    available: true,
    description: '香港Mastercard',
    metadata: {
      card_type: 'Mastercard',
      country: '香港',
      verification: '无需AVS验证、无需3DS',
      applicable_platforms: 'Facebook, Google, Amazon, Shopify, Walmart, Alibaba, AliExpress 等',
      single_limit: 10000,
      daily_limit: 100000,
      rechargeable: true,
      prohibitions: ['高频拒付', '小额消费（平均订单金额低于$0.5）', '高撤销退款', '高风险商户'],
    },
  },
  {
    product_code: 'S5258YL',
    bin: '525847',
    network: 'Mastercard',
    issuing_area: 'Hong Kong SAR',
    type: 'save',
    card_price: '1.50',
    available: true,
    description: '香港Mastercard',
    metadata: {
      card_type: 'Mastercard',
      country: '香港',
      verification: '无需AVS验证、无需3DS',
      applicable_platforms: 'Facebook, Google, Amazon, Shopify, Walmart, Alibaba, AliExpress 等',
      single_limit: 10000,
      daily_limit: 100000,
      rechargeable: true,
      prohibitions: ['高频拒付', '小额消费（平均订单金额低于$0.5）', '高撤销退款', '高风险商户'],
    },
  },
  {
    product_code: 'G5554LC',
    bin: '246001',
    network: 'Mastercard',
    issuing_area: 'United Kingdom',
    type: 'save',
    card_price: '1.50',
    available: true,
    description: '英国Mastercard',
    metadata: {
      card_type: 'Mastercard',
      country: '英国',
      verification: '无需AVS验证、无需3DS',
      applicable_platforms: 'Facebook, Google, Amazon, OpenAI, Twitter 等',
      single_limit: 10000,
      daily_limit: 100000,
      rechargeable: true,
      prohibitions: ['高频拒付', '小额消费（平均订单金额低于$0.5）', '高撤销退款', '高风险商户'],
    },
  },
  {
    product_code: 'S5331YL',
    bin: '533171',
    network: 'Mastercard',
    issuing_area: 'Singapore',
    type: 'save',
    card_price: '1.50',
    available: true,
    description: '新加坡Mastercard',
    metadata: {
      card_type: 'Mastercard',
      country: '新加坡',
      verification: '无需AVS验证、无需3DS',
      applicable_platforms: 'Facebook, Google, OpenAI, Twitter, Telegram 等',
      single_limit: 10000,
      daily_limit: 100000,
      rechargeable: true,
      prohibitions: ['高频拒付', '小额消费（平均订单金额低于$0.5）', '高撤销退款', '高风险商户'],
    },
  },
  {
    product_code: 'VC113',
    bin: '537872',
    network: 'Mastercard',
    issuing_area: '美国',
    type: 'save',
    card_price: '1.50',
    available: true,
    description: 'AI/Agent工具付费卡段',
    metadata: {
      card_type: 'Mastercard (Business Credit)',
      country: '美国',
      verification: '无需AVS验证、无需3DS',
      applicable_platforms: 'Facebook, Google, TikTok Ads, AI/Agent 订阅 等',
      single_limit: 10000,
      daily_limit: 100000,
      rechargeable: true,
      prohibitions: ['高频拒付', '小额消费（平均订单金额低于$0.5）', '高撤销退款', '高风险商户'],
    },
  },
  {
    product_code: 'S5395',
    bin: '539578',
    network: 'Mastercard',
    issuing_area: 'Hong Kong SAR',
    type: 'save',
    card_price: '1.50',
    available: true,
    description: '香港Mastercard',
    metadata: {
      card_type: 'Mastercard',
      country: '香港',
      verification: '无需AVS验证、无需3DS',
      applicable_platforms: 'Facebook, Google, Amazon, Shopify, Walmart, Alibaba, AliExpress 等',
      single_limit: 10000,
      daily_limit: 100000,
      rechargeable: true,
      prohibitions: ['高频拒付', '小额消费（平均订单金额低于$0.5）', '高撤销退款', '高风险商户'],
    },
  },
  {
    product_code: 'C2350LC',
    bin: '235019',
    network: 'Mastercard',
    issuing_area: 'United Kingdom',
    type: 'save',
    card_price: '1.50',
    available: true,
    description: '英国Mastercard',
    metadata: {
      card_type: 'Mastercard',
      country: '英国',
      verification: '无需AVS验证、无需3DS',
      applicable_platforms: 'Facebook, Google, Amazon, Shopify, Walmart, Alibaba, AliExpress, OpenAI 等',
      single_limit: 10000,
      daily_limit: 100000,
      rechargeable: true,
      prohibitions: ['高频拒付', '小额消费（平均订单金额低于$0.5）', '高撤销退款', '高风险商户'],
    },
  },
  {
    product_code: 'S5257',
    bin: '525797',
    network: 'Mastercard',
    issuing_area: 'Hong Kong SAR',
    type: 'save',
    card_price: '1.50',
    available: true,
    description: '香港Mastercard',
    metadata: {
      card_type: 'Mastercard',
      country: '香港',
      verification: '无需AVS验证、无需3DS',
      applicable_platforms: 'Facebook, Google, Amazon, Shopify, Walmart, Alibaba, AliExpress 等',
      single_limit: 10000,
      daily_limit: 100000,
      rechargeable: true,
      prohibitions: ['高频拒付', '小额消费（平均订单金额低于$0.5）', '高撤销退款', '高风险商户'],
    },
  },
  {
    product_code: 'C2236LC',
    bin: '223600',
    network: 'Mastercard',
    issuing_area: 'United Kingdom',
    type: 'save',
    card_price: '1.50',
    available: true,
    description: '英国Mastercard',
    metadata: {
      card_type: 'Mastercard',
      country: '英国',
      verification: '无需AVS验证、无需3DS',
      applicable_platforms: 'Facebook, Google, OpenAI 等',
      single_limit: 10000,
      daily_limit: 100000,
      rechargeable: true,
      prohibitions: ['高频拒付', '小额消费（平均订单金额低于$0.5）', '高撤销退款', '高风险商户'],
    },
  },
  {
    product_code: 'C2380LC',
    bin: '238003',
    network: 'Mastercard',
    issuing_area: 'United Kingdom',
    type: 'save',
    card_price: '1.50',
    available: true,
    description: '英国Mastercard',
    metadata: {
      card_type: 'Mastercard',
      country: '英国',
      verification: '无需AVS验证、无需3DS',
      applicable_platforms: 'Facebook, Google, Amazon, Shopify, Walmart, Alibaba, AliExpress 等',
      single_limit: 10000,
      daily_limit: 100000,
      rechargeable: true,
      prohibitions: ['高频拒付', '小额消费（平均订单金额低于$0.5）', '高撤销退款', '高风险商户'],
    },
  },
];

router.get('/meta/products', async (req, res, next) => {
  try {
    const result = await sdk.getProductCode();
    // 合并 API 返回的产品列表 + 硬编码默认产品（去重）
    const apiList = (result && result.list) || [];
    // 按 BIN 去重：API 产品在上层，硬编码补充缺失信息
    const merged = [...apiList];
    for (const hp of HARDCODED_PRODUCTS) {
      const existing = merged.find(m => m.bin === hp.bin);
      if (existing) {
        // API 已有该 BIN，用硬编码补充字段
        existing.metadata = hp.metadata;
        if (!existing.description) existing.description = hp.description;
        existing.available = true;
      } else {
        // API 没有该 BIN，添加硬编码产品（标记可用/不可用由自身决定）
        merged.push(hp);
      }
    }
    res.json({ code: 0, msg: 'ok', data: { ...result, list: merged } });
  } catch (err) {
    // API 调用失败时，至少返回硬编码列表
    res.json({
      code: 0,
      msg: 'ok',
      data: { list: HARDCODED_PRODUCTS },
    });
  }
});

module.exports = router;
