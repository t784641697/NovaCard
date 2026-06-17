/**
 * 账户流水路由
 * GET /api/ledger — 查询当前用户的余额变动记录（本地 transactions 表）
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// GET /api/ledger?page_size=50&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&type=充值
router.get('/', (req, res, next) => {
  try {
    const userId = req.user.id;
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.page_size) || 50));
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const offset = (page - 1) * pageSize;
    const { dateFrom, dateTo, type } = req.query;

    // 查询当前余额
    const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ code: 404, msg: '用户不存在' });
    }

    // 动态 WHERE
    const where = ['user_id = ?'];
    const args = [userId];
    if (dateFrom) { where.push('created_at >= ?'); args.push(dateFrom + ' 00:00:00'); }
    if (dateTo)   { where.push('created_at <= ?'); args.push(dateTo   + ' 23:59:59'); }
    if (type)     { where.push('type = ?');         args.push(type); }
    const whereSql = 'WHERE ' + where.join(' AND ');

    // 查询交易记录（按时间倒序）
    const rows = db.prepare(`
      SELECT id, type, amount, net_amount, fee_type, fee_amount, description, ref_id, created_at
      FROM transactions
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(...args, pageSize, offset);

    // 查询总数
    const total = db.prepare(`
      SELECT COUNT(*) as cnt FROM transactions ${whereSql}
    `).get(...args).cnt;

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

/**
 * GET /api/ledger/export.csv — 导出账户流水为 CSV
 * Query: dateFrom, dateTo, type, limit(<=50000)
 * Permission: 当前用户（自动按 user_id 隔离）
 */
router.get('/export.csv', (req, res) => {
  try {
    const userId = req.user.id;
    const { dateFrom, dateTo, type } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 10000, 50000);

    const where = ['user_id = ?'];
    const args = [userId];
    if (dateFrom) { where.push('created_at >= ?'); args.push(dateFrom + ' 00:00:00'); }
    if (dateTo)   { where.push('created_at <= ?'); args.push(dateTo   + ' 23:59:59'); }
    if (type)     { where.push('type = ?');         args.push(type); }
    const whereSql = 'WHERE ' + where.join(' AND ');

    const rows = db.prepare(`
      SELECT id, type, net_amount, fee_type, fee_amount, description, ref_id, created_at
      FROM transactions
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...args, limit);

    // CSV 转义 (RFC 4180)
    const esc = v => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const feeTypeMap = {
      small_transaction: '小额授权费', cross_border: '跨境交易费',
      card_creation: '开卡费', topup: '充值费', refund: '退款手续费',
      transaction: '交易手续费', chargeback: '拒付手续费',
      withdrawal: '提现手续费', auth_reversal: '撤销手续费',
      management: '管理费', card_monthly: '卡月费'
    };
    const header = ['交易时间', '交易类型', '净变动金额', '费用类型', '手续费', '描述', '关联ID'];
    const lines = [header.map(esc).join(',')];
    for (const r of rows) {
      lines.push([
        r.created_at,
        r.type,
        r.net_amount,
        r.fee_type ? (feeTypeMap[r.fee_type] || r.fee_type) : '',
        r.fee_amount != null ? r.fee_amount : '',
        r.description,
        r.ref_id,
      ].map(esc).join(','));
    }

    const csv = '\uFEFF' + lines.join('\r\n');
    const fname = `ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.setHeader('X-Export-Count', rows.length);
    res.send(csv);
  } catch (e) {
    res.status(500).json({ code: 500, msg: e.message });
  }
});

// GET /api/ledger/export.csv?dateFrom=...&dateTo=...&type=...
router.get('/export.csv', (req, res, next) => {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';
    const { dateFrom, dateTo, type } = req.query;
    const limit = Math.min(50000, parseInt(req.query.limit) || 50000);

    const where = [];
    const args = [];
    if (!isAdmin) { where.push('user_id = ?'); args.push(userId); }
    if (dateFrom) { where.push('created_at >= ?'); args.push(dateFrom + ' 00:00:00'); }
    if (dateTo)   { where.push('created_at <= ?'); args.push(dateTo   + ' 23:59:59'); }
    if (type)     { where.push('type = ?');         args.push(type); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const rows = db.prepare(`
      SELECT id, user_id, type, amount, fee_type, fee_amount, net_amount, description, ref_id, created_at
      FROM transactions
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...args, limit);

    // CSV 转义 (RFC 4180)
    const esc = v => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = ['时间,用户ID,类型,变动金额,手续费类型,手续费,到账金额,说明,关联ID'];
    rows.forEach(r => {
      lines.push([
        esc(r.created_at), esc(r.user_id), esc(r.type),
        esc(r.amount), esc(r.fee_type || ''), esc(r.fee_amount || 0),
        esc(r.net_amount), esc(r.description || ''), esc(r.ref_id || '')
      ].join(','));
    });

    const csv = '\uFEFF' + lines.join('\r\n');  // BOM 防 Excel 乱码
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ledger-${new Date().toISOString().slice(0,10)}.csv"`);
    res.setHeader('X-Export-Count', rows.length);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

module.exports = router;