/**
 * VCC Hub 后端服务入口
 * Node.js + Express
 */

require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const logger     = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');

// ── Swagger / OpenAPI 文档 ──
const swaggerUi     = require('swagger-ui-express');
const swaggerSpec   = require('./swagger');

// ── 初始化数据库（启动时自动建表/种子）──
require('./db/database');

// ── 路由 ──
const authRouter         = require('./routes/auth');
const cardsRouter        = require('./routes/cards');
const transactionsRouter = require('./routes/transactions');
const ledgerRouter       = require('./routes/ledger');
const adminRouter        = require('./routes/admin');
const topupRouter        = require('./routes/topup');
const webhookRouter      = require('./webhooks/vmcardio');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Nginx 反向代理信任（必须在 rateLimit 之前）──────────────────────────────
app.set('trust proxy', 1);

// ── 安全中间件 ─────────────────────────────────────────────────────────────
app.use(helmet({
  strictTransportSecurity: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https:", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https:", "data:"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      upgradeInsecureRequests: null,
    },
  },
}));
app.use(cors({
  origin: (origin, cb) => {
    // 允许：无 origin（server-to-server）、本地开发、生产服务器
    const allowed = [
      'http://localhost:5502', 'http://127.0.0.1:5502',
      'http://localhost:5500', 'http://127.0.0.1:5500',
      'http://43.135.26.36',
      process.env.FRONTEND_URL,
    ].filter(Boolean);
    if (!origin || allowed.includes(origin)) return cb(null, true);
    cb(null, true); // 目前全放通，上线后可收紧
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── 限流：全局 API 100次/15分钟 ──────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, msg: '请求过于频繁，请稍后再试' },
});
app.use('/api', globalLimiter);

// ── Body 解析 ─────────────────────────────────────────────────────────────
// WebHook 路由需要原始 body，单独处理；其他路由用 JSON
app.use('/api/webhook', webhookRouter);           // WebHook 路由内部自己 use express.json()
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// ── 业务路由 ──────────────────────────────────────────────────────────────
app.use('/api/auth',         authRouter);
app.use('/api/cards',        cardsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/ledger',       ledgerRouter);
app.use('/api/admin',        adminRouter);
app.use('/api/topup',        topupRouter);
app.use('/api/user/balance', require('./middleware/auth').authenticate, require('./routes/userBalance')); // 用户余额明细
app.use('/api/settlements',  require('./routes/settlements'));   // 卡结算记录
app.use('/api/admin/fee-configs', require('./routes/feeConfig')); // 费率配置管理
// KYC 企业认证（需登录）
app.use('/api/auth', require('./middleware/auth').authenticate, require('./routes/kyc'));
// KYC 管理审核（已包含在 admin 路由中）

// ── 健康检查（强化版：7 维度自检）─────────────────────────────────────────
app.use('/health', require('./routes/health'));

// ── Swagger UI ──
app.get('/api/docs.json', (req, res) => res.json(swaggerSpec));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'VCC Hub API',
  customCss: '.swagger-ui .topbar { display: none }',
  swaggerOptions: { persistAuthorization: true },
}));

// ── CSV 代理下载（Safari 兼容：前端生成 CSV → POST 换 token → window.open GET 下载）──
const csvProxyStore = new Map(); // token → { csv, filename, ts }
const { authenticate } = require('./middleware/auth');
app.post('/api/csv-proxy', authenticate, (req, res) => {
  const { filename, csv } = req.body || {};
  if (!csv || !filename) return res.status(400).json({ code: 400, msg: '缺少 csv 或 filename' });
  const token = require('crypto').randomBytes(16).toString('hex');
  csvProxyStore.set(token, { csv, filename, ts: Date.now() });
  // 5 分钟后自动清理
  setTimeout(() => csvProxyStore.delete(token), 5 * 60 * 1000);
  res.json({ code: 0, msg: 'ok', data: { token } });
});
app.get('/api/csv-proxy', (req, res) => {
  const token = req.query.token;
  if (!token || !csvProxyStore.has(token)) return res.status(404).json({ code: 404, msg: '无效或过期的下载令牌' });
  const { csv, filename } = csvProxyStore.get(token);
  csvProxyStore.delete(token); // 一次性令牌
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.send(csv);
});
// 定期清理过期令牌（每分钟）
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of csvProxyStore) { if (now - v.ts > 5 * 60 * 1000) csvProxyStore.delete(k); }
}, 60 * 1000);

// ── 静态文件服务（提供前端页面）────────────────────────────────────────────
const path = require('path');
const fs = require('fs');

// 检查前端文件是否存在（支持环境变量 FRONTEND_DIR 指定目录）
const frontendDir = process.env.FRONTEND_DIR
  ? path.resolve(process.env.FRONTEND_DIR)
  : path.join(__dirname, '../../vcc-dashboard');
const frontendPath = path.join(frontendDir, 'app.html');
const indexPath = path.join(frontendDir, 'index.html');
if (fs.existsSync(frontendPath)) {
  // 提供前端HTML文件（强制禁用缓存，避免 CDN/浏览器拿到旧版本）
  const noCache = (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    next();
  };
  app.get('/', noCache, (req, res) => {
    res.sendFile(frontendPath);
  });
  app.get('/app.html', noCache, (req, res) => {
    res.sendFile(frontendPath);
  });
  if (fs.existsSync(indexPath)) {
    app.get('/index.html', noCache, (req, res) => {
      res.sendFile(indexPath);
    });
  }
  // 提供其他静态资源（CSS、JS等）也禁用缓存
  app.use('/static', noCache, express.static(frontendDir));
  logger.info('📁 前端静态文件服务已启用：' + frontendDir);
} else {
  logger.warn('⚠️  前端文件未找到：' + frontendPath);
}

// ── 404 处理 ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ code: 404, msg: `接口不存在：${req.method} ${req.path}` });
});

// ── 全局错误处理（必须放最后）────────────────────────────────────────────
app.use(errorHandler);

// ── 商户余额同步服务（每分钟同步一次）──
const syncService = require('./services/merchantBalanceSync');
syncService.start();
logger.info('💰 商户余额同步服务已启动（每分钟同步）');

// ── 全局异常捕获（防止进程崩溃导致连接重置）─────────────────────────────────
process.on('uncaughtException', (err) => {
  logger.error('[uncaughtException] 未捕获的同步异常:', err.message, err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('[unhandledRejection] 未捕获的 Promise 拒绝:', reason);
});

// ── 启动 ──────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  logger.info(`🚀 VCC Hub 后端服务启动，端口 ${PORT}，环境 ${process.env.NODE_ENV || 'development'}`);
  logger.info(`📡 vmcardio Base URL: ${process.env.VMCARDIO_BASE_URL || '（未配置，使用沙箱）'}`);
  logger.info(`🔔 WebHook 接收地址：POST http://localhost:${PORT}/api/webhook/vmcardio`);

  // 启动通知 (异步, 不阻塞)
  const telegram = require('./services/telegram');
  if (telegram.isEnabled()) {
    const uptime = process.uptime().toFixed(0);
    const mem = (process.memoryUsage().rss / 1024 / 1024).toFixed(0);
    telegram.sendInfo(
      `🟢 <b>VCC Hub 启动</b>\n` +
      `端口: <code>${PORT}</code>  环境: <code>${process.env.NODE_ENV || 'dev'}</code>\n` +
      `PID: <code>${process.pid}</code>  内存: ${mem}MB\n` +
      `时间: ${new Date().toISOString()}`
    ).catch(e => logger.error('启动通知失败:', e.message));
  }
});

// 修复 Nginx keepalive 竞争：Node.js keepalive 超时需大于 Nginx（默认 75s）
server.keepAliveTimeout = 120000; // 120秒
server.headersTimeout = 125000;   // 125秒，必须大于 keepAliveTimeout

module.exports = app;
