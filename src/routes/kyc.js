/**
 * 企业认证（KYC）路由 - 用户端
 */
const express = require('express');
const router  = express.Router();
const db      = require('../db');

// 查询当前用户的 KYC 状态
router.get('/kyc/status', (req, res) => {
  const user = db.prepare('SELECT kyc_status FROM users WHERE id = ?').get(req.user.id);
  let application = null;
  if (user && user.kyc_status && user.kyc_status !== 'none') {
    application = db.prepare(`
      SELECT id, company_name, contact_name, contact_phone, business_license,
             remark, status, reject_reason, created_at, updated_at
      FROM kyc_applications WHERE user_id = ? ORDER BY id DESC LIMIT 1
    `).get(req.user.id);
  }
  res.json({ code: 0, msg: 'ok', data: { status: user?.kyc_status || 'none', application } });
});

// 提交企业认证
router.post('/kyc/submit', (req, res) => {
  const { company_name, contact_name, contact_phone, business_license, remark } = req.body;
  if (!company_name || !contact_name || !contact_phone) {
    return res.status(400).json({ code: 400, msg: '企业名称、联系人、联系电话为必填项' });
  }
  const existing = db.prepare('SELECT id, status FROM kyc_applications WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(req.user.id);
  if (existing && existing.status === 'pending') {
    return res.status(400).json({ code: 400, msg: '已有待审核的认证申请，请等待审核结果' });
  }
  const r = db.prepare(`
    INSERT INTO kyc_applications (user_id, company_name, contact_name, contact_phone, business_license, remark, status, submitter_ip)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(req.user.id, company_name, contact_name, contact_phone, business_license || '', remark || '', req.ip || '');
  db.prepare("UPDATE users SET kyc_status = 'pending', updated_at = datetime('now') WHERE id = ?").run(req.user.id);
  const row = db.prepare('SELECT * FROM kyc_applications WHERE id = ?').get(r.lastInsertRowid);
  res.json({ code: 0, msg: '企业认证已提交，等待管理员审核', data: row });
});

module.exports = router;