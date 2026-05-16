/**
 * 认证相关参数校验器
 * 规则：
 *   密码：8-16位，至少1个大写字母，字母+数字组合，必须含特殊字符
 */

// 邮箱正则
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 密码规则：8-16位 / 至少1大写 / 至少1小写 / 至少1数字 / 至少1特殊字符
const PWD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~])[A-Za-z\d!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]{8,16}$/;

// 手机号正则（国内 + 区号格式）
const PHONE_RE = /^\+?[1-9]\d{6,14}$/;

/**
 * 校验登录参数
 * @returns { valid: bool, errors: string[] }
 */
function validateLogin({ email, password, captchaToken, captchaAnswer }) {
  const errors = [];

  if (!email || typeof email !== 'string') {
    errors.push('邮箱不能为空');
  } else if (!EMAIL_RE.test(email.trim())) {
    errors.push('邮箱格式不正确');
  }

  if (!password || typeof password !== 'string') {
    errors.push('密码不能为空');
  } else if (password.length < 6) {
    // 登录时宽松检查（兼容老账号），只要非空即可
    // 但仍拒绝明显异常长度
    errors.push('密码长度不合法');
  }

  if (!captchaToken || !captchaAnswer) {
    // errors.push('请完成图形验证码'); // 验证码暂时跳过
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 校验注册参数
 */
function validateRegister({ email, password, confirmPassword, captchaToken, captchaAnswer }) {
  const errors = [];

  if (!email || typeof email !== 'string') {
    errors.push('邮箱不能为空');
  } else if (!EMAIL_RE.test(email.trim())) {
    errors.push('邮箱格式不正确');
  }

  if (!password || typeof password !== 'string') {
    errors.push('密码不能为空');
  } else if (!PWD_RE.test(password)) {
    errors.push('密码须8-16位，包含大小写字母、数字及特殊字符（如 !@#$%）');
  }

  if (confirmPassword !== undefined && confirmPassword !== password) {
    errors.push('两次输入的密码不一致');
  }

  if (!captchaToken || !captchaAnswer) {
    // errors.push('请完成图形验证码'); // 验证码暂时跳过
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 校验发送短信参数
 */
function validateSendSms({ phone, purpose }) {
  const errors = [];

  if (!phone || typeof phone !== 'string') {
    errors.push('手机号不能为空');
  } else if (!PHONE_RE.test(phone.replace(/\s/g, ''))) {
    errors.push('手机号格式不正确');
  }

  const validPurposes = ['register', 'login', 'reset'];
  if (!purpose || !validPurposes.includes(purpose)) {
    errors.push('purpose 参数不合法');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 密码强度评分（供前端展示，0-4）
 */
function passwordStrength(pwd) {
  if (!pwd) return 0;
  let score = 0;
  if (pwd.length >= 8)  score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/\d/.test(pwd))    score++;
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(pwd)) score++;
  return score; // 1=弱 2=中 3=强 4=极强
}

module.exports = { validateLogin, validateRegister, validateSendSms, passwordStrength, PWD_RE, EMAIL_RE };
