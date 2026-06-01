/**
 * 充值申请路由
 *
 * POST /api/topup          - 用户提交充值申请
 * GET  /api/topup          - 用户查询自己的申请记录
 * GET  /api/topup/admin    - 管理员查看所有申请（requireAdmin）
 * PATCH /api/topup/:id     - 管理员审批（approve / reject）
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.use(authenticate);

// ── 用户提交充值申请 ──────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { network, amount_usdt, txhash, remark } = req.body;

    if (!network) {
      return res.status(400).json({ code: 400, msg: '请选择充值网络' });
    }

    const info = db.prepare(`
      INSERT INTO topup_requests (user_id, network, amount_usdt, txhash, remark)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      network,
      Number(amount_usdt) || 0,
      txhash  || '',
      remark  || ''
    );

    res.status(201).json({
      code: 0,
      msg: '充值申请已提交，请等待管理员审核',
      data: { id: info.lastInsertRowid }
    });
  } catch (err) {
    next(err);
  }
});

// ── 用户查询自己的申请记录 ─────────────────────────────────────────────────
router.get('/', (req, res, next) => {
  try {
    const page      = parseInt(req.query.page)      || 1;
    const page_size = parseInt(req.query.page_size) || 20;
    const offset    = (page - 1) * page_size;

    const total = db.prepare('SELECT COUNT(*) as cnt FROM topup_requests WHERE user_id = ?').get(req.user.id).cnt;
    const rows  = db.prepare(`
      SELECT id, network, amount_usdt, txhash, remark, status, created_at, updated_at
      FROM topup_requests
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(req.user.id, page_size, offset);

    res.json({ code: 0, msg: 'ok', data: { total, list: rows } });
  } catch (err) {
    next(err);
  }
});

// ── 用户：获取入账汇总（已审批通过的充值总额） ──────────────────────────────
router.get('/summary', (req, res, next) => {
  try {
    const row = db.prepare(`
      SELECT COALESCE(SUM(amount_usdt), 0) as total_approved
      FROM topup_requests
      WHERE user_id = ? AND status = 'approved'
    `).get(req.user.id);
    res.json({ code: 0, msg: 'ok', data: { total_approved: Number(row.total_approved) } });
  } catch (err) {
    next(err);
  }
});

// ── 用户：更新充值金额（仅 pending 状态可改） ──────────────────────────────
router.patch('/:id/amount', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { amount_usdt } = req.body;

    const amt = Number(amount_usdt);
    if (!amt || amt <= 0) {
      return res.status(400).json({ code: 400, msg: '请输入有效金额（> 0）' });
    }

    const row = db.prepare('SELECT * FROM topup_requests WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!row) return res.status(404).json({ code: 404, msg: '记录不存在' });
    if (row.status !== 'pending') return res.status(400).json({ code: 400, msg: '只能修改待处理的申请' });

    db.prepare(`
      UPDATE topup_requests SET amount_usdt = ?, updated_at = datetime('now') WHERE id = ?
    `).run(amt, id);

    res.json({ code: 0, msg: '金额已更新', data: { id, amount_usdt: amt } });
  } catch (err) {
    next(err);
  }
});

// ── 管理员：查看所有申请 ──────────────────────────────────────────────────
router.get('/admin', requireAdmin, (req, res, next) => {
  try {
    const status    = req.query.status    || '';
    const page      = parseInt(req.query.page)      || 1;
    const page_size = parseInt(req.query.page_size) || 20;
    const offset    = (page - 1) * page_size;

    const where = status ? 'WHERE t.status = ?' : '';
    const args  = status ? [status, page_size, offset] : [page_size, offset];

    const total = db.prepare(`SELECT COUNT(*) as cnt FROM topup_requests t ${where}`).get(...(status ? [status] : [])).cnt;
    const rows  = db.prepare(`
      SELECT t.id, t.network, t.amount_usdt, t.txhash, t.remark, t.status,
             t.created_at, t.updated_at,
             u.email as user_email, u.name as user_name
      FROM topup_requests t
      LEFT JOIN users u ON u.id = t.user_id
      ${where}
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...args);

    res.json({ code: 0, msg: 'ok', data: { total, list: rows } });
  } catch (err) {
    next(err);
  }
});

// ── 管理员：审批申请 ──────────────────────────────────────────────────────
router.patch('/:id', requireAdmin, (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, note } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ code: 400, msg: 'status 必须为 approved 或 rejected' });
    }

    const row = db.prepare('SELECT * FROM topup_requests WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ code: 404, msg: '申请不存在' });
    if (row.status !== 'pending') return res.status(400).json({ code: 400, msg: '该申请已处理' });

    db.prepare(`
      UPDATE topup_requests SET status = ?, remark = ?, updated_at = datetime('now') WHERE id = ?
    `).run(status, note || row.remark, id);

    // 审批通过：自动入账用户余额
    if (status === 'approved' && row.amount_usdt > 0) {
      // 读取 USDT 汇率（默认 1:1）
      const rateRow = db.prepare("SELECT value FROM settings WHERE key = 'usdt_rate'").get();
      const rate = rateRow ? (parseFloat(rateRow.value) || 1) : 1;
      const usdAmount = parseFloat((row.amount_usdt * rate).toFixed(2));
      db.prepare(`
        UPDATE users SET balance = ROUND(balance + ?, 2), topup_total = ROUND(COALESCE(topup_total, 0) + ?, 2), updated_at = datetime('now') WHERE id = ?
      `).run(usdAmount, usdAmount, row.user_id);

      // 写入交易流水，记入账户流水
      const oldBalance = db.prepare('SELECT balance FROM users WHERE id = ?').get(row.user_id);
      const oldBal = oldBalance ? parseFloat((oldBalance.balance - usdAmount).toFixed(2)) : 0;
      db.prepare(`
        INSERT INTO transactions (user_id, type, amount, net_amount, description, created_at)
        VALUES (?, '充值', ?, ?, ?, datetime('now'))
      `).run(row.user_id, usdAmount, usdAmount, `管理员审核通过充值 $${row.amount_usdt} USDT，入账 $${usdAmount}`);
    }

    res.json({ code: 0, msg: status === 'approved' ? '已审批通过' : '已拒绝', data: { id, status } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
