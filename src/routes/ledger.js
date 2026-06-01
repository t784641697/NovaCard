/**
 * 账户流水路由
 * GET /api/ledger — 查询当前用户的余额变动记录（本地 transactions 表）
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// GET /api/ledger?page_size=50
router.get('/', (req, res, next) => {
  try {
    const userId = req.user.id;
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.page_size) || 50));
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const offset = (page - 1) * pageSize;

    // 查询当前余额
    const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ code: 404, msg: '用户不存在' });
    }

    // 查询交易记录（按时间倒序）
    const rows = db.prepare(`
      SELECT id, type, amount, net_amount, fee_type, fee_amount, description, ref_id, created_at
      FROM transactions
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(userId, pageSize, offset);

    // 查询总数
    const total = db.prepare(`
      SELECT COUNT(*) as cnt FROM transactions WHERE user_id = ?
    `).get(userId).cnt;

    // 计算每笔交易时的余额（从当前余额倒推）
    let runningBalance = user.balance;
    const items = rows.map(row => {
      const balance = parseFloat(runningBalance.toFixed(2));
      // 逆向推算：前一笔交易后的余额 = 当前余额 - 当前交易的净变动额
      runningBalance -= row.net_amount;
      return {
        id: row.id,
        type: row.type,
        amount: row.net_amount,
        fee_type: row.fee_type,
        fee_amount: row.fee_amount,
        description: row.description,
        created_at: row.created_at,
        currency: 'USD',
        balance: balance,
      };
    });

    res.json({
      code: 0, msg: 'ok',
      data: {
        list: items,
        total,
        page,
        page_size: pageSize,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;