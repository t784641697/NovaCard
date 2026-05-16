/**
 * 审计日志 Service
 * 统一记录安全相关事件，解耦业务逻辑与日志写入
 *
 * action 枚举：
 *   login_ok       登录成功
 *   login_fail     登录失败（密码错、账号不存在）
 *   login_locked   账号被锁定，拒绝登录
 *   register_ok    注册成功
 *   register_fail  注册失败
 *   logout         退出登录
 *   pwd_change     修改密码
 *   captcha_fail   验证码错误
 *   sms_send       发送短信验证码
 *   sms_fail       短信验证码校验失败
 *   replay_block   防重放拦截
 */

const db     = require('../db/database');
const logger = require('../utils/logger');

/**
 * 写入审计日志（同步，SQLite 写入极快）
 * @param {object} params
 * @param {number|null} params.userId
 * @param {string}       params.action
 * @param {string}       params.ip
 * @param {string}       params.ua
 * @param {object}       params.detail   - 附加信息（会被 JSON.stringify）
 */
function writeLog({ userId = null, action, ip = '', ua = '', detail = {} }) {
  try {
    db.prepare(`
      INSERT INTO audit_logs (user_id, action, ip, ua, detail)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, action, ip, ua, JSON.stringify(detail));
  } catch (err) {
    // 日志写入失败不影响主业务，只打印警告
    logger.warn(`[AuditLog] 写入失败：${err.message}`);
  }
}

/**
 * 查询某个 IP 在最近 windowMs 内某类 action 的次数
 */
function countByIp(ip, action, windowMs) {
  const since = new Date(Date.now() - windowMs).toISOString().replace('T', ' ').split('.')[0];
  const row = db.prepare(`
    SELECT COUNT(*) as cnt FROM audit_logs
    WHERE ip = ? AND action = ? AND created_at >= ?
  `).get(ip, action, since);
  return row ? row.cnt : 0;
}

/**
 * 查询某个邮箱在最近 windowMs 内登录失败次数
 */
function countLoginFailByEmail(email, windowMs) {
  const since = new Date(Date.now() - windowMs).toISOString().replace('T', ' ').split('.')[0];
  const row = db.prepare(`
    SELECT COUNT(*) as cnt FROM audit_logs
    WHERE action = 'login_fail'
      AND json_extract(detail, '$.email') = ?
      AND created_at >= ?
  `).get(email, since);
  return row ? row.cnt : 0;
}

module.exports = { writeLog, countByIp, countLoginFailByEmail };
