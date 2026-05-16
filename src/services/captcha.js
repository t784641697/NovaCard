/**
 * 图形验证码 Service
 * 使用 svg-captcha 生成 SVG 验证码
 * token 存 SQLite captcha_store 表，有效期 5 分钟，校验后立即标记 used
 */

const svgCaptcha = require('svg-captcha');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

const CAPTCHA_TTL_MS = 5 * 60 * 1000; // 5 分钟有效

/**
 * 生成验证码
 * @returns { token: string, svg: string }
 */
function generateCaptcha() {
  const captcha = svgCaptcha.create({
    size: 4,           // 4位字符
    noise: 3,          // 干扰线
    color: true,       // 彩色字符
    background: '#1e253a', // 与页面背景搭配
    fontSize: 52,
    width: 130,
    height: 48,
    ignoreChars: '0o1iIlO', // 去掉易混淆字符
  });

  const token     = uuidv4();
  const expiresAt = new Date(Date.now() + CAPTCHA_TTL_MS).toISOString();
  const answer    = captcha.text.toLowerCase();

  // 清理同 token（理论上不会重复，但保险）
  db.prepare('DELETE FROM captcha_store WHERE token = ?').run(token);

  db.prepare(`
    INSERT INTO captcha_store (token, text, expires_at, used) VALUES (?, ?, ?, 0)
  `).run(token, answer, expiresAt);

  // 定期清理过期验证码（每次生成时顺带清理）
  db.prepare(`DELETE FROM captcha_store WHERE expires_at < datetime('now')`).run();

  return { token, svg: captcha.data };
}

/**
 * 校验验证码
 * @param {string} token
 * @param {string} answer  用户输入（不区分大小写）
 * @returns { valid: bool, reason?: string }
 */
function verifyCaptcha(token, answer) {
  if (!token || !answer) {
    return { valid: false, reason: '验证码参数缺失' };
  }

  const row = db.prepare('SELECT * FROM captcha_store WHERE token = ?').get(token);

  if (!row) {
    return { valid: false, reason: '验证码不存在或已失效' };
  }
  if (row.used) {
    return { valid: false, reason: '验证码已使用，请刷新' };
  }
  if (new Date(row.expires_at) < new Date()) {
    return { valid: false, reason: '验证码已过期，请刷新' };
  }
  if (row.text !== answer.toLowerCase().trim()) {
    return { valid: false, reason: '验证码输入错误' };
  }

  // 标记已使用（一次性）
  db.prepare('UPDATE captcha_store SET used = 1 WHERE token = ?').run(token);

  return { valid: true };
}

module.exports = { generateCaptcha, verifyCaptcha };
