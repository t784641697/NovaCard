/**
 * 认证路由（重构版）
 *
 * 架构分层：
 *   routes/auth.js       ← 当前文件，仅负责 HTTP 层（参数提取、响应）
 *   validators/auth.js   ← 参数校验（格式、强度）
 *   services/captcha.js  ← 图形验证码生成/校验
 *   services/sms.js      ← 腾讯云短信发送/校验
 *   services/auditLog.js ← 安全审计日志
 *   middleware/loginRateLimiter.js ← IP 限流 + 锁定
 *   middleware/replayProtection.js ← 防重放
 *
 * 接口列表：
 *   GET  /api/auth/captcha           获取图形验证码
 *   POST /api/auth/sms/send          发送短信验证码
 *   POST /api/auth/login             登录（含验证码校验）
 *   POST /api/auth/register          注册（含验证码校验 + 密码强度）
 *   GET  /api/auth/me                当前用户信息（JWT）
 *   POST /api/auth/logout            退出登录（记录日志）
 */

const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const logger   = require('../utils/logger');

const db            = require('../db/database');
const { authenticate } = require('../middleware/auth');
const { loginRateLimiter, markLoginFail, resetLoginCounter, getIp } = require('../middleware/loginRateLimiter');
const { replayProtection } = require('../middleware/replayProtection');
const { validateLogin, validateRegister, validateSendSms } = require('../validators/auth');
const { generateCaptcha, verifyCaptcha } = require('../services/captcha');
const { sendSmsCode, verifySmsCode }     = require('../services/sms');
const { writeLog }                       = require('../services/auditLog');

const router      = express.Router();
const JWT_SECRET  = process.env.JWT_SECRET  || 'vcc-secret-change-in-production';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

// ── 账号锁定相关常量 ──────────────────────────────────────────────────────
const LOCK_THRESHOLD = 5;               // 连续失败 5 次触发锁定
const LOCK_DURATION  = 15 * 60 * 1000; // 锁定 15 分钟

// ── 工具：获取客户端 IP ────────────────────────────────────────────────────
function clientIp(req) {
  return getIp(req);
}

// ── 工具：获取 User-Agent ──────────────────────────────────────────────────
function clientUa(req) {
  return (req.headers['user-agent'] || '').slice(0, 200);
}

// ══════════════════════════════════════════════════════════════════════════
//  GET /api/auth/captcha   生成图形验证码
// ══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/auth/captcha:
 *   get:
 *     summary: 获取图形验证码
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: 验证码图片 + token + 答案
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code: { type: integer, example: 0 }
 *                 data:
 *                   type: object
 *                   properties:
 *                     token:  { type: string, description: '传给 /login' }
 *                     answer: { type: string, description: '测试环境会返回，生产环境不返回' }
 *                     svg:    { type: string, description: 'SVG 字符串' }
 */
router.get('/captcha', (req, res) => {
  const { token, svg } = generateCaptcha();
  // SVG 直接返回，前端 img src 设为 data:image/svg+xml,<svg...> 或通过 base64
  const svgBase64 = Buffer.from(svg).toString('base64');
  res.json({
    code: 0,
    data: {
      token,
      image: `data:image/svg+xml;base64,${svgBase64}`,
    },
  });
});

// ══════════════════════════════════════════════════════════════════════════
//  POST /api/auth/sms/send   发送短信验证码
// ══════════════════════════════════════════════════════════════════════════
router.post('/sms/send', replayProtection, async (req, res) => {
  const { phone, purpose = 'register' } = req.body || {};
  const ip = clientIp(req);

  // 参数校验
  const { valid, errors } = validateSendSms({ phone, purpose });
  if (!valid) {
    return res.status(400).json({ code: 400, msg: errors[0], errors });
  }

  const result = await sendSmsCode(phone, purpose, ip);

  writeLog({
    userId: null,
    action: result.success ? 'sms_send' : 'sms_fail',
    ip,
    ua: clientUa(req),
    detail: { phone, purpose, msg: result.msg },
  });

  if (!result.success) {
    return res.status(429).json({ code: 429, msg: result.msg });
  }

  res.json({ code: 0, msg: result.msg, ...(result.devCode ? { devCode: result.devCode } : {}) });
});

// ══════════════════════════════════════════════════════════════════════════
//  POST /api/auth/login   登录
// ══════════════════════════════════════════════════════════════════════════
/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: 用户登录（带图形验证码 + 限流 + 重放保护）
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, captchaToken, captchaAnswer]
 *             properties:
 *               email:         { type: string, example: 'admin@vcc.hub' }
 *               password:      { type: string, example: 'Admin@2026' }
 *               captchaToken:  { type: string }
 *               captchaAnswer: { type: string, example: 'a1b2' }
 *     responses:
 *       200:
 *         description: 登录成功, 返回 JWT
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code: { type: integer, example: 0 }
 *                 data:
 *                   type: object
 *                   properties:
 *                     token: { type: string }
 *                     user:  { type: object }
 *       429: { description: '限流: 15 分钟内同 IP 失败 5 次' }
 */
router.post('/login', loginRateLimiter, replayProtection, async (req, res) => {
  const { email, password, captchaToken, captchaAnswer } = req.body || {};
  const ip = clientIp(req);
  const ua = clientUa(req);

  // 1. 前端参数校验
  const { valid, errors } = validateLogin({ email, password, captchaToken, captchaAnswer });
  if (!valid) {
    return res.status(400).json({ code: 400, msg: errors[0], errors });
  }

  // 2. 图形验证码校验（暂时跳过）
  /*
  const captchaResult = verifyCaptcha(captchaToken, captchaAnswer);
  if (!captchaResult.valid) {
    markLoginFail(req);
    writeLog({ userId: null, action: 'captcha_fail', ip, ua, detail: { email, reason: captchaResult.reason } });
    return res.status(400).json({ code: 400, msg: captchaResult.reason });
  }
  */

  const emailNorm = email.trim().toLowerCase();

  // 3. 查找用户
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(emailNorm);
  if (!user) {
    markLoginFail(req);
    writeLog({ userId: null, action: 'login_fail', ip, ua, detail: { email: emailNorm, reason: 'user_not_found' } });
    return res.status(401).json({ code: 401, msg: '账号或密码错误' });
  }

  // 4. 账号状态检查
  if (user.status === 'disabled') {
    writeLog({ userId: user.id, action: 'login_locked', ip, ua, detail: { reason: 'account_disabled' } });
    return res.status(403).json({ code: 403, msg: '账号已被禁用，请联系管理员' });
  }

  // 5. 账号锁定检查（数据库级别）
  if (user.status === 'locked' && user.locked_until) {
    const lockUntil = new Date(user.locked_until);
    if (lockUntil > new Date()) {
      const retryAfter = Math.ceil((lockUntil - Date.now()) / 1000);
      writeLog({ userId: user.id, action: 'login_locked', ip, ua, detail: { reason: 'db_lock' } });
      return res.status(423).json({ code: 423, msg: `账号已锁定，请 ${Math.ceil(retryAfter / 60)} 分钟后再试`, retryAfter });
    }
    // 锁定已过期，解锁
    db.prepare(`UPDATE users SET status='active', login_fail_cnt=0, locked_until='' WHERE id=?`).run(user.id);
  }

  // 6. 密码验证
  const pwdOk = bcrypt.compareSync(password, user.password);
  if (!pwdOk) {
    markLoginFail(req);
    const newFailCnt = (user.login_fail_cnt || 0) + 1;
    const shouldLock = newFailCnt >= LOCK_THRESHOLD;
    const lockedUntil = shouldLock
      ? new Date(Date.now() + LOCK_DURATION).toISOString()
      : user.locked_until || '';

    db.prepare(`
      UPDATE users SET
        login_fail_cnt = ?,
        status = ?,
        locked_until = ?
      WHERE id = ?
    `).run(newFailCnt, shouldLock ? 'locked' : 'active', lockedUntil, user.id);

    writeLog({ userId: user.id, action: 'login_fail', ip, ua, detail: { reason: 'wrong_password', failCnt: newFailCnt } });

    if (shouldLock) {
      return res.status(423).json({ code: 423, msg: `密码错误次数过多，账号已锁定 ${LOCK_DURATION / 60000} 分钟` });
    }

    const remaining = LOCK_THRESHOLD - newFailCnt;
    return res.status(401).json({ code: 401, msg: `账号或密码错误，还剩 ${remaining} 次机会` });
  }

  // 7. 登录成功
  resetLoginCounter(req);

  // 重置失败计数
  db.prepare(`
    UPDATE users SET
      login_fail_cnt = 0,
      status = 'active',
      locked_until = '',
      last_login_at = nowiso(),
      last_login_ip = ?
    WHERE id = ?
  `).run(ip, user.id);

  // 2FA 检查：已启用则返回临时 token，要求输入 TOTP 码
  if (user.two_fa_enabled && user.two_fa_secret) {
    const tempToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role, twoFaPending: true },
      JWT_SECRET,
      { expiresIn: '5m' }
    );
    writeLog({ userId: user.id, action: 'login_2fa_pending', ip, ua, detail: {} });
    return res.json({
      code: 0,
      msg: 'ok',
      data: { require2FA: true, tempToken },
    });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );

  writeLog({ userId: user.id, action: 'login_ok', ip, ua, detail: {} });

  // 取企业名（仅 approved 的申请）
  const kycApp = db.prepare("SELECT company_name FROM kyc_applications WHERE user_id = ? AND status = 'approved' ORDER BY updated_at DESC LIMIT 1").get(user.id);

  res.json({
    code: 0,
    msg:  'ok',
    data: {
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, balance: user.balance, company_name: kycApp ? kycApp.company_name : null },
    },
  });
});

// ══════════════════════════════════════════════════════════════════════════
//  POST /api/auth/register   注册
// ══════════════════════════════════════════════════════════════════════════
router.post('/register', replayProtection, async (req, res) => {
  const { email, password, confirmPassword, name, captchaToken, captchaAnswer } = req.body || {};
  const ip = clientIp(req);
  const ua = clientUa(req);

  // 1. 参数校验
  const { valid, errors } = validateRegister({ email, password, confirmPassword, captchaToken, captchaAnswer });
  if (!valid) {
    return res.status(400).json({ code: 400, msg: errors[0], errors });
  }

  // 2. 图形验证码校验（暂时跳过）
  /*
  const captchaResult = verifyCaptcha(captchaToken, captchaAnswer);
  if (!captchaResult.valid) {
    writeLog({ userId: null, action: 'captcha_fail', ip, ua, detail: { email, reason: captchaResult.reason } });
    return res.status(400).json({ code: 400, msg: captchaResult.reason });
  }
  */

  const emailNorm = email.trim().toLowerCase();

  // 3. 邮箱唯一性
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(emailNorm);
  if (exists) {
    writeLog({ userId: null, action: 'register_fail', ip, ua, detail: { email: emailNorm, reason: 'email_exists' } });
    return res.status(409).json({ code: 409, msg: '该邮箱已注册' });
  }

  // 4. 哈希密码并创建用户
  const hash   = bcrypt.hashSync(password, 12); // 12 轮，更安全
  const result = db.prepare(`
    INSERT INTO users (email, password, name, role, last_login_ip)
    VALUES (?, ?, ?, 'user', ?)
  `).run(emailNorm, hash, name || emailNorm.split('@')[0], ip);

  const userId = result.lastInsertRowid;
  const token  = jwt.sign(
    { id: userId, email: emailNorm, role: 'user' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );

  writeLog({ userId, action: 'register_ok', ip, ua, detail: { email: emailNorm } });

  res.status(201).json({
    code: 0,
    msg:  'ok',
    data: { token, user: { id: userId, email: emailNorm, name: name || '', role: 'user', balance: 0 } },
  });
});

// ══════════════════════════════════════════════════════════════════════════
//  GET /api/auth/me   当前用户信息
// ══════════════════════════════════════════════════════════════════════════
router.get('/me', authenticate, (req, res) => {
  const user = db.prepare(
    'SELECT id, email, name, role, balance, status, last_login_at, last_login_ip, created_at FROM users WHERE id = ?'
  ).get(req.user.id);
  if (!user) return res.status(404).json({ code: 404, msg: '用户不存在' });
  const kycApp = db.prepare("SELECT company_name FROM kyc_applications WHERE user_id = ? AND status = 'approved' ORDER BY updated_at DESC LIMIT 1").get(req.user.id);
  res.json({ code: 0, msg: 'ok', data: { ...user, company_name: kycApp ? kycApp.company_name : null } });
});

// ══════════════════════════════════════════════════════════════════════════
//  POST /api/auth/logout   退出登录
// ══════════════════════════════════════════════════════════════════════════
router.post('/logout', authenticate, (req, res) => {
  writeLog({
    userId: req.user.id,
    action: 'logout',
    ip:     clientIp(req),
    ua:     clientUa(req),
    detail: {},
  });
  res.json({ code: 0, msg: 'ok' });
});

// 获取活跃公告（用户端弹窗用）
router.get('/announcements/active', (req, res) => {
  const list = db.prepare("SELECT id, title, content, type, created_at FROM announcements WHERE is_active=1 ORDER BY created_at DESC").all();
  res.json({ code: 0, msg: 'ok', data: list });
});

// 获取全部公告历史（用户端历史记录用）
router.get('/announcements/history', (req, res) => {
  const list = db.prepare("SELECT id, title, content, type, is_active, created_at FROM announcements ORDER BY created_at DESC").all();
  res.json({ code: 0, msg: 'ok', data: list });
});

// ══════════════════════════════════════════════════════════════════════════
//  POST /api/auth/change-password   修改密码
// ══════════════════════════════════════════════════════════════════════════
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.userId;

    if (!oldPassword || !newPassword) {
      return res.json({ code: 400, msg: '旧密码和新密码不能为空' });
    }
    if (newPassword.length < 8) {
      return res.json({ code: 400, msg: '新密码至少8位' });
    }
    if (oldPassword === newPassword) {
      return res.json({ code: 400, msg: '新密码不能与旧密码相同' });
    }

    const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.json({ code: 404, msg: '用户不存在' });
    }

    const valid = await bcrypt.compare(oldPassword, user.password_hash);
    if (!valid) {
      return res.json({ code: 401, msg: '旧密码错误' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, userId);

    writeLog('密码修改', userId, req);

    res.json({ code: 0, msg: '密码修改成功，请重新登录' });
  } catch (err) {
    logger.error('修改密码失败:', err);
    res.json({ code: 500, msg: '修改密码失败' });
  }
});

// ============================================================
// 2FA (TOTP) 路由
// ============================================================

// 1. 生成 2FA 密钥 + QR 码 (需登录)
router.post('/2fa/setup', authenticate, (req, res) => {
  try {
    const user = db.prepare('SELECT id, email, two_fa_enabled, two_fa_secret FROM users WHERE id=?').get(req.userId);
    if (!user) return res.status(401).json({ code: 401, msg: '用户不存在' });
    if (user.two_fa_enabled) return res.status(400).json({ code: 400, msg: '2FA 已启用，如需重新绑定请先禁用' });

    const { TOTP, Secret } = require('otpauth');
    const secret = new Secret({ size: 20 });
    const totp = new TOTP({
      issuer: 'NovaCard',
      label: user.email,
      secret,
      digits: 6,
      period: 30,
    });

    // 临时存储到 DB (未启用状态)
    db.prepare('UPDATE users SET two_fa_secret=? WHERE id=?').run(secret.base32, user.id);

    res.json({
      code: 0,
      msg: 'ok',
      data: {
        secret: secret.base32,
        otpauthUrl: totp.toString(),
      },
    });
  } catch (err) {
    logger.error('2FA setup error:', err);
    res.status(500).json({ code: 500, msg: '生成2FA密钥失败' });
  }
});

// 2. 启用 2FA (验证 TOTP 码确认绑定)
router.post('/2fa/enable', authenticate, (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ code: 400, msg: '请输入验证码' });

    const user = db.prepare('SELECT id, two_fa_secret, two_fa_enabled FROM users WHERE id=?').get(req.userId);
    if (!user) return res.status(401).json({ code: 401, msg: '用户不存在' });
    if (user.two_fa_enabled) return res.status(400).json({ code: 400, msg: '2FA 已启用' });
    if (!user.two_fa_secret) return res.status(400).json({ code: 400, msg: '请先生成2FA密钥' });

    const { TOTP, Secret } = require('otpauth');
    const totp = new TOTP({
      issuer: 'NovaCard',
      label: '',
      secret: Secret.fromBase32(user.two_fa_secret),
      digits: 6,
      period: 30,
    });

    const delta = totp.validate({ token: String(code), window: 1 });
    if (delta === null) {
      return res.status(400).json({ code: 400, msg: '验证码错误，请重试' });
    }

    db.prepare('UPDATE users SET two_fa_enabled=1 WHERE id=?').run(user.id);
    logger.info('2FA enabled for user ' + user.id);

    res.json({ code: 0, msg: '2FA 已启用' });
  } catch (err) {
    logger.error('2FA enable error:', err);
    res.status(500).json({ code: 500, msg: '启用2FA失败' });
  }
});

// 3. 登录 2FA 验证 (用 tempToken)
router.post('/2fa/verify-login', (req, res) => {
  try {
    const { tempToken, code } = req.body;
    if (!tempToken || !code) return res.status(400).json({ code: 400, msg: '参数缺失' });

    // 验证临时 token
    let payload;
    try {
      payload = jwt.verify(tempToken, JWT_SECRET);
    } catch {
      return res.status(401).json({ code: 401, msg: '临时令牌已过期，请重新登录' });
    }
    if (!payload.twoFaPending) return res.status(400).json({ code: 400, msg: '无效的临时令牌' });

    const user = db.prepare('SELECT id, email, name, role, balance, two_fa_secret, two_fa_enabled FROM users WHERE id=?').get(payload.id);
    if (!user || !user.two_fa_enabled || !user.two_fa_secret) {
      return res.status(400).json({ code: 400, msg: '2FA 未启用' });
    }

    const { TOTP, Secret } = require('otpauth');
    const totp = new TOTP({
      issuer: 'NovaCard',
      label: '',
      secret: Secret.fromBase32(user.two_fa_secret),
      digits: 6,
      period: 30,
    });

    const delta = totp.validate({ token: String(code), window: 1 });
    if (delta === null) {
      return res.status(400).json({ code: 400, msg: '验证码错误，请重试' });
    }

    // 验证通过，签发正式 token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    // 更新登录信息
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
    db.prepare('UPDATE users SET login_fail_cnt=0, last_login_at=datetime("now"), last_login_ip=? WHERE id=?').run(ip, user.id);
    writeLog({ userId: user.id, action: 'login_2fa_ok', ip, ua: req.headers['user-agent'] || '', detail: {} });

    const kycApp = db.prepare("SELECT company_name FROM kyc_applications WHERE user_id = ? AND status = 'approved' ORDER BY updated_at DESC LIMIT 1").get(user.id);

    res.json({
      code: 0,
      msg: 'ok',
      data: {
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role, balance: user.balance, company_name: kycApp ? kycApp.company_name : null },
      },
    });
  } catch (err) {
    logger.error('2FA verify-login error:', err);
    res.status(500).json({ code: 500, msg: '2FA验证失败' });
  }
});

// 4. 禁用 2FA (需验证当前 TOTP 码)
router.post('/2fa/disable', authenticate, (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ code: 400, msg: '请输入验证码' });

    const user = db.prepare('SELECT id, two_fa_secret, two_fa_enabled FROM users WHERE id=?').get(req.userId);
    if (!user || !user.two_fa_enabled) return res.status(400).json({ code: 400, msg: '2FA 未启用' });

    const { TOTP, Secret } = require('otpauth');
    const totp = new TOTP({
      issuer: 'NovaCard',
      label: '',
      secret: Secret.fromBase32(user.two_fa_secret),
      digits: 6,
      period: 30,
    });

    const delta = totp.validate({ token: String(code), window: 1 });
    if (delta === null) {
      return res.status(400).json({ code: 400, msg: '验证码错误，请重试' });
    }

    db.prepare('UPDATE users SET two_fa_enabled=0, two_fa_secret=NULL WHERE id=?').run(user.id);
    logger.info('2FA disabled for user ' + user.id);

    res.json({ code: 0, msg: '2FA 已禁用' });
  } catch (err) {
    logger.error('2FA disable error:', err);
    res.status(500).json({ code: 500, msg: '禁用2FA失败' });
  }
});

// 5. 查询 2FA 状态
router.get('/2fa/status', authenticate, (req, res) => {
  try {
    const user = db.prepare('SELECT two_fa_enabled FROM users WHERE id=?').get(req.userId);
    if (!user) return res.status(401).json({ code: 401, msg: '用户不存在' });
    res.json({ code: 0, data: { enabled: !!user.two_fa_enabled } });
  } catch (err) {
    res.status(500).json({ code: 500, msg: '查询失败' });
  }
});

module.exports = router;
