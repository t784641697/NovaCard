/**
 * JWT 认证中间件
 * 前端登录后拿到 token，每次请求带在 Authorization: Bearer <token>
 */

const jwt    = require('jsonwebtoken');
const logger = require('../utils/logger');
const db     = require('../db/database');

/**
 * 验证 JWT，通过后将 payload 写入 req.user
 * 同时回查数据库确认账号当前状态（禁用的账号即使 token 有效也拒绝）
 */
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ code: 401, msg: '未提供认证 Token' });
  }

  const token = authHeader.slice(7);
  try {
    const JWT_SECRET = process.env.JWT_SECRET || 'vcc-secret-change-in-production';
    const payload = jwt.verify(token, JWT_SECRET);

    // 回查 DB，确认账号未被禁用
    const user = db.prepare('SELECT id, status, role FROM users WHERE id = ?').get(payload.id);
    if (!user) {
      return res.status(401).json({ code: 401, msg: '账号不存在' });
    }
    if (user.status === 'disabled') {
      return res.status(403).json({ code: 403, msg: '账号已被禁用，请联系管理员' });
    }

    req.user = payload;
    next();
  } catch (err) {
    logger.warn('[auth] Token 验证失败：', err.message);
    return res.status(401).json({ code: 401, msg: 'Token 无效或已过期' });
  }
}

/**
 * 管理员权限校验（需先经过 authenticate）
 */
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ code: 403, msg: '权限不足，仅管理员可操作' });
  }
  next();
}

module.exports = { authenticate, requireAdmin };
