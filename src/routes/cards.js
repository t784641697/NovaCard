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
const cardProductOverrideService = require('../services/cardProductOverrideService');
const cardProductSeenLog = require('../services/cardProductSeenLog'); // v1.0.75 首次出现追踪
const { authenticate } = require('../middleware/auth');
const { normalizeCountry } = require('../utils/country');
const { deriveScenariosForProduct } = require('../utils/scenarioMatcher');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

// v1.0.70 场景配置 DB 读取 (每次 /meta/products 调用时实时拉取, 配置变更即时生效)
function loadScenarios() {
  try {
    // platforms 字段是 JSON 字符串, 需要 parse 成数组
    return db.prepare(`SELECT id, scenario_name, scenario_icon, sort_order, platforms, enabled
                       FROM scenario_mappings
                       WHERE enabled = 1
                       ORDER BY sort_order ASC`).all()
      .map(s => ({ ...s, platforms: JSON.parse(s.platforms || '[]') }));
  } catch (e) {
    return [];
  }
}

// v1.0.23 卡段静态元数据（适用平台 / 限额 / 卡级别），从 data/card_metadata.json 加载
// 注：上游 vmcardio API 不返回这些字段，data/card_metadata.json 来源是 assets/11111123.docx 16 张截图
// 上游字段（bin/network/issuing_area/remaining_open_card_num）以实时为准
function loadCardMetadata() {
  try {
    const fp = path.join(__dirname, '..', '..', 'data', 'card_metadata.json');
    if (!fs.existsSync(fp)) return new Map();
    const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    return new Map((data.products || []).map(p => [p.product_code, p]));
  } catch (e) {
    console.error('[loadCardMetadata] failed:', e.message);
    return new Map();
  }
}
const CARD_METADATA = loadCardMetadata();
const META_BY_BIN_PREFIX6 = (() => {
  const m = new Map();
  for (const p of CARD_METADATA.values()) {
    if (p.bin_prefix6) m.set(p.bin_prefix6, p);
  }
  return m;
})();

const router = express.Router();

// v1.0.70 公开接口 (放最前, 不走 authenticate) — 用户端开卡页场景按钮用
router.get('/meta/scenarios', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, scenario_name, scenario_icon, sort_order
      FROM scenario_mappings
      WHERE enabled = 1
      ORDER BY sort_order ASC
    `).all();
    res.json({ code: 0, msg: 'ok', data: { list: rows } });
  } catch (err) {
    res.status(500).json({ code: 500, msg: 'failed: ' + err.message });
  }
});

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
// v1.0.21 HARDCODED 业务控制层（v1.0.19 旧版含 metadata 模板已废弃，上游 API 自身已返回完整 metadata）
// 数据来源：上游 API 返回完整 metadata + description + available，业务代码只控制 4 个维度：
//   - available: 用户可申请（true=可选，false=灰显"暂不可用"）
//   - featured: 推荐标记（前端加 ⭐/首推 徽章）
//   - priority: 排序权重（数字越大越靠前）
//   - custom_message: 自定义文案（覆盖上游 description）
// 其他字段（bin/network/metadata/issuing_area/limits/prohibitions）全部来自上游 API，不再硬编码
const HARDCODED_PRODUCTS = [
  // 🇭🇰 香港 (10个) - 暂不可用
  { product_code: 'S5395YL', business: { available: false, priority: 110 }, display_name: null },
  { product_code: 'G55832SI', business: { available: false, priority: 120 }, display_name: null },
  { product_code: 'G5450SU', business: { available: false, priority: 130 }, display_name: null },
  { product_code: 'S5258LL', business: { available: false, priority: 140 }, display_name: null },
  { product_code: 'G5449LJ', business: { available: false, priority: 150 }, display_name: null },
  { product_code: 'G5449IC', business: { available: false, priority: 160 }, display_name: null },
  { product_code: 'G5321KC', business: { available: false, priority: 170 }, display_name: null },
  { product_code: 'G5324FV', business: { available: false, priority: 180 }, display_name: null },
  { product_code: 'S5395PL', business: { available: false, priority: 190 }, display_name: null },
  { product_code: 'S5257PM', business: { available: false, priority: 200 }, display_name: null },
  // 🇬🇧 英国 (4个) - 暂不可用
  { product_code: 'S2460OL', business: { available: false, priority: 210 }, display_name: null },
  { product_code: 'S2380AL', business: { available: false, priority: 220 }, display_name: null },
  { product_code: 'S2350CX', business: { available: false, priority: 230 }, display_name: null },
  { product_code: 'S2236CP', business: { available: false, priority: 240 }, display_name: null },
  // 🇸🇬 新加坡 (1个) - 暂不可用
  { product_code: 'S5331GL', business: { available: false, priority: 250 }, display_name: null },
  // 🇺🇸 美国 (2个)
  { product_code: 'G5237OH', business: { available: false, priority: 260 }, display_name: null },
  // VC102 - 唯一可用 + 推荐
  { product_code: 'G5554LC',  display_name: 'VC102', business: { available: true, featured: true, priority: 1000, custom_message: '🌟 AI/Agent 工具付费首选 · 美国 Mastercard · 2 个 BIN 随机分配' } },
];


router.get('/meta/products', async (req, res, next) => {
  try {
    const result = await sdk.getProductCode();
    const apiList = (result && result.list) || [];

    // v1.0.21 ?raw=1: 跳过 HARDCODED 合并，直接返回上游 API 原始数据（调试用）
    if (req.query.raw === '1') {
      // ?raw=1: 跳过 HARDCODED 合并，但仍附加国家标准化字段（供前端展示）
      // v1.0.70 附加 derived_scenarios 派生字段
      const scenarios = loadScenarios();
      const listWithNorm = apiList.map(p => {
        const country = normalizeCountry(p.issuing_area);
        // v1.0.23 附加静态元数据(适用平台/限额/卡级别) — docx 截图数据
        const meta = CARD_METADATA.get(p.product_code) || META_BY_BIN_PREFIX6.get(String(p.bin || '').slice(0, 6));
        const platforms = (Array.isArray(p.applicable_platforms) && p.applicable_platforms.length > 0)
          ? p.applicable_platforms
          : (Array.isArray(meta?.applicable_platforms) ? meta.applicable_platforms : []);
        return {
          ...p,
          issuing_area_code: country.code,
          issuing_area_name: country.name,
          issuing_area_flag: country.flag,
          applicable_platforms: meta?.applicable_platforms || null,
          card_level:           meta?.meta?.card_level || null,
          single_limit:         meta?.meta?.single_limit || null,
          daily_limit:          meta?.meta?.daily_limit || null,
          verification:         meta?.meta?.verification || null,
          // v1.0.70 场景派生 (B 规则: 精确 + 大小写不敏感)
          derived_scenarios:    deriveScenariosForProduct({ applicable_platforms: platforms }, scenarios),
        };
      });
      // v1.0.24 合并管理员 DB 覆盖(优先级最高:DB override > HARDCODED > docx metadata)
      // v1.0.72 修复: 覆盖 applicable_platforms 后必须重算 derived_scenarios,
      //   否则 ?raw=1 分支下前端拿到的 derived_scenarios 是基于 meta 的(错的),
      //   用户在申请开卡页按场景过滤时, DB override 过的卡段全部筛不到
      const listWithOverride = listWithNorm.map(item => {
        const ov = cardProductOverrideService.get(item.product_code);
        if (!ov) return item;
        const merged = {
          ...item,
          available:              ov.available,
          applicable_platforms:   ov.applicable_platforms,  // null 表示用 docx
          custom_message:         ov.custom_message,
        };
        // 关键: override 后立即重算派生, 保证 derived_scenarios 与最终 applicable_platforms 一致
        merged.derived_scenarios = deriveScenariosForProduct(merged, scenarios);
        return merged;
      });
      // v1.0.75 首次出现标记 (raw 分支也要同步, 否则 is_new 不会更新)
      const { isNewMap: rawIsNewMap } = cardProductSeenLog.syncAndCompute(listWithOverride);
      for (const item of listWithOverride) {
        if (item.product_code) item.is_new = rawIsNewMap[item.product_code] === true;
      }
      return res.json({ code: 0, msg: 'ok (raw upstream)', data: { ...result, list: listWithOverride } });
    }

    // v1.0.21 合并策略：上游 API 为基础数据层 + HARDCODED 业务控制层
    //   - 基础数据（bin/network/type/media/issuing_area/remaining_open_card_num/metadata/description）→ 100% 来自上游
    //   - 业务控制（available/featured/priority/custom_message）→ HARDCODED 覆盖
    //   - 按 priority 降序排序
    // v1.0.21 HARDCODED 条目支持两层: business 字段（业务覆盖）+ display_name（前端友好别名）
    const hardcodedMap = new Map(HARDCODED_PRODUCTS.map(hp => [hp.product_code, hp]));
    // v1.0.24 合并优先级：DB override > HARDCODED > docx metadata > upstream
    // v1.0.70 派生 derived_scenarios (用合并后最终 applicable_platforms)
    const scenarios = loadScenarios();
    const merged = apiList
      .map(p => {
        const hp = hardcodedMap.get(p.product_code);
        const biz = (hp && hp.business) || {};
        // 国家/地区标准化（统一中文名 + 国旗 emoji）
        const country = normalizeCountry(p.issuing_area);
        // v1.0.23 附加静态元数据(适用平台/限额/卡级别) — docx 截图数据
        const meta = CARD_METADATA.get(p.product_code) || META_BY_BIN_PREFIX6.get(String(p.bin || '').slice(0, 6));
        return {
          ...p,
          // 业务覆盖（HARDCODED 层）
          available:       biz.available !== undefined ? biz.available : p.available,
          featured:        biz.featured || false,
          priority:        biz.priority || 0,
          custom_message:  biz.custom_message || null,
          // 友好别名（如 G5554LC → VC102）
          display_name:    (hp && hp.display_name) || p.product_code,
          // 国家/地区标准化字段（后端统一，前端无需处理）
          issuing_area_code:  country.code,
          issuing_area_name:  country.name,
          issuing_area_flag:  country.flag,
          // v1.0.23 静态元数据(docx 截图)
          applicable_platforms: meta?.applicable_platforms || null,
          card_level:           meta?.meta?.card_level || null,
          single_limit:         meta?.meta?.single_limit || null,
          daily_limit:          meta?.meta?.daily_limit || null,
          verification:         meta?.meta?.verification || null,
        };
      })
      // v1.0.24 合并管理员 DB 覆盖(优先级最高:DB override > HARDCODED > docx > upstream)
      .map(item => {
        const ov = cardProductOverrideService.get(item.product_code);
        if (ov) {
          item = {
            ...item,
            available:              ov.available,
            applicable_platforms:   ov.applicable_platforms !== undefined ? ov.applicable_platforms : item.applicable_platforms,
            custom_message:         ov.custom_message !== undefined ? ov.custom_message : item.custom_message,
          };
        }
        // v1.0.70 派生 (用最终合并后的 platforms, 优先级 DB override > docx)
        item.derived_scenarios = deriveScenariosForProduct(item, scenarios);
        return item;
      })
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    // v1.0.75 首次出现标记 (滑动窗口)
    //   派生数据, 不持久化. 每次拉取上游后, 对比 last_seen 算出 is_new, 再覆盖 last_seen
    //   首次部署后第一次拉取时自动种子化, 全部 is_new=false
    const { isNewMap } = cardProductSeenLog.syncAndCompute(merged);
    for (const item of merged) {
      if (item.product_code) item.is_new = isNewMap[item.product_code] === true;
    }

    res.json({ code: 0, msg: 'ok', data: { ...result, list: merged } });
  } catch (err) {
    // v1.0.21 HARDCODED 业务控制层只含 business 字段，无法作为完整 fallback
    // 上游 API 挂掉时返回 503 + 错误信息，前端可缓存上一次成功的列表
    logger.error && logger.error('[/api/cards/meta/products] upstream failed:', err.message);
    res.status(503).json({
      code: 503,
      msg: 'upstream vmcardio API unavailable: ' + err.message,
    });
  }
});


// v1.0.21 调试用: 永远返回上游 API 原始数据（不合并 HARDCODED）
router.get('/meta/products/upstream', async (req, res, next) => {
  try {
    const result = await sdk.getProductCode();
    const rawList = (result && result.list) || [];
    // 附带标准化字段（便于调试时对比原始 vs 标准化）
    const listWithNorm = rawList.map(p => {
      const c = normalizeCountry(p.issuing_area);
      return {
        ...p,
        issuing_area_code: c.code,
        issuing_area_name: c.name,
        issuing_area_flag: c.flag,
      };
    });
    res.json({ code: 0, msg: 'ok (upstream raw)', data: { ...result, list: listWithNorm } });
  } catch (err) {
    res.status(500).json({ code: 500, msg: 'upstream failed: ' + err.message });
  }
});


// ── 公开场景列表已移到 router.use(authenticate) 之前 (v1.0.70)


module.exports = router;
