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

    // 动态 WHERE (v1.0.99.6 加 t. 前缀避免 JOIN cards 后 user_id 歧义)
    const where = ['t.user_id = ?'];
    const args = [userId];
    if (dateFrom) { where.push('t.created_at >= ?'); args.push(dateFrom + ' 00:00:00'); }
    if (dateTo)   { where.push('t.created_at <= ?'); args.push(dateTo   + ' 23:59:59'); }
    if (type)     { where.push('t.type = ?');         args.push(type); }
    const whereSql = 'WHERE ' + where.join(' AND ');

    // 查询交易记录（按时间倒序）
    // v1.0.99.6: LEFT JOIN cards 拿 card_number，前端展示「关联卡号」列
    const rows = db.prepare(`
      SELECT t.id, t.type, t.amount, t.net_amount, t.fee_type, t.fee_amount,
             t.description, t.ref_id, t.created_at,
             c.card_number, c.product_code, c.label
      FROM transactions t
      LEFT JOIN cards c ON c.card_id = t.ref_id
      ${whereSql}
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...args, pageSize, offset);

    // 查询总数 (v1.0.99.6 同步加 t. 别名, 因为 whereSql 含 t. 前缀)
    const total = db.prepare(`
      SELECT COUNT(*) as cnt FROM transactions t ${whereSql}
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
        ref_id: row.ref_id,
        card_number: row.card_number || '',     // v1.0.99.6: 关联卡号（LEFT JOIN，未关联时为空串）
        product_code: row.product_code || '',
        label: row.label || '',
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

// GET /api/ledger/export.csv?dateFrom=...&dateTo=...&type=...
router.get('/export.csv', (req, res, next) => {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';
    const { dateFrom, dateTo, type } = req.query;
    const limit = Math.min(50000, parseInt(req.query.limit) || 50000);

    const where = [];
    const args = [];
    if (!isAdmin) { where.push('t.user_id = ?'); args.push(userId); }
    // v1.0.99.14: created_at 是 ISO 8601 UTC (2026-06-18T06:23:35.720Z),
    // 字符串比较 'YYYY-MM-DD HH:MM:SS' 会因 'T' > ' ' 字符序错乱。
    // 改用 SQLite date() 函数自动解析 ISO 字符串头 10 位 YYYY-MM-DD
    if (dateFrom) { where.push('date(t.created_at) >= ?'); args.push(dateFrom); }
    if (dateTo)   { where.push('date(t.created_at) <= ?'); args.push(dateTo); }
    if (type)     { where.push('t.type = ?');         args.push(type); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    // v1.0.99.14: 关联卡号列 (LEFT JOIN cards) 跟用户版统一
    const rows = db.prepare(`
      SELECT t.id, t.user_id, t.type, t.amount, t.fee_type, t.fee_amount, t.net_amount,
             t.description, t.ref_id, t.created_at,
             c.card_number, c.product_code, c.label
      FROM transactions t
      LEFT JOIN cards c ON c.card_id = t.ref_id
      ${whereSql}
      ORDER BY t.created_at DESC
      LIMIT ?
    `).all(...args, limit);

    // CSV 转义 (RFC 4180)
    const esc = v => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    // v1.0.99.14: 普通用户卡号 masked 16 位 (**** **** **** 3750), admin 保留原始
    const maskCard = cn => {
      if (!cn || cn.length < 4) return cn || '';
      return '**** **** **** ' + cn.slice(-4);
    };

    // 手续费类型中文映射 (fee_type 英文 key → 中文)
    const FEE_TYPE_MAP = {
      'card_creation': '开卡费',
      'topup': '入账手续费',
      'transaction': '交易手续费',
      'refund': '退款手续费',
      'chargeback': '拒付手续费',
      'cross_border': '跨境交易费',
      'small_transaction': '小额授权费',
      'withdrawal': '提现手续费',
      'auth_reversal': '撤销手续费',
      'management': '管理费',
      'card_recharge': '卡充值',
      'card_recharge_refund': '卡充值退款',
    };
    const feeTypeLabel = ft => FEE_TYPE_MAP[ft] || ft || '—';

    const lines = ['时间,类型,变动金额,手续费类型,手续费,到账金额,关联卡号,说明'];
    rows.forEach(r => {
      lines.push([
        esc(r.created_at), esc(r.type),
        esc(r.amount), esc(feeTypeLabel(r.fee_type)), esc(r.fee_amount || 0),
        esc(r.net_amount),
        esc(isAdmin ? (r.card_number || '') : maskCard(r.card_number)),
        esc(r.description || '')
      ].join(','));
    });

    const csv = '\uFEFF' + lines.join('\r\n');  // BOM 防 Excel 乱码
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
    res.setHeader('Content-Disposition', `attachment; filename="ledger_${ts}.csv"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Export-Count', rows.length);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

module.exports = router;