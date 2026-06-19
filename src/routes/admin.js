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
 * GET  /api/admin/card-products      — 卡段管理：列出所有卡段含 overrides (v1.0.24)
 * PUT  /api/admin/card-products/:pc  — 卡段管理：更新单卡段 overrides (v1.0.24)
 * DEL  /api/admin/card-products/:pc/override — 重置 overrides 回 docx (v1.0.24)
 */

const express = require('express');
const db      = require('../db/database');
const sdk     = require('../services/vmcardioSDK');
const cardProductOverrideService = require('../services/cardProductOverrideService');
const { normalizeCountry } = require('../utils/country');
const path = require('path');
const fs = require('fs');

// v1.0.24 加载 docx metadata
function loadCardMetadata() {
  try {
    const fp = path.join(__dirname, '..', '..', 'data', 'card_metadata.json');
    if (!fs.existsSync(fp)) return new Map();
    const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    return new Map((data.products || []).map(p => [p.product_code, p]));
  } catch (e) { return new Map(); }
}
const CARD_METADATA = loadCardMetadata();
const META_BY_BIN_PREFIX6 = (() => {
  const m = new Map();
  for (const p of CARD_METADATA.values()) if (p.bin_prefix6) m.set(p.bin_prefix6, p);
  return m;
})();
const logger  = require('../utils/logger');
const BalanceService = require('../services/balanceService');
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
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, nowiso())
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
      const promises = batch.map(async (cardId) => {
        try {
          const detail = await sdk.cardDetail(cardId);

          // 判断上游是否返回了有效数据
          const isDeleted = !detail || !detail.card_id || (detail.status || '').toUpperCase() === 'DELETED';

          if (localIdSet.has(cardId)) {
            // 更新已有卡片
            if (isDeleted) {
              db.prepare(`
                UPDATE cards SET
                  status = 'deleted',
                  available_amount = 0,
                  updated_at = nowiso(),
                  last_verified = nowiso(),
                  verified_status = 'verified',
                  verification_error = NULL
                WHERE card_id = ?
              `).run(cardId);
              results.synced++;
              results.details.push({ cardId, status: 'deleted', action: 'mark_deleted' });
            } else {
              const mappedStatus = detail.status.toUpperCase() === 'ACTIVE' ? 'active' : 'frozen';
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
                  updated_at = nowiso(),
                  last_verified = nowiso(),
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
                cardId
              );
              results.synced++;
              results.details.push({ cardId, status: mappedStatus, action: 'updated' });
            }
          } else {
            // 新增卡片
            if (!isDeleted) {
              const mappedStatus = detail.status.toUpperCase() === 'ACTIVE' ? 'active' : 'frozen';
              db.prepare(`
                INSERT OR IGNORE INTO cards (
                  card_id, user_id, card_number, product_code, label, card_type,
                  status, available_amount, expiry_month, expiry_year, cvv,
                  single_limit, day_limit, month_limit, last_verified, verified_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, nowiso(), 'verified')
              `).run(
                cardId,
                defaultUserId,
                detail.card_number || null,
                detail.product_code || null,
                detail.product_name || '',
                detail.card_type || 'virtual',
                mappedStatus,
                detail.available_amount || 0,
                detail.expiry_month || null,
                detail.expiry_year || null,
                detail.cvv || null,
                detail.single_limit || null,
                detail.day_limit || null,
                detail.month_limit || null
              );
              results.added++;
              results.details.push({ cardId, status: mappedStatus, action: 'inserted' });
            }
          }

          // 小延迟，避免请求过快
          await new Promise(r => setTimeout(r, 50));
        } catch (err) {
          // 上游调用失败时，标记为验证失败
          if (localIdSet.has(cardId)) {
            db.prepare(`
              UPDATE cards SET
                last_verified = nowiso(),
                verified_status = 'error',
                verification_error = ?
              WHERE card_id = ?
            `).run(err.message, cardId);
          }
          results.failed++;
          results.errors.push({ cardId, error: err.message });
        }
      });

      await Promise.all(promises);
    }

    res.json({ code: 0, msg: '同步完成', data: results });
  } catch (err) {
    next(err);
  }
});

// ── 实时同步单张卡 ──────────────────────────────────────────────────────────
/**
 * 从上游同步单张卡片状态，返回同步后的最新数据
 * 当上游返回 DELETED 时，将本地状态更新为 deleted
 */
async function syncSingleCard(cardId) {
  const detail = await sdk.cardDetail(cardId);

  if (!detail || !detail.card_id || (detail.status || '').toUpperCase() === 'DELETED') {
    // 上游卡片已删除
    db.prepare(`
      UPDATE cards SET
        card_number = ?,
        status = 'deleted',
        available_amount = 0,
        updated_at = nowiso(),
        last_verified = nowiso(),
        verified_status = 'verified',
        verification_error = NULL
      WHERE card_id = ?
    `).run(detail?.card_number || null, cardId);

    return { synchronized: true, upstream_status: 'DELETED', local_status: 'deleted' };
  }

  // 上游有有效数据
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
      updated_at = nowiso(),
      last_verified = nowiso(),
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
    cardId
  );

  return { synchronized: true, upstream_status: detail.status, local_status: mappedStatus };
}

// ── 获取商户实时余额 ────────────────────────────────────────────────────────
router.get('/merchant-balance', async (req, res, next) => {
  try {
    const result = await sdk.getAccountBalance();
    const balanceVal = result && typeof result.balance === 'number' ? result.balance : 0;
    const walletVal  = result && typeof result.wallet_balance === 'number' ? result.wallet_balance : 0;
    logger.info('[merchant-balance] 上游余额: ' + JSON.stringify(result));
    res.json({
      code: 0,
      msg:  'ok',
      data: {
        balance: balanceVal,
        wallet_balance: walletVal,
        currency: 'USD',
        updated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    // 上游 API 失败时降级读取缓存余额
    try {
      const stmt = db.prepare('SELECT value, updated_at FROM settings WHERE key = ?');
      const cached = stmt.get('merchant_balance_cached');
      const lastSync = stmt.get('merchant_balance_last_sync');
      logger.warn('[merchant-balance] 上游获取失败,降级到缓存: ' + err.message);
      res.json({
        code: 0,
        msg:  'ok',
        data: {
          balance: cached ? parseFloat(cached.value) : 0,
          currency: 'USD',
          updated_at: lastSync?.value || new Date().toISOString(),
          source: 'cache',
          error: err.message,
        },
      });
    } catch (dbErr) {
      logger.error('[merchant-balance] 缓存读取失败: ' + dbErr.message);
      res.json({
        code: 0,
        msg:  'ok',
        data: {
          balance: 0,
          currency: 'USD',
          updated_at: new Date().toISOString(),
          source: 'fallback',
        },
      });
    }
  }
});

// ── 获取平台统计 ─────────────────────────────────────────────────────────────
router.get('/stats', async (req, res, next) => {
  try {
    // 尝试从上游获取实时数据
    let upstreamCards = [];
    try {
      const listResult = await sdk.cardList({ pageSize: 200, page: 1 });
      if (listResult && Array.isArray(listResult.list)) {
        upstreamCards = listResult.list;
      }
    } catch (err) {
      console.warn('[Admin Stats] 上游 list 接口不可用，使用本地数据:', err.message);
    }

    // 如有上游数据，计算实时统计
    if (upstreamCards.length > 0) {
      const totalBalance = upstreamCards.reduce((s, c) => s + (c.available_amount || 0), 0);
      const activeCards = upstreamCards.filter(c => (c.status || '').toUpperCase() === 'ACTIVE').length;
      const frozenCards = upstreamCards.filter(c => (c.status || '').toUpperCase() !== 'ACTIVE').length;

      // 同步上游数据到本地
      for (const card of upstreamCards) {
        const local = db.prepare('SELECT id, status FROM cards WHERE card_id = ?').get(card.card_id);
        const mappedStatus = (card.status || 'ACTIVE').toUpperCase() === 'ACTIVE' ? 'active' : 'frozen';

        if (local) {
          db.prepare(`
            UPDATE cards SET status = ?, available_amount = ?, last_verified = nowiso(),
              verified_status = 'verified', verification_error = NULL
            WHERE card_id = ?
          `).run(mappedStatus, card.available_amount || 0, card.card_id);
        } else {
          db.prepare(`
            INSERT OR IGNORE INTO cards (card_id, user_id, card_number, product_code, status, available_amount, last_verified, verified_status)
            VALUES (?, 2, ?, ?, ?, ?, nowiso(), 'verified')
          `).run(card.card_id, card.card_number || '', card.product_code || '', mappedStatus, card.available_amount || 0);
        }
      }

      return res.json({
        code: 0,
        msg:  'ok',
        data: {
          users: { total: db.prepare('SELECT COUNT(*) as c FROM users').get().c },
          cards: {
            total: upstreamCards.length,
            active: activeCards,
            frozen: frozenCards,
          },
          total_cards: upstreamCards.length,
          total_balance: totalBalance.toFixed(2),
          active_cards: activeCards,
          frozen_cards: frozenCards,
          source: 'upstream',
        },
      });
    }

    // 回退到本地统计
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_cards,
        SUM(available_amount) as total_balance,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_cards,
        COUNT(CASE WHEN status = 'frozen' THEN 1 END) as frozen_cards,
        COUNT(CASE WHEN status = 'deleted' THEN 1 END) as deleted_cards
      FROM cards
    `).get();

    res.json({
      code: 0,
      msg:  'ok',
      data: {
        users: { total: db.prepare('SELECT COUNT(*) as c FROM users').get().c },
        cards: {
          total: stats.total_cards || 0,
          active: stats.active_cards || 0,
          frozen: stats.frozen_cards || 0,
        },
        total_cards: stats.total_cards || 0,
        total_balance: parseFloat(stats.total_balance || 0).toFixed(2),
        active_cards: stats.active_cards || 0,
        frozen_cards: stats.frozen_cards || 0,
        deleted_cards: stats.deleted_cards || 0,
        source: 'local',
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── 财务中心概览 ──────────────────────────────────────────────────────────
/**
 * GET /api/admin/finance-summary
 * 聚合财务中心页面所需全部数据
 */
router.get('/finance-summary', async (req, res, next) => {
  try {
    // 1. 商户余额（从 settings 表读取）
    const merchantBalanceVal = parseFloat(db.prepare("SELECT value FROM settings WHERE key='merchant_balance'").get()?.value || 0);
    const walletBalanceVal  = parseFloat(db.prepare("SELECT value FROM settings WHERE key='wallet_balance'").get()?.value || 0);
    const lastSyncVal       = db.prepare("SELECT value FROM settings WHERE key='merchant_balance_last_sync'").get()?.value || null;

    // 2. 用户总余额 & 分布（排除管理员）
    const allUsers = db.prepare(`
      SELECT id, email, balance,
        (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE user_id=u.id AND type='充值') as topup_total,
        (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE user_id=u.id AND type='消费') as total_spend,
        (SELECT COALESCE(SUM(fee_amount),0) FROM transactions WHERE user_id=u.id AND fee_amount>0) as total_fees
      FROM users u WHERE u.role != 'admin' ORDER BY balance DESC
    `).all();
    const totalUserBalance = allUsers.reduce((s, u) => s + (parseFloat(u.balance) || 0), 0);

    // 3. Topup 统计
    const topupApproved = db.prepare("SELECT COUNT(*) as cnt, COALESCE(SUM(amount_usdt),0) as total FROM topup_requests WHERE status='approved'").get();
    const topupToday   = db.prepare("SELECT COALESCE(SUM(amount_usdt),0) as total FROM topup_requests WHERE status='approved' AND date(created_at)=date('now')").get();
    const topupPending = db.prepare("SELECT COUNT(*) as cnt FROM topup_requests WHERE status='pending'").get();

    // 4. 费用统计
    const totalFees = db.prepare('SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE type=?').get('手续费');

    // 5. 开卡申请统计
    const cardApps = db.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status='approved' THEN 1 END) as approved,
        COUNT(CASE WHEN status='pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status='rejected' THEN 1 END) as rejected
      FROM card_applications
    `).get();

    // 6. 系统预留 = 商户余额 - 用户余额总和（平台持有但未分配给用户的资金）
    const systemBalance = Math.max(0, parseFloat((merchantBalanceVal - totalUserBalance).toFixed(2)));

    // 7. 余额验证
    const vmcardioBalance = merchantBalanceVal;
    const usersTotalBal = parseFloat(totalUserBalance.toFixed(2));
    const sysReserved   = parseFloat(systemBalance.toFixed(2));

    res.json({
      code: 0,
      msg: 'ok',
      data: {
        merchant_balance: vmcardioBalance,
        wallet_balance: walletBalanceVal,
        merchant_last_sync: lastSyncVal,
        total_user_balance: usersTotalBal,
        system_balance: sysReserved,
        users_balance: allUsers.map(u => ({
          id: u.id,
          email: u.email,
          balance: parseFloat(u.balance || 0),
          topup_total: parseFloat(u.topup_total || 0),
          total_spend: parseFloat(u.total_spend || 0),
          total_fees: parseFloat(u.total_fees || 0),
        })),
        total_topup: parseFloat(topupApproved.total || 0),
        topup: {
          total_count: topupApproved.cnt || 0,
          today_approved: parseFloat(topupToday.total || 0),
          pending_count: topupPending.cnt || 0,
        },
        total_fees: parseFloat(totalFees.total || 0),
        card_apps: {
          total_count: cardApps.total || 0,
          approved_count: cardApps.approved || 0,
          pending_count: cardApps.pending || 0,
          rejected_count: cardApps.rejected || 0,
        },
        balance_check: {
          vmcardio_balance: vmcardioBalance,
          users_total_balance: usersTotalBal,
          system_reserved: sysReserved,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── 交易监控 ─────────────────────────────────────────────────────────────────
/**
 * GET /api/admin/transactions?page=1&page_size=50&type=&user_id=&start_date=&end_date=
 */
router.get('/transactions', async (req, res, next) => {
  try {
    const { page = 1, page_size = 50, type, user_id, start_date, end_date } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(page_size);
    const limit = parseInt(page_size);
    // use db directly

    let where = [];
    let params = [];

    if (type) { where.push('t.type = ?'); params.push(type); }
    if (user_id) { where.push('t.user_id = ?'); params.push(parseInt(user_id)); }
    if (start_date) { where.push('t.created_at >= ?'); params.push(start_date); }
    if (end_date) { where.push('t.created_at <= ?'); params.push(end_date); }

    const whereClause = where.length ? ' WHERE ' + where.join(' AND ') : '';

    // 分页查询
    let sql = `
      SELECT t.id, t.user_id, t.type, t.amount, t.description, t.created_at,
             u.email as user_email
      FROM transactions t
      LEFT JOIN users u ON u.id = t.user_id
      ${whereClause}
      ORDER BY t.id DESC
      LIMIT ? OFFSET ?
    `;
    let rows;
    try {
      rows = db.prepare(sql).all(...params, limit, offset);
    } catch (e) {
      console.error('[TX] SQL error:', e.message);
      return res.status(500).json({ code: 500, msg: e.message });
    }

    // 总数
    const countRow = db.prepare(`
      SELECT COUNT(*) as total, COALESCE(SUM(amount),0) as total_amount
      FROM transactions t
      ${whereClause}
    `).get(...params);

    // 格式化输出
    const items = rows.map(r => ({
      id: r.id,
      card_id: 'txn_' + r.id,
      _card_number: '',
      transaction_type: r.type,
      status: 'COMPLETE',
      amount: parseFloat(r.amount),
      auth_amount: null,
      merchant_name: r.description || '—',
      description: r.description || '',
      start_time: r.created_at,
      _user: { user_name: '', user_email: r.user_email || '' },
    }));

    res.json({
      code: 0, msg: 'ok',
      data: {
        list: items,
        summary: {
          total_count: countRow.total || 0,
          total_amount: parseFloat(countRow.total_amount || 0),
          auth_count: 0,
          auth_amount: 0,
          settle_count: 0,
          settle_amount: 0,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});
/**
 * GET /api/admin/transaction-stats?start_date=&end_date=&user_id=
 * 交易监控统计：总体指标 + 分用户指标
 */
router.get('/transaction-stats', async (req, res, next) => {
  try {
    const { start_date, end_date, user_id } = req.query;
    const params = [];
    const conds = [];

    if (start_date) { conds.push(`t.created_at >= ?`); params.push(start_date); }
    if (end_date) { conds.push(`t.created_at <= ?`); params.push(end_date); }
    if (user_id) { conds.push(`t.user_id = ?`); params.push(user_id); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    // 1. 开卡量
    const cardConds = [];
    const cardParams = [];
    if (start_date) { cardConds.push(`created_at >= ?`); cardParams.push(start_date); }
    if (end_date) { cardConds.push(`created_at <= ?`); cardParams.push(end_date); }
    if (user_id) { cardConds.push(`user_id = ?`); cardParams.push(user_id); }
    const cardWhere = cardConds.length ? `WHERE ${cardConds.join(' AND ')}` : '';
    const cardCount = db.prepare(`SELECT COUNT(*) as cnt FROM cards ${cardWhere}`).get(...cardParams);
    const appCount = db.prepare(`SELECT COUNT(*) as cnt FROM card_applications ${cardWhere.replace('cards','card_applications')}`).get(...cardParams);

    // 2. 交易统计（按类型分组）
    const txRows = db.prepare(`SELECT t.type, COUNT(*) as cnt, COALESCE(SUM(t.amount),0) as total
      FROM transactions t ${where} GROUP BY t.type`).all(...params);

    const typeMap = {};
    txRows.forEach(r => { typeMap[r.type] = { count: r.cnt, amount: parseFloat(r.total) }; });

    // 3. 开卡申请统计
    const appStats = db.prepare(`SELECT status, COUNT(*) as cnt FROM card_applications ${cardWhere.replace('cards','card_applications')} GROUP BY status`).all(...cardParams);
    const appMap = {};
    appStats.forEach(r => { appMap[r.status] = r.cnt; });

    // 4. 分用户统计
    const allUsers = db.prepare(`SELECT id, email FROM users WHERE role != 'admin' ORDER BY id`).all();
    const perUser = [];

    for (const u of allUsers) {
      const up = [];
      const uc = [];
      if (start_date) { uc.push(`created_at >= ?`); up.push(start_date); }
      if (end_date) { uc.push(`created_at <= ?`); up.push(end_date); }
      const uWhere = uc.length ? `AND ${uc.join(' AND ')}` : '';

      const cardRow = db.prepare(`SELECT COUNT(*) as cnt FROM cards WHERE user_id=? ${uWhere}`).get(u.id, ...up);
      const txRow = db.prepare(`SELECT type, COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM transactions WHERE user_id=? ${uWhere} GROUP BY type`).all(u.id, ...up);

      const txMap = {};
      txRow.forEach(r => { txMap[r.type] = { count: r.cnt, amount: parseFloat(r.total) }; });

      perUser.push({
        user_id: u.id,
        email: u.email,
        card_count: cardRow.cnt,
        tx_count: txMap['消费']?.count || 0,
        topup_count: txMap['充值']?.count || 0,
        spend_count: txMap['消费']?.count || 0,
        topup_total: txMap['充值']?.amount || 0,
        spend_total: txMap['消费']?.amount || 0,
        refund_total: txMap['退款']?.amount || 0,
        fee_total: txMap['手续费']?.amount || 0,
      });
    }

    // 5. 总体指标
    const txCount = typeMap['消费']?.count || 0;
    const totalAmount = parseFloat(typeMap['消费']?.amount || 0);
    const topupAmt = typeMap['充值']?.amount || 0;
    const spendAmt = typeMap['消费']?.amount || 0;
    const refundAmt = typeMap['退款']?.amount || 0;
    const feeAmt = typeMap['手续费']?.amount || 0;

    // ===== 上游交易流水同步 =====
    try {
      await require('../services/transactionSyncService').syncTransactions({startTime: start_date, endTime: end_date});
    } catch (syncErr) {
      logger.warn('[tx-stats] sync failed (upstream may be unreachable):', syncErr.message);
    }

    // 5. 从 card_transactions 表计算上游指标
    const ctConds = [];
    const ctParams = [];
    if (start_date) { ctConds.push(`ct.create_time >= ?`); ctParams.push(start_date); }
    if (end_date)   { ctConds.push(`ct.create_time <= ?`); ctParams.push(end_date); }
    const ctWhere = ctConds.length ? `WHERE ${ctConds.join(' AND ')}` : '';
    const ctAnd   = ctConds.length ? `AND ${ctConds.join(' AND ')}` : '';

    const ctRows = db.prepare(`SELECT type, status,
      COUNT(*) as cnt,
      COALESCE(SUM(auth_amount),0) as auth_amt,
      COALESCE(SUM(settle_amount),0) as settle_amt
      FROM card_transactions ct ${ctWhere} GROUP BY type, ct.status`).all(...ctParams);

    let authComplete = 0, authDeclined = 0, authPending = 0;
    let settleCount = 0, settleAmt = 0;
    let reversalCount = 0;
    let refundCount = 0;
    ctRows.forEach(r => {
      const cnt = r.cnt;
      if (r.type === 'Authorization' && r.status === 'COMPLETE') authComplete = cnt;
      else if (r.type === 'Authorization' && r.status === 'DECLINED') authDeclined = cnt;
      else if (r.type === 'Authorization' && r.status === 'PENDING') authPending = cnt;
      else if (r.type === 'Settlement') { settleCount = cnt; settleAmt = parseFloat(r.settle_amt); }
      else if (r.type === 'Reversal') reversalCount = cnt;
      else if (r.type === 'Refund') refundCount = cnt;
    });

    const totalAuth = authComplete + authDeclined;
    const authAmt = parseFloat(ctRows.filter(r => r.type==='Authorization').reduce((s,r) => s + parseFloat(r.auth_amt), 0));
    const settlementRate  = totalAuth > 0 ? parseFloat((settleCount / totalAuth).toFixed(4)) : 0;
    const failureRate     = totalAuth > 0 ? parseFloat((authDeclined / totalAuth).toFixed(4)) : 0;
    const reversalRate    = authComplete > 0 ? parseFloat((reversalCount / authComplete).toFixed(4)) : 0;
    const refundRate      = settleCount > 0 ? parseFloat((refundCount / settleCount).toFixed(4)) : 0;

    // 更新 per_user 加入上游指标
    for (const u of perUser) {
      const u_ctRows = db.prepare(`SELECT type, ct.status, COUNT(*) as cnt
        FROM card_transactions ct
        JOIN cards c ON c.card_id = ct.card_id
        WHERE c.user_id = ? ${ctAnd} GROUP BY type, ct.status`).all(u.user_id, ...ctParams);

      let uAuthOk = 0, uAuthDecl = 0, uSettle = 0, uRev = 0, uRef = 0;
      u_ctRows.forEach(r => {
        if (r.type === 'Authorization' && r.status === 'COMPLETE') uAuthOk = r.cnt;
        else if (r.type === 'Authorization' && r.status === 'DECLINED') uAuthDecl = r.cnt;
        else if (r.type === 'Settlement') uSettle = r.cnt;
        else if (r.type === 'Reversal') uRev = r.cnt;
        else if (r.type === 'Refund') uRef = r.cnt;
      });
      const uTotal = uAuthOk + uAuthDecl;
      u.auth_count = uAuthOk + uAuthDecl;
      u.settle_count = uSettle;
      u.decline_count = uAuthDecl;
      u.reversal_count = uRev;
      u.refund_count = uRef;
      u.settle_rate = uTotal > 0 ? parseFloat((uSettle / uTotal).toFixed(4)) : 0;
      u.fail_rate = uTotal > 0 ? parseFloat((uAuthDecl / uTotal).toFixed(4)) : 0;
      u.reversal_rate = uAuthOk > 0 ? parseFloat((uRev / uAuthOk).toFixed(4)) : 0;
      u.refund_rate = uSettle > 0 ? parseFloat((uRef / uSettle).toFixed(4)) : 0;
    }

    const metrics = {
      card_issued: cardCount.cnt,
      card_applications: appCount.cnt,
      app_pending: appMap['pending'] || 0,
      app_approved: appMap['approved'] || 0,
      app_rejected: appMap['rejected'] || 0,
      tx_count: txCount,
      tx_total_amount: totalAmount,
      topup_count: typeMap['充值']?.count || 0,
      topup_amount: topupAmt,
      spend_count: typeMap['消费']?.count || 0,
      spend_amount: spendAmt,
      refund_count: typeMap['退款']?.count || 0,
      refund_amount: refundAmt,
      fee_amount: feeAmt,
      // 上游卡片交易明细指标（从 card_transactions 实时计算）
      auth_count: authComplete + authDeclined + authPending,
      auth_amount: authAmt,
      settle_count: settleCount,
      settle_amount: settleAmt,
      decline_count: authDeclined,
      reversal_count: reversalCount,
      refund_count: refundCount,
      settlement_rate: settlementRate,
      failure_rate: failureRate,
      reversal_rate: reversalRate,
      refund_rate: refundRate,
    };

    // 补充钱包数据
    metrics.account_balance = Number(getSetting('account_balance', '0'));
    metrics.total_topup = Number(getSetting('total_topup', '0'));

    res.json({ code: 0, msg: 'ok', data: { metrics, per_user: perUser } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/transaction-trends?start_date=&end_date=&user_id=
 * 交易走势数据（按天分组）
 */
router.get('/transaction-trends', async (req, res, next) => {
  try {
    const { start_date, end_date, user_id } = req.query;
    const cardP = [], txP = [], ctP = [];
    const cardC = [], txC = [], ctC = [];

    if (start_date) { cardC.push('created_at >= ?'); cardP.push(start_date); }
    if (end_date)   { cardC.push('created_at <= ?'); cardP.push(end_date + ' 23:59:59'); }
    if (user_id)    { cardC.push('user_id = ?'); cardP.push(user_id); }
    const cardWhere = cardC.length ? 'WHERE ' + cardC.join(' AND ') : '';

    if (start_date) { txC.push('t.created_at >= ?'); txP.push(start_date); }
    if (end_date)   { txC.push('t.created_at <= ?'); txP.push(end_date + ' 23:59:59'); }
    if (user_id)    { txC.push('t.user_id = ?'); txP.push(user_id); }
    const txWhere = txC.length ? 'WHERE ' + txC.join(' AND ') : '';

    // card_transactions 条件
    if (start_date) { ctC.push('ct.create_time >= ?'); ctP.push(start_date); }
    if (end_date)   { ctC.push('ct.create_time <= ?'); ctP.push(end_date + ' 23:59:59'); }

    // 按天汇总：开卡量
    const cardRows = db.prepare(`SELECT DATE(created_at) as dt, COUNT(*) as cnt FROM cards ${cardWhere} GROUP BY dt ORDER BY dt`).all(...cardP);
    // 按天+类型汇总：本地交易
    const txRows = db.prepare(`SELECT DATE(t.created_at) as dt, t.type, COUNT(*) as cnt, SUM(t.amount) as amt FROM transactions t ${txWhere} GROUP BY dt, t.type ORDER BY dt`).all(...txP);

    // 上游清算数据：按天+类型
    let ctRows = [];
    if (user_id) {
      const uctP = [user_id, ...ctP];
      const uctC = ['c.user_id = ?', ...ctC];
      const uctWhere = 'WHERE ' + uctC.join(' AND ');
      ctRows = db.prepare(`SELECT DATE(ct.create_time) as dt, ct.type, COUNT(*) as cnt, SUM(ct.settle_amount) as settle_amt
        FROM card_transactions ct JOIN cards c ON ct.card_id = c.card_id ${uctWhere} GROUP BY dt, ct.type ORDER BY dt`).all(...uctP);
    } else {
      const ctWhere = ctC.length ? 'WHERE ' + ctC.join(' AND ') : '';
      ctRows = db.prepare(`SELECT DATE(ct.create_time) as dt, ct.type, COUNT(*) as cnt, SUM(ct.settle_amount) as settle_amt
        FROM card_transactions ct ${ctWhere} GROUP BY dt, ct.type ORDER BY dt`).all(...ctP);
    }

    // 合并到按天 map
    const dayMap = {};
    const addDay = (dt) => { if (!dayMap[dt]) dayMap[dt] = { date: dt, card_issued: 0, tx_count: 0, tx_amount: 0, topup_amount: 0, settle_amount: 0, reversal_count: 0, refund_count: 0 }; };

    cardRows.forEach(r => { addDay(r.dt); dayMap[r.dt].card_issued = r.cnt; });
    txRows.forEach(r => {
      addDay(r.dt);
      if (r.type === '消费') { dayMap[r.dt].tx_count = r.cnt; dayMap[r.dt].tx_amount = +r.amt; }
      else if (r.type === '充值') dayMap[r.dt].topup_amount = +r.amt;
    });
    ctRows.forEach(r => {
      addDay(r.dt);
      if (r.type === 'Settlement') dayMap[r.dt].settle_amount = +r.settle_amt;
      else if (r.type === 'Reversal') dayMap[r.dt].reversal_count = r.cnt;
      else if (r.type === 'Refund') dayMap[r.dt].refund_count = r.cnt;
    });

    // 填充日期空档
    const trends = [];
    if (start_date) {
      let d = new Date(start_date);
      const end = end_date ? new Date(end_date) : new Date();
      while (d <= end) {
        const key = d.toISOString().slice(0, 10);
        addDay(key);
        d.setDate(d.getDate() + 1);
      }
    }
    trends.push(...Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date)));

    res.json({ code: 0, msg: 'ok', data: { trends } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/cards?page=1&pageSize=10&status=active&search=xxx
 *   &force=true — 先触发上游同步再返回数据（同步过程会更新本地 DB）
 *   &sync=true  — 对当前页卡片逐一从上游拉取最新状态（含 DELETED 标记）
 *
 * 关键改进：
 *   - sync=true 时，对当前页每张卡调用上游 cardDetail
 *   - 上游返回 DELETED → 本地标记 deleted、余额置 0
 *   - 上游返回有效数据 → 更新本地状态
 */
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
      force,
      sync
    } = req.query;
    
    // force=true 时触发全量同步
    if (force === 'true') {
      console.log('[Admin Cards] 触发全量卡片同步...');
      try {
        await syncAllCardsFromUpstream();
        console.log('[Admin Cards] 全量同步完成');
      } catch (err) {
        console.error('[Admin Cards] 全量同步失败:', err.message);
      }
    }
    
    // 排序字段白名单
    const allowedSortFields = ['created_at', 'updated_at', 'available_amount', 'status', 'card_number'];
    const safeSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
    const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    
    const offset = (page - 1) * pageSize;
    
    // 构建查询条件和参数
    let whereConditions = [];
    let queryParams = [];
    
    if (status) {
      whereConditions.push('c.status = ?');
      queryParams.push(status);
    }
    
    if (user_id) {
      whereConditions.push('c.user_id = ?');
      queryParams.push(user_id);
    }
    
    if (card_id) {
      whereConditions.push('c.card_id = ?');
      queryParams.push(card_id.trim());
    }
    
    if (date_from) {
      whereConditions.push('c.created_at >= ?');
      queryParams.push(date_from);
    }
    if (date_to) {
      whereConditions.push('c.created_at <= ?');
      queryParams.push(date_to + ' 23:59:59');
    }
    
    if (search) {
      const searchTerm = `%${search}%`;
      whereConditions.push('(c.card_number LIKE ? OR c.label LIKE ? OR u.name LIKE ? OR u.email LIKE ? OR u.id LIKE ?)');
      queryParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }
    
    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    
    // 查询当前页卡片
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
    
    // sync=true：先从上游拉取全量卡片列表，再对当前页逐张同步状态
    if (sync === 'true') {
      console.log('[Admin Cards] 从上游拉取全量卡片列表...');
      try {
        const listResult = await sdk.cardList({ pageSize: 200, page: 1 });
        if (listResult && Array.isArray(listResult.list) && listResult.list.length > 0) {
          const upsert = db.prepare(`
            INSERT INTO cards (card_id, user_id, card_number, product_code, status, available_amount, expiry_month, expiry_year, last_verified, verified_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, nowiso(), 'synced')
            ON CONFLICT(card_id) DO UPDATE SET
              status = excluded.status,
              available_amount = excluded.available_amount,
              last_verified = nowiso(),
              verified_status = 'synced'
          `);
          for (const up of listResult.list) {
            const vmStatus = (up.status || '').toUpperCase();
            const mappedStatus = vmStatus === 'ACTIVE' ? 'active' : vmStatus === 'CANCELLED' ? 'frozen' : 'active';
            upsert.run(
              up.card_id, 2, up.card_number || '',
              up.product_code || '', mappedStatus,
              up.available_amount || 0,
              up.expiry_month || null, up.expiry_year || null
            );
          }
          console.log(`[Admin Cards] 上游同步完成：更新/插入了 ${listResult.list.length} 张卡`);
        }
      } catch (err) {
        console.warn('[Admin Cards] 上游列表拉取失败，仅同步本地已有卡片:', err.message);
      }

      // 对当前页每张卡从上游拉取最新状态（含 DELETED 标记）
      if (cards.length > 0) {
        console.log(`[Admin Cards] 实时同步 ${cards.length} 张卡片状态...`);
        for (const card of cards) {
          try {
            await syncSingleCard(card.card_id);
          } catch (err) {
            console.warn(`[Admin Cards] 同步卡片 ${card.card_id} 失败:`, err.message);
          }
        }
      }
      // 重新拉取最新数据
      const refreshedCards = db.prepare(`
        SELECT 
          c.id, c.card_id, c.card_number, c.product_code, c.label, c.card_type,
          c.status, c.available_amount, c.expiry_month, c.expiry_year, c.cvv,
          c.single_limit, c.day_limit, c.month_limit, c.created_at, c.updated_at,
          c.last_verified, c.verified_status, c.verification_error,
          u.id as user_id, u.name as user_name, u.email as user_email, u.role as user_role
        FROM cards c
        JOIN users u ON u.id = c.user_id
        ${whereClause}
        ORDER BY c.${safeSortBy} ${safeSortOrder}
        LIMIT ? OFFSET ?
      `).all(...queryParams, pageSize, offset);
      cards.length = 0;
      cards.push(...refreshedCards);
    }
    
    // 查询总数
    const totalResult = db.prepare(`
      SELECT COUNT(*) as total
      FROM cards c
      JOIN users u ON u.id = c.user_id
      ${whereClause}
    `).get(...queryParams);
    
    // 查询统计信息
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_cards,
        SUM(c.available_amount) as total_balance,
        COUNT(DISTINCT c.user_id) as total_users,
        COUNT(CASE WHEN c.status = 'active' THEN 1 END) as active_cards,
        COUNT(CASE WHEN c.status = 'frozen' THEN 1 END) as frozen_cards,
        COUNT(CASE WHEN c.status = 'deleted' THEN 1 END) as deleted_cards
      FROM cards c
    `).get();
    
    // 格式化到期日字段
    const formattedCards = cards.map(c => ({
      ...c,
      expire: c.expiry_month && c.expiry_year
        ? String(c.expiry_month).padStart(2, '0') + '/' + String(c.expiry_year).slice(-2)
        : null
    }));

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
          frozen_cards: stats.frozen_cards || 0,
          deleted_cards: stats.deleted_cards || 0
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
 * 实时从 vmcardio 拉取卡片完整信息，同时更新本地数据库
 * 上游 DELETED → 本地标记 deleted
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

    // 实时从上游拉取完整详情
    let detail = {};
    let verificationError = null;
    let verifiedStatus = 'valid';
    
    try {
      detail = await sdk.cardDetail(cardId);
      
      if (!detail || !detail.card_id) {
        // 上游返回空数据，视为卡片已删除
        db.prepare(`
          UPDATE cards SET
            status = 'deleted',
            available_amount = 0,
            updated_at = nowiso(),
            last_verified = nowiso(),
            verified_status = 'verified',
            verification_error = NULL
          WHERE card_id = ?
        `).run(cardId);
        
        return res.json({
          code: 0, msg: 'ok', data: {
            ...localCard,
            status: 'deleted',
            available_amount: 0,
            expire: localCard.expiry_month && localCard.expiry_year
              ? String(localCard.expiry_month).padStart(2, '0') + '/' + String(localCard.expiry_year).slice(-2)
              : null,
            upstream_status: 'DELETED',
          }
        });
      }

      const upstreamStatus = (detail.status || '').toUpperCase();
      if (upstreamStatus === 'DELETED') {
        // 上游明确标记为已删除
        db.prepare(`
          UPDATE cards SET
            card_number = ?,
            status = 'deleted',
            available_amount = 0,
            updated_at = nowiso(),
            last_verified = nowiso(),
            verified_status = 'verified',
            verification_error = NULL
          WHERE card_id = ?
        `).run(detail.card_number || null, cardId);
      } else {
        // 上游有效数据 → 映射并更新本地
        const mappedStatus = upstreamStatus === 'ACTIVE' ? 'active' : 'frozen';
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
            updated_at = nowiso(),
            last_verified = nowiso(),
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
          cardId
        );
      }
    } catch (err) {
      console.error('[Card Detail] 上游调用失败:', err.message);
      verificationError = err.message;
      verifiedStatus = 'error';

      // 上游出错时，记录验证失败但不改状态
      db.prepare(`
        UPDATE cards SET
          last_verified = nowiso(),
          verified_status = 'error',
          verification_error = ?
        WHERE card_id = ?
      `).run(err.message, cardId);
    }

    // 重新读取更新后的本地数据
    const updated = db.prepare(`
      SELECT c.*, u.name as user_name, u.email as user_email
      FROM cards c
      JOIN users u ON u.id = c.user_id
      WHERE c.card_id = ?
    `).get(cardId);

    res.json({
      code: 0, msg: 'ok', data: {
        ...updated,
        expire: updated.expiry_month && updated.expiry_year
          ? String(updated.expiry_month).padStart(2, '0') + '/' + String(updated.expiry_year).slice(-2)
          : null,
      }
    });
  } catch (err) {
    next(err);
  }
});

// ── 管理员查询所有用户 ──────────────────────────────────────────────────────
router.get('/users', (req, res) => {
  const { page = 1, pageSize = 20, search } = req.query;
  const offset = (page - 1) * pageSize;
  let where = '';
  let params = [];

  if (search) {
    where = 'WHERE (u.name LIKE ? OR u.email LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term);
  }

  const users = db.prepare(`
    SELECT 
      u.id, u.email, u.name, u.role, u.balance, u.created_at,
      (SELECT COUNT(*) FROM cards c WHERE c.user_id = u.id) as card_count
    FROM users u
    ${where}
    ORDER BY u.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);

  const total = db.prepare(`
    SELECT COUNT(*) as total FROM users u ${where}
  `).get(...params);

  res.json({
    code: 0, msg: 'ok', data: { list: users, total: total.total, page: parseInt(page), pageSize: parseInt(pageSize) }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 消费明细（按 cardIds 列表）公共查询
// ════════════════════════════════════════════════════════════════════════════
// 复用于：/admin/users/:id/transactions、/admin/cards/:cardId/transactions

const TYPE_ZH    = { Authorization: '预授权', Settlement: '结算', Refund: '退款', Reversal: '撤销' };
const STATUS_ZH  = { COMPLETE: '已完成', DECLINED: '失败', PENDING: '清算中' };

/**
 * 查流水（按 cardIds 列表）
 * @param {string[]} cardIds
 * @param {{type?:string,start_date?:string,end_date?:string,page?:number,page_size?:number}} opts
 * @returns {Object} { rows, total, byTypeMap, byCard, totalAuth, totalSettle, totalCount, page, pageSize }
 */
function fetchCardTransactions(cardIds, opts = {}) {
  const { type, start_date, end_date, page = 1, page_size = 50 } = opts;
  const limit  = Math.min(parseInt(page_size) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  // 动态条件
  const params = [];
  const conds = [];
  if (type)       { conds.push('ct.type = ?');           params.push(type); }
  if (start_date) { conds.push('ct.create_time >= ?');   params.push(start_date); }
  if (end_date)   { conds.push('ct.create_time <= ?');   params.push(end_date + ' 23:59:59'); }
  conds.push(`c.card_id IN (${cardIds.map(() => '?').join(',')})`);
  const where = ' WHERE ' + conds.join(' AND ');

  // 分页明细
  const rows = db.prepare(`
    SELECT ct.id, ct.auth_id, ct.card_id, ct.type, ct.status,
           ct.auth_amount, ct.settle_amount, ct.auth_currency, ct.settle_currency,
           ct.merchant_name, ct.create_time, ct.auth_time, ct.sync_time,
           c.card_number, c.product_code, c.label
    FROM card_transactions ct
    JOIN cards c ON c.card_id = ct.card_id
    ${where}
    ORDER BY ct.create_time DESC
    LIMIT ? OFFSET ?
  `).all(...params, ...cardIds, limit, offset);

  // 总数
  const total = db.prepare(`
    SELECT COUNT(*) as cnt
    FROM card_transactions ct
    JOIN cards c ON c.card_id = ct.card_id
    ${where}
  `).get(...params, ...cardIds).cnt;

  // Summary：按类型
  const byTypeRows = db.prepare(`
    SELECT ct.type, COUNT(*) as cnt,
           COALESCE(SUM(ct.auth_amount),0)   as auth_sum,
           COALESCE(SUM(ct.settle_amount),0) as settle_sum
    FROM card_transactions ct
    JOIN cards c ON c.card_id = ct.card_id
    ${where}
    GROUP BY ct.type
  `).all(...params, ...cardIds);

  const byTypeMap = {};
  let totalAuth = 0, totalSettle = 0, totalCount = 0;
  for (const r of byTypeRows) {
    byTypeMap[r.type] = { label: TYPE_ZH[r.type] || r.type, count: r.cnt, auth_amount: r.auth_sum, settle_amount: r.settle_sum };
    totalAuth   += r.auth_sum;
    totalSettle += r.settle_sum;
    totalCount  += r.cnt;
  }

  // 退款总额 = type='Refund' 的 settle_amount 合计（绝对值，便于展示）
  const refundRow = byTypeMap['Refund'];
  const totalRefund = refundRow ? Math.abs(refundRow.settle_amount || 0) : 0;

  // Summary：按卡（只在多卡场景下有意义，但单卡也返回以保持结构一致）
  const byCard = db.prepare(`
    SELECT ct.card_id, c.card_number, c.label,
           COUNT(*) as cnt,
           COALESCE(SUM(ct.auth_amount),0)   as auth_sum,
           COALESCE(SUM(ct.settle_amount),0) as settle_sum
    FROM card_transactions ct
    JOIN cards c ON c.card_id = ct.card_id
    ${where}
    GROUP BY ct.card_id
    ORDER BY cnt DESC
  `).all(...params, ...cardIds);

  return { rows, total, byTypeMap, byCard, totalAuth, totalSettle, totalRefund, totalCount, page: parseInt(page), pageSize: limit };
}

/**
 * 构造 CSV 字符串
 */
function buildTransactionsCSV(rows) {
  const header = ['时间', '卡片ID', '类型', '状态', '授权金额', '结算金额', '币种', '商家', 'Auth ID', '授权时间', '同步时间'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const cells = [
      esc_(r.create_time || ''),
      esc_(r.card_id || ''),
      esc_(TYPE_ZH[r.type] || r.type || ''),
      esc_(STATUS_ZH[r.status] || r.status || ''),
      r.auth_amount != null ? r.auth_amount : '',
      r.settle_amount != null ? r.settle_amount : '',
      esc_(r.auth_currency || 'USD'),
      esc_(r.merchant_name || ''),
      esc_(r.auth_id || ''),
      esc_(r.auth_time || ''),
      esc_(r.sync_time || '')
    ];
    lines.push(cells.join(','));
  }
  return '\ufeff' + lines.join('\n');
}

/**
 * GET /api/admin/users/:id/transactions
 *   查询某用户所有卡的刷卡流水（来自 vmcardio 上游 card_transactions）
 *   Query:
 *     type        Authorization / Settlement / Refund / Reversal
 *     start_date  YYYY-MM-DD
 *     end_date    YYYY-MM-DD
 *     page        默认 1
 *     page_size   默认 50，最大 500
 *     format=csv  直接返回 CSV 下载
 */
router.get('/users/:id/transactions', (req, res) => {
  const userId = parseInt(req.params.id);
  if (!userId) return res.status(400).json({ code: 400, msg: '无效的用户ID' });

  // 校验用户存在
  const user = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ code: 404, msg: '用户不存在' });

  const { type, start_date, end_date, page = 1, page_size = 50, format } = req.query;
  const limit  = Math.min(parseInt(page_size) || 50, 500);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

  // 该用户的卡
  const userCards = db.prepare(`
    SELECT id, card_id, card_number, status, available_amount, product_code, label
    FROM cards WHERE user_id = ? ORDER BY created_at DESC
  `).all(userId);
  const cardIds = userCards.map(c => c.card_id);
  // 该用户有 0 张卡时直接返回空
  if (cardIds.length === 0) {
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="transactions_${userId}_empty.csv"`);
      return res.send('该用户没有卡片\n');
    }
    return res.json({
      code: 0, msg: 'ok',
      data: {
        user: { id: user.id, email: user.email, name: user.name },
        cards: [],
        list: [], total: 0, page: 1, pageSize: 50,
        summary: { total_count: 0, total_auth: 0, total_settle: 0, total_refund: 0, by_type: {}, by_card: [] }
      }
    });
  }

  // CSV 导出（最多 5000 条）
  if (format === 'csv') {
    const csvAll = fetchCardTransactions(cardIds, { type, start_date, end_date, page: 1, page_size: 5000 });
    const csv = buildTransactionsCSV(csvAll.rows);
    const fname = `transactions_${userId}_${(start_date||'all')}_${(end_date||'all')}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    return res.send(csv);
  }

  // 分页 + Summary（走公共函数）
  const data = fetchCardTransactions(cardIds, { type, start_date, end_date, page, page_size });

  res.json({
    code: 0, msg: 'ok',
    data: {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      cards: userCards,
      list: data.rows,
      total: data.total,
      page: data.page,
      pageSize: data.pageSize,
      summary: {
        total_count:  data.totalCount,
        total_auth:   data.totalAuth,
        total_settle: data.totalSettle,
        total_refund: data.totalRefund,
        by_type: data.byTypeMap,
        by_card: data.byCard
      }
    }
  });
});

// ==================== 管理员手动充值 ====================

/**
 * POST /api/admin/users/:id/topup
 * 管理员为指定用户账户充值（与扣款对称）
 * Body: { amount: number(>0), note: string(可选) }
 */
router.post('/users/:id/topup', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const amount = parseFloat(req.body.amount);
    const note = (req.body.note || '').toString().trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ code: 400, msg: '充值金额必须是正数' });
    }
    if (amount > 100000) {
      return res.status(400).json({ code: 400, msg: '单次充值金额不能超过 100,000' });
    }

    // 预检查目标用户存在 + 非管理员（与 deduct 对称）
    const target = db.prepare('SELECT id, role, name FROM users WHERE id = ?').get(userId);
    if (!target) return res.status(404).json({ code: 404, msg: '用户不存在' });
    if (target.role === 'admin') {
      return res.status(403).json({ code: 403, msg: '不能给管理员账户充值' });
    }

    const result = BalanceService.adminTopup(userId, amount, note || `管理员充值 (admin=${req.user.id})`);

    // 写审计日志（与 adminDeduct 对称）
    db.prepare(`
      INSERT INTO audit_logs (user_id, action, ip, ua, detail, created_at)
      VALUES (?, 'admin_topup', ?, ?, ?, nowiso())
    `).run(
      userId,
      req.ip || '',
      (req.headers['user-agent'] || '').slice(0, 200),
      JSON.stringify({
        admin_id: req.user.id,
        admin_email: req.user.email,
        topup_amount: amount,
        old_balance: result.old_balance,
        new_balance: result.new_balance,
        note: note || ''
      })
    );

    logger.info(`[adminTopup] admin=${req.user.id}(${req.user.email}) user=${userId} amount=+$${amount} note="${note}"`);

    res.json({
      code: 0,
      msg: 'ok',
      data: {
        user_id: userId,
        user_name: target.name,
        topup_amount: amount,
        old_balance: result.old_balance,
        new_balance: result.new_balance,
        transaction_id: result.transaction_id
      }
    });
  } catch (e) {
    logger.error(`[adminTopup] error: ${e.stack || e.message}`);
    next(e);
  }
});

/**
 * POST /api/admin/users/:id/deduct
 *   管理员手动扣减普通用户余额
 *   Body: { amount: number(>0), reason: string(1-200) }
 *   - 仅管理员可调（requireAdmin 已在 router.use 中）
 *   - 不允许扣成负数（余额不足 → 拒绝）
 *   - 强制要求 reason（审计要求）
 *   - 写 transactions 流水（type='管理员扣款'，用户后台可看到）
 *   - 写 audit_logs 审计（带管理员 ID、IP、UA、扣款前后余额）
 */
router.post('/users/:id/deduct', (req, res, next) => {
  try {
    const userId = parseInt(req.params.id);
    if (!userId) return res.status(400).json({ code: 400, msg: '无效的用户ID' });

    // 校验目标用户存在
    const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId);
    if (!target) return res.status(404).json({ code: 404, msg: '用户不存在' });

    // 校验目标用户非管理员（虽然管理员账户在前端不显示扣款按钮，双重保护）
    if (target.role === 'admin') {
      return res.status(403).json({ code: 403, msg: '不能扣除管理员账户余额' });
    }

    const { amount, reason } = req.body || {};
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ code: 400, msg: '扣款金额必须是正数' });
    }
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ code: 400, msg: '扣款原因不能为空' });
    }
    if (String(reason).trim().length > 200) {
      return res.status(400).json({ code: 400, msg: '扣款原因不能超过 200 字' });
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';

    const result = BalanceService.adminDeduct(
      req.user.id,  // 管理员 ID
      userId,       // 被扣款用户 ID
      amt,          // 金额
      String(reason).trim(),
      ip,
      ua
    );

    logger.info(`[adminDeduct] admin=${req.user.id}(${req.user.email}) deducted $${amt} from user=${userId}(${result.user_email}) reason="${String(reason).trim()}"`);

    res.json({
      code: 0, msg: '扣款成功',
      data: {
        user_id: result.user_id,
        user_name: result.user_name,
        user_email: result.user_email,
        deduction: result.deduction,
        old_balance: result.old_balance,
        new_balance: result.new_balance,
        transaction_id: result.transaction_id
      }
    });
  } catch (err) {
    // 业务错误 → 400；其他 → 500
    if (err.message && /余额不足|扣款金额|扣款原因|用户不存在|管理员不能/.test(err.message)) {
      return res.status(400).json({ code: 400, msg: err.message });
    }
    next(err);
  }
});

/**
 * GET /api/admin/cards/:cardId/info
 *   轻量级卡片信息（用于"按卡看消费"弹窗头部展示）
 *   不调上游 SDK，仅查本地 DB
 */
router.get('/cards/:cardId/info', (req, res) => {
  const cardId = req.params.cardId;
  if (!cardId) return res.status(400).json({ code: 400, msg: '无效的卡片ID' });
  const card = db.prepare(`
    SELECT id, card_id, card_number, status, available_amount, product_code, label, user_id
    FROM cards WHERE card_id = ?
  `).get(cardId);
  if (!card) return res.status(404).json({ code: 404, msg: '卡片不存在' });
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
 * GET /api/admin/cards/:cardId/transactions
 *   查询某张卡的刷卡流水（来自 vmcardio 上游 card_transactions）
 *   复用 fetchCardTransactions + buildTransactionsCSV 公共函数
 */
router.get('/cards/:cardId/transactions', (req, res) => {
  const cardId = req.params.cardId;
  if (!cardId) return res.status(400).json({ code: 400, msg: '无效的卡片ID' });

  // 校验卡片存在
  const card = db.prepare(`
    SELECT id, card_id, card_number, status, available_amount, product_code, label, user_id
    FROM cards WHERE card_id = ?
  `).get(cardId);
  if (!card) return res.status(404).json({ code: 404, msg: '卡片不存在' });

  // 查该卡所属用户（用于头部展示）
  const owner = card.user_id
    ? db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(card.user_id)
    : null;

  const { type, start_date, end_date, page = 1, page_size = 50, format } = req.query;

  // CSV 导出
  if (format === 'csv') {
    const csvAll = fetchCardTransactions([cardId], { type, start_date, end_date, page: 1, page_size: 5000 });
    const csv = buildTransactionsCSV(csvAll.rows);
    const fname = `transactions_card_${cardId}_${(start_date||'all')}_${(end_date||'all')}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    return res.send(csv);
  }

  // 分页 + Summary
  const data = fetchCardTransactions([cardId], { type, start_date, end_date, page, page_size });

  res.json({
    code: 0, msg: 'ok',
    data: {
      card: {
        id: card.id, card_id: card.card_id, card_number: card.card_number,
        status: card.status, available_amount: card.available_amount,
        product_code: card.product_code, label: card.label
      },
      owner: owner ? { id: owner.id, email: owner.email, name: owner.name } : null,
      list: data.rows,
      total: data.total,
      page: data.page,
      pageSize: data.pageSize,
      summary: {
        total_count:  data.totalCount,
        total_auth:   data.totalAuth,
        total_settle: data.totalSettle,
        total_refund: data.totalRefund,
        by_type: data.byTypeMap,
        by_card: data.byCard
      }
    }
  });
});

// 简单 CSV 字段转义
function esc_(v) {
  const s = String(v == null ? '' : v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ── 开卡申请管理 ────────────────────────────────────────────────────────────
/**
 * GET  /api/admin/card-applications         — 查询所有开卡申请（支持 ?status= 过滤）
 * POST /api/admin/card-applications/:id/approve — 审批通过（调 vmcardio 开卡）
 * POST /api/admin/card-applications/:id/reject  — 拒绝申请
 */

// 查询开卡申请列表
router.get('/card-applications', (req, res) => {
  const { status, search } = req.query;
  let where = 'WHERE 1=1';
  const params = [];
  if (status && status !== 'all') {
    where += ' AND a.status = ?';
    params.push(status);
  }
  if (search) {
    where += ' AND (u.name LIKE ? OR u.email LIKE ? OR a.product_code LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term, term);
  }
  const rows = db.prepare(`
    SELECT a.*, u.name as user_name, u.email as user_email,
           (SELECT COUNT(*) FROM card_applications WHERE status='pending') as pending_count,
           (SELECT COUNT(*) FROM card_applications WHERE status='approved') as approved_count,
           (SELECT COUNT(*) FROM card_applications WHERE status='rejected') as rejected_count
    FROM card_applications a
    JOIN users u ON u.id = a.user_id
    ${where}
    ORDER BY a.created_at DESC
    LIMIT 200
  `).all(...params);
  res.json({ code: 0, msg: 'ok', data: rows });
});

// 审批通过 — 调用 vmcardio 创建卡片
router.post('/card-applications/:id/approve', async (req, res, next) => {
  try {
    const { id } = req.params;
    const app = db.prepare('SELECT * FROM card_applications WHERE id = ?').get(id);
    if (!app) return res.status(404).json({ code: 404, msg: '申请记录不存在' });
    if (app.status !== 'pending') return res.status(400).json({ code: 400, msg: '该申请已被处理' });

    const topupAmt = Number(app.topup_amount);
    const qty = Math.max(1, Number(app.quantity) || 1);
    if (topupAmt < 20) return res.status(400).json({ code: 400, msg: '卡内充值金额不能低于 $20' });

    const createdCards = [];
    let lastError = null;

    for (let i = 0; i < qty; i++) {
      try {
        // 姓名中去掉数字（vmcardio 不支持数字）
        const sanitizeName = (name) => (name || '').replace(/[0-9]/g, '').trim() || 'User';

        // 正式环境走 Merchant API：RSA 加密，product_code + amount + first/last_name + user_id
        //   v1.0.7 假设的 Web API (dev.vmcardio.com/web/createCard) 在正式环境不存在
        //   v1.0.15 实测：vmapi.vmcardio.com/createCard + VC102（原 sandbox 名 G5554LC）正式环境可正常开卡
        // v1.0.17: 审批时传商户 KYC 默认账单地址，上游写入 card_address
        let cardBillingAddress = null;
        if (process.env.VMCARDIO_DEFAULT_BILLING_ADDRESS) {
          try { cardBillingAddress = JSON.parse(process.env.VMCARDIO_DEFAULT_BILLING_ADDRESS); } catch {}
        }
        const createParams = {
          product_code: app.product_code || app.card_bin,
          amount:       topupAmt,
          first_name:   sanitizeName(app.first_name),
          last_name:    sanitizeName(app.last_name),
          user_id:      String(app.user_id),
        };
        if (cardBillingAddress) createParams.card_address = cardBillingAddress;
        const result = await sdk.createCard(createParams);
        const realCardId = result.card_id;
        if (!realCardId) {
          throw new Error('上游未返回 card_id');
        }
        // 插入真实 card_id，立即从上游拉取完整信息（卡号/CVV/有效期）
        //   v1.0.15+ 修复：之前没调 cardDetail，导致卡号/CVV/有效期全空，
        //   用户在卡片管理看到 `**** **** **** ****` + `有效期 —`
        let detail = null;
        try {
          detail = await sdk.cardDetail(realCardId);
        } catch (e) {
          logger.warn(`[approve] cardDetail ${realCardId} 失败: ${e.message}（占位记录已写入，可后续同步）`);
        }
        db.prepare(`INSERT INTO cards (card_id, user_id, product_code, available_amount, label, status,
          card_number, expiry_month, expiry_year, cvv, card_type,
          single_limit, day_limit, month_limit, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, nowiso(), nowiso())`).run(
          realCardId, app.user_id, app.product_code || app.card_bin, topupAmt, app.label || 'Virtual Card',
          detail?.card_number || '', detail?.expiry_month || 0, detail?.expiry_year || 0,
          detail?.cvv || '', detail?.card_type || 'save',
          detail?.single_limit || 0, detail?.day_limit || 0, detail?.month_limit || 0
        );
        createdCards.push(realCardId);
      } catch (err) {
        lastError = err;
        break;
      }
      // 避免请求过快
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    if (createdCards.length > 0) {
      db.prepare(`UPDATE card_applications SET card_id = ?, status = 'approved', updated_at = nowiso() WHERE id = ?`)
        .run(createdCards.join(','), id);
      res.json({
        code: 0,
        msg: `已成功创建 ${createdCards.length}/${qty} 张卡片（card_id 已写入本地，详情可点同步按钮拉取）`,
        data: {
          total: qty,
          success: createdCards.length,
          application_id: id,
          card_ids: createdCards,
        }
      });
    } else {
      db.prepare(`UPDATE card_applications SET status = 'rejected', reject_reason = ?, updated_at = nowiso() WHERE id = ?`)
        .run('开卡失败: ' + (lastError?.message || '未知错误'), id);
      // 退还费用
      const totalRefund = (app.fee_amount || 0) + (app.topup_amount || 0) * Math.max(1, Number(app.quantity) || 1);
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(totalRefund, app.user_id);
      logger.info(`[WebCreate] 审批失败已退还 fee+topup $${totalRefund} → user_id=${app.user_id}`);
      res.status(422).json({ code: 422, msg: '开卡失败: ' + (lastError?.message || '未知错误') });
    }
  } catch (err) {
    next(err);
  }
});

// 拒绝申请
router.post('/card-applications/:id/reject', (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const app = db.prepare('SELECT * FROM card_applications WHERE id = ?').get(id);
    if (!app) return res.status(404).json({ code: 404, msg: '申请记录不存在' });
    if (app.status !== 'pending') return res.status(400).json({ code: 400, msg: '该申请已被处理' });

    // 退还开卡费 + 充值冻结金额
    const refund = (app.fee_amount || 0) + (app.topup_amount || 0) * Math.max(1, Number(app.quantity) || 1);
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(refund, app.user_id);
    db.prepare(`UPDATE card_applications SET status = 'rejected', reject_reason = ?, updated_at = nowiso() WHERE id = ?`)
      .run(reason || '管理员拒绝了申请', id);

    res.json({ code: 0, msg: '已拒绝该申请，费用已退还' });
  } catch (err) {
    next(err);
  }
});

// ── 全量同步 ────────────────────────────────────────────────────────────────
/**
 * 遍历本地所有卡（含 deleted 状态），逐一从上游拉取最新状态
 * 上游 DELETED → 本地标记 deleted
 * 上游有效数据 → 更新本地状态
 */
async function syncAllCardsFromUpstream() {
  console.log('[CardSync] 开始同步卡片数据...');
  const startTime = Date.now();
  
  try {
    // 第一步：从上游拉取全量卡片列表，同步到本地
    console.log('[CardSync] 拉取上游全量卡片列表...');
    try {
      const listResult = await sdk.cardList({ pageSize: 200, page: 1 });
      if (listResult && Array.isArray(listResult.list) && listResult.list.length > 0) {
        const upsert = db.prepare(`
          INSERT INTO cards (card_id, user_id, card_number, product_code, status, available_amount, expiry_month, expiry_year, last_verified, verified_status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, nowiso(), 'synced')
          ON CONFLICT(card_id) DO UPDATE SET
            status = excluded.status,
            available_amount = excluded.available_amount,
            last_verified = nowiso(),
            verified_status = 'synced'
        `);
        for (const up of listResult.list) {
          const vmStatus = (up.status || '').toUpperCase();
          const mappedStatus = vmStatus === 'ACTIVE' ? 'active' : vmStatus === 'CANCELLED' ? 'frozen' : 'active';
          upsert.run(
            up.card_id, 2, up.card_number || '',
            up.product_code || '', mappedStatus,
            up.available_amount || 0,
            up.expiry_month || null, up.expiry_year || null
          );
        }
        console.log(`[CardSync] 上游列表同步完成：更新/插入了 ${listResult.list.length} 张卡`);
      }
    } catch (err) {
      console.warn('[CardSync] 上游列表拉取失败，仅同步本地已有卡片:', err.message);
    }

    // 第二步：获取所有本地卡片，逐张同步详细状态
    const cards = db.prepare(`SELECT card_id, status FROM cards ORDER BY updated_at ASC LIMIT 200`).all();
    
    console.log(`[CardSync] 找到 ${cards.length} 张卡片需要详细同步`);
    
    let successCount = 0;
    let failCount = 0;
    
    for (const card of cards) {
      try {
        await syncSingleCard(card.card_id);
        successCount++;
      } catch (err) {
        console.error(`[CardSync] 同步卡片 ${card.card_id} 失败:`, err.message);
        db.prepare(`
          UPDATE cards SET
            last_verified = nowiso(),
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

// =============================================
// Web API 卡片发现：后台尝试补全上游 card_id
// =============================================
async function discoverWebCardIds(applicationId, app, placeholderCardIds) {
  if (!placeholderCardIds || placeholderCardIds.length === 0) return;
  const maxAttempts = 6; // 6 × 3s = 18s 最大轮询
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      // 尝试通过 cardTransaction 发现新卡片（有 card_id 的情况下）
      // 但上游无 cardList 端点，此方法仅尽力而为
      const txResult = await sdk.cardTransaction({ page: 1, pageSize: 200 });
      if (txResult && txResult.list && txResult.list.length > 0) {
        for (const tx of txResult.list) {
          if (tx.card_id && !db.prepare('SELECT 1 FROM cards WHERE card_id = ?').get(tx.card_id)) {
            const matchBin = app.product_code || app.card_bin;
            if (!matchBin || (tx.product_code || '').includes(matchBin)) {
              // 找到匹配的卡片，更新本地记录
              const oldId = placeholderCardIds.shift();
              if (oldId) {
                db.prepare('UPDATE cards SET card_id = ? WHERE card_id = ?').run(tx.card_id, oldId);
                logger.info(`[WebCreate] Card discovered: ${tx.card_id} (was ${oldId})`);
              }
            }
          }
        }
        if (placeholderCardIds.length === 0) return; // 全部找到
      }
    } catch (e) {
      // 静默重试
    }
  }
  if (placeholderCardIds.length > 0) {
    logger.warn(`[WebCreate] ${placeholderCardIds.length} card(s) still undiscovered for application ${applicationId}`);
  }
}

// =============================================
// 手动关联上游 card_id（管理员通过 vmcardio 后台查到的 card_id）
// POST /api/admin/cards/attach-web-id
// =============================================
router.post('/admin/cards/attach-web-id', async (req, res, next) => {
  try {
    const { placeholder_id, real_card_id, real_card_number } = req.body;
    if (!placeholder_id || !real_card_id) {
      return res.status(400).json({ code: 400, msg: '缺少 placeholder_id 或 real_card_id' });
    }
    const card = db.prepare('SELECT * FROM cards WHERE card_id = ?').get(placeholder_id);
    if (!card) {
      return res.status(404).json({ code: 404, msg: '占位卡片不存在' });
    }
    const updateFields = ['card_id = ?'];
    const updateParams = [real_card_id];
    if (real_card_number) {
      updateFields.push('card_number = ?');
      updateParams.push(real_card_number);
    }
    updateParams.push(placeholder_id);
    db.prepare(`UPDATE cards SET ${updateFields.join(', ')} WHERE card_id = ?`).run(...updateParams);
    logger.info(`[WebCreate] Admin manually attached card: ${placeholder_id} -> ${real_card_id}`);
    res.json({ code: 0, msg: '卡片 ID 已更新' });
  } catch (e) {
    next(e);
  }
});

// =============================================
// 系统设置（settings 表读写）
// =============================================

// 读取所有系统设置
router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const data = {};
  rows.forEach(r => { data[r.key] = r.value; });
  res.json({ code: 0, msg: 'ok', data });
});

// 保存系统设置
router.put('/settings', (req, res) => {
  const allowed = ['wallet_trc20','wallet_erc20','wallet_bep20','wallet_sol','usdt_rate','min_topup','topup_notice'];
  const stmt = db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, nowiso()) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=nowiso()");
  const tx = db.transaction(() => {
    for (const key of allowed) {
      if (req.body[key] !== undefined) stmt.run(key, String(req.body[key]));
    }
  });
  tx();
  res.json({ code: 0, msg: '设置已保存' });
});

// =============================================
// 上游费用成本（upstream_fees）
// =============================================

// 获取全部上游费用
router.get('/upstream-fees', (req, res) => {
  const list = db.prepare('SELECT * FROM upstream_fees ORDER BY fee_type').all().map(f => ({
    ...f,
    upstream_rate: f.upstream_rate || 0,
    upstream_fixed: f.upstream_fixed || 0,
    rules: (() => { try { return JSON.parse(f.rules); } catch { return {}; } })()
  }));
  res.json({ code: 0, msg: 'ok', data: list });
});

// 更新某条上游费用
router.put('/upstream-fees/:feeType', (req, res) => {
  const { upstream_rate, upstream_fixed, upstream_rules, notes } = req.body;
  const existing = db.prepare('SELECT * FROM upstream_fees WHERE fee_type = ?').get(req.params.feeType);
  if (!existing) return res.status(404).json({ code: 404, msg: '未找到该费用类型' });
  db.prepare("UPDATE upstream_fees SET upstream_rate=?, upstream_fixed=?, rules=?, notes=?, updated_at=datetime('now') WHERE fee_type=?").run(
    upstream_rate ?? existing.upstream_rate,
    upstream_fixed ?? existing.upstream_fixed,
    upstream_rules || existing.rules,
    notes ?? existing.notes,
    req.params.feeType
  );
  const row = db.prepare('SELECT * FROM upstream_fees WHERE fee_type = ?').get(req.params.feeType);
  res.json({ code: 0, msg: '已更新', data: row });
});

// =============================================
// 公告管理 CRUD
// =============================================

// 获取全部公告
router.get('/announcements', (req, res) => {
  const list = db.prepare('SELECT * FROM announcements ORDER BY created_at DESC').all();
  res.json({ code: 0, msg: 'ok', data: list });
});

// 新增公告
router.post('/announcements', (req, res) => {
  const { title, content, type } = req.body;
  if (!title || !content) return res.status(400).json({ code: 400, msg: '标题和内容不能为空' });
  const info = db.prepare("INSERT INTO announcements (title, content, type, is_active) VALUES (?, ?, ?, 1)").run(title, content, type || '运营公告');
  const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(info.lastInsertRowid);
  res.json({ code: 0, msg: '公告已发布', data: row });
});

// 更新公告
router.put('/announcements/:id', (req, res) => {
  const { title, content, type } = req.body;
  const existing = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ code: 404, msg: '公告不存在' });
  db.prepare("UPDATE announcements SET title=?, content=?, type=?, updated_at=datetime('now') WHERE id=?").run(
    title || existing.title,
    content || existing.content,
    type || existing.type,
    req.params.id
  );
  const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  res.json({ code: 0, msg: '公告已更新', data: row });
});

// 切换公告启用/停用
router.patch('/announcements/:id/toggle', (req, res) => {
  const existing = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ code: 404, msg: '公告不存在' });
  db.prepare("UPDATE announcements SET is_active=?, updated_at=datetime('now') WHERE id=?").run(
    existing.is_active ? 0 : 1,
    req.params.id
  );
  const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  res.json({ code: 0, msg: row.is_active ? '公告已启用' : '公告已停用', data: row });
});

// 删除公告
router.delete('/announcements/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ code: 404, msg: '公告不存在' });
  db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  res.json({ code: 0, msg: '公告已删除' });
});

// ── KYC 企业认证审核 ──────────────────────────────────────────────────

// 获取 KYC 申请列表
router.get('/kyc/list', (req, res) => {
  const status = req.query.status || '';
  let sql = `
    SELECT k.*, u.email, u.name AS user_name
    FROM kyc_applications k
    LEFT JOIN users u ON u.id = k.user_id
  `;
  const params = [];
  if (status) { sql += ' WHERE k.status = ?'; params.push(status); }
  sql += ' ORDER BY k.id DESC';
  res.json({ code: 0, msg: 'ok', data: db.prepare(sql).all(...params) });
});

// 通过 KYC 审核
router.post('/kyc/:id/approve', (req, res) => {
  const app = db.prepare('SELECT * FROM kyc_applications WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ code: 404, msg: '申请不存在' });
  db.prepare("UPDATE kyc_applications SET status = 'approved', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  db.prepare("UPDATE users SET kyc_status = 'approved', updated_at = datetime('now') WHERE id = ?").run(app.user_id);
  res.json({ code: 0, msg: '企业认证已通过' });
});

// 拒绝 KYC 审核
router.post('/kyc/:id/reject', (req, res) => {
  const { reason } = req.body;
  const app = db.prepare('SELECT * FROM kyc_applications WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ code: 404, msg: '申请不存在' });
  db.prepare("UPDATE kyc_applications SET status = 'rejected', reject_reason = ?, updated_at = datetime('now') WHERE id = ?").run(reason || '', req.params.id);
  db.prepare("UPDATE users SET kyc_status = 'rejected', updated_at = datetime('now') WHERE id = ?").run(app.user_id);
  res.json({ code: 0, msg: '企业认证已拒绝', data: { reject_reason: reason || '' } });
});

// v1.0.24 卡段管理 — 列出所有卡段含当前 overrides
router.get('/card-products', async (req, res) => {
  try {
    // 调上游拉卡段列表
    const sdkRes = await sdk.getProductCode();
    const apiList = (sdkRes && Array.isArray(sdkRes.list)) ? sdkRes.list
                   : (sdkRes && sdkRes.data && Array.isArray(sdkRes.data.list)) ? sdkRes.data.list
                   : [];

    // 合并元数据 + overrides
    const allOverrides = new Map(cardProductOverrideService.listAll().map(o => [o.product_code, o]));
    const list = apiList.map(p => {
      const country = normalizeCountry(p.issuing_area);
      const meta = CARD_METADATA.get(p.product_code) || META_BY_BIN_PREFIX6.get(String(p.bin || '').slice(0, 6));
      const ov = allOverrides.get(p.product_code);
      return {
        product_code: p.product_code,
        bin: p.bin,
        network: p.network,
        media: p.media,
        type: p.type,
        issuing_area: p.issuing_area,
        issuing_area_code: country.code,
        issuing_area_name: country.name,
        issuing_area_flag: country.flag,
        remaining_open_card_num: p.remaining_open_card_num,
        // docx 静态值
        docx_platforms: meta?.applicable_platforms || null,
        card_level:    meta?.meta?.card_level || null,
        single_limit:  meta?.meta?.single_limit || null,
        daily_limit:   meta?.meta?.daily_limit || null,
        // DB override（管理员设置）
        available:             ov ? !!ov.available : true,
        applicable_platforms:  ov ? ov.applicable_platforms : null,  // null=沿用 docx
        custom_message:        ov ? ov.custom_message : null,
        updated_at:            ov ? ov.updated_at : null,
        updated_by:            ov ? ov.updated_by : null,
      };
    });

    res.json({ code: 0, msg: 'ok', data: { list, count: list.length } });
  } catch (e) {
    console.error('[admin/card-products] error:', e);
    res.status(500).json({ code: 500, msg: '获取卡段列表失败: ' + e.message });
  }
});

// v1.0.24 卡段管理 — 更新单个卡段的 overrides
router.put('/card-products/:productCode', (req, res) => {
  const { productCode } = req.params;
  const { available, applicable_platforms, custom_message } = req.body || {};

  // 校验 product_code 存在
  const upper = String(productCode).toUpperCase();

  // 校验
  if (available !== undefined && ![0, 1, true, false].includes(available)) {
    return res.status(400).json({ code: 400, msg: 'available 必须是 0/1/true/false' });
  }
  if (applicable_platforms !== undefined && applicable_platforms !== null) {
    if (!Array.isArray(applicable_platforms)) {
      return res.status(400).json({ code: 400, msg: 'applicable_platforms 必须是数组' });
    }
    if (applicable_platforms.some(p => typeof p !== 'string' || !p.trim())) {
      return res.status(400).json({ code: 400, msg: 'applicable_platforms 元素必须是非空字符串' });
    }
    if (applicable_platforms.length > 50) {
      return res.status(400).json({ code: 400, msg: '适用平台最多 50 个' });
    }
  }
  if (custom_message !== undefined && custom_message !== null && typeof custom_message !== 'string') {
    return res.status(400).json({ code: 400, msg: 'custom_message 必须是字符串' });
  }
  if (custom_message && custom_message.length > 500) {
    return res.status(400).json({ code: 400, msg: 'custom_message 最长 500 字符' });
  }

  try {
    // v1.0.58 fix: 未传的字段不进 patch, 让 upsert 走"保留原值"分支
    // 之前填成 null 会让 upsert 把 DB 里的 platforms/custom_message 误清空
    const patch = {};
    if (available !== undefined) {
      patch.available = available ? 1 : 0;
    } else {
      patch.available = 1;  // INSERT 时无 existing, 需要默认值
    }
    if (applicable_platforms !== undefined) {
      patch.applicable_platforms = Array.isArray(applicable_platforms) ? applicable_platforms : null;
    }
    // 不传 applicable_platforms 时不写该字段 → upsert 保留旧值
    if (custom_message !== undefined) {
      patch.custom_message = custom_message || null;
    }
    // 不传 custom_message 时不写该字段 → upsert 保留旧值
    cardProductOverrideService.upsert(upper, patch, req.user?.email || null);
    const ov = cardProductOverrideService.get(upper);
    res.json({ code: 0, msg: 'ok', data: ov });
  } catch (e) {
    console.error('[admin/card-products PUT] error:', e);
    res.status(500).json({ code: 500, msg: '更新失败: ' + e.message });
  }
});

// v1.0.24 卡段管理 — 重置单个卡段的 overrides（回到 HARDCODED/docx 默认）
router.delete('/card-products/:productCode/override', (req, res) => {
  const upper = String(req.params.productCode).toUpperCase();
  cardProductOverrideService.remove(upper);
  res.json({ code: 0, msg: 'ok' });
});

module.exports = router;
// ── 异常消费告警 ─────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/admin/anomaly-alerts:
 *   get:
 *     summary: 获取异常消费告警汇总（管理员）
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 告警列表 + 汇总 + 各用户未读数
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code: { type: integer, example: 0 }
 *                 data:
 *                   type: object
 *                   properties:
 *                     alerts:        { type: array, items: { $ref: '#/components/schemas/AnomalyAlert' } }
 *                     summary:      { type: object }
 *                     total_alerts:  { type: integer }
 *                     unread_by_user: { type: array, items: { type: object } }
 */
router.get('/anomaly-alerts', (req, res) => {
  try {
    const db = require('../db');

    // 最近 20 条告警
    const logRow = db.prepare("SELECT value FROM settings WHERE key='anomaly_alerts_log'").get();
    const alerts = logRow ? (JSON.parse(logRow.value) || []) : [];

    // 汇总
    const summaryRow = db.prepare("SELECT value FROM settings WHERE key='anomaly_alert_summary'").get();
    const summary = summaryRow ? (JSON.parse(summaryRow.value) || null) : null;

    // 未读站内信数量
    const unread = db.prepare(`
      SELECT user_id, COUNT(*) as c FROM notifications
      WHERE is_read = 0 GROUP BY user_id
    `).all();

    res.json({
      code: 0,
      msg: 'ok',
      data: {
        alerts,
        summary,
        unread_by_user: unread,
        total_alerts: alerts.length,
      }
    });
  } catch (e) {
    res.status(500).json({ code: 500, msg: e.message });
  }
});

// 更新告警阈值
/**
 * @swagger
 * /api/admin/anomaly-thresholds:
 *   post:
 *     summary: 更新异常告警阈值
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               single:  { type: number,  description: '单笔阈值 USD',   example: 200 }
 *               hourly:  { type: number,  description: '1 小时累计 USD', example: 500 }
 *               daily:   { type: number,  description: '24 小时累计 USD', example: 2000 }
 *               strict:  { type: boolean, description: '是否启用严格模式' }
 *     responses:
 *       200:
 *         description: 当前生效的阈值
 */
router.post('/anomaly-thresholds', (req, res) => {
  try {
    const db = require('../db');
    const { single, hourly, daily, strict } = req.body || {};
    const setSetting = (key, value) => {
      db.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value
      `).run(key, String(value));
    };
    if (single !== undefined) setSetting('anomaly_single_usd', Number(single));
    if (hourly !== undefined) setSetting('anomaly_hourly_usd', Number(hourly));
    if (daily !== undefined)  setSetting('anomaly_daily_usd', Number(daily));
    if (strict !== undefined) setSetting('anomaly_enable_strict', strict ? 'true' : 'false');

    const anomalyAlert = require('../services/anomalyAlert');
    res.json({ code: 0, msg: 'ok', data: { thresholds: anomalyAlert.getThresholds() } });
  } catch (e) {
    res.status(500).json({ code: 500, msg: e.message });
  }
});

// 列出某用户的告警站内信
/**
 * @swagger
 * /api/admin/notifications/{userId}:
 *   get:
 *     summary: 列出某用户的告警站内信
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 站内信列表（最近 50 条）
 */
router.get('/notifications/:userId', (req, res) => {
  try {
    const db = require('../db');
    const list = db.prepare(`
      SELECT * FROM notifications WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 50
    `).all(req.params.userId);
    res.json({ code: 0, msg: 'ok', data: list });
  } catch (e) {
    res.status(500).json({ code: 500, msg: e.message });
  }
});
