/**
 * 异常消费告警服务
 *
 * 检测规则（同步交易流水后触发）:
 *   1. 单笔高额: 单笔 Authorization amount > ANOMALY_SINGLE_THRESHOLD
 *   2. 短时累计: 1 小时内同卡累计 > ANOMALY_HOURLY_THRESHOLD
 *   3. 陌生商户: merchant_name 首次出现
 *   4. 高风险: 包含敏感关键词 (赌博/成人/虚拟货币等)
 *
 * 推送渠道:
 *   - notifications 表: 给持卡用户站内信
 *   - logger.warn: 管理员看 winston 日志
 *   - settings.anomaly_alert_summary: /health 端点显示
 *   - 管理后台 banner: 前端轮询
 *
 * 设计: 规则配置存 settings 表，管理员可通过 /api/admin 调整阈值
 */

const db = require('../db');
const logger = require('../utils/logger');

// ── 默认阈值 ─────────────────────────────────────────────────────────────
const DEFAULTS = {
  SINGLE_USD: 200,        // 单笔 $200
  HOURLY_USD: 500,        // 1 小时累计 $500
  DAILY_USD: 2000,        // 24 小时累计 $2000 (可选启用)
  ENABLE_STRICT: false    // 严格模式：陌生商户也告警
};

// ── 高风险关键词（用单词边界匹配，避免 "tor" 误中 "Store"）────────────
const RISKY_KEYWORDS = [
  // 赌博
  'gambling', 'casino', 'betting', 'poker', 'lottery', 'bookmaker', 'bet365',
  // 成人
  'adult', 'escort', 'porn', 'xxx', 'onlyfans',
  // 加密货币
  'bitcoin', 'ethereum', 'binance', 'coinbase', 'kraken',
  // 暗网
  'darkweb', 'onion',
  // 武器
  'weapons', 'firearms', 'ammunition',
  // 处方药
  'prescription', 'pharmacy online',
];

function getThresholds() {
  try {
    const rows = db.prepare(
      "SELECT key, value FROM settings WHERE key LIKE 'anomaly_%'"
    ).all();
    const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
    return {
      SINGLE_USD: parseFloat(s.anomaly_single_usd || DEFAULTS.SINGLE_USD),
      HOURLY_USD: parseFloat(s.anomaly_hourly_usd || DEFAULTS.HOURLY_USD),
      DAILY_USD:  parseFloat(s.anomaly_daily_usd  || DEFAULTS.DAILY_USD),
      ENABLE_STRICT: s.anomaly_enable_strict === 'true',
    };
  } catch (e) {
    return DEFAULTS;
  }
}

/**
 * 创建站内信 (notifications 表)
 * @param {number} userId
 * @param {string} type - alert/info/warning
 * @param {string} title
 * @param {string} content
 */
function pushNotification(userId, type, title, content) {
  try {
    db.prepare(`
      INSERT INTO notifications (user_id, type, title, content, created_at, is_read)
      VALUES (?, ?, ?, ?, nowiso(), 0)
    `).run(userId, type, title, content);
  } catch (e) {
    // 表可能还没建, 跳过
    logger.warn('notification insert failed: ' + e.message);
  }
}

/**
 * 标记告警已经处理（写到 settings.anomaly_alerts_log）
 */
function recordAlert(alert) {
  try {
    // 简单做法: 把告警 JSON 追加到 settings 的 last_alerts 字段（保留最近 20 条）
    const row = db.prepare("SELECT value FROM settings WHERE key='anomaly_alerts_log'").get();
    let arr = [];
    try { arr = row ? JSON.parse(row.value) : []; } catch { arr = []; }
    arr.unshift({ ...alert, ts: new Date().toISOString() });
    if (arr.length > 20) arr = arr.slice(0, 20);

    db.prepare(`
      INSERT INTO settings (key, value) VALUES ('anomaly_alerts_log', ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
    `).run(JSON.stringify(arr));
  } catch (e) {
    console.warn('recordAlert failed: ' + e.message);
  }
}

/**
 * 检查单笔交易是否异常
 * @param {Object} tx - 一条 card_transactions 记录
 * @param {Object} thresholds
 * @returns {string[]} - 命中的规则名
 */
function detectAnomalies(tx, thresholds, history) {
  const reasons = [];
  const amount = Number(tx.auth_amount || tx.settle_amount || 0);

  // 规则 1: 单笔高额
  if (amount >= thresholds.SINGLE_USD) {
    reasons.push(`单笔高额 $${amount.toFixed(2)} (阈值 $${thresholds.SINGLE_USD})`);
  }

  // 规则 2: 1 小时累计
  if (history && history.hourlyTotal + amount > thresholds.HOURLY_USD) {
    reasons.push(`1 小时累计 $${(history.hourlyTotal + amount).toFixed(2)} (阈值 $${thresholds.HOURLY_USD})`);
  }

  // 规则 3: 陌生商户
  if (thresholds.ENABLE_STRICT && history && !history.knownMerchants.has(tx.merchant_name)) {
    reasons.push(`陌生商户: ${tx.merchant_name}`);
  }

  // 规则 4: 高风险关键词（单词边界匹配，避免 "tor" 误中 "Store"）
  const merchantLower = String(tx.merchant_name || '').toLowerCase();
  const matched = RISKY_KEYWORDS.find(kw => {
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return re.test(merchantLower);
  });
  if (matched) {
    reasons.push(`高风险商户关键词: ${matched}`);
  }

  return reasons;
}

/**
 * 检查新同步进来的交易
 * @param {Array} newTxs - 本次同步的新交易 (还没写库的也行)
 * @returns {Object} - { alerts: [...], summary: { totalChecked, alertCount, byRule: {...} } }
 */
function checkNewTransactions(newTxs) {
  const thresholds = getThresholds();
  const alerts = [];
  const byRule = { '单笔高额': 0, '1小时累计': 0, '陌生商户': 0, '高风险关键词': 0 };

  for (const tx of newTxs) {
    // 只检查 Authorization 类型的 COMPLETE 状态
    if (tx.type !== 'Authorization' || tx.status !== 'COMPLETE') continue;

    // 查历史: 1 小时累计 + 已知商户
    const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
    const hourlyRows = db.prepare(`
      SELECT auth_amount, settle_amount, merchant_name FROM card_transactions
      WHERE card_id = ? AND type = 'Authorization' AND status = 'COMPLETE'
        AND auth_time >= ?
        AND auth_id != ?
    `).all(tx.card_id, oneHourAgo, tx.auth_id || '');

    const history = {
      hourlyTotal: hourlyRows.reduce((s, r) => s + Number(r.auth_amount || 0), 0),
      knownMerchants: new Set(
        db.prepare(`SELECT DISTINCT merchant_name FROM card_transactions WHERE card_id = ? AND merchant_name != ''`)
          .all(tx.card_id).map(r => r.merchant_name)
      ),
    };

    const reasons = detectAnomalies(tx, thresholds, history);
    if (reasons.length === 0) continue;

    // 查这张卡属于哪个用户
    const card = db.prepare(`SELECT user_id, card_number FROM cards WHERE card_id = ?`).get(tx.card_id);
    const userId = card?.user_id || 0;

    // 累加规则命中
    reasons.forEach(r => {
      if (r.includes('单笔高额')) byRule['单笔高额']++;
      else if (r.includes('1 小时累计')) byRule['1小时累计']++;
      else if (r.includes('陌生商户')) byRule['陌生商户']++;
      else if (r.includes('高风险')) byRule['高风险关键词']++;
    });

    const alert = {
      card_id: tx.card_id,
      card_no: card?.card_number || '',
      user_id: userId,
      amount: Number(tx.auth_amount || 0),
      merchant: tx.merchant_name,
      auth_time: tx.auth_time || tx.create_time,
      reasons,
    };
    alerts.push(alert);

    // 写站内信 (给持卡用户)
    if (userId > 0) {
      pushNotification(
        userId,
        'alert',
        `⚠️ 异常消费: $${alert.amount.toFixed(2)}`,
        `卡号 ${alert.card_no} 在 ${alert.merchant} 消费 $${alert.amount.toFixed(2)}\n原因: ${reasons.join('; ')}`
      );
    }

    // 写日志
    logger.warn(
      `[anomaly] card=${alert.card_no} user=${userId} amount=$${alert.amount} merchant=${alert.merchant} reasons=${reasons.join('; ')}`
    );

    // 写 settings 记录
    recordAlert(alert);
  }

  // 写汇总
  const summary = {
    last_check_at: new Date().toISOString(),
    thresholds,
    total_checked: newTxs.length,
    alert_count: alerts.length,
    by_rule: byRule,
  };
  try {
    db.prepare(`
      INSERT INTO settings (key, value) VALUES ('anomaly_alert_summary', ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
    `).run(JSON.stringify(summary));
  } catch (e) {
    console.warn('save summary failed: ' + e.message);
  }

  return { alerts, summary };
}

module.exports = {
  checkNewTransactions,
  detectAnomalies,
  getThresholds,
  DEFAULTS,
  RISKY_KEYWORDS,
};
