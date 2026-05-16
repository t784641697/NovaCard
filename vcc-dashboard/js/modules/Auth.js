// ═══════════════════════════════════════════════════════
//  Auth 模块 - 认证相关功能
// ═══════════════════════════════════════════════════════

import { apiFetch } from '../services/api.js';
import { toast } from '../components/ui/toast.js';
import { setToken, setMe, _token, _me } from '../utils/config.js';
import { EMAIL_RE } from '../utils/config.js';

// 密码规则
const PWD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()\-_=+\[\]{};:'",.<>/?\\|`~])[A-Za-z\d!@#$%^&*()\-_=+\[\]{};:'",.<>/?\\|`~]{8,16}$/;

// 验证码 token 缓存
let _loginCaptchaToken = '';
let _regCaptchaToken = '';

// 防频繁点击冷却
let _loginCooling = false;
let _regCooling = false;

// 加载占位图
const _CAPTCHA_LOADING_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='110' height='40'%3E%3Crect width='100%25' height='100%25' fill='%231e253a'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%239da3c0' font-size='13'%3E加载中...%3C/text%3E%3C/svg%3E";

/**
 * 切换登录/注册标签
 */
export function switchTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('tabLogin').classList.toggle('active', isLogin);
  document.getElementById('tabReg').classList.toggle('active', !isLogin);
  document.getElementById('loginForm').classList.toggle('hidden', !isLogin);
  document.getElementById('regForm').classList.toggle('hidden', isLogin);
  refreshCaptcha(isLogin ? 'login' : 'reg');
}

/**
 * 刷新图形验证码
 */
export async function refreshCaptcha(type) {
  const imgId = type === 'login' ? 'loginCaptchaImg' : 'regCaptchaImg';
  const img = document.getElementById(imgId);

  if (img) {
    img.style.opacity = '0.5';
    img.src = _CAPTCHA_LOADING_SVG;
  }

  try {
    const data = await apiFetch('/auth/captcha', { method: 'GET' });
    if (data.code !== 0) return;

    if (type === 'login') {
      _loginCaptchaToken = data.data.token;
    } else {
      _regCaptchaToken = data.data.token;
    }

    if (img) {
      img.src = data.data.image;
      img.style.opacity = '1';
    }
  } catch (e) {
    if (img) img.style.opacity = '1';
  }
}

/**
 * 设置字段错误信息
 */
function setFieldError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}

/**
 * 登录表单实时校验
 */
export function validateLoginField() {
  const email = document.getElementById('loginEmail').value.trim();
  const pwd = document.getElementById('loginPwd').value;
  let ok = true;

  if (email && !EMAIL_RE.test(email)) {
    setFieldError('loginEmailErr', '邮箱格式不正确');
    ok = false;
  } else {
    setFieldError('loginEmailErr', '');
  }

  if (pwd && pwd.length < 6) {
    setFieldError('loginPwdErr', '密码长度不合法');
    ok = false;
  } else {
    setFieldError('loginPwdErr', '');
  }

  return ok;
}

/**
 * 注册表单实时校验
 */
export function validateRegField() {
  const email = document.getElementById('regEmail').value.trim();
  const pwd = document.getElementById('regPwd').value;
  const pwd2 = document.getElementById('regPwd2')?.value;
  let ok = true;

  if (email && !EMAIL_RE.test(email)) {
    setFieldError('regEmailErr', '邮箱格式不正确');
    ok = false;
  } else {
    setFieldError('regEmailErr', '');
  }

  if (pwd && !PWD_RE.test(pwd)) {
    setFieldError('regPwdErr', '密码须8-16位，含大小写字母、数字及特殊字符');
    ok = false;
  } else {
    setFieldError('regPwdErr', '');
  }

  if (pwd2 && pwd2 !== pwd) {
    setFieldError('regPwd2Err', '两次密码不一致');
    ok = false;
  } else {
    setFieldError('regPwd2Err', '');
  }

  return ok;
}

/**
 * 设置密码规则提示状态
 */
function setRule(id, pass) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = pass ? 'ok' : '';
  el.textContent = (pass ? '✓ ' : '✗ ') + el.textContent.slice(2);
}

/**
 * 密码强度实时检测
 */
export function onRegPwdInput() {
  const pwd = document.getElementById('regPwd').value;
  const wrap = document.getElementById('pwdStrengthWrap');
  const fill = document.getElementById('pwdStrengthFill');
  const lbl = document.getElementById('pwdStrengthLabel');

  const rLen = pwd.length >= 8 && pwd.length <= 16;
  const rUpper = /[A-Z]/.test(pwd);
  const rNum = /\d/.test(pwd);
  const rSpecial = /[!@#$%^&*()\-_=+\[\]{};:'",.<>/?\\|`~]/.test(pwd);

  setRule('r-len', rLen);
  setRule('r-upper', rUpper);
  setRule('r-num', rNum);
  setRule('r-special', rSpecial);

  if (pwd.length === 0) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'flex';

  const score = [rLen, rUpper, rNum, rSpecial].filter(Boolean).length;
  const levels = [
    { w: '25%', bg: '#ff5f5f', t: '弱' },
    { w: '50%', bg: '#ffb347', t: '中' },
    { w: '75%', bg: '#4f8fff', t: '强' },
    { w: '100%', bg: '#00c758', t: '极强' },
  ];
  const lv = levels[score - 1] || levels[0];
  fill.style.width = lv.w;
  fill.style.background = lv.bg;
  lbl.textContent = lv.t;
  lbl.style.color = lv.bg;

  validateRegField();
}

/**
 * 登录
 */
export async function doLogin() {
  if (_loginCooling) return;

  const email = document.getElementById('loginEmail').value.trim();
  const pwd = document.getElementById('loginPwd').value;

  // 前端校验
  let hasErr = false;
  if (!email) {
    setFieldError('loginEmailErr', '邮箱不能为空');
    hasErr = true;
  } else if (!EMAIL_RE.test(email)) {
    setFieldError('loginEmailErr', '邮箱格式不正确');
    hasErr = true;
  } else {
    setFieldError('loginEmailErr', '');
  }

  if (!pwd) {
    setFieldError('loginPwdErr', '密码不能为空');
    hasErr = true;
  } else {
    setFieldError('loginPwdErr', '');
  }

  if (hasErr) return;

  _loginCooling = true;
  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 登录中…';

  try {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: pwd }),
    });

    if (data.code !== 0) {
      toast('❌ ' + (data.msg || '登录失败'));
      return;
    }

    setToken(data.data.token);
    setMe(data.data.user);

    // 触发进入仪表盘（由主应用处理）
    window.enterDash && window.enterDash();
  } catch (e) {
    if (e.message !== 'Unauthorized') toast('❌ ' + (e.message || '连接失败'));
  } finally {
    btn.disabled = false;
    btn.textContent = '登 录';
    setTimeout(() => { _loginCooling = false; }, 500);
  }
}

/**
 * 注册
 */
export async function doRegister() {
  if (_regCooling) return;

  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const pwd = document.getElementById('regPwd').value;
  const pwd2 = document.getElementById('regPwd2')?.value;

  let hasErr = false;
  if (!name) {
    setFieldError('regNameErr', '用户名不能为空');
    hasErr = true;
  } else {
    setFieldError('regNameErr', '');
  }

  if (!email) {
    setFieldError('regEmailErr', '邮箱不能为空');
    hasErr = true;
  } else if (!EMAIL_RE.test(email)) {
    setFieldError('regEmailErr', '邮箱格式不正确');
    hasErr = true;
  } else {
    setFieldError('regEmailErr', '');
  }

  if (!pwd) {
    setFieldError('regPwdErr', '密码不能为空');
    hasErr = true;
  } else if (!PWD_RE.test(pwd)) {
    setFieldError('regPwdErr', '密码须8-16位，含大小写字母、数字及特殊字符');
    hasErr = true;
  } else {
    setFieldError('regPwdErr', '');
  }

  if (pwd2 !== pwd) {
    setFieldError('regPwd2Err', '两次密码不一致');
    hasErr = true;
  } else {
    setFieldError('regPwd2Err', '');
  }

  if (hasErr) return;

  _regCooling = true;
  const btn = document.getElementById('regBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 注册中…';

  try {
    const data = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password: pwd, confirmPassword: pwd2, name }),
    });

    if (data.code !== 0) {
      toast('❌ ' + (data.msg || '注册失败'));
      return;
    }

    toast('✅ 注册成功，请登录');
    switchTab('login');
  } catch (e) {
    if (e.message !== 'Unauthorized') toast('❌ 连接失败，请检查后端');
  } finally {
    btn.disabled = false;
    btn.textContent = '注 册';
    setTimeout(() => { _regCooling = false; }, 500);
  }
}

/**
 * 显示认证界面
 */
export function showAuth() {
  document.getElementById('authWrap')?.classList.remove('hidden');
  document.getElementById('dashWrap')?.classList.add('hidden');
}

/**
 * 登出
 */
export function doLogout() {
  setToken(null);
  setMe(null);
  showAuth();
}

/**
 * 获取当前验证码 token
 */
export function getCaptchaToken(type) {
  return type === 'login' ? _loginCaptchaToken : _regCaptchaToken;
}

/**
 * 检查是否已登录
 */
export function isAuthenticated() {
  return !!_token && !!_me;
}

/**
 * 检查是否是管理员
 */
export function isAdmin() {
  return _me?.role === 'admin';
}

/**
 * 获取当前用户信息
 */
export function getCurrentUser() {
  return _me;
}
