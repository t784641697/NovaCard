/**
 * 管理员专用路由
 *
 * POST /api/admin/sync              — 从沙盒同步所有卡数据（支持新增卡 ID）
 * GET  /api/admin/stats             — 返回平台真实统计数据
 * GET  /api/admin/cards             — 管理员查询全部卡（含实时详情）
 * GET  /api/admin/users             — 管理员查询所有用户（含持卡数）
 * GET  /api/admin/account-balance   — 获取账户余额配置
 * POST /api/admin/account-balance   — 更新账户余额配置
 * GET  /api/admin/merchant-balance  — 获取商户实时余额（从vmcardio拉取）
 */

const express = require('express');
const db      = require('../db/database');
const sdk     = require('../services/vmcardioSDK');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireAdmin);

// ── 工具：读/写 settings 表 ──────────────────────────────────────────────────
function getSetting(key, defaultVal = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defaultVal;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, String(value));
}

// ── 获取账户余额配置 ──────────────────────────────────────────────────────────
router.get('/account-balance', (req, res) => {
  res.json({
    code: 0,
    msg:  'ok',
    data: {
      account_balance:     Number(getSetting('account_balance', '0')),
      total_topup:         Number(getSetting('total_topup', '0')),
      total_spend:         Number(getSetting('total_spend', '0')),
      updated_at:          getSetting('account_balance_updated_at', ''),
    },
  });
});

// ── 更新账户余额配置（管理员手动同步） ──────────────────────────────────────
router.post('/account-balance', (req, res) => {
  const { account_balance, total_topup, total_spend } = req.body;

  if (account_balance !== undefined) {
    const val = Number(account_balance);
    if (isNaN(val) || val < 0) return res.status(400).json({ code: 1, msg: 'account_balance 必须为非负数' });
    setSetting('account_balance', val.toFixed(2));
    setSetting('account_balance_updated_at', new Date().toISOString());
  }
  if (total_topup !== undefined) {
    const val = Number(total_topup);
    if (!isNaN(val) && val >= 0) setSetting('total_topup', val.toFixed(2));
  }
  if (total_spend !== undefined) {
    const val = Number(total_spend);
    if (!isNaN(val) && val >= 0) setSetting('total_spend', val.toFixed(2));
  }

  res.json({ code: 0, msg: '更新成功' });
});

// ── 从沙盒同步卡数据 ───────────────────────────────────────────────────────
/**
 * POST /api/admin/sync
 * body.card_ids   - 可选，指定要新增/同步的卡 ID 数组
 * body.user_id    - 新卡归属用户 ID（默认归属 user_id=2，即第一个普通用户）
 *
 * 流程：
 *   1. 合并本地已有卡 + body.card_ids 中的新卡
 *   2. 逐一从沙盒拉 cardDetail，更新本地状态
 *   3. 本地没有的新卡自动 INSERT
 */
router.post('/sync', async (req, res, next) => {
  try {
    const manualIds = Array.isArray(req.body.card_ids) ? req.body.card_ids.filter(Boolean) : [];
    const defaultUserId = req.body.user_id || 2; // 默认归属到第一个普通用户

    // 取本地所有卡
    const localCards = db.prepare('SELECT card_id, user_id FROM cards').all();
    const localIdSet = new Set(localCards.map(c => c.card_id));

    // 合并：本地已有 + 手动新增
    const allIds = [...localIdSet, ...manualIds.filter(id => !localIdSet.has(id))];

    if (allIds.length === 0) {
      return res.json({ code: 0, msg: '无卡可同步', data: { synced: 0, added: 0, errors: [] } });
    }

    const results = { synced: 0, added: 0, failed: 0, errors: [], details: [] };

    // 并发拉取（最多 5 并发）
    const BATCH = 5;
    for (let i = 0; i < allIds.length; i += BATCH) {
      const batch = allIds.slice(i, i + BATCH);
      await Promise.all(batch.map(async (card_id) => {
        try {
          const detail = await sdk.cardDetail(card_id);
          const isNew  = !localIdSet.has(card_id);

          if (isNew) {
            // 新卡：INSERT
            db.prepare(`
              INSERT OR IGNORE INTO cards (user_id, card_id, product_code, label, status)
              VALUES (?, ?, ?, ?, ?)
            `).run(
              defaultUserId,
              card_id,
              detail.product_code || '',
              detail.label || '',
              (detail.status || 'ACTIVE').toUpperCase() === 'ACTIVE' ? 'active' : 'frozen'
            );
            results.added++;
          } else {
            // 已有卡：更新状态
            db.prepare(`
              UPDATE cards SET
                status       = ?,
                product_code = COALESCE(NULLIF(?, ''), product_code),
                label        = COALESCE(NULLIF(?, ''), label)
              WHERE card_id = ?
            `).run(
              (detail.status || 'ACTIVE').toUpperCase() === 'ACTIVE' ? 'active' : 'frozen',
              detail.product_code || '',
              detail.label || '',
              card_id
            );
            results.synced++;
          }

          results.details.push({
            card_id,
            card_number:      detail.card_number,
            available_amount: detail.available_amount,
            status:           detail.status,
            expire:           detail.expire,
            is_new:           isNew,
          });
        } catch (err) {
          results.failed++;
          results.errors.push({ card_id, error: err.message });
        }
      }));
    }

    const msg = `同步完成：更新 ${results.synced} 张，新增 ${results.added} 张，失败 ${results.failed} 张`;
    res.json({ code: 0, msg, data: results });
  } catch (err) {
    next(err);
  }
});

// ── 平台统计 ─────────────────────────────────────────────────────────────────
/**
 * GET /api/admin/stats
 * 返回：
 *   - users       用户统计
 *   - cards       卡片统计（含实时卡内余额聚合）
 *   - account     账户余额（从 settings 表读，管理员手动维护）
 *   - products    产品码列表
 */
router.get('/stats', async (req, res, next) => {
  try {
    const forceRefresh = req.query.force === 'true';

    // ① 用户统计（本地 DB）
    const usersTotal = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
    const usersNew   = db.prepare(`
      SELECT COUNT(*) as n FROM users
      WHERE created_at >= date('now', 'start of month')
    `).get().n;

    // ② 卡片统计（本地 DB）
    const cardsTotal  = db.prepare('SELECT COUNT(*) as n FROM cards').get().n;
    const cardsActive = db.prepare("SELECT COUNT(*) as n FROM cards WHERE status = 'active'").get().n;
    const cardsFrozen = db.prepare("SELECT COUNT(*) as n FROM cards WHERE status = 'frozen'").get().n;

    // ③ 卡内余额（forceRefresh=true 时才从沙盒拉，否则读本地缓存）
    const localCards = db.prepare('SELECT card_id FROM cards').all();
    let cardBalanceTotal = 0;
    let balanceSynced    = 0;
    const cardDetails    = [];

    if (forceRefresh && localCards.length > 0) {
      const settled = await Promise.allSettled(
        localCards.map(r => sdk.cardDetail(r.card_id))
      );
      settled.forEach((r, idx) => {
        if (r.status === 'fulfilled') {
          const amt = Number(r.value.available_amount || 0);
          cardBalanceTotal += amt;
          balanceSynced++;
          cardDetails.push({
            card_id:          r.value.card_id || localCards[idx].card_id,
            card_number:      r.value.card_number,
            available_amount: r.value.available_amount,
            status:           r.value.status,
          });
        }
      });
    } else {
      // 从本地 cards 表读余额缓存
      const cachedCards = db.prepare('SELECT card_id, card_number, available_amount, status FROM cards WHERE available_amount IS NOT NULL').all();
      cachedCards.forEach(c => {
        cardBalanceTotal += Number(c.available_amount || 0);
        balanceSynced++;
      });
      cardDetails.push(...cachedCards);
    }

    // ④ 账户余额（settings 表缓存）
    let merchantBalance = Number(getSetting('merchant_balance', '0'));
    let walletBalance   = Number(getSetting('wallet_balance', '0'));
    const totalTopup     = Number(getSetting('total_topup', '0'));
    const totalSpend     = Number(getSetting('total_spend', '0'));

    // 用户总余额（动态查询）
    const totalUserBalanceRow = db.prepare("SELECT COALESCE(SUM(balance),0) as s FROM users WHERE role='user'").get();
    const totalUserBalanceForStats = Number(totalUserBalanceRow.s);

    // 仅 forceRefresh 时才实时拉取 vmcardio 余额
    if (forceRefresh) {
      try {
        const balInfo = await sdk.getAccountBalance();
        if (balInfo && typeof balInfo.balance === 'number') {
          merchantBalance = balInfo.balance;
          walletBalance   = balInfo.wallet_balance || 0;
          const now = new Date().toISOString();
          db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`)
            .run('merchant_balance', balInfo.balance, now);
          db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`)
            .run('wallet_balance', balInfo.wallet_balance || 0, now);
          db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`)
            .run('merchant_balance_last_sync', now, now);
        }
      } catch (e) {
        console.warn('[admin/stats] vmcardio余额实时拉取失败，使用缓存:', e.message);
      }
    }

    // ⑤ 产品码列表（从本地缓存读，forceRefresh 时才拉）
    let products = [];
    if (forceRefresh) {
      try {
        products = await sdk.getProductCode();
        if (!Array.isArray(products)) products = products.list || [];
      } catch (_) { /* 产品码拉取失败不阻断 */ }
    } else {
      const cached = getSetting('products_cache', '');
      if (cached) { try { products = JSON.parse(cached); } catch(_){} }
    }

    res.json({
      code: 0,
      msg:  'ok',
      data: {
        users: {
          total:     usersTotal,
          new_month: usersNew,
        },
        cards: {
          total:           cardsTotal,
          active:          cardsActive,
          frozen:          cardsFrozen,
          card_balance:    +cardBalanceTotal.toFixed(2),   // 卡内余额（实时）
          synced_count:    balanceSynced,
          details:         cardDetails,
        },
        account: {
          system_balance:   +Math.max(0, merchantBalance - totalUserBalanceForStats).toFixed(2),  // 动态计算：商户余额 - 用户总余额
          vmcardio_balance: merchantBalance,   // vmcardio平台实时余额（管理员看到的）
          wallet_balance:   walletBalance,     // vmcardio钱包余额
          total_topup:      totalTopup,        // 累积充值
          total_spend:      totalSpend,        // 累积消费（开卡费+卡消费）
        },
        products: {
          count: products.length,
          list:  products,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── 管理员查所有卡（完整版，支持分页、搜索、过滤）────────────────────────────────
router.get('/cards', async (req, res, next) => {
  try {
    const { 
      page = 1, 
      pageSize = 10, 
      status, 
      search, 
      user_id,
      card_id,
      date_from,
      date_to,
      sortBy = 'created_at',
      sortOrder = 'DESC',
      force
    } = req.query;
    
    // force=true 时触发卡片数据同步（异步执行，不阻塞响应）
    if (force === 'true') {
      console.log('[Admin Cards] 收到强制刷新请求，触发卡片数据同步...');
      // 异步触发同步，不等待完成
      syncAllCardsFromUpstream().catch(err => {
        console.error('[Admin Cards] 异步同步卡片数据失败:', err.message);
      });
    }
    
    // 排序字段白名单（防止SQL注入）
    const allowedSortFields = ['created_at', 'updated_at', 'available_amount', 'status', 'card_number'];
    const safeSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
    const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    
    const offset = (page - 1) * pageSize;
    
    // 构建查询条件和参数
    let whereConditions = [];
    let queryParams = [];
    
    // 状态过滤
    if (status) {
      whereConditions.push('c.status = ?');
      queryParams.push(status);
    }
    
    // 用户ID过滤
    if (user_id) {
      whereConditions.push('c.user_id = ?');
      queryParams.push(user_id);
    }
    
    // vmcardio 卡片ID精确匹配
    if (card_id) {
      whereConditions.push('c.card_id = ?');
      queryParams.push(card_id.trim());
    }
    
    // 创建时间范围过滤
    if (date_from) {
      whereConditions.push('c.created_at >= ?');
      queryParams.push(date_from);
    }
    if (date_to) {
      whereConditions.push('c.created_at <= ?');
      queryParams.push(date_to + ' 23:59:59');
    }
    
    // 搜索条件（卡号、标签、用户名、邮箱）
    if (search) {
      const searchTerm = `%${search}%`;
      whereConditions.push('(c.card_number LIKE ? OR c.label LIKE ? OR u.name LIKE ? OR u.email LIKE ? OR u.id LIKE ?)');
      queryParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }
    
    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    
    // 查询卡片数据（完整字段）
    const cards = db.prepare(`
      SELECT 
        c.id,
        c.card_id,
        c.card_number,
        c.product_code,
        c.label,
        c.card_type,
        c.status,
        c.available_amount,
        c.expiry_month,
        c.expiry_year,
        c.cvv,
        c.single_limit,
        c.day_limit,
        c.month_limit,
        c.created_at,
        c.updated_at,
        c.last_verified,
        c.verified_status,
        c.verification_error,
        u.id as user_id,
        u.name as user_name,
        u.email as user_email,
        u.role as user_role
      FROM cards c
      JOIN users u ON u.id = c.user_id
      ${whereClause}
      ORDER BY c.${safeSortBy} ${safeSortOrder}
      LIMIT ? OFFSET ?
    `).all(...queryParams, pageSize, offset);
    
    // 查询总数
    const totalResult = db.prepare(`
      SELECT COUNT(*) as total
      FROM cards c
      JOIN users u ON u.id = c.user_id
      ${whereClause}
    `).get(...queryParams);
    
    // 查询统计信息（只使用不涉及 users 表的过滤条件）
    const hasUref = whereConditions.some(c => /[^a-zA-Z]u\./.test(c));
    let statsQueryConditions = [];
    let statsParams = [];
    if (status) {
      statsQueryConditions.push('c.status = ?');
      statsParams.push(status);
    }
    if (date_from) {
      statsQueryConditions.push('c.created_at >= ?');
      statsParams.push(date_from);
    }
    if (date_to) {
      statsQueryConditions.push('c.created_at <= ?');
      statsParams.push(date_to + ' 23:59:59');
    }
    const statsWhere = statsQueryConditions.length > 0 ? 'WHERE ' + statsQueryConditions.join(' AND ') : '';
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_cards,
        SUM(c.available_amount) as total_balance,
        COUNT(DISTINCT c.user_id) as total_users,
        COUNT(CASE WHEN c.status = 'active' THEN 1 END) as active_cards,
        COUNT(CASE WHEN c.status = 'frozen' THEN 1 END) as frozen_cards
      FROM cards c
      ${statsWhere}
    `).get(...statsParams);
    
    // 格式化到期日字段
    const formattedCards = cards.map(c => {
      if (c.expiry_month && c.expiry_year) {
        c.expire = String(c.expiry_month).padStart(2, '0') + '/' + String(c.expiry_year).slice(-2);
      }
      return c;
    });

    res.json({ 
      code: 0, 
      msg: 'ok', 
      data: {
        list: formattedCards,
        total: totalResult.total,
        page: parseInt(page),
        pageSize: parseInt(pageSize),
        stats: {
          total_cards: stats.total_cards || 0,
          total_balance: parseFloat(stats.total_balance || 0).toFixed(2),
          total_users: stats.total_users || 0,
          active_cards: stats.active_cards || 0,
          frozen_cards: stats.frozen_cards || 0
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

// ── 管理员实时拉取单张卡完整详情（含卡号/CVV） ────────────────────────────────
/**
 * GET /api/admin/cards/:cardId/detail
 * 实时从 vmcardio 拉取卡片完整信息（卡号、CVV、余额、限额等）
 * 同时将最新数据写回本地数据库
 */
router.get('/cards/:cardId/detail', async (req, res, next) => {
  try {
    const { cardId } = req.params;

    // 先查本地确认卡片存在
    const localCard = db.prepare(`
      SELECT c.*, u.name as user_name, u.email as user_email
      FROM cards c
      JOIN users u ON u.id = c.user_id
      WHERE c.card_id = ?
    `).get(cardId);

    if (!localCard) {
      return res.status(404).json({ code: 404, msg: '卡片不存在' });
    }

    // 实时调用 vmcardio 获取完整卡详情
    let detail = {};
    let verificationError = null;
    let verifiedStatus = 'valid';
    
    try {
      detail = await sdk.cardDetail(cardId);
    } catch (sdkErr) {
      verificationError = sdkErr.vmMsg || sdkErr.message;
      verifiedStatus = 'invalid';
      
      // 更新数据库验证状态
      db.prepare(`
        UPDATE cards SET
          last_verified = datetime('now'),
          verified_status = ?,
          verification_error = ?
        WHERE card_id = ?
      `).run('invalid', verificationError, cardId);
      
      // 失效卡片：余额自动退回用户总余额
      try {
        const card = db.prepare('SELECT user_id, available_amount FROM cards WHERE card_id = ?').get(cardId);
        if (card && Number(card.available_amount) > 0) {
          const refundAmt = Number(card.available_amount);
          db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(refundAmt, card.user_id);
          db.prepare('UPDATE cards SET available_amount = 0 WHERE card_id = ?').run(cardId);
          db.prepare("INSERT INTO transactions (user_id, type, amount, description, created_at) VALUES (?, 'card_refund', ?, ?, datetime('now'))")
            .run(card.user_id, refundAmt, '卡片失效，余额自动退还 $' + refundAmt.toFixed(2));
        }
      } catch (refundErr) {
        console.error('[cardDetail] 余额退还失败:', refundErr.message);
      }
      
      // vmcardio 调用失败，返回本地数据
      return res.json({
        code: 0,
        msg: `ok（本地数据，vmcardio 未响应: ${verificationError}）`,
        data: {
          ...localCard,
          _from_cache: true,
          _verified: false,
          _verification_error: verificationError
        }
      });
    }

    // vmcardio cardDetail 返回 expire 字段（格式 "MM/YY"，如 "11/28"）
    const expireStr = detail.expire || '';
    let expMonth = 0, expYear = 0;
    if (expireStr && expireStr.includes('/')) {
      const parts = expireStr.split('/');
      expMonth = parseInt(parts[0]) || 0;
      expYear  = parseInt(parts[1]) || 0;
    }

    // 更新本地数据库缓存
    db.prepare(`
      UPDATE cards SET
        card_number     = ?,
        cvv             = ?,
        available_amount = ?,
        expiry_month    = ?,
        expiry_year     = ?,
        single_limit    = ?,
        day_limit       = ?,
        month_limit     = ?,
        status          = ?,
        updated_at      = datetime('now'),
        last_verified   = datetime('now'),
        verified_status = ?,
        verification_error = ?
      WHERE card_id = ?
    `).run(
      detail.card_number  || localCard.card_number  || '',
      detail.cvv          || localCard.cvv          || '',
      parseFloat(detail.available_amount || detail.balance || 0),
      expMonth,
      expYear,
      parseFloat(detail.single_limit || detail.singleLimit || localCard.single_limit || 0),
      parseFloat(detail.day_limit    || detail.dayLimit    || localCard.day_limit    || 0),
      parseFloat(detail.month_limit  || detail.monthLimit  || localCard.month_limit || 0),
      (detail.status || localCard.status || 'active').toLowerCase(),
      'valid',   // verified_status
      null,      // verification_error
      cardId
    );

    // 合并本地 + vmcardio 数据返回（直接使用 vmcardio 的 expire 字符串）
    const finalExpire = expireStr || (localCard.expiry_month && localCard.expiry_year
      ? String(localCard.expiry_month).padStart(2, '0') + '/' + String(localCard.expiry_year).slice(-2)
      : '');

    res.json({
      code: 0,
      msg: 'ok',
      data: {
        ...localCard,
        card_number:      detail.card_number      || localCard.card_number      || '',
        cvv:              detail.cvv              || localCard.cvv              || '',
        available_amount: parseFloat(detail.available_amount || detail.balance || 0),
        expire:           finalExpire,
        expiry_month:     expMonth || localCard.expiry_month,
        expiry_year:      expYear  || localCard.expiry_year,
        single_limit:     parseFloat(detail.single_limit  || detail.singleLimit  || 0),
        day_limit:        parseFloat(detail.day_limit      || detail.dayLimit      || 0),
        month_limit:      parseFloat(detail.month_limit    || detail.monthLimit    || 0),
        status:           (detail.status || localCard.status || 'active').toLowerCase(),
        address_line_one: detail.card_address?.address_line_one || detail.address_line_one || '',
        address_line_two: detail.card_address?.address_line_two || detail.address_line_two || '',
        city:             detail.card_address?.city    || detail.city    || '',
        state:            detail.card_address?.state   || detail.state   || '',
        country:          detail.card_address?.country || detail.country || '',
        post_code:        detail.card_address?.post_code || detail.post_code || '',
        _from_cache: false,
        _raw: detail
      }
    });
  } catch (err) {
    next(err);
  }
});

// ── 管理员查所有用户 ──────────────────────────────────────────────────────────
router.get('/users', async (req, res, next) => {
  try {
    const users = db.prepare(`
      SELECT u.id, u.email, u.name, u.role, u.status, u.balance, u.created_at,
             COUNT(c.id) as card_count
      FROM users u
      LEFT JOIN cards c ON c.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `).all();

    res.json({ code: 0, msg: 'ok', data: users });
  } catch (err) {
    next(err);
  }
});

// ── 管理员：给用户手动充值 ────────────────────────────────────────────────────
const BalanceService = require('../services/balanceService');

/**
 * POST /api/admin/users/:id/topup
 * body: { amount: number, note?: string }
 * 管理员直接给指定用户增加余额
 */
router.post('/users/:id/topup', async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id);
    const { amount, note } = req.body;

    // 参数校验
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      return res.status(400).json({ code: 400, msg: '充值金额必须为正数' });
    }
    if (amt > 100000) {
      return res.status(400).json({ code: 400, msg: '单次充值不能超过 $100,000' });
    }

    // 目标用户校验
    const target = db.prepare('SELECT id, email, name, role, balance FROM users WHERE id = ?').get(targetId);
    if (!target) return res.status(404).json({ code: 404, msg: '用户不存在' });
    if (target.role === 'admin') {
      return res.status(400).json({ code: 400, msg: '不能给管理员账号充值' });
    }

    // 使用余额服务进行充值（会自动更新topup_total和记录交易流水）
    const result = BalanceService.adminTopup(targetId, amt, note);

    // 写入审计日志
    db.prepare(`
      INSERT INTO audit_logs (user_id, action, detail, ip, ua, created_at)
      VALUES (?, 'admin_topup', ?, ?, ?, datetime('now'))
    `).run(
      req.user.id,
      JSON.stringify({ 
        amount: amt, 
        note: note || '', 
        target_user_id: targetId, 
        target_user: target.name, 
        old_balance: target.balance, 
        new_balance: result.new_balance,
        transaction_id: result.transaction_id
      }),
      req.ip,
      req.headers['user-agent'] || ''
    );

    res.json({
      code: 0,
      msg: '充值成功',
      data: {
        user_id: targetId,
        user_name: target.name,
        amount: amt,
        old_balance: target.balance,
        new_balance: result.new_balance,
        transaction_id: result.transaction_id
      }
    });
  } catch (err) {
    next(err);
  }
});

// ── 管理员：禁用 / 启用用户 ───────────────────────────────────────────────────
/**
 * PATCH /api/admin/users/:id/status
 * body: { status: 'disabled' | 'active' }
 * 不允许操作自己，不允许操作其他管理员
 */
router.patch('/users/:id/status', async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id);
    const { status } = req.body;

    if (!['disabled', 'active'].includes(status)) {
      return res.status(400).json({ code: 400, msg: 'status 只能为 active 或 disabled' });
    }
    if (targetId === req.user.id) {
      return res.status(400).json({ code: 400, msg: '不能操作自己的账号' });
    }

    const target = db.prepare('SELECT id, role, email FROM users WHERE id = ?').get(targetId);
    if (!target) return res.status(404).json({ code: 404, msg: '用户不存在' });
    if (target.role === 'admin') {
      return res.status(403).json({ code: 403, msg: '不能禁用管理员账号' });
    }

    // 1. 先更新用户状态
    db.prepare(`UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, targetId);

    // 2. 同步冻结/解冻用户的vmcardio卡片
    // 注意：这里查询所有状态不为'deleted'的卡片，因为有些卡可能标记为invalid但仍然需要冻结
    const userCards = db.prepare("SELECT card_id FROM cards WHERE user_id = ? AND status != 'deleted'").all(targetId);
    
    const vmcardioResults = [];
    
    if (userCards.length > 0) {
      const vmcardioStatus = status === 'disabled' ? 'CANCELLED' : 'ACTIVE';
      
      // 并行处理所有卡片，提高响应速度
      const promises = userCards.map(async (card) => {
        try {
          await sdk.freezeCard(card.card_id, vmcardioStatus);
          return { card_id: card.card_id, success: true };
        } catch (err) {
          console.error(`冻结/解冻卡片失败 (${card.card_id}):`, err.message);
          var vmErr = err.vmMsg || err.message || '';
          var friendlyErr = '操作失败';
          if (vmErr.includes('Canceled') || vmErr.includes('cancelled')) friendlyErr = '卡片已失效';
          else if (vmErr.includes('status') || vmErr.includes('Status')) friendlyErr = '卡片状态不支持此操作';
          else if (vmErr.includes('400')) friendlyErr = '请求参数错误';
          return { card_id: card.card_id, success: false, error: friendlyErr };
        }
      });
      
      // 并行执行，添加超时保护
      const results = await Promise.allSettled(promises);
      results.forEach(result => {
        if (result.status === 'fulfilled') {
          vmcardioResults.push(result.value);
        } else {
          // 理论上Promise.allSettled不会走到这里，因为我们catch了错误
          vmcardioResults.push({ 
            card_id: 'unknown', 
            success: false, 
            error: result.reason?.message || 'Unknown error' 
          });
        }
      });
    }

    // 3. 记录审计日志
    const actionType = status === 'disabled' ? 'user_frozen_with_cards' : 'user_unfrozen_with_cards';
    const detail = JSON.stringify({
      userId: targetId,
      cardsCount: userCards.length,
      vmcardioResults: vmcardioResults.filter(r => !r.success).length > 0 ? vmcardioResults : undefined
    });
    
    db.prepare(`
      INSERT INTO audit_logs (user_id, action, ip, ua, detail)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      actionType,
      req.ip,
      req.get('User-Agent') || '',
      detail
    );

    const successCards = vmcardioResults.filter(r => r.success).length;
    const failCards = vmcardioResults.length - successCards;
    
    let msg = status === 'disabled' ? '已冻结' : '已解冻';
    if (userCards.length > 0) {
      msg += `，同步处理了 ${userCards.length} 张卡片`;
      if (failCards > 0) {
        msg += `（成功 ${successCards} 张，失败 ${failCards} 张）`;
      }
    }

    res.json({ 
      code: 0, 
      msg,
      data: { 
        id: targetId, 
        status,
        cardsCount: userCards.length,
        vmcardioSuccess: successCards,
        vmcardioFailed: failCards
      }
    });
  } catch (err) {
    next(err);
  }
});

// ── 开卡申请列表 ──────────────────────────────────────────────────────────────
/**
 * GET /api/admin/card-applications
 * 查询参数：status=pending|approved|rejected（不传=全部）
 */
router.get('/card-applications', (req, res, next) => {
  try {
    const { status } = req.query;
    let sql = `
      SELECT a.*, u.email as user_email, u.name as user_name
      FROM card_applications a
      JOIN users u ON u.id = a.user_id
    `;
    const params = [];
    if (status) {
      sql += ' WHERE a.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY a.created_at DESC';

    const rows = db.prepare(sql).all(...params);
    res.json({ code: 0, msg: 'ok', data: rows });
  } catch (err) {
    next(err);
  }
});

// ── 审批通过：真正调 vmcardio 开卡 ───────────────────────────────────────────
/**
 * POST /api/admin/card-applications/:id/approve
 */
router.post('/card-applications/:id/approve', async (req, res, next) => {
  try {
    const appId = parseInt(req.params.id);
    const app = db.prepare('SELECT * FROM card_applications WHERE id = ?').get(appId);

    if (!app) return res.status(404).json({ code: 404, msg: '申请不存在' });
    if (app.status !== 'pending') {
      return res.status(400).json({ code: 400, msg: `申请当前状态为 ${app.status}，无法再次审批` });
    }

    // 解析 card_address
    let card_address = {};
    try { card_address = JSON.parse(app.card_address); } catch (_) {}

    // 调 vmcardio 开卡
    const result = await sdk.createCard({
      product_code: app.product_code,
      first_name:   app.first_name,
      last_name:    app.last_name,
      label:        app.label,
      amount:       app.amount,
      single_limit: app.single_limit,
      day_limit:    app.day_limit,
      month_limit:  app.month_limit,
      area_code:    app.area_code,
      mobile:       app.mobile,
      email:        app.email,
      card_address,
    });

    const card_id = result.card_id;

    // 写入 cards 表
    db.prepare(`
      INSERT OR IGNORE INTO cards (user_id, card_id, product_code, label)
      VALUES (?, ?, ?, ?)
    `).run(app.user_id, card_id, app.product_code, app.label || '');

    // 更新申请状态
    db.prepare(`
      UPDATE card_applications
      SET status = 'approved', card_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(card_id, appId);

    // 拉完整卡详情
    const detail = await sdk.cardDetail(card_id).catch(() => ({ card_id }));

    res.json({ code: 0, msg: '审批通过，卡片已创建', data: { card_id, detail } });
  } catch (err) {
    next(err);
  }
});

// ── 审批拒绝 ──────────────────────────────────────────────────────────────────
/**
 * POST /api/admin/card-applications/:id/reject
 * body: { reason: string }
 */
router.post('/card-applications/:id/reject', (req, res, next) => {
  try {
    const appId = parseInt(req.params.id);
    const { reason = '' } = req.body;

    const app = db.prepare('SELECT id, status FROM card_applications WHERE id = ?').get(appId);
    if (!app) return res.status(404).json({ code: 404, msg: '申请不存在' });
    if (app.status !== 'pending') {
      return res.status(400).json({ code: 400, msg: `申请当前状态为 ${app.status}，无法操作` });
    }

    db.prepare(`
      UPDATE card_applications
      SET status = 'rejected', reject_reason = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(reason, appId);

    res.json({ code: 0, msg: '已拒绝申请' });
  } catch (err) {
    next(err);
  }
});

// ── 给用户设置余额（管理员手动充值）──────────────────────────────────────────
router.post('/users/:id/balance', (req, res, next) => {
  try {
    const userId = parseInt(req.params.id);
    const { balance } = req.body;
    const val = Number(balance);
    if (isNaN(val) || val < 0) return res.status(400).json({ code: 1, msg: 'balance 必须为非负数' });
    const r = db.prepare('UPDATE users SET balance = ?, updated_at = datetime(\'now\') WHERE id = ?').run(val.toFixed(2), userId);
    if (r.changes === 0) return res.status(404).json({ code: 404, msg: '用户不存在' });
    res.json({ code: 0, msg: 'ok', data: { id: userId, balance: val } });
  } catch (err) {
    next(err);
  }
});

// ── 获取商户实时余额（从 vmcardio 拉取）───────────────────────────────────────
/**
 * GET /api/admin/merchant-balance
 * 返回当前商户余额和钱包余额
 */
router.get('/merchant-balance', async (req, res, next) => {
  try {
    const sdk = require('../services/vmcardioSDK');
    const db = require('../db/database');
    const forceRefresh = req.query.force === 'true';
    
    // 从数据库获取缓存值
    const lastSync = db.prepare('SELECT value FROM settings WHERE key = ?').get('merchant_balance_last_sync');
    const cachedBalance = db.prepare('SELECT value FROM settings WHERE key = ?').get('merchant_balance');
    const walletBalance = db.prepare('SELECT value FROM settings WHERE key = ?').get('wallet_balance');
    const lastError = db.prepare('SELECT value FROM settings WHERE key = ?').get('merchant_balance_last_error');
    
    // 默认使用缓存，forceRefresh=true 时才调外部API
    let balanceInfo = null;
    let vmcardioError = null;
    if (forceRefresh) {
      try {
        balanceInfo = await sdk.getAccountBalance();
      } catch (err) {
        vmcardioError = err.message;
        console.warn('vmcardio余额获取失败，使用缓存数据:', err.message);
      }
    }
    
    // 优先使用实时余额，失败时使用缓存
    const realBalance = balanceInfo ? balanceInfo.balance : (cachedBalance ? parseFloat(cachedBalance.value) : 0);
    const realWalletBalance = balanceInfo ? (balanceInfo.wallet_balance || 0) : (walletBalance ? parseFloat(walletBalance.value) : 0);

    // force=true 成功时，更新数据库缓存
    if (forceRefresh && balanceInfo) {
      const now = new Date().toISOString();
      const upsert = db.prepare(`
        INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `);
      upsert.run("merchant_balance", String(realBalance), now);
      upsert.run("wallet_balance", String(realWalletBalance), now);
      upsert.run("merchant_balance_last_sync", now, now);
      upsert.run("merchant_balance_last_error", "", now);
      console.log("[admin] force刷新商户余额成功:", realBalance);
    }

    
    res.json({
      code: 0,
      msg: 'ok',
      data: {
        // 余额数据（优先实时，次选缓存）
        balance: realBalance,
        wallet_balance: realWalletBalance,
        
        // 缓存信息
        cached_balance: cachedBalance ? parseFloat(cachedBalance.value) : null,
        last_sync: forceRefresh && balanceInfo ? (function() { const r = db.prepare("SELECT value FROM settings WHERE key = ?").get("merchant_balance_last_sync"); return r ? r.value : null; })() : (lastSync ? lastSync.value : null),
        last_error: lastError ? lastError.value : (vmcardioError || null),
        vmcardio_available: balanceInfo !== null,
        
        // 同步状态
        sync_enabled: true,
        sync_interval_seconds: 60,
        low_balance_threshold: 100,
        
        // 提醒状态
        is_low_balance: realBalance < 100,
      }
    });
  } catch (err) {
    next(err);
  }
});

// ── 系统设置：读取 ────────────────────────────────────────────────────────────
/**
 * GET /api/admin/settings
 * 返回所有系统可配置参数
 */
router.get('/settings', (req, res, next) => {
  try {
    const keys = [
      'wallet_trc20', 'wallet_erc20', 'wallet_bep20', 'wallet_sol',
      'usdt_rate', 'min_topup', 'topup_notice'
    ];
    const data = {};
    keys.forEach(k => {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
      data[k] = row ? row.value : '';
    });
    res.json({ code: 0, msg: 'ok', data });
  } catch (err) {
    next(err);
  }
});

// ── 系统设置：保存 ────────────────────────────────────────────────────────────
/**
 * POST /api/admin/settings
 * body: { wallet_trc20, wallet_erc20, wallet_bep20, wallet_sol, usdt_rate, min_topup, topup_notice }
 */
router.post('/settings', (req, res, next) => {
  try {
    const allowed = ['wallet_trc20', 'wallet_erc20', 'wallet_bep20', 'wallet_sol',
                     'usdt_rate', 'min_topup', 'topup_notice'];
    const upsert = db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    const body = req.body || {};
    allowed.forEach(k => {
      if (body[k] !== undefined) upsert.run(k, String(body[k]));
    });
    res.json({ code: 0, msg: 'ok' });
  } catch (err) {
    next(err);
  }
});

// ── 上游费用成本（只读 + 编辑）──────────────────────────────────────────────────
/**
 * GET /api/admin/upstream-fees
 * 返回 vmcardio 上游 8 项费用规则（fee_configs 表只存平台定价，此表存上游成本）
 */
router.get('/upstream-fees', (req, res, next) => {
  try {
    const rows = db.prepare('SELECT fee_type, name, upstream_rate, upstream_fixed, upstream_rules, notes, updated_at FROM upstream_fee_costs ORDER BY id').all();
    rows.forEach(r => {
      try { r.rules = JSON.parse(r.upstream_rules || '{}'); } catch { r.rules = {}; }
      delete r.upstream_rules;
    });
    res.json({ code: 0, data: rows });
  } catch (err) { next(err); }
});

/**
 * PUT /api/admin/upstream-fees/:fee_type
 * 更新上游费用（仅管理员）
 */
router.put('/upstream-fees/:fee_type', (req, res, next) => {
  try {
    const { fee_type } = req.params;
    const { upstream_rate, upstream_fixed, upstream_rules, notes, name } = req.body || {};

    const exists = db.prepare('SELECT id FROM upstream_fee_costs WHERE fee_type = ?').get(fee_type);
    if (!exists) return res.status(404).json({ code: 1, msg: '费用类型不存在：' + fee_type });

    // 构建 SET 子句，只更新传入的字段
    const sets = [];
    const vals = [];
    if (upstream_rate !== undefined) { sets.push('upstream_rate = ?'); vals.push(upstream_rate); }
    if (upstream_fixed !== undefined) { sets.push('upstream_fixed = ?'); vals.push(upstream_fixed); }
    if (upstream_rules !== undefined) {
      const rulesStr = typeof upstream_rules === 'string' ? upstream_rules : JSON.stringify(upstream_rules);
      sets.push('upstream_rules = ?'); vals.push(rulesStr);
    }
    if (notes !== undefined) { sets.push('notes = ?'); vals.push(notes); }
    if (name !== undefined) { sets.push('name = ?'); vals.push(name); }

    if (sets.length === 0) return res.status(400).json({ code: 1, msg: '没有需要更新的字段' });

    sets.push("updated_at = datetime('now')");
    vals.push(fee_type);
    db.prepare('UPDATE upstream_fee_costs SET ' + sets.join(', ') + ' WHERE fee_type = ?').run(...vals);

    res.json({ code: 0, msg: '已更新' });
  } catch (err) { next(err); }
});

// ── 全局交易监控（管理员跨用户跨卡） ─────────────────────────────────────────
/**
 * GET /api/admin/transactions
 * 查询参数：
 *   card_id          - 精确匹配 vmcardio card_id（可选）
 *   user_id          - 按用户过滤（可选）
 *   transaction_type - 按类型过滤（Authorization/Settlement/Refund/Reversal）
 *   status           - 按状态过滤（PENDING/COMPLETE/DECLINED）
 *   start_time       - 开始时间（可选，YYYY-MM-DD 或 ISO）
 *   end_time         - 结束时间（可选）
 *   page / page_size - 分页
 *
 * 管理员可查看所有用户所有卡的交易记录
 */
router.get('/transactions', async (req, res, next) => {
  try {
    const {
      card_id,
      user_id,
      transaction_type,
      status,
      start_time,
      end_time,
      page = 1,
      page_size = 20,
    } = req.query;

    const params = {};

    // 如果指定了 user_id，先查该用户的所有卡 ID，然后逐一查
    if (user_id) {
      const userCards = db.prepare('SELECT card_id FROM cards WHERE user_id = ?').all(parseInt(user_id));
      if (userCards.length === 0) {
        return res.json({ code: 0, msg: 'ok', data: { list: [], total: 0, page: 1, summary: emptySummary() } });
      }
      // 取第一张卡的交易（vmcardio cardTransaction 是按卡查的，先查第一张）
      // 如果指定了 card_id 就只查那张卡
      const targetCardId = card_id || userCards[0].card_id;
      params.card_id = targetCardId;
    } else if (card_id) {
      params.card_id = card_id;
    }

    if (transaction_type) params.transaction_type = transaction_type;
    if (status) params.status = status;
    if (start_time) params.start_time = start_time;
    if (end_time) params.end_time = end_time;
    params.page = parseInt(page);
    params.page_size = parseInt(page_size);

    const result = await sdk.cardTransaction(params);
    const items = result?.list || result || [];

    // 附加用户信息：把 card_id 对应的 user 信息补上
    const allCardIds = [...new Set(items.map(i => i.card_id).filter(Boolean))];
    const cardUserMap = {};
    if (allCardIds.length > 0) {
      const placeholders = allCardIds.map(() => '?').join(',');
      const cardRows = db.prepare(`
        SELECT c.card_id, c.card_number, c.label, u.id as user_id, u.name as user_name, u.email as user_email
        FROM cards c JOIN users u ON u.id = c.user_id
        WHERE c.card_id IN (${placeholders})
      `).all(...allCardIds);
      cardRows.forEach(r => { cardUserMap[r.card_id] = r; });
    }

    // 生成汇总统计
    const summary = buildTxSummary(items, cardUserMap);

    // 补充用户信息到每条记录
    const enriched = items.map(item => ({
      ...item,
      _user: cardUserMap[item.card_id] ? {
        user_id: cardUserMap[item.card_id].user_id,
        user_name: cardUserMap[item.card_id].user_name,
        user_email: cardUserMap[item.card_id].user_email,
      } : null,
      _card_number: cardUserMap[item.card_id]?.card_number || '',
      _label: cardUserMap[item.card_id]?.label || '',
    }));

    const total = result?.total || enriched.length;

    res.json({
      code: 0,
      msg: 'ok',
      data: {
        list: enriched,
        total,
        page: params.page,
        page_size: params.page_size,
        summary,
        // 可选卡片列表（管理员筛选用）
        available_cards: user_id ? undefined : getAdminCardList(),
      },
    });
  } catch (err) {
    next(err);
  }
});

function emptySummary() {
  return { total_count: 0, total_amount: 0, auth_count: 0, auth_amount: 0, settle_count: 0, settle_amount: 0, refund_count: 0, refund_amount: 0 };
}

function buildTxSummary(items, cardUserMap) {
  let totalAmount = 0, authCount = 0, authAmount = 0, settleCount = 0, settleAmount = 0, refundCount = 0, refundAmount = 0;
  items.forEach(item => {
    const amt = Math.abs(parseFloat(item.amount) || 0);
    totalAmount += (parseFloat(item.amount) || 0);
    if (item.transaction_type === 'Authorization') { authCount++; authAmount += amt; }
    else if (item.transaction_type === 'Settlement') { settleCount++; settleAmount += amt; }
    else if (item.transaction_type === 'Refund') { refundCount++; refundAmount += amt; }
  });
  return {
    total_count: items.length,
    total_amount: +totalAmount.toFixed(2),
    auth_count: authCount,
    auth_amount: +authAmount.toFixed(2),
    settle_count: settleCount,
    settle_amount: +settleAmount.toFixed(2),
    refund_count: refundCount,
    refund_amount: +refundAmount.toFixed(2),
  };
}

function getAdminCardList() {
  return db.prepare(`
    SELECT c.card_id, c.card_number, c.label, c.status, u.name as user_name, u.email as user_email
    FROM cards c JOIN users u ON u.id = c.user_id
    ORDER BY c.created_at DESC
  `).all();
}

// ── 财务中心汇总 ────────────────────────────────────────────────────────────
/**
 * GET /api/admin/finance-summary
 * 返回管理员财务中心的全部数据：
 *   - balance: 商户余额（vmcardio 实时 + 缓存）
 *   - users_balance: 所有用户余额汇总
 *   - topup_stats: 充值统计（总额/待审核/今日）
 *   - fee_income: 平台费用收入（从 fee_configs 和 upstream_fee_costs 汇总）
 *   - card_apps: 开卡申请统计
 */
router.get('/finance-summary', async (req, res, next) => {
  try {
    // ① 商户余额（与 admin/stats 逻辑一致）
    let merchantBalance = Number(getSetting('merchant_balance', '0'));
    let walletBalance   = Number(getSetting('wallet_balance', '0'));
    let merchantLastSync = getSetting('merchant_balance_last_sync', '');
    try {
      const balInfo = await sdk.getAccountBalance();
      if (balInfo && typeof balInfo.balance === 'number') {
        merchantBalance = balInfo.balance;
        walletBalance   = balInfo.wallet_balance || 0;
        const now = new Date().toISOString();
        db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`)
          .run('merchant_balance', balInfo.balance, now);
        db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`)
          .run('wallet_balance', balInfo.wallet_balance || 0, now);
        merchantLastSync = now;
      }
    } catch (_) {}

    // ② 用户余额汇总（从 topup_requests 实时聚合充值，users.balance 为当前余额）
    const usersBalance = db.prepare(`
      SELECT
        u.id, u.email, u.name, u.balance,
        COALESCE((SELECT SUM(amount_usdt) FROM topup_requests WHERE user_id = u.id AND status = 'approved'), 0) as topup_total,
        COUNT(c.id) as card_count
      FROM users u
      LEFT JOIN cards c ON c.user_id = u.id
      WHERE u.role = 'user'
      GROUP BY u.id
      ORDER BY u.balance DESC
    `).all();

    const totalUserBalance = usersBalance.reduce((s, u) => s + (u.balance || 0), 0);
    const totalTopup       = usersBalance.reduce((s, u) => s + (u.topup_total || 0), 0);
    const totalSpend       = Number(getSetting('total_spend', '0'));

    // 从 transactions 表真实汇总手续费收入
    const feeAgg = db.prepare(`
      SELECT
        COUNT(*) as fee_count,
        COALESCE(SUM(fee_amount), 0) as total_fees
      FROM transactions
      WHERE fee_amount > 0
    `).get();

    // ③ 充值统计
    const topupStats = db.prepare(`
      SELECT
        COUNT(*) as total_count,
        COALESCE(SUM(CASE WHEN status = 'approved' THEN amount_usdt ELSE 0 END), 0) as total_approved,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN amount_usdt ELSE 0 END), 0) as total_pending,
        COALESCE(SUM(CASE WHEN status = 'approved' AND date(created_at) = date('now') THEN amount_usdt ELSE 0 END), 0) as today_approved,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count
      FROM topup_requests
    `).get();

    // ④ 开卡申请统计
    const cardAppStats = db.prepare(`
      SELECT
        COUNT(*) as total_count,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_count,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected_count
      FROM card_applications
    `).get();

    // ⑤ 系统预留余额（动态计算：商户余额 - 用户总余额）
    const systemBalance = +Math.max(0, merchantBalance - totalUserBalance).toFixed(2);

    res.json({
      code: 0,
      msg: 'ok',
      data: {
        // 商户余额
        merchant_balance: +merchantBalance.toFixed(2),
        wallet_balance: +walletBalance.toFixed(2),
        merchant_last_sync: merchantLastSync,
        // 用户余额分布
        users_balance: usersBalance,
        total_user_balance: +totalUserBalance.toFixed(2),
        total_topup: +totalTopup.toFixed(2),
        total_spend: +totalSpend.toFixed(2),
        total_fees: +Number(feeAgg.total_fees).toFixed(2),
        // 系统预留余额（动态：商户余额 - 用户总余额）
        system_balance: systemBalance,
        // 充值统计
        topup: {
          total_count: topupStats.total_count,
          total_approved: +topupStats.total_approved.toFixed(2),
          total_pending: +topupStats.total_pending.toFixed(2),
          today_approved: +topupStats.today_approved.toFixed(2),
          pending_count: topupStats.pending_count,
        },
        // 开卡统计
        card_apps: cardAppStats,
        // 资金平衡验证
        balance_check: {
          vmcardio_balance: +merchantBalance.toFixed(2),
          users_total_balance: +totalUserBalance.toFixed(2),
          system_reserved: systemBalance,
          formula: 'vmcardio余额 ≈ 用户总余额 + 系统预留',
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── 从上游同步所有卡片数据 ───────────────────────────────────────────────────
/**
 * 异步从 vmcardio 上游同步所有卡片数据
 * 注意：这是一个耗时操作，会逐个调用上游API获取卡片详情
 */
async function syncAllCardsFromUpstream() {
  console.log('[CardSync] 开始同步卡片数据...');
  const startTime = Date.now();
  
  try {
    // 获取所有卡片ID（只同步状态为 active 或 frozen 的卡片）
    const cards = db.prepare(`
      SELECT card_id FROM cards 
      WHERE status IN ('active', 'frozen') 
      ORDER BY updated_at ASC
      LIMIT 100
    `).all();
    
    console.log(`[CardSync] 找到 ${cards.length} 张需要同步的卡片`);
    
    let successCount = 0;
    let failCount = 0;
    
    // 逐个同步卡片（串行执行，避免对上游造成压力）
    for (const card of cards) {
      try {
        // 调用上游 API 获取卡片详情
        const detail = await sdk.cardDetail(card.card_id);
        
        if (detail && detail.card_id) {
          // 更新数据库
          // 状态映射：上游 ACTIVE -> active, 其他 -> frozen
          const mappedStatus = (detail.status || 'ACTIVE').toUpperCase() === 'ACTIVE' ? 'active' : 'frozen';
          
          db.prepare(`
            UPDATE cards SET
              card_number = ?,
              status = ?,
              available_amount = ?,
              expiry_month = ?,
              expiry_year = ?,
              cvv = ?,
              single_limit = ?,
              day_limit = ?,
              month_limit = ?,
              updated_at = datetime('now'),
              last_verified = datetime('now'),
              verified_status = 'verified',
              verification_error = NULL
            WHERE card_id = ?
          `).run(
            detail.card_number || null,
            mappedStatus,
            detail.available_amount || 0,
            detail.expiry_month || null,
            detail.expiry_year || null,
            detail.cvv || null,
            detail.single_limit || null,
            detail.day_limit || null,
            detail.month_limit || null,
            card.card_id
          );
          successCount++;
        }
      } catch (err) {
        console.error(`[CardSync] 同步卡片 ${card.card_id} 失败:`, err.message);
        // 记录错误但不中断同步
        db.prepare(`
          UPDATE cards SET
            last_verified = datetime('now'),
            verified_status = 'error',
            verification_error = ?
          WHERE card_id = ?
        `).run(err.message, card.card_id);
        failCount++;
      }
      
      // 添加小延迟，避免请求过快
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    const duration = Date.now() - startTime;
    console.log(`[CardSync] 同步完成，成功: ${successCount}, 失败: ${failCount}, 耗时: ${duration}ms`);
    
    return { success: successCount, failed: failCount, total: cards.length };
  } catch (err) {
    console.error('[CardSync] 同步过程出错:', err.message);
    throw err;
  }
}

module.exports = router;
