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
const FeeCalculator = require('../services/feeCalculator');

router.use(authenticate);

// ── 用户提交充值申请 ──────────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { network, amount_usdt, txhash, remark } = req.body;

    if (!network) {
      return res.status(400).json({ code: 400, msg: '请选择充值网络' });
    }

    const usdAmount = parseFloat(Number(amount_usdt).toFixed(2)) || 0;

    // 计算并锁定入账手续费（费率随申请时刻快照，审批时不再重算，防止管理员调费率导致用户到账金额变化）
    const feeResult = usdAmount > 0
      ? FeeCalculator.calculateFee('topup', usdAmount, req.user.id)
      : { fee_amount: 0, fee_rate: 0, net_amount: 0 };

    const info = db.prepare(`
      INSERT INTO topup_requests (user_id, network, amount_usdt, txhash, remark, fee_rate, fee_amount, net_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      network,
      usdAmount,
      txhash  || '',
      remark  || '',
      feeResult.fee_rate   || 0,
      feeResult.fee_amount || 0,
      feeResult.net_amount || 0
    );

    res.status(201).json({
      code: 0,
      msg: '充值申请已提交，请等待管理员审核',
      data: {
        id:         info.lastInsertRowid,
        amount_usdt: usdAmount,
        fee_rate:   feeResult.fee_rate   || 0,
        fee_amount: feeResult.fee_amount || 0,
        net_amount: feeResult.net_amount || 0
      }
    });
  } catch (err) {
    next(err);
  }
});

// ── 用户查询自己的申请记录 ─────────────────────────────────────────────────
router.get('/fee-config', (req, res, next) => {
  try {
    // 公开端点：任何已登录用户都能查 topup 费率（用于申请页实时预览）
    const cfg = db.prepare(`
      SELECT fee_type, description, fee_rate, fee_fixed, min_amount, max_amount
      FROM fee_configs
      WHERE fee_type = 'topup' AND is_active = 1
      LIMIT 1
    `).get();
    if (!cfg) {
      return res.json({ code: 0, msg: 'ok', data: { fee_rate: 0, fee_fixed: 0, min_amount: 0, max_amount: 0, description: '入账手续费' } });
    }
    res.json({
      code: 0,
      msg: 'ok',
      data: {
        fee_type:     cfg.fee_type,
        description:  cfg.description,
        fee_rate:     Number(cfg.fee_rate     || 0),
        fee_fixed:    Number(cfg.fee_fixed    || 0),
        min_amount:   Number(cfg.min_amount   || 0),
        max_amount:   Number(cfg.max_amount   || 0)
      }
    });
  } catch (err) {
    next(err);
  }
});

router.get('/', (req, res, next) => {
  try {
    const page      = parseInt(req.query.page)      || 1;
    const page_size = parseInt(req.query.page_size) || 20;
    const offset    = (page - 1) * page_size;

    const total = db.prepare('SELECT COUNT(*) as cnt FROM topup_requests WHERE user_id = ?').get(req.user.id).cnt;
    const rows  = db.prepare(`
      SELECT id, network, amount_usdt, txhash, remark, status, fee_rate, fee_amount, net_amount, created_at, updated_at
      FROM topup_requests
      WHERE user_id = ?
      ORDER BY id DESC
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
    const u = db.prepare('SELECT topup_total, topup_net_total FROM users WHERE id = ?').get(req.user.id);
    res.json({
      code: 0,
      msg: 'ok',
      data: {
        total_approved:     Number(u?.topup_total     || 0),  // 累计申请金额
        total_approved_net: Number(u?.topup_net_total || 0)   // 累计实到金额（扣手续费后）
      }
    });
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

    // 改金额时重新计算并锁定手续费
    const feeResult = FeeCalculator.calculateFee('topup', amt, req.user.id);

    db.prepare(`
      UPDATE topup_requests
      SET amount_usdt = ?, fee_rate = ?, fee_amount = ?, net_amount = ?, updated_at = ?
      WHERE id = ?
    `).run(amt, feeResult.fee_rate, feeResult.fee_amount, feeResult.net_amount, new Date().toISOString(), id);

    res.json({
      code: 0,
      msg: '金额已更新',
      data: {
        id,
        amount_usdt: amt,
        fee_rate:    feeResult.fee_rate,
        fee_amount:  feeResult.fee_amount,
        net_amount:  feeResult.net_amount
      }
    });
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
             t.fee_rate, t.fee_amount, t.net_amount,
             t.created_at, t.updated_at,
             u.email as user_email, u.name as user_name
      FROM topup_requests t
      LEFT JOIN users u ON u.id = t.user_id
      ${where}
      ORDER BY t.id DESC
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
    const { status, note, amount_usdt } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ code: 400, msg: 'status 必须为 approved 或 rejected' });
    }

    // 用事务 + CAS（WHERE status='pending'）保证 cluster 模式下并发审批安全：
    // pm2 2 workers 共享 SQLite 文件时，如果两个 worker 同时处理同一个 id，
    // 没有 CAS 会导致两 worker 都读到 pending、都 UPDATE，balance 被加两次。
    const result = db.transaction(() => {
      const row = db.prepare('SELECT * FROM topup_requests WHERE id = ?').get(id);
      if (!row) return { code: 404, msg: '申请不存在' };
      if (row.status !== 'pending') return { code: 400, msg: '该申请已处理' };

      // USDT 模式：管理员审批时填实际入账 USDT 金额（修复老数据丢失 bug）
      let updatedAmount = row.amount_usdt;
      if (status === 'approved' && amount_usdt !== undefined && amount_usdt !== null && amount_usdt !== '') {
        const amt = parseFloat(Number(amount_usdt).toFixed(2));
        if (!amt || amt <= 0) return { code: 400, msg: '入账金额必须 > 0' };
        updatedAmount = amt;
      }
      const nowISO = new Date().toISOString();

      // CAS UPDATE：只更新 status='pending' 的行。如果已经被其他 worker 改掉，
      // changes=0，我们识别为"该申请已处理"并中止事务（不会触碰 users/transactions）
      const casResult = db.prepare(`
        UPDATE topup_requests
        SET status = ?, remark = ?, amount_usdt = ?, updated_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(status, note || row.remark, updatedAmount, nowISO, id);

      if (casResult.changes === 0) {
        return { code: 400, msg: '该申请已处理' };
      }

      // 审批通过：自动入账用户余额（按申请时锁定的费率扣手续费）
      if (status === 'approved' && updatedAmount > 0) {
        // 读取 USDT 汇率（默认 1:1）
        const rateRow = db.prepare("SELECT value FROM settings WHERE key = 'usdt_rate'").get();
        const rate = rateRow ? (parseFloat(rateRow.value) || 1) : 1;
        const usdAmount  = parseFloat((updatedAmount * rate).toFixed(2));
        // 优先用申请时锁定的费率（USD 模式：用户填金额时已锁定）。
        // 如果 row 上没存（USDT 模式：管理员审批时才填金额），则按当前费率实时算。
        let feeRate, feeAmount, netAmount;
        if (row.fee_rate > 0 || row.fee_amount > 0) {
          feeRate   = row.fee_rate   || 0;
          feeAmount = parseFloat((row.fee_amount || usdAmount * feeRate).toFixed(2));
          netAmount = parseFloat((usdAmount - feeAmount).toFixed(2));
        } else {
          const fr = FeeCalculator.calculateFee('topup', usdAmount, row.user_id);
          feeRate   = fr.fee_rate;
          feeAmount = fr.fee_amount;
          netAmount = fr.net_amount;
        }

        db.prepare(`
          UPDATE users
          SET balance         = ROUND(balance + ?, 2),
              topup_total     = ROUND(COALESCE(topup_total, 0)     + ?, 2),
              topup_net_total = ROUND(COALESCE(topup_net_total, 0) + ?, 2),
              updated_at      = ?
          WHERE id = ?
        `).run(netAmount, usdAmount, netAmount, nowISO, row.user_id);

        // 回写 fee 字段（USDT 模式首审时落库，方便审计追踪）
        db.prepare(`
          UPDATE topup_requests SET fee_rate = ?, fee_amount = ?, net_amount = ? WHERE id = ?
        `).run(feeRate, feeAmount, netAmount, id);

        // 写入交易流水，记入账户流水（实到金额 + 手续费备注）
        // 注意：字段名是 fee_amount（不是 fee），历史 commit 4547454 写错过一次，
        // 导致 id=2 那次充值 balance 增加了 98 但 transactions 表没记录。
        const feeDesc = feeAmount > 0
          ? `（含入账手续费 $${feeAmount.toFixed(2)}，费率 ${(feeRate * 100).toFixed(2)}%）`
          : '';
        db.prepare(`
          INSERT INTO transactions (user_id, type, amount, net_amount, fee_amount, description, created_at)
          VALUES (?, '充值', ?, ?, ?, ?, ?)
        `).run(row.user_id, netAmount, netAmount, feeAmount, `管理员审核通过充值 $${updatedAmount} USDT，实到 $${netAmount.toFixed(2)}${feeDesc}`, nowISO);
      }

      return { code: 0, msg: status === 'approved' ? '已审批通过' : '已拒绝', data: { id, status } };
    })();

    if (result.code === 0) {
      return res.json(result);
    }
    return res.status(result.code).json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
