const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * GET /api/settlements - 查本地 card_transactions 表 (type=Settlement)
 * 与 /api/transactions 数据源一致
 * Query: page, page_size, card_id, status, start_time, end_time
 * 鉴权：管理员看全部，普通用户只看自己卡的
 */
router.get('/', authenticate, (req, res) => {
  try {
    const userId  = req.user.id;
    const isAdmin = req.user.role === 'admin';
    const where = ['t.type = ?'];
    const args  = ['Settlement'];

    if (req.query.card_id) { where.push('t.card_id = ?'); args.push(req.query.card_id); }
    if (!isAdmin)          { where.push('c.user_id = ?'); args.push(userId); }
    if (req.query.status)  { where.push('t.status = ?'); args.push(req.query.status); }
    if (req.query.start_time) { where.push('t.create_time >= ?'); args.push(req.query.start_time); }
    if (req.query.end_time)   { where.push('t.create_time <= ?'); args.push(req.query.end_time); }

    const page     = Math.max(1, parseInt(req.query.page)      || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.page_size) || 50));
    const offset   = (page - 1) * pageSize;

    const whereSql = 'WHERE ' + where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) c FROM card_transactions t LEFT JOIN cards c ON c.card_id = t.card_id ${whereSql}`).get(...args).c;
    const rows  = db.prepare(`
      SELECT t.id, t.auth_id, t.card_id, c.card_number, t.type, t.status,
             t.auth_amount, t.auth_currency, t.settle_amount, t.settle_currency,
             t.merchant_name, t.create_time, t.auth_time, t.sync_time
      FROM card_transactions t
      LEFT JOIN cards c ON c.card_id = t.card_id
      ${whereSql}
      ORDER BY t.create_time DESC
      LIMIT ? OFFSET ?
    `).all(...args, pageSize, offset);

    res.json({ code: 0, msg: 'ok', data: { list: rows, total, page, page_size: pageSize } });
  } catch (err) {
    logger.error(`[settlements] 查询结算记录失败: ${err.message}`);
    res.status(500).json({ code: 500, msg: `获取结算记录失败: ${err.message}` });
  }
});

module.exports = router;