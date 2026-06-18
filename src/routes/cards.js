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

    // 通过余额服务扣除开卡费（amount=0，只扣 fee；topup 走 line 80 单独冻结，避免重复扣款）
    const spendResult = BalanceService.recordSpend(
      req.user.id,
      0, // topup 不计入消费（由下面 UPDATE 冻结）
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
        single_limit, day_limit, month_limit,
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

    // 先查本地基础数据（product_code / label / 限额 等上游不一定返回的字段）
    let localCard = null;
    const localSql = `
      SELECT c.*, u.name as user_name, u.email as user_email
      FROM cards c JOIN users u ON u.id = c.user_id
      WHERE c.card_id = ?
    `;
    if (req.user.role === 'admin') {
      localCard = db.prepare(localSql).get(card_id);
    } else {
      localCard = db.prepare(localSql + ' AND c.user_id = ?').get(card_id, req.user.id);
    }
    if (!localCard) return res.status(403).json({ code: 403, msg: '无权限或卡片不存在' });

    // 实时从上游拉取完整详情（卡号/CVV/有效期/限额/账单地址）
    const detail = await sdk.cardDetail(card_id);
    // 排除 detail.user_name（持卡人姓名）— 避免覆盖 localCard.user_name（用户真名）
    const { user_name: _ignored, ...detailSafe } = detail;

    // 合并：上游字段优先（实时），本地字段兜底（上游没返回的如 product_code）
    res.json({
      code: 0, msg: 'ok',
      data: {
        ...localCard,        // 本地基础（product_code, label, user_email, user_name 用户真名 等）
        ...detailSafe,       // 上游实时（卡号/CVV/有效期/限额/账单地址）
        // 重新生成 expire 字符串（兼容 admin 端格式）
        expire: (detail.expiry_month || localCard.expiry_month) && (detail.expiry_year || localCard.expiry_year)
          ? String(detail.expiry_month || localCard.expiry_month).padStart(2, '0') + '/' + String(detail.expiry_year || localCard.expiry_year).slice(-2)
          : detail.expire || null,
      }
    });
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
/**
 * GET /api/cards/:cardId/info
 *   轻量级卡片信息（用于"按卡看消费"弹窗头部展示）
 *   不调上游 SDK，仅查本地 DB
 *   普通用户只能查自己的卡
 */
router.get('/:cardId/info', (req, res) => {
  const cardId = req.params.cardId;
  if (!cardId) return res.status(400).json({ code: 400, msg: '无效的卡片ID' });
  const card = db.prepare(`
    SELECT id, card_id, card_number, status, available_amount, product_code, label, user_id
    FROM cards WHERE card_id = ?
  `).get(cardId);
  if (!card) return res.status(404).json({ code: 404, msg: '卡片不存在' });
  if (req.user.role !== 'admin' && card.user_id !== req.user.id) {
    return res.status(403).json({ code: 403, msg: '无权限查看该卡' });
  }
  const owner = card.user_id
    ? db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(card.user_id)
    : null;
  res.json({
    code: 0, msg: 'ok',
    data: {
      card_id:          card.card_id,
      card_number:      card.card_number,
      brand:            card.product_code || card.label || 'CARD',
      status:           card.status,
      available_balance: card.available_amount,
      currency:         card.currency || 'USD',
      owner:            owner ? { id: owner.id, name: owner.name, email: owner.email } : null
    }
  });
});

/**
 * GET /api/cards/:cardId/transactions
 *   查询某张卡的刷卡流水（来自 vmcardio 上游 cardTransaction）
 *   普通用户只能查自己的卡
 */
router.get('/:cardId/transactions', async (req, res) => {
  const cardId = req.params.cardId;
  if (!cardId) return res.status(400).json({ code: 400, msg: '无效的卡片ID' });

  const card = db.prepare(`
    SELECT id, card_id, card_number, status, available_amount, product_code, label, user_id
    FROM cards WHERE card_id = ?
  `).get(cardId);
  if (!card) return res.status(404).json({ code: 404, msg: '卡片不存在' });
  if (req.user.role !== 'admin' && card.user_id !== req.user.id) {
    return res.status(403).json({ code: 403, msg: '无权限查看该卡流水' });
  }
  const owner = card.user_id
    ? db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(card.user_id)
    : null;

  const { type, start_date, end_date, page = 1, page_size = 50 } = req.query;
  try {
    const params = { card_id: cardId, page: Number(page), pageSize: Number(page_size) };
    if (type) params.type = type;
    if (start_date) params.start_date = start_date;
    if (end_date) params.end_date = end_date;
    const data = await sdk.cardTransaction(params);
    res.json({
      code: 0, msg: 'ok',
      data: {
        card: {
          id: card.id, card_id: card.card_id, card_number: card.card_number,
          status: card.status, available_amount: card.available_amount,
          product_code: card.product_code, label: card.label
        },
        owner: owner ? { id: owner.id, email: owner.email, name: owner.name } : null,
        list: data.list || [],
        total: data.total || (data.list || []).length,
        page: Number(page),
        pageSize: Number(page_size)
      }
    });
  } catch (err) {
    res.status(500).json({ code: 500, msg: '查询流水失败: ' + (err.message || '') });
  }
});

/**
 * GET /api/cards/:card_id             - 删卡
 */
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
// 地区模板：每个国家一个 metadata 模板
const REGION_META = {
  HK: {
    country: '香港',
    applicable_platforms: 'Facebook, Google, Amazon, Shopify, Walmart, Alibaba, AliExpress 等',
  },
  UK: {
    country: '英国',
    applicable_platforms: 'Facebook, Google, Amazon, Shopify, Walmart, Alibaba, AliExpress, OpenAI 等',
  },
  US: {
    country: '美国',
    applicable_platforms: 'Facebook, Google, TikTok, Amazon, AI/Agent 工具 等',
  },
  SG: {
    country: '新加坡',
    applicable_platforms: 'Facebook, Google, OpenAI, Twitter, Telegram 等',
  },
};

// 通用元数据（每个卡段都有）
const COMMON_META = {
  network: 'Mastercard',
  card_type: 'Mastercard',
  type: 'save',
  verification: '无需AVS验证、无需3DS',
  single_limit: 10000,
  daily_limit: 100000,
  rechargeable: true,
  prohibitions: ['高频拒付', '小额消费（平均订单金额低于$0.5）', '高撤销退款', '高风险商户'],
};

// 上游 17 个 product_code 实际清单（来自 getProductCode）
// v1.0.18 修正：G5554LC=美国/BIN 555671544015（v1.0.7 沙盒时期硬编码错误）
const HARDCODED_PRODUCTS = [
  // HK 香港（10 个）
  { product_code: 'S5395YL', bin: '539502', issuing_area: 'Hong Kong SAR', ...COMMON_META, card_price: '1.50', available: true, ...REGION_META.HK },
  { product_code: 'G55832SI', bin: '558325', issuing_area: 'Hong Kong SAR', ...COMMON_META, card_price: '1.50', available: true, ...REGION_META.HK },
  { product_code: 'G5450SU', bin: '54502000', issuing_area: 'Hong Kong SAR', ...COMMON_META, card_price: '1.50', available: true, ...REGION_META.HK },
  { product_code: 'S5258LL', bin: '525847', issuing_area: 'Hong Kong SAR', ...COMMON_META, card_price: '1.50', available: true, ...REGION_META.HK },
  { product_code: 'G5449LJ', bin: '54492360', issuing_area: 'Hong Kong SAR', ...COMMON_META, card_price: '1.50', available: true, ...REGION_META.HK },
  { product_code: 'G5449IC', bin: '54493747', issuing_area: 'Hong Kong SAR', ...COMMON_META, card_price: '1.50', available: true, ...REGION_META.HK },
  { product_code: 'G5321KC', bin: '53211359', issuing_area: 'Hong Kong SAR', ...COMMON_META, card_price: '1.50', available: true, ...REGION_META.HK },
  { product_code: 'G5324FV', bin: '53240691', issuing_area: 'Hong Kong SAR', ...COMMON_META, card_price: '1.50', available: true, ...REGION_META.HK },
  { product_code: 'S5395PL', bin: '539578', issuing_area: 'Hong Kong SAR', ...COMMON_META, card_price: '1.50', available: true, ...REGION_META.HK },
  { product_code: 'S5257PM', bin: '525797', issuing_area: 'Hong Kong SAR', ...COMMON_META, card_price: '1.50', available: true, ...REGION_META.HK },
  // UK 英国（4 个）
  { product_code: 'S2460OL', bin: '246001', issuing_area: 'United Kingdom', ...COMMON_META, card_price: '1.50', available: true, ...REGION_META.UK },
  { product_code: 'S2380AL', bin: '238003', issuing_area: 'United Kingdom', ...COMMON_META, card_price: '1.50', available: true, ...REGION_META.UK },
  { product_code: 'S2350CX', bin: '235019', issuing_area: 'United Kingdom', ...COMMON_META, card_price: '1.50', available: true, ...REGION_META.UK },
  { product_code: 'S2236CP', bin: '223600', issuing_area: 'United Kingdom', ...COMMON_META, card_price: '1.50', available: true, ...REGION_META.UK },
  // US 美国（2 个）
  // G5554LC (上游正式环境名：VC102) — 2 个 6 位 BIN 随机分配，bin 字段是上游把 2 个拼接成 12 位返回
  { product_code: 'G5554LC', bin: '555671544015', bins: ['555671', '544015'], upstream_product_code: 'VC102', issuing_area: 'United States', ...COMMON_META, card_price: '1.50', available: true, ...REGION_META.US },
  { product_code: 'G5237OH', bin: '52737560', issuing_area: 'United States', ...COMMON_META, card_price: '1.50', available: true, ...REGION_META.US },
  // SG 新加坡（1 个）
  { product_code: 'S5331GL', bin: '533171', issuing_area: 'Singapore', ...COMMON_META, card_price: '1.50', available: true, ...REGION_META.SG },
].map(p => ({
  // 重新组织字段：metadata 子对象存放描述/限额/适用平台
  product_code: p.product_code,
  bin: p.bin,
  bins: p.bins,                  // G5554LC 等多 BIN 卡段：['555671', '544015']
  upstream_product_code: p.upstream_product_code,  // 兼容旧 G 前缀的 sandbox 名
  issuing_area: p.issuing_area,
  card_type: p.card_type,
  type: p.type,
  network: p.network,
  card_price: p.card_price,
  available: p.available,
  description: p.country + ' Mastercard 虚拟储蓄卡',
  metadata: {
    country: p.country,
    applicable_platforms: p.applicable_platforms,
    verification: p.verification,
    single_limit: p.single_limit,
    daily_limit: p.daily_limit,
    rechargeable: p.rechargeable,
    prohibitions: p.prohibitions,
  },
}));


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
        // API 已有该 BIN，用硬编码补充 metadata + 拓展字段（bins、upstream_product_code 等）
        existing.metadata = hp.metadata;
        existing.description = hp.description;
        existing.available = true;
        // 透传硬编码里的拓展字段（bins、upstream_product_code 等）
        if (hp.bins)        existing.bins = hp.bins;
        if (hp.upstream_product_code) existing.upstream_product_code = hp.upstream_product_code;
      } else {
        // API 没有该 BIN，添加硬编码产品
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
