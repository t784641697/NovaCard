/**
 * Telegram Bot 通知服务
 * 
 * 场景:
 *   - /health 关键项失败 (DB/SSL/Backup)
 *   - 异常消费告警
 *   - 关键错误 (vmcardio 401/500)
 *
 * 配置 (写入 .env):
 *   TELEGRAM_BOT_TOKEN=8602206550:AAEOQriCDM-wA95kTyKr6G7pf7EnwLbVncw
 *   TELEGRAM_CHAT_ID=-100XXXXXXXXX
 *   TELEGRAM_ENABLED=true
 */
const https = require('https');
const { URL } = require('url');
const logger = require('../utils/logger');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ENABLED = process.env.TELEGRAM_ENABLED === 'true';

if (ENABLED && !TOKEN) {
  logger.warn('[Telegram] TELEGRAM_ENABLED=true 但缺 TELEGRAM_BOT_TOKEN');
}
if (ENABLED && !CHAT_ID) {
  logger.warn('[Telegram] TELEGRAM_ENABLED=true 但缺 TELEGRAM_CHAT_ID');
}

/**
 * 发送 Telegram 消息 (HTML 格式)
 * @param {string} text - Markdown 文本
 * @param {object} options - { silent, parseMode }
 *   silent=true → 静默推送 (无声音)
 */
async function send(text, options = {}) {
  if (!ENABLED) {
    logger.debug(`[Telegram] disabled, skip: ${text.substring(0, 50)}...`);
    return { ok: false, reason: 'disabled' };
  }
  if (!TOKEN || !CHAT_ID) {
    logger.warn('[Telegram] 未配置 token/chat_id, 跳过');
    return { ok: false, reason: 'not_configured' };
  }

  // Telegram 单条消息 4096 字符限制
  const chunks = [];
  const MAX = 4000;
  if (text.length <= MAX) {
    chunks.push(text);
  } else {
    for (let i = 0; i < text.length; i += MAX) {
      chunks.push(text.substring(i, i + MAX));
    }
  }

  const results = [];
  for (const chunk of chunks) {
    const r = await sendOne(chunk, options);
    results.push(r);
    // 限流: 30 条/秒 (Telegram 限制), 但我们不会有这么多, 加 100ms 缓冲
    await new Promise(r => setTimeout(r, 100));
  }
  return { ok: results.every(r => r.ok), results };
}

function sendOne(text, options = {}) {
  return new Promise((resolve) => {
    const params = new URLSearchParams({
      chat_id: CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: 'true',
    });
    if (options.silent) params.append('disable_notification', 'true');

    const url = new URL(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    const body = params.toString();

    const req = https.request({
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
      family: 4,
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const r = JSON.parse(data);
          if (r.ok) {
            logger.info(`[Telegram] sent, msg_id=${r.result.message_id}`);
            resolve({ ok: true, message_id: r.result.message_id });
          } else {
            logger.error(`[Telegram] send failed: ${r.error_code} ${r.description}`);
            resolve({ ok: false, error: r.description });
          }
        } catch (e) {
          logger.error(`[Telegram] parse response error: ${e.message}`);
          resolve({ ok: false, error: e.message });
        }
      });
    });

    req.on('error', (e) => {
      logger.error(`[Telegram] request error: ${e.message}`);
      resolve({ ok: false, error: e.message });
    });
    req.on('timeout', () => {
      req.destroy();
      logger.error('[Telegram] timeout');
      resolve({ ok: false, error: 'timeout' });
    });

    req.write(body);
    req.end();
  });
}

/**
 * 简化包装: 严重 (有声音)
 */
async function sendCritical(text) {
  return send(text, { silent: false });
}

/**
 * 简化包装: 普通 (无声音)
 */
async function sendInfo(text) {
  return send(text, { silent: true });
}

// ================== 格式化辅助 ==================

function fmtHealthCheck(healthData) {
  const { status, checks, cache } = healthData;
  const emoji = status === 'ok' ? '🟢' : status === 'degraded' ? '🟡' : '🔴';
  const lines = [`${emoji} <b>VCC Hub 健康检查</b>`, `状态: <code>${status}</code>  缓存: ${cache || 'bypass'}`, ''];

  for (const [name, c] of Object.entries(checks)) {
    const mark = c.ok ? '✅' : '❌';
    const val = c.value || c.message || c.error || '?';
    const valueStr = String(val).substring(0, 80);
    lines.push(`${mark} <b>${name}</b>: ${valueStr}`);
  }
  return lines.join('\n');
}

function fmtAnomalyAlert(alerts, summary) {
  if (!alerts || alerts.length === 0) return null;
  const lines = ['🚨 <b>异常消费告警</b>', `触发: ${alerts.length} 笔  总损失: $${(summary?.total_amount || 0).toFixed(2)}`, ''];
  for (const a of alerts.slice(0, 5)) {
    const reasons = a.reasons.map(r => `  • ${r}`).join('\n');
    lines.push(`💳 卡 <code>${a.card_no}</code>  金额: <b>$${a.amount}</b>\n${reasons}\n商户: ${a.merchant}\n`);
  }
  if (alerts.length > 5) {
    lines.push(`... 还有 ${alerts.length - 5} 笔, 查看 /api/admin/anomaly-alerts`);
  }
  return lines.join('\n');
}

function fmtError(module, error, context = {}) {
  return `❌ <b>${module}</b>\n错误: <code>${String(error.message || error).substring(0, 200)}</code>${Object.keys(context).length ? '\n' + Object.entries(context).map(([k, v]) => `  ${k}: ${v}`).join('\n') : ''}`;
}

module.exports = {
  send,
  sendCritical,
  sendInfo,
  fmtHealthCheck,
  fmtAnomalyAlert,
  fmtError,
  // 配置状态
  isEnabled: () => ENABLED && !!TOKEN && !!CHAT_ID,
};
