/**
 * 防重放攻击中间件
 *
 * 方案：客户端每次请求携带：
 *   X-Nonce:     随机字符串（UUID 或 16 位随机串）
 *   X-Timestamp: Unix 毫秒时间戳
 *
 * 服务端校验：
 *   1. timestamp 在 ±5分钟以内（防止时间差攻击）
 *   2. nonce 在 TTL 内未出现过（防止重放）
 *
 * nonce 存内存 Set（Map with expiry），重启清零
 * 对于关键接口（登录/注册/发短信）启用
 */

const TOLERANCE_MS = 5 * 60 * 1000; // 时间容差 ±5 分钟
const NONCE_TTL    = 10 * 60 * 1000; // nonce 过期时间 10 分钟

// { nonce -> expireAt }
const nonces = new Map();

// 定期清理过期 nonce
setInterval(() => {
  const now = Date.now();
  for (const [k, exp] of nonces.entries()) {
    if (exp < now) nonces.delete(k);
  }
}, 2 * 60 * 1000);

/**
 * 防重放中间件（可选挂载，仅对敏感接口）
 */
function replayProtection(req, res, next) {
  const nonce = req.headers['x-nonce'];
  const tsStr = req.headers['x-timestamp'];

  // 如果客户端没发这两个头，宽松放行（兼容非安全增强客户端）
  // 若要强制校验，改为 return res.status(400).json(...)
  if (!nonce || !tsStr) {
    return next();
  }

  const ts  = Number(tsStr);
  const now = Date.now();

  // 时间戳合法性
  if (isNaN(ts) || Math.abs(now - ts) > TOLERANCE_MS) {
    return res.status(400).json({ code: 400, msg: '请求时间戳已过期，请检查设备时间' });
  }

  // nonce 重放检测
  if (nonces.has(nonce)) {
    return res.status(400).json({ code: 400, msg: '重复请求，已被拦截' });
  }

  // 记录 nonce
  nonces.set(nonce, now + NONCE_TTL);

  next();
}

module.exports = { replayProtection };
