/**
 * 全局交易记录路由
 * GET /api/transactions — 查询所有卡的交易记录（带筛选）
 * GET /api/transactions/export.csv — 导出交易记录为 CSV
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

/**
 * GET /api/transactions — 查本地 card_transactions 表（与 export.csv 数据源一致）
 * 支持 card_id / transaction_type / status / start_time / end_time / page / page_size
 * 鉴权：管理员看全部，普通用户只看自己卡的
 */
router.get('/', async (req, res, next) => {
  try {
    const userId  = req.user.id;
    const isAdmin = req.user.role === 'admin';

    // 自动触发上游交易同步（10分钟内不重复同步，15秒超时）
    const _lastSync = transactionsRoute._lastSync || 0;
    const SYNC_INTERVAL = 10 * 60 * 1000; // 10 minutes
    if (Date.now() - _lastSync > SYNC_INTERVAL) {
      try {
        const { syncTransactions } = require('../services/transactionSyncService');
        await Promise.race([
          syncTransactions(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('sync timeout')), 15000))
        ]);
        transactionsRoute._lastSync = Date.now();
      } catch (syncErr) {
        require('../utils/logger').warn('[transactions] sync skipped:', syncErr.message);
      }
    }

    const where = [];
    const args  = [];

    if (req.query.card_id) { where.push('t.card_id = ?'); args.push(req.query.card_id); }
    if (!isAdmin) {
      // 用子查询获取用户所有 card_id（含已删除卡），避免 LEFT JOIN 丢失孤儿交易
      const userCardIds = db.prepare('SELECT card_id FROM cards WHERE user_id = ?').all(userId).map(r => r.card_id);
      if (userCardIds.length) {
        const placeholders = userCardIds.map(() => '?').join(',');
        where.push(`t.card_id IN (${placeholders})`);
        args.push(...userCardIds);
      } else {
        where.push('1=0'); // 无卡则无交易
      }
    }
    if (req.query.transaction_type) { where.push('t.type = ?'); args.push(req.query.transaction_type); }
    if (req.query.status)           { where.push('t.status = ?'); args.push(req.query.status); }
    if (req.query.start_time)       { where.push('t.create_time >= ?'); args.push(req.query.start_time); }
    if (req.query.end_time)         { where.push('t.create_time <= ?'); args.push(req.query.end_time); }

    const page      = Math.max(1, parseInt(req.query.page)      || 1);
    const pageSize  = Math.min(999, Math.max(1, parseInt(req.query.page_size) || 20));
    const offset    = (page - 1) * pageSize;

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = db.prepare(`SELECT COUNT(*) c FROM card_transactions t LEFT JOIN cards c ON c.card_id = t.card_id ${whereSql}`).get(...args).c;
    const rows  = db.prepare(`
      SELECT t.id, t.auth_id, t.card_id, c.card_number, t.type, t.status,
             t.auth_amount, t.auth_currency, t.settle_amount, t.settle_currency,
             t.merchant_name, t.create_time, t.auth_time, t.sync_time,
             t.auth_amount AS amount, t.auth_currency AS currency
      FROM card_transactions t
      LEFT JOIN cards c ON c.card_id = t.card_id
      ${whereSql}
      ORDER BY t.create_time DESC
      LIMIT ? OFFSET ?
    `).all(...args, pageSize, offset);

    res.json({ code: 0, msg: 'ok', data: { list: rows, total, page, page_size: pageSize } });
  } catch (err) { next(err); }
});

/**
 * GET /api/transactions/export.csv
 * Query: dateFrom, dateTo, status, type, card_id, limit(<=10000)
 * Permission: 管理员看全部; 用户只能看自己的卡
 */
/**
 * @swagger
 * /api/transactions/export.csv:
 *   get:
 *     summary: 导出交易记录为 CSV
 *     tags: [Transactions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: dateTo
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [COMPLETE, DECLINED, PENDING] }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [Authorization, Settlement, Refund, Reversal] }
 *       - in: query
 *         name: card_id
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10000, maximum: 50000 }
 *     responses:
 *       200:
 *         description: CSV 文件 (UTF-8 BOM, 含表头)
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *               example: |
 *                 时间,卡ID,卡号,类型,状态,...
 *                 2026-06-17 10:00:00,...
 */
router.get('/export.csv', (req, res) => {
  try {
    const userId  = req.user.id;
    const isAdmin = req.user.role === 'admin';
    const { dateFrom, dateTo, status, type, card_id } = req.query;
    const limit   = Math.min(parseInt(req.query.limit) || 10000, 50000);

    // 构造查询
    const where = [];
    const args  = [];
    if (!isAdmin) {
      // 普通用户只能看自己卡的交易
      where.push('c.user_id = ?');
      args.push(userId);
    }
    if (card_id) { where.push('t.card_id = ?'); args.push(card_id); }
    if (status)  { where.push('t.status  = ?'); args.push(status); }
    if (type)    { where.push('t.type    = ?'); args.push(type); }
    if (dateFrom){ where.push('t.create_time >= ?'); args.push(dateFrom); }
    if (dateTo)  { where.push('t.create_time <= ?'); args.push(dateTo); }

    const sql = `
      SELECT t.create_time, t.card_id, c.card_number, t.type, t.status,
             t.auth_amount, t.auth_currency, t.settle_amount, t.settle_currency,
             t.merchant_name, t.auth_time
      FROM card_transactions t
      LEFT JOIN cards c ON c.card_id = t.card_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY t.create_time DESC
      LIMIT ?
    `;
    args.push(limit);
    const rows = db.prepare(sql).all(...args);

    // CSV 转义：字段含 , " \n 时加双引号，内部 " 加两个
    const esc = v => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    // 类型/状态 英文 → 中文（与前端 UI 一致）
    const TYPE_ZH   = { Authorization: '消费授权', Settlement: '清算', Refund: '退款', Reversal: '撤销' };
    const STATUS_ZH = { COMPLETE: '完成', PENDING: '清算中', DECLINED: '失败' };

    const header = ['时间', '卡ID', '卡号', '类型', '状态', '授权金额', '授权币种', '结算金额', '结算币种', '商户', '授权时间'];
    const lines = [header.map(esc).join(',')];
    for (const r of rows) {
      lines.push([
        r.create_time, r.card_id,
        r.card_number ? `****${String(r.card_number).slice(-4)}` : '',
        TYPE_ZH[r.type] || r.type,
        STATUS_ZH[r.status] || r.status,
        r.auth_amount, r.auth_currency,
        r.settle_amount, r.settle_currency,
        r.merchant_name, r.auth_time,
      ].map(esc).join(','));
    }

    // 加 BOM 让 Excel 正确识别 UTF-8
    const csv = '\uFEFF' + lines.join('\r\n');

    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
    const fname = `transactions_${ts}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Export-Count', rows.length);
    res.send(csv);
  } catch (e) {
    res.status(500).json({ code: 500, msg: e.message });
  }
});

module.exports = router;
