/**
 * 腾讯云短信验证码 Service
 *
 * 依赖：tencentcloud-sdk-nodejs-sms
 *
 * 环境变量（.env）：
 *   TENCENT_SMS_SECRET_ID     腾讯云 SecretId
 *   TENCENT_SMS_SECRET_KEY    腾讯云 SecretKey
 *   TENCENT_SMS_SDK_APP_ID    短信应用 SDKAppID（如：1400xxxxxx）
 *   TENCENT_SMS_SIGN_NAME     短信签名（如：XiuXiu Card）
 *   TENCENT_SMS_TPL_REGISTER  注册验证码模板ID（如：1234567）
 *   TENCENT_SMS_TPL_LOGIN     登录验证码模板ID
 *   TENCENT_SMS_TPL_RESET     重置密码验证码模板ID
 *   TENCENT_SMS_REGION        地域（默认 ap-guangzhou）
 *
 * 短信模板示例（需在腾讯云控制台创建）：
 *   "您的{1}验证码为{2}，{3}分钟内有效，请勿泄露。"
 *   参数1=场景，参数2=验证码，参数3=有效分钟数
 */

const tencentcloud = require('tencentcloud-sdk-nodejs-sms');
const { v4: uuidv4 } = require('uuid');
const db     = require('../db/database');
const logger = require('../utils/logger');

const SmsClient = tencentcloud.sms.v20210111.Client;

const CODE_TTL_MINUTES = 5;  // 有效期分钟
const CODE_TTL_MS      = CODE_TTL_MINUTES * 60 * 1000;
const MAX_SEND_PER_HOUR = 5; // 同手机号每小时最多发 5 条

// 场景名称映射
const PURPOSE_NAME = {
  register: '注册',
  login:    '登录',
  reset:    '重置密码',
};

/**
 * 获取腾讯云短信客户端
 */
function getSmsClient() {
  const secretId  = process.env.TENCENT_SMS_SECRET_ID;
  const secretKey = process.env.TENCENT_SMS_SECRET_KEY;

  if (!secretId || !secretKey) {
    throw new Error('腾讯云短信密钥未配置（TENCENT_SMS_SECRET_ID / TENCENT_SMS_SECRET_KEY）');
  }

  return new SmsClient({
    credential: { secretId, secretKey },
    region: process.env.TENCENT_SMS_REGION || 'ap-guangzhou',
  });
}

/**
 * 生成 6 位随机数字验证码
 */
function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * 发送短信验证码
 * @param {string} phone    手机号（E.164 格式，如 +8613800138000）
 * @param {string} purpose  register / login / reset
 * @param {string} ip       请求来源 IP（用于日志）
 * @returns { success: bool, msg: string, devCode?: string }
 */
async function sendSmsCode(phone, purpose, ip = '') {
  // 频率限制：同手机号每小时不超过 MAX_SEND_PER_HOUR 条
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const sentCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM sms_codes
    WHERE phone = ? AND created_at >= ?
  `).get(phone, since);

  if (sentCount && sentCount.cnt >= MAX_SEND_PER_HOUR) {
    return { success: false, msg: `同一手机号每小时最多发送 ${MAX_SEND_PER_HOUR} 次验证码` };
  }

  const code      = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

  // 判断是否配置了腾讯云密钥
  const secretId = process.env.TENCENT_SMS_SECRET_ID;
  const isDev    = !secretId || secretId === 'YOUR_SECRET_ID';

  if (!isDev) {
    // ── 真实发送 ──────────────────────────────────────────────────────────
    const tplId = {
      register: process.env.TENCENT_SMS_TPL_REGISTER,
      login:    process.env.TENCENT_SMS_TPL_LOGIN,
      reset:    process.env.TENCENT_SMS_TPL_RESET,
    }[purpose];

    if (!tplId) {
      return { success: false, msg: `短信模板 ID 未配置（purpose=${purpose}）` };
    }

    try {
      const client = getSmsClient();
      const result = await client.SendSms({
        SmsSdkAppId:    process.env.TENCENT_SMS_SDK_APP_ID,
        SignName:       process.env.TENCENT_SMS_SIGN_NAME,
        TemplateId:     tplId,
        TemplateParamSet: [PURPOSE_NAME[purpose] || purpose, code, String(CODE_TTL_MINUTES)],
        PhoneNumberSet: [phone],
        SessionContext: uuidv4(), // 防重放会话标识
      });

      const sendStatus = result.SendStatusSet?.[0];
      if (sendStatus?.Code !== 'Ok') {
        logger.error(`[SMS] 发送失败：${phone} ${sendStatus?.Code} ${sendStatus?.Message}`);
        return { success: false, msg: `短信发送失败：${sendStatus?.Message || '未知错误'}` };
      }

      logger.info(`[SMS] 发送成功：${phone} purpose=${purpose}`);
    } catch (err) {
      logger.error(`[SMS] 发送异常：${err.message}`);
      return { success: false, msg: '短信发送失败，请稍后再试' };
    }
  } else {
    // ── 开发模式：不真实发送，返回 code 方便测试 ──────────────────────────
    logger.warn(`[SMS][DEV] 模拟发送验证码 ${phone} → ${code}`);
  }

  // 存储验证码到数据库
  db.prepare(`
    INSERT INTO sms_codes (phone, code, purpose, expires_at, ip)
    VALUES (?, ?, ?, ?, ?)
  `).run(phone, code, purpose, expiresAt, ip);

  // 清理过期验证码
  db.prepare(`DELETE FROM sms_codes WHERE expires_at < nowiso() AND used = 1`).run();

  const resp = { success: true, msg: `验证码已发送至 ${phone}，${CODE_TTL_MINUTES} 分钟内有效` };
  if (isDev) resp.devCode = code; // 开发模式返回明文（生产绝不返回）

  return resp;
}

/**
 * 校验短信验证码
 * @param {string} phone
 * @param {string} code
 * @param {string} purpose
 * @returns { valid: bool, reason?: string }
 */
function verifySmsCode(phone, code, purpose) {
  if (!phone || !code || !purpose) {
    return { valid: false, reason: '参数缺失' };
  }

  const row = db.prepare(`
    SELECT * FROM sms_codes
    WHERE phone = ? AND purpose = ? AND used = 0
    ORDER BY created_at DESC LIMIT 1
  `).get(phone, purpose);

  if (!row) {
    return { valid: false, reason: '验证码不存在或已使用' };
  }
  if (new Date(row.expires_at) < new Date()) {
    return { valid: false, reason: '验证码已过期' };
  }
  if (row.code !== String(code).trim()) {
    return { valid: false, reason: '验证码错误' };
  }

  // 标记已使用
  db.prepare('UPDATE sms_codes SET used = 1 WHERE id = ?').run(row.id);

  return { valid: true };
}

module.exports = { sendSmsCode, verifySmsCode };
