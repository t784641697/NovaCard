/**
 * 认证专用限流中间件
 *
 * 策略：
 *   - 同一 IP  10分钟内最多 10 次登录尝试（宽限）
 *   - 超限后 lockout 10分钟，返回 429 + 剩余秒数
 *   - 数据存内存（Map），重启清零；如需持久化可改 Redis/SQLite
 */

const WINDOW_MS    = 10 * 60 * 1000; // 10 分钟窗口
const MAX_ATTEMPTS = 10;              // 最多尝试次数
const LOCKOUT_MS   = 10 * 60 * 1000; // 锁定时长

// 内存存储 { ip -> { count, resetAt, lockedUntil } }
const store = new Map();

// 定期清理过期条目（5分钟一次）
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of store.entries()) {
    if (rec.lockedUntil && rec.lockedUntil < now && rec.resetAt < now) {
      store.delete(ip);
    }
  }
}, 5 * 60 * 1000);

/**
 * 获取真实 IP（信任 Nginx 代理头）
 */
function getIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

/**
 * 登录尝试限流中间件（挂在 POST /api/auth/login 之前）
 */
function loginRateLimiter(req, res, next) {
  const ip  = getIp(req);
  const now = Date.now();
  let rec   = store.get(ip);

  if (!rec || rec.resetAt < now) {
    rec = { count: 0, resetAt: now + WINDOW_MS, lockedUntil: 0 };
    store.set(ip, rec);
  }

  // 已锁定
  if (rec.lockedUntil > now) {
    const retryAfter = Math.ceil((rec.lockedUntil - now) / 1000);
    return res.status(429).json({
      code: 429,
      msg:  `登录尝试过于频繁，请 ${retryAfter} 秒后再试`,
      retryAfter,
    });
  }

  // 记录本次尝试（在 next() 调用后，由路由主动调 req.markLoginAttempt()）
  req._loginIp  = ip;
  req._loginRec = rec;

  next();
}

/**
 * 登录路由调用此函数标记一次失败尝试
 * 如果超过阈值则触发锁定
 */
function markLoginFail(req) {
  const rec = req._loginRec;
  if (!rec) return;
  rec.count++;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.lockedUntil = Date.now() + LOCKOUT_MS;
  }
}

/**
 * 登录成功时重置计数
 */
function resetLoginCounter(req) {
  const ip = req._loginIp;
  if (ip) store.delete(ip);
}

module.exports = { loginRateLimiter, markLoginFail, resetLoginCounter, getIp };
