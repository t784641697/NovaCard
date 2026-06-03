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
                  updated_at = datetime('now'),
                  last_verified = datetime('now'),
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
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'verified')
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
                last_verified = datetime('now'),
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
        updated_at = datetime('now'),
        last_verified = datetime('now'),
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
    cardId
  );

  return { synchronized: true, upstream_status: detail.status, local_status: mappedStatus };
}

// ── 获取商户实时余额 ────────────────────────────────────────────────────────
router.get('/merchant-balance', async (req, res, next) => {
  try {
    const result = await sdk.getAccountBalance();
    const balanceData = result?.data || {};
    res.json({
      code: 0,
      msg:  'ok',
      data: {
        balance: balanceData.balance || balanceData.availableBalance || 0,
        currency: balanceData.currency || 'USD',
        updated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.warn('[merchant-balance] 获取失败: ' + err.message);
    res.json({
      code: 0,
      msg:  'ok',
      data: {
        balance: 0,
        currency: 'USD',
        updated_at: new Date().toISOString(),
        error: err.message,
      },
    });
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
            UPDATE cards SET status = ?, available_amount = ?, last_verified = datetime('now'),
              verified_status = 'verified', verification_error = NULL
            WHERE card_id = ?
          `).run(mappedStatus, card.available_amount || 0, card.card_id);
        } else {
          db.prepare(`
            INSERT OR IGNORE INTO cards (card_id, user_id, card_number, product_code, status, available_amount, last_verified, verified_status)
            VALUES (?, 2, ?, ?, ?, ?, datetime('now'), 'verified')
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

// ── 卡片列表（含上游同步） ──────────────────────────────────────────────────
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
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'synced')
            ON CONFLICT(card_id) DO UPDATE SET
              status = excluded.status,
              available_amount = excluded.available_amount,
              last_verified = datetime('now'),
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
            updated_at = datetime('now'),
            last_verified = datetime('now'),
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
            updated_at = datetime('now'),
            last_verified = datetime('now'),
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
          last_verified = datetime('now'),
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

        const result = await sdk.webCreateCard({
          bin:               app.product_code || app.card_bin,
          amount:            topupAmt,
          create_num:        1,
          customize_name:    sanitizeName(app.first_name),
          customize_last_name: sanitizeName(app.last_name),
          bind_uid:          22123,
          user_name:         'taoliang.light@gmail.com',
          alias:             app.label || '',
        });
        // 立即创建本地卡片记录，用户可立即看到此卡
        const localCardId = `WEB-${app.product_code || app.card_bin || app.product_code}-${Date.now()}-${i}`;
        db.prepare(`INSERT INTO cards (card_id, user_id, product_code, available_amount, label, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))`).run(
          localCardId, app.user_id, app.product_code || app.card_bin, topupAmt, app.label || 'Web Card'
        );
        createdCards.push(localCardId);
      } catch (err) {
        lastError = err;
        break;
      }
      // 避免请求过快
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    if (createdCards.length > 0) {
      db.prepare(`UPDATE card_applications SET card_id = ?, status = 'approved', updated_at = datetime('now') WHERE id = ?`)
        .run(createdCards.join(','), id);
      // 后台异步发现：尝试补齐上游 card_id（非阻塞）
      discoverWebCardIds(id, app, createdCards).catch(err => {
        logger.error('[WebCreate] Card discovery error:', err.message);
      });
      res.json({
        code: 0,
        msg: `已成功提交 ${createdCards.length}/${qty} 张卡片的开卡请求（异步处理，约10-20秒完成），请稍后同步卡片列表查看`,
        data: { total: qty, success: createdCards.length, application_id: id }
      });
    } else {
      db.prepare(`UPDATE card_applications SET status = 'rejected', reject_reason = ?, updated_at = datetime('now') WHERE id = ?`)
        .run('开卡失败: ' + (lastError?.message || '未知错误'), id);
      // 退还费用
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(app.fee_amount, app.user_id);
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
    db.prepare(`UPDATE card_applications SET status = 'rejected', reject_reason = ?, updated_at = datetime('now') WHERE id = ?`)
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
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'synced')
          ON CONFLICT(card_id) DO UPDATE SET
            status = excluded.status,
            available_amount = excluded.available_amount,
            last_verified = datetime('now'),
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

module.exports = router;