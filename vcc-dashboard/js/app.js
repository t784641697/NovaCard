// ══════════════════════════════════════════════
//  CONFIG & STATE
// ══════════════════════════════════════════════
const API_BASE = (window.location.hostname==='localhost'||window.location.hostname==='127.0.0.1')
  ? 'http://localhost:3000/api' : '/api';

let _token = localStorage.getItem('vcc_token') || null;
let _me    = JSON.parse(localStorage.getItem('vcc_me') || 'null');


// 诊断函数 - 用于测试管理员按钮显示
window.debugAdminButton = function() {

  console.log('是否为管理员 (_me?.role === "admin"):', _me?.role === 'admin');


  // 在页面顶部显示诊断结果
  const debugDiv = document.createElement('div');
  debugDiv.id = 'admin-debug-info';
  debugDiv.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    z-index: 9999;
    background: #1e253a;
    color: #e8eaf6;
    padding: 12px 16px;
    border-radius: 8px;
    border: 1px solid rgba(79,143,255,.3);
    font-family: monospace;
    font-size: 12px;
    max-width: 400px;
    max-height: 300px;
    overflow: auto;
    box-shadow: 0 4px 20px rgba(0,0,0,.4);
  `;
  
  debugDiv.innerHTML = `
    <div style="color:#4f8fff; font-weight: bold; margin-bottom: 8px;">🔍 管理员按钮诊断</div>
    <div>用户角色: <span style="color:${_me?.role === 'admin' ? '#00c758' : '#ff5f5f'}">${_me?.role || '未登录'}</span></div>
    <div>是否为管理员: <span style="color:${_me?.role === 'admin' ? '#00c758' : '#ff5f5f'}">${_me?.role === 'admin'}</span></div>
    <div>详情函数: <span style="color:${typeof window.showAdminCardDetail === 'function' ? '#00c758' : '#ff5f5f'}">${typeof window.showAdminCardDetail === 'function' ? '已定义' : '未定义'}</span></div>
    <div style="margin-top: 8px; font-size: 10px; color: #a6aabe;">按ESC关闭此窗口</div>
  `;
  
  document.body.appendChild(debugDiv);
  
  // 按ESC关闭
  const closeHandler = (e) => {
    if (e.key === 'Escape') {
      debugDiv.remove();
      document.removeEventListener('keydown', closeHandler);
    }
  };
  document.addEventListener('keydown', closeHandler);
  
  // 5秒后自动关闭
  setTimeout(() => {
    if (debugDiv.parentNode) {
      debugDiv.remove();
      document.removeEventListener('keydown', closeHandler);
    }
  }, 5000);
  
  // 如果未登录为管理员，提示如何登录
  if (!_me || _me?.role !== 'admin') {
    console.log('提示: 请使用管理员账号登录 (admin@vcc.hub / admin123)');
  }
};
let _curPage = 'cards';
let _rechargeCardId = null;
let _selectedBin = null;
let _productList = null;

// ══════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════
let _toastTimer = null;
function _detectType(msg) {
  if (msg.startsWith('✅')) return 'success';
  if (msg.startsWith('❌')) return 'error';
  if (msg.startsWith('⚠️') || msg.startsWith('🔒') || msg.startsWith('📭')) return 'warning';
  return 'success';
}
function _iconHTML(type, msg) {
  var icons = { success: '✓', error: '✕', warning: '!' };
  var titles = { success: '操作成功', error: '操作失败', warning: '提示' };
  return '<div class="toast-icon">' + icons[type] + '</div>' + '<div class="toast-body"><div class="toast-title">' + titles[type] + '</div><div class="toast-msg">' + msg + '</div></div>';
}
function toast(msg, duration) {
  duration = duration || 2800;
  var type = _detectType(msg);
  showToast(msg.replace(/^[✅❌⚠️]\s*/, ''), type, duration);
}
function showToast(msg, type, duration) {
  if (!type) type = 'success';
  if (!duration) duration = 2800;
  var el = document.getElementById('toast');
  el.innerHTML = '<div class="toast-box ' + type + '">' + _iconHTML(type, msg) + '</div>';
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function() { el.classList.remove('show'); }, duration);
}

// ══════════════════════════════════════════════
//  API
// ══════════════════════════════════════════════
async function apiFetch(path, opts={}) {
  try {
    const headers = {'Content-Type':'application/json',...(opts.headers||{})};
    if (_token) headers['Authorization'] = 'Bearer ' + _token;
    
    // 添加超时控制（60秒，vmcardio沙盒API响应慢，冻结/解冻等操作需较长时间）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    
    const res = await fetch(API_BASE + path, {...opts, headers, signal: controller.signal});
    clearTimeout(timeoutId);  // 请求完成，清除超时
    
    // 检查HTTP状态码
    if (res.status === 429) {
      // 频率限制错误，返回特定的错误信息
      return { code: 429, msg: '请求过于频繁，请稍后再试' };
    }
    
    if (!res.ok && res.status !== 200 && res.status !== 304) {
      // 其他HTTP错误（304是缓存正常响应，不算错误）
      let errorMsg = `HTTP ${res.status}`;
      try {
        const errorData = await res.json();
        errorMsg = errorData.msg || errorMsg;
      } catch (e) {
        // 无法解析JSON响应
      }
      return { code: res.status, msg: errorMsg };
    }
    
    const json = await res.json();
    
    if (res.status === 401) {
      _token = null; _me = null;
      localStorage.removeItem('vcc_token');
      localStorage.removeItem('vcc_me');
      showAuth();
      throw new Error('Unauthorized');
    }
    return json;
  } catch (err) {

    // 网络错误、解析错误或超时
    let errorMsg;
    if (err.name === 'AbortError') {
      errorMsg = '请求超时，请检查网络连接或刷新重试';
    } else if (err.name === 'TypeError') {
      errorMsg = '网络连接失败，请检查网络';
    } else {
      errorMsg = `请求失败: ${err.message}`;
    }
    return { 
      code: -1,  // 使用-1表示网络错误，避免与成功码0混淆
      msg: errorMsg 
    };
  }
}

// ══════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════
function switchTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('tabLogin').classList.toggle('active', isLogin);
  document.getElementById('tabReg').classList.toggle('active', !isLogin);
  document.getElementById('loginForm').classList.toggle('hidden', !isLogin);
  document.getElementById('regForm').classList.toggle('hidden', isLogin);
  refreshCaptcha(isLogin ? 'login' : 'reg');
}

// ══════════════════════════════════════════════
//  AUTH — 验证码 token 缓存
// ══════════════════════════════════════════════
let _loginCaptchaToken = '';
let _regCaptchaToken   = '';

// 密码规则
const PWD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()\-_=+\[\]{};:'",.<>/?\\|`~])[A-Za-z\d!@#$%^&*()\-_=+\[\]{};:'",.<>/?\\|`~]{8,16}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── 刷新图形验证码 ────────────────────────────────────────────────────────
const _CAPTCHA_LOADING_SVG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='110' height='40'%3E%3Crect width='100%25' height='100%25' fill='%231e253a'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%239da3c0' font-size='13'%3E加载中...%3C/text%3E%3C/svg%3E";
async function refreshCaptcha(type) {
    const imgId = type === 'login' ? 'loginCaptchaImg' : 'regCaptchaImg';
    const img = document.getElementById(imgId);
    // 立即显示 loading 占位，让用户感知到请求已触发
    if (img) { img.style.opacity = '0.5'; img.src = _CAPTCHA_LOADING_SVG; }
    try {
        const data = await apiFetch('/auth/captcha', { method:'GET' });
        if (data.code !== 0) return;
        if (type === 'login') {
            _loginCaptchaToken = data.data.token;
        } else {
            _regCaptchaToken = data.data.token;
        }
        if (img) { img.src = data.data.image; img.style.opacity = '1'; }
    } catch(e) {

        if (img) img.style.opacity = '1';
    }
}

// ── 显示/隐藏密码 ─────────────────────────────────────────────────────────
function togglePwd(inputId, icon) {
  const inp = document.getElementById(inputId);
  if (inp.type === 'password') { inp.type = 'text';     icon.style.opacity = '1'; }
  else                         { inp.type = 'password'; icon.style.opacity = '.6'; }
}

// ── 密码强度实时检测 ──────────────────────────────────────────────────────
function onRegPwdInput() {
  const pwd  = document.getElementById('regPwd').value;
  const wrap = document.getElementById('pwdStrengthWrap');
  const fill = document.getElementById('pwdStrengthFill');
  const lbl  = document.getElementById('pwdStrengthLabel');

  const rLen     = pwd.length >= 8 && pwd.length <= 16;
  const rUpper   = /[A-Z]/.test(pwd);
  const rNum     = /\d/.test(pwd);
  const rSpecial = /[!@#$%^&*()\-_=+\[\]{};:'",.<>/?\\|`~]/.test(pwd);

  setRule('r-len',     rLen);
  setRule('r-upper',   rUpper);
  setRule('r-num',     rNum);
  setRule('r-special', rSpecial);

  if (pwd.length === 0) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';

  const score = [rLen, rUpper, rNum, rSpecial].filter(Boolean).length;
  const levels = [
    { w:'25%', bg:'#ff5f5f', t:'弱' },
    { w:'50%', bg:'#ffb347', t:'中' },
    { w:'75%', bg:'#4f8fff', t:'强' },
    { w:'100%',bg:'#00c758', t:'极强' },
  ];
  const lv = levels[score - 1] || levels[0];
  fill.style.width      = lv.w;
  fill.style.background = lv.bg;
  lbl.textContent       = lv.t;
  lbl.style.color       = lv.bg;

  validateRegField();
}

function setRule(id, pass) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = pass ? 'ok' : '';
  el.textContent = (pass ? '✓ ' : '✗ ') + el.textContent.slice(2);
}

// ── 登录表单实时校验 ──────────────────────────────────────────────────────
function validateLoginField() {
  const email = document.getElementById('loginEmail').value.trim();
  const pwd   = document.getElementById('loginPwd').value;
  let ok = true;

  if (email && !EMAIL_RE.test(email)) {
    setFieldError('loginEmailErr', '邮箱格式不正确'); ok = false;
  } else {
    setFieldError('loginEmailErr', '');
  }
  if (pwd && pwd.length < 6) {
    setFieldError('loginPwdErr', '密码长度不合法'); ok = false;
  } else {
    setFieldError('loginPwdErr', '');
  }
  return ok;
}

// ── 注册表单实时校验 ──────────────────────────────────────────────────────
function validateRegField() {
  const email = document.getElementById('regEmail').value.trim();
  const pwd   = document.getElementById('regPwd').value;
  const pwd2  = document.getElementById('regPwd2').value;
  let ok = true;

  if (email && !EMAIL_RE.test(email)) {
    setFieldError('regEmailErr', '邮箱格式不正确'); ok = false;
  } else {
    setFieldError('regEmailErr', '');
  }
  if (pwd && !PWD_RE.test(pwd)) {
    setFieldError('regPwdErr', '密码须8-16位，含大小写字母、数字及特殊字符'); ok = false;
  } else {
    setFieldError('regPwdErr', '');
  }
  if (pwd2 && pwd2 !== pwd) {
    setFieldError('regPwd2Err', '两次密码不一致'); ok = false;
  } else {
    setFieldError('regPwd2Err', '');
  }
  return ok;
}

function setFieldError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}

// ── 防频繁点击（500ms 冷却）────────────────────────────────────────────────
let _loginCooling = false, _regCooling = false;

// ══════════════════════════════════════════════
//  登录
// ══════════════════════════════════════════════
async function doLogin() {
  if (_loginCooling) return;

  const email   = document.getElementById('loginEmail').value.trim();
  const pwd     = document.getElementById('loginPwd').value;

  // 前端校验
  let hasErr = false;
  if (!email)            { setFieldError('loginEmailErr',   '邮箱不能为空');         hasErr=true; }
  else if (!EMAIL_RE.test(email)) { setFieldError('loginEmailErr', '邮箱格式不正确'); hasErr=true; }
  else                   { setFieldError('loginEmailErr', ''); }

  if (!pwd)              { setFieldError('loginPwdErr', '密码不能为空'); hasErr=true; }
  else                   { setFieldError('loginPwdErr', ''); }

  if (hasErr) return;

  _loginCooling = true;
  const btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 登录中…';

  try {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password:      pwd,
      }),
    });
    if (data.code !== 0) {
      toast('❌ ' + (data.msg || '登录失败'));
      return;
    }


    _token = data.data.token; _me = data.data.user;
    localStorage.setItem('vcc_token', _token);
    localStorage.setItem('vcc_me', JSON.stringify(_me));
    enterDash();
  } catch(e) {
    if (e.message !== 'Unauthorized') toast('❌ ' + (e.message || '连接失败'));
  } finally {
    btn.disabled = false; btn.textContent = '登 录';
    setTimeout(() => { _loginCooling = false; }, 500);
  }
}

// ══════════════════════════════════════════════
//  注册
// ══════════════════════════════════════════════
async function doRegister() {
  if (_regCooling) return;

  const name   = document.getElementById('regName').value.trim();
  const email  = document.getElementById('regEmail').value.trim();
  const pwd    = document.getElementById('regPwd').value;
  const pwd2   = document.getElementById('regPwd2').value;

  let hasErr = false;
  if (!name)    { setFieldError('regNameErr',   '用户名不能为空');  hasErr=true; }
  else          { setFieldError('regNameErr', ''); }

  if (!email)            { setFieldError('regEmailErr', '邮箱不能为空');         hasErr=true; }
  else if (!EMAIL_RE.test(email)) { setFieldError('regEmailErr', '邮箱格式不正确'); hasErr=true; }
  else                   { setFieldError('regEmailErr', ''); }

  if (!pwd)     { setFieldError('regPwdErr', '密码不能为空'); hasErr=true; }
  else if (!PWD_RE.test(pwd)) { setFieldError('regPwdErr', '密码须8-16位，含大小写字母、数字及特殊字符'); hasErr=true; }
  else          { setFieldError('regPwdErr', ''); }

  if (pwd2 !== pwd) { setFieldError('regPwd2Err', '两次密码不一致'); hasErr=true; }
  else              { setFieldError('regPwd2Err', ''); }

  if (hasErr) return;

  _regCooling = true;
  const btn = document.getElementById('regBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 注册中…';

  try {
    const data = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email, password: pwd, confirmPassword: pwd2, name,
      }),
    });
    if (data.code !== 0) {
      toast('❌ ' + (data.msg || '注册失败'));
      return;
    }
    toast('✅ 注册成功，请登录');
    switchTab('login');
  } catch(e) {
    if (e.message !== 'Unauthorized') toast('❌ 连接失败，请检查后端');
  } finally {
    btn.disabled = false; btn.textContent = '注 册';
    setTimeout(() => { _regCooling = false; }, 500);
  }
}

function showAuth() {
  document.getElementById('authWrap').classList.remove('hidden');
  document.getElementById('dashWrap').classList.add('hidden');
  // refreshCaptcha('login'); // 验证码暂时注释
}
function enterDash() {
  document.getElementById('authWrap').classList.add('hidden');
  document.getElementById('dashWrap').classList.remove('hidden');
  // 更新侧边栏用户信息
  const avatar = (_me?.name||_me?.email||'U')[0].toUpperCase();
  document.getElementById('sidebarAvatar').textContent = avatar;
  document.getElementById('sidebarName').textContent = _me?.name || _me?.email || '用户';
  document.getElementById('sidebarRole').textContent = _me?.role === 'admin' ? '管理员' : '普通用户';
  
  // 管理员专属导航和隐藏普通用户菜单
  const adminSection = document.getElementById('nav-admin-section');
  const financeSection = document.getElementById('nav-finance-section');
  const virtualCardSection = document.querySelector('.nav-section:nth-child(1)'); // 第一个 nav-section
  
  if (_me?.role === 'admin') {
    // 管理员：隐藏虚拟卡和账务菜单，显示管理员菜单
    if (virtualCardSection) virtualCardSection.style.display = 'none';
    if (financeSection) financeSection.style.display = 'none';
    adminSection.classList.remove('hidden');
    // 管理员：优先恢复上次页面，否则默认管理总览
    const lastPage = localStorage.getItem('vcc_page');
    gotoPage(lastPage || 'admin-dashboard');
  } else {
    // 普通用户：显示虚拟卡和账务菜单，隐藏管理员菜单
    if (virtualCardSection) virtualCardSection.style.display = '';
    if (financeSection) financeSection.style.display = '';
    adminSection.classList.add('hidden');
    const lastPage = localStorage.getItem('vcc_page');
    gotoPage(lastPage || 'cards');
  }
  
  // 延迟检查账户余额，确保 _me 已初始化
  setTimeout(() => {
    checkAccountBalanceWarning();
  }, 300);
}
function doLogout() {
  _token = null; _me = null;
  localStorage.removeItem('vcc_token');
  localStorage.removeItem('vcc_me');
  showAuth();
}

// ══════════════════════════════════════════════
//  账户余额检查 & 弹窗提醒
// ══════════════════════════════════════════════
async function checkAccountBalanceWarning() {
  // 管理员不需要此弹窗，商户余额在管理总览页面直接可见
  if (_me?.role === 'admin') return;
  
  try {
    const r = await apiFetch('/cards/account/balance');
    if (r?.code === 0 && r?.data) {
      const balance = Number(r.data.balance) || 0;
      if (balance < 100) {
        showBalanceWarningModal(balance, '账户余额');
      }
    }
  } catch(e) {
    // 静默失败，不影响正常使用
  }
}

function showBalanceWarningModal(balance, balanceType = '账户余额') {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed;top:0;left:0;right:0;bottom:0;
    background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;
    z-index:9999;
  `;
  
  const modal = document.createElement('div');
  modal.style.cssText = `
    background:linear-gradient(135deg, #0d1322 0%, #13192a 100%);
    border:1px solid rgba(0,242,254,.2);border-radius:16px;
    padding:32px;max-width:420px;width:90%;
    box-shadow:0 20px 60px rgba(0,0,0,.4);
  `;
  
  const title = balanceType === '商户余额' ? '商户余额不足' : '账户余额不足';
  const description = balanceType === '商户余额' 
    ? '商户余额已低于 <strong style="color:#00f2fe;">$100</strong>，建议及时向vmcardio平台充值，确保用户可以正常使用卡片。'
    : '您的账户余额已低于 <strong style="color:#00f2fe;">$100</strong>，建议及时充值，确保卡片正常消费。';
  
  const buttonAction = balanceType === '商户余额' 
    ? 'gotoPage(\\\"admin-dashboard\\\")' 
    : 'openTopupTypeModal()';
  const buttonText = balanceType === '商户余额' ? '查看商户详情' : '立即充值';
  
  modal.innerHTML = `
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;">
      <div style="font-size:32px;line-height:1;">⚠️</div>
      <h3 style="margin:0;color:#ffb347;font-size:18px;font-weight:700;\">${title}</h3>
    </div>
    <p style="color:#a6aabe;margin:0 0 20px;line-height:1.6;font-size:14px;\">
      ${description}
    </p>
    <div style="background:rgba(0,242,254,.08);border-left:3px solid #00f2fe;padding:12px;border-radius:6px;margin-bottom:24px;">
      <div style="font-size:12px;color:#a6aabe;margin-bottom:4px;\">当前${balanceType}</div>
      <div style="font-size:24px;font-weight:700;color:#00f2fe;\">\$${balance.toFixed(2)}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;\">
      <button onclick="this.parentElement.parentElement.parentElement.remove()" 
        style="padding:10px 16px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:8px;color:#e1e5f9;cursor:pointer;font-weight:600;transition:.2s;\">
        稍后处理
      </button>
      <button onclick="${buttonAction};this.parentElement.parentElement.parentElement.remove()\" 
        style="padding:10px 16px;background:linear-gradient(135deg, #00f2fe 0%, #00deec 100%);border:none;border-radius:8px;color:#000;cursor:pointer;font-weight:600;transition:.2s;\">
        ${buttonText}
      </button>
    </div>
  `;
  
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

// ══════════════════════════════════════════════
//  ROUTING
// ══════════════════════════════════════════════
const PAGE_META = {
  cards: { title:'账户总览', sub:'' },
  apply: { title:'申请开卡', sub:'选择卡段，提交开卡申请' },
  topup: { title:'充值', sub:'充值到账户余额，支持 USDT 等方式' },
  ledger: { title:'账户流水', sub:'账户资金进出记录' },
  'card-tx': { title:'卡交易记录', sub:'所有虚拟卡的交易明细' },
  'card-settle': { title:'卡结算记录', sub:'虚拟卡的结算对账记录' },
  'admin-fee-config': { title:'费用设置', sub:'配置全局费率，可为指定用户设置自定义费率' },
  'balance-detail': { title:'账务明细', sub:'账户资金构成、分类统计和余额趋势' },
  'card-mgmt': { title:'卡片管理', sub:'查看和操作所有用户卡片' },
  'admin-card-review': { title:'开卡审核', sub:'审核用户提交的开卡申请，通过后自动调用 vmcardio 开卡' },
  'admin-topup-review': { title:'充值审核', sub:'审核用户提交的充值申请，通过后自动入账用户余额' },
  'admin-settings': { title:'系统设置', sub:'配置钱包收款地址、USDT汇率等系统参数' },
  'admin-finance': { title:'财务中心', sub:'平台资金概览、用户余额分布、充值与费用统计' },
  'admin-tx-monitor': { title:'交易监控', sub:'所有用户所有卡的实时交易记录与统计' },
};

// 页面名 → nav元素id 的补充映射（当 'nav-'+page 找不到对应元素时使用）
const PAGE_NAV_MAP = {
  'card-mgmt': ['nav-card-mgmt', 'nav-admin-cards'],  // 普通用户/管理员共用同一页面
  'admin-dashboard': ['nav-admin-dashboard'],
  'admin-users': ['nav-admin-users'],
  'admin-fee-config': ['nav-admin-fee-config'],
  'admin-card-review': ['nav-admin-card-review'],
  'admin-topup-review': ['nav-admin-topup-review'],
  'admin-finance': ['nav-admin-finance'],
  'admin-tx-monitor': ['nav-admin-tx-monitor'],
  'admin-settings': ['nav-admin-settings'],
};

function gotoPage(page) {
  _curPage = page;
  localStorage.setItem('vcc_page', page);  // 记住当前页面，刷新后恢复
  // 恢复 contentArea 默认样式（管理员卡片管理页面会临时覆盖）
  var area = document.getElementById('contentArea');
  if (area) { area.style.paddingTop = ''; area.style.paddingLeft = ''; area.style.maxWidth = ''; }
  // nav 高亮
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.remove('active'));
  // 优先按映射表找，找不到再用默认规则 nav-{page}
  const navIds = PAGE_NAV_MAP[page] || ['nav-' + page];
  navIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  });
  // topbar
  const meta = PAGE_META[page] || {};
  document.getElementById('topbarTitle').textContent = meta.title||page;
  document.getElementById('topbarSub').textContent   = meta.sub||'';
  // 渲染页面
  area.scrollTo && area.scrollTo({top:0});
  if (page==='overview') (window.renderOverview || renderOverview)();
  else if (page==='cards') (window.renderCards || renderCards)();
  else if (page==='apply') (window.renderApply || renderApply)();
  else if (page==='topup') (window.renderTopup || renderTopup)();
  else if (page==='card-mgmt') renderCardManage();
  else if (page==='ledger') renderLedger();
  else if (page==='card-tx') renderCardTx();
  else if (page==='card-settle') renderCardSettle();
  else if (page==='admin-dashboard') renderAdminDashboard();
  else if (page==='admin-users') renderAdminUsers();
  else if (page==='admin-fee-config') renderFeeConfigPage();
  else if (page==='balance-detail') renderBalanceDetailPage();
  else if (page==='admin-card-review') renderCardReviewPage();
  else if (page==='admin-topup-review') renderTopupReviewPage();
  else if (page==='admin-finance') renderAdminFinance();
  else if (page==='admin-tx-monitor') renderAdminTxMonitor();
  else if (page==='admin-settings') renderAdminSettingsPage();
}

function refreshPage() { gotoPage(_curPage); }

// ══════════════════════════════════════════════
//  PAGE: 账户总览
// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
//  PAGE: 账户总览 — 主入口
// ══════════════════════════════════════════════
async function renderCards() {
  const area = document.getElementById('contentArea');
  area.innerHTML = `
    <div class="page-header">
      <div class="flex items-center justify-between">
        <div>
          <h2>账户总览</h2>
          <p class="text-muted mt-1">资产状况一目了然</p>
        </div>
        <button class="btn btn-primary" onclick="gotoPage('apply')">✨ 申请开卡</button>
      </div>
    </div>

    
    <div class="ov-stat-row">
      <div class="ov-stat-card">
        <div class="ov-stat-label">账户余额</div>
        <div class="ov-stat-val grad-text" id="ovBalance">$—</div>
      </div>
      <div class="ov-stat-card">
        <div class="ov-stat-label">活跃卡片</div>
        <div class="ov-stat-val grad-text" id="ovCardCount">—</div>
        <div class="ov-stat-hint">未冻结 · 未过期</div>
      </div>
    </div>

    
    <div class="panel mb-4">
      <div class="flex items-center justify-between mb-4">
        <div style="font-weight:700;font-size:.95rem">消费趋势</div>
        <div class="ov-tab-group">
          <button class="ov-tab active" onclick="switchOvTab(7,this)">近7天</button>
          <button class="ov-tab" onclick="switchOvTab(30,this)">近30天</button>
          <button class="ov-tab" onclick="switchOvTab(90,this)">近90天</button>
        </div>
      </div>
      <div style="position:relative;height:200px">
        <canvas id="ovChart"></canvas>
        <div id="ovChartEmpty" style="display:none;position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--text3);font-size:.85rem">暂无交易数据</div>
      </div>
    </div>

    
    <div class="panel">
      <div style="font-weight:700;font-size:.95rem;margin-bottom:16px">最近交易记录</div>
      <div id="ovTxList"><div class="skeleton" style="height:200px;border-radius:10px;"></div></div>
    </div>
  `;

  // 并发加载：余额 + 卡片 + 交易
  loadOvBalance();
  loadOvCards();
  loadOvChart(7);
  loadOvTxList();
}

// ── 账户余额 ────────────────────────────────────────────────────────────────
async function loadOvBalance() {
  try {
    const el = document.getElementById('ovBalance');
    if (!el) return;

    if (_me?.role === 'admin') {
      // 管理员：显示 vmcardio 商户余额
      const labelEl = el.previousElementSibling;
      if (labelEl) labelEl.textContent = '商户余额';
      const r = await apiFetch('/admin/stats');
      if (r?.code === 0 && r?.data?.merchant_balance != null) {
        el.textContent = '$' + Number(r.data.merchant_balance).toFixed(2);
      } else {
        el.textContent = '$—';
      }
    } else {
      // 普通用户：显示个人账户余额
      const r = await apiFetch('/cards/account/balance');
      el.textContent = r.code === 0 ? '$' + Number(r.data.balance).toFixed(2) : '$—';
    }
  } catch(e) {}
}

// ── 活跃卡片数量（未冻结且未过期）──────────────────────────────────────────
async function loadOvCards() {
  try {
    const r = await apiFetch('/cards');
    const el = document.getElementById('ovCardCount');
    if (!el) return;
    if (r.code !== 0) { el.textContent = '—'; return; }
    const now = new Date();
    const active = (r.data||[]).filter(c => {
      if (c.error) return false;
      if ((c.status||'').toUpperCase() !== 'ACTIVE') return false;
      // 过期判断：expire 格式 MM/YY
      if (c.expire) {
        const [mm, yy] = c.expire.split('/');
        const exp = new Date(2000 + parseInt(yy||0), parseInt(mm||1) - 1, 1);
        if (exp < now) return false;
      }
      return true;
    });
    el.textContent = active.length;
  } catch(e) {}
}

// ── 交易趋势折线图 ──────────────────────────────────────────────────────────
let _ovChartInstance = null;
let _ovTxCache = null;  // 缓存交易数据，避免重复请求

async function loadOvChart(days) {
  const canvas = document.getElementById('ovChart');
  if (!canvas) return;

  // 获取交易数据（首次拉取，后续用缓存）
  if (!_ovTxCache) {
    try {
      const r = await apiFetch('/transactions?page_size=200');
      _ovTxCache = (r.code === 0 && r.data?.list) ? r.data.list : [];
    } catch(e) { _ovTxCache = []; }
  }

  // 只保留消费成功的记录（transaction_type: consume / spend，status: success）
  const successTx = _ovTxCache.filter(t => {
    const type = (t.transaction_type||t.type||'').toLowerCase();
    const status = (t.status||'').toLowerCase();
    return status === 'success' && (type.includes('consume') || type.includes('spend') || type.includes('payment'));
  });

  // 按天聚合最近 N 天
  const now = new Date();
  const labels = [];
  const values = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = `${d.getMonth()+1}/${d.getDate()}`;
    labels.push(key);
    const dayTotal = successTx.filter(t => {
      const td = new Date(t.auth_time || t.created_at || 0);
      return td.getFullYear()===d.getFullYear() && td.getMonth()===d.getMonth() && td.getDate()===d.getDate();
    }).reduce((sum, t) => sum + Math.abs(Number(t.transaction_amount || t.amount || 0)), 0);
    values.push(parseFloat(dayTotal.toFixed(2)));
  }

  const hasData = values.some(v => v > 0);
  const emptyEl = document.getElementById('ovChartEmpty');
  if (emptyEl) emptyEl.style.display = hasData ? 'none' : 'flex';

  // 销毁旧图表
  if (_ovChartInstance) { _ovChartInstance.destroy(); _ovChartInstance = null; }

  _ovChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '消费金额 ($)',
        data: values,
        borderColor: '#00f2fe',
        backgroundColor: 'rgba(0,242,254,0.08)',
        pointBackgroundColor: '#00f2fe',
        pointRadius: 3,
        pointHoverRadius: 5,
        tension: 0.4,
        fill: true,
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1e253a',
          borderColor: 'rgba(0,242,254,.2)',
          borderWidth: 1,
          titleColor: '#a6aabe',
          bodyColor: '#e1e5f9',
          callbacks: { label: ctx => ' $' + ctx.parsed.y.toFixed(2) }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,.04)' },
          ticks: { color: '#707587', font: { size: 11 }, maxTicksLimit: days <= 7 ? 7 : 10 }
        },
        y: {
          grid: { color: 'rgba(255,255,255,.04)' },
          ticks: { color: '#707587', font: { size: 11 }, callback: v => '$' + v }
        }
      }
    }
  });
}

function switchOvTab(days, btn) {
  document.querySelectorAll('.ov-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _ovTxCache = null; // 切换天数时重新拉（可选，也可直接用缓存过滤）
  loadOvChart(days);
}

// ── 最近交易记录列表 ─────────────────────────────────────────────────────────
async function loadOvTxList() {
  const wrap = document.getElementById('ovTxList');
  if (!wrap) return;

  // 表头（始终展示）
  const TABLE_HEAD = `
  <div class="ov-tx-head">
    <div>卡BIN</div>
    <div>卡产品<span style="color:var(--text3);font-size:.65rem;font-weight:400">-待定</span></div>
    <div>商户名称<span style="color:var(--text3);font-size:.65rem;font-weight:400">-待定</span></div>
    <div>交易类型</div>
    <div>交易状态</div>
    <div style="text-align:right">交易金额<span style="color:var(--text3);font-size:.65rem;font-weight:400">-待定</span></div>
    <div style="text-align:right">交易时间</div>
  </div>`;

  try {
    const r = await apiFetch('/transactions?page_size=10');
    if (r.code !== 0 || !(r.data?.list||[]).length) {
      wrap.innerHTML = TABLE_HEAD +
        '<div style="text-align:center;padding:28px 0;color:var(--text3);font-size:.85rem">暂无交易记录</div>';
      return;
    }
    const txTypeMap = {
      Authorization: '消费授权',
      Settlement: '清算',
      Refund: '退款',
      Reversal: '撤销',
    };
    const txStatusMap = {
      PENDING: { cls: 'tag-yellow', label: '清算中' },
      DECLINED: { cls: 'tag-red', label: '失败' },
      COMPLETE: { cls: 'tag-green', label: '完成' },
    };
    const rows = r.data.list.map(t => {
      const typeRaw = (t.transaction_type || '').toString();
      const typeCn = txTypeMap[typeRaw] || typeRaw || '—';
      const statusRaw = (t.status || '').toUpperCase();
      const statusInfo = txStatusMap[statusRaw] || { cls: 'tag-purple', label: statusRaw || '—' };
      const bin = (t.card_id || '').slice(0, 6) || '—';
      const product = t.product_code || '—';
      const merchant = t.merchant_name || '—';
      const txAmt = t.amount !== undefined ? Number(t.amount) : null;
      const amtColor = txAmt !== null && txAmt < 0 ? 'var(--red)' : txAmt !== null && txAmt > 0 ? 'var(--green)' : 'var(--text2)';
      const dt = t.start_time
        ? new Date(t.start_time).toLocaleString('zh-CN', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})
        : '—';
      return `
      <div class="ov-tx-row">
        <div class="ov-tx-cell">${bin}</div>
        <div class="ov-tx-cell">${product}</div>
        <div class="ov-tx-cell ov-tx-merchant">${merchant}</div>
        <div class="ov-tx-cell"><span class="tag tag-blue" style="font-size:.68rem">${typeCn}</span></div>
        <div class="ov-tx-cell"><span class="tag ${statusInfo.cls}" style="font-size:.68rem">${statusInfo.label}</span></div>
        <div class="ov-tx-cell" style="text-align:right;font-weight:700;color:${amtColor}">
          ${txAmt !== null ? (txAmt >= 0 ? '+' : '') + txAmt.toFixed(2) : '—'}
        </div>
        <div class="ov-tx-cell" style="text-align:right;color:var(--text3);font-size:.78rem">${dt}</div>
      </div>`;
    }).join('');
    wrap.innerHTML = TABLE_HEAD + `<div class="ov-tx-body">${rows}</div>`;
  } catch(e) {
    if (e.message !== 'Unauthorized') wrap.innerHTML = '<div style="color:var(--red);font-size:.85rem;padding:12px">加载失败</div>';
  }
}

function cardGradClass(i) {
  return ['vcard-1','vcard-2','vcard-3'][i % 3];
}

// ── 卡片详情弹窗 ──
async function showCardDetail(cardId) {
  const modal = document.getElementById('cardModal');
  const body  = document.getElementById('cardModalBody');
  modal.classList.add('open');
  body.innerHTML = '<div style="padding:40px;text-align:center"><span class="spinner"></span></div>';
  try {
    const res = await apiFetch(`/cards/${cardId}`);
    if (res.code!==0) { body.innerHTML = `<div style="color:var(--red);padding:20px">${res.msg}</div>`; return; }
    const c = res.data;
    const isActive = (c.status||'').toUpperCase()==='ACTIVE';
    const isInvalid = c.verified_status === 'invalid';
    const addr = c.card_address||{};
    const field = (label,val,mono,blur)=>{
      if (!val && val!==0) return '';
      const id = 'cf_'+Math.random().toString(36).slice(2);
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:.8rem;color:var(--text2)">${label}</span>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-family:${mono?'monospace':'inherit'};font-size:.88rem;font-weight:600;
            ${blur?'filter:blur(5px);cursor:pointer':''};" id="${id}"
            ${blur?`onclick="document.getElementById('${id}').style.filter=document.getElementById('${id}').style.filter?'':'blur(5px)'"`:''}>
            ${val}
          </span>
          ${blur?`<button onclick="copyVal('${val}')" style="font-size:.7rem;padding:2px 7px;border-radius:5px;border:1px solid var(--border2);background:transparent;color:var(--text2);cursor:pointer">复制</button>`:''}
        </div>
      </div>`;
    };
    body.innerHTML = `
      
      <div class="vcard ${cardGradClass(0)}" style="margin-bottom:20px;cursor:default">
        <div class="vcard-top">
          <span class="vcard-network">${/visa/i.test(c.card_type||'')?'VISA':'MASTERCARD'}</span>
          <span class="vcard-status-dot" style="background:${isActive?'var(--green)':'var(--red)'}"></span>
        </div>
        <div class="vcard-number">${(c.card_number||'').replace(/(\d{4})(?=\d)/g,'$1 ')||'**** **** **** ****'}</div>
        <div class="vcard-bottom">
          <div><div class="vcard-label">持卡人</div><div class="vcard-value">${c.first_name||''} ${c.last_name||''}</div></div>
          <div style="text-align:center"><div class="vcard-label">CVV</div><div class="vcard-value">${c.cvv||'—'}</div></div>
          <div style="text-align:right"><div class="vcard-label">有效期</div><div class="vcard-value">${c.expire||'—'}</div></div>
        </div>
      </div>
      ${!isActive ? '<div class="card-frozen-banner"><div class="cfb-header"><svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg><span>该卡片当前处于冻结状态</span></div><div class="cfb-body"><ul style="margin:0;padding-left:14px;"><li>如果该卡片绑定了任何平台或服务，请尽快解绑，避免因自动扣费产生不必要的支出</li><li>卡片余额如有剩余，建议尽快转出至账户余额，以免资金滞留</li></ul></div></div>' : ''}
      
      <div style="padding:0 2px">
        ${field('Card ID', c.card_id, true, false)}
        ${field('完整卡号', c.card_number, true, true)}
        ${field('CVV', c.cvv, true, true)}
        ${field('有效期', c.expire, false, false)}
        ${field('状态', isActive?'✅ ACTIVE':'🔒 CANCELLED', false, false)}
        ${field('可用余额', c.available_amount!==undefined ? '$'+Number(c.available_amount).toFixed(2) : undefined, false, false)}
        ${field('卡类型', c.card_type, false, false)}
        ${field('地址', [addr.address_line_one,addr.city,addr.country].filter(Boolean).join(', ')||undefined, false, false)}
      </div>
      
      <div class="flex gap-3 mt-4">
        ${!isInvalid ? '<button class="btn btn-primary flex-1" onclick="closeCardModal();openRechargeModal(\'' + c.card_id + '\',\'' + (c.card_number||'') + '\')">💰 充值</button>' : '<button class="btn btn-outline flex-1" disabled style="opacity:.4;cursor:not-allowed">该卡片已失效</button>'}
        ${!isInvalid ? '<button class="btn btn-outline flex-1" onclick="closeCardModal();doFreeze(\'' + c.card_id + '\',\'' + (c.status||'ACTIVE') + '\',\'' + (c.verified_status||'') + '\')">' + (isActive ? '🔒 冻结' : '🔓 解冻') + '</button>' : ''}
        <button class="btn btn-outline flex-1" onclick="closeCardModal();showFbCodesModal(\'' + c.card_id + '\')" style="border-color:#1877f2;color:#1877f2;">🔍 FB验证码</button>
      </div>
    `;
  } catch(e) {
    if (e.message!=='Unauthorized') body.innerHTML='<div style="color:var(--red);padding:20px">加载失败</div>';
  }
}
function closeCardModal(e) {
  if (e && e.target!==document.getElementById('cardModal')) return;
  document.getElementById('cardModal').classList.remove('open');
}

// ── 充值弹窗 ──
function openRechargeModal(cardId, cardNumber) {
  _rechargeCardId = cardId;
  document.getElementById('rechargeCardInfo').textContent = '卡片：' + (cardNumber||cardId);
  document.getElementById('rechargeAmt').value = '';
  document.getElementById('rechargeModal').classList.add('open');
}
function closeRechargeModal(e) {
  if (e && e.target!==document.getElementById('rechargeModal')) return;
  document.getElementById('rechargeModal').classList.remove('open');
}
async function confirmRecharge() {
  const amt = parseFloat(document.getElementById('rechargeAmt').value);
  if (!amt||amt<=0) { toast('⚠️ 请输入有效金额'); return; }
  if (amt<10) { toast('⚠️ 最低充值 $10'); return; }
  const btn = document.getElementById('rechargeConfirmBtn');
  btn.disabled = true; btn.innerHTML='<span class="spinner"></span> 处理中…';
  try {
    const res = await apiFetch(`/cards/${_rechargeCardId}/recharge`,{method:'POST',body:JSON.stringify({amount:amt})});
    if (res.code!==0) { toast('❌ '+(res.msg||'充值失败')); return; }
    toast(`✅ 充值 $${amt} 成功`);
    closeRechargeModal();
    if (_curPage==='cards') renderCards();
  } catch(e) {
    if (e.message!=='Unauthorized') toast('❌ 充值失败');
  } finally {
    btn.disabled=false; btn.textContent='确认充值';
  }
}

// ── 冻结/解冻 ──
async function doFreeze(cardId, currentStatus, verifiedStatus) {
  const cur = String(currentStatus).toUpperCase();
  const newStatus = cur==='CANCELLED'?'ACTIVE':'CANCELLED';
  const action = newStatus==='CANCELLED'?'冻结':'解冻';
  // 前置校验：失效卡片不允许操作
  if (verifiedStatus === 'invalid') {
    toast('该卡片已失效，无法执行' + action + '操作', 3000);
    return;
  }
  if (!confirm('确认要' + action + '该卡片吗？')) return;
  try {
    const res = await apiFetch(`/cards/${cardId}/freeze`,{method:'POST',body:JSON.stringify({status:newStatus})});
    if (res.code!==0) { toast('❌ '+(res.msg||`${action}失败`)); return; }
    toast(`✅ 卡片已${action}`);
    if (_curPage==='cards') renderCards();
  } catch(e) {
    if (e.message!=='Unauthorized') toast('❌ 操作失败');
  }
}

// ── 复制 ──
function copyVal(val) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(val).then(()=>toast('✅ 已复制')).catch(()=>fallbackCopy(val));
  } else { fallbackCopy(val); }
}
function fallbackCopy(text) {
  const el = document.createElement('textarea');
  el.value = text; el.style.cssText='position:fixed;opacity:0;';
  document.body.appendChild(el); el.focus(); el.select();
  try { document.execCommand('copy'); toast('✅ 已复制'); } catch(_){ toast('❌ 复制失败'); }
  document.body.removeChild(el);
}

// ══════════════════════════════════════════════
//  PAGE: 申请开卡
// ══════════════════════════════════════════════
async function renderApply() {
  const area = document.getElementById('contentArea');
  area.innerHTML = `
    <div class="page-header">
      <h2>申请开卡</h2>
      <p class="text-muted mt-1">选择卡段，填写信息，提交审批</p>
    </div>
    
    <div class="stepper mb-6">
      <div class="step active" id="step1Indicator">
        <div class="step-num">1</div>
        <div class="step-label">选择卡段</div>
      </div>
      <div class="step-line"></div>
      <div class="step" id="step2Indicator">
        <div class="step-num">2</div>
        <div class="step-label">填写信息</div>
      </div>
      <div class="step-line"></div>
      <div class="step" id="step3Indicator">
        <div class="step-num">3</div>
        <div class="step-label">提交申请</div>
      </div>
    </div>

    
    <div id="applyStep1">
      <div class="panel">
        <div class="flex items-center justify-between mb-4">
          <div style="font-weight:700">可用卡段</div>
          <div class="flex gap-2">
            <button class="btn btn-outline btn-sm" id="binAll"   onclick="filterBin('all')">全部</button>
            <button class="btn btn-outline btn-sm" id="binVisa"  onclick="filterBin('visa')">VISA</button>
            <button class="btn btn-outline btn-sm" id="binMC"    onclick="filterBin('mc')">Mastercard</button>
          </div>
        </div>
        <div id="binGrid" class="bin-grid">
          <div class="skeleton" style="height:80px;"></div>
          <div class="skeleton" style="height:80px;"></div>
          <div class="skeleton" style="height:80px;"></div>
          <div class="skeleton" style="height:80px;"></div>
        </div>
      </div>

      
      <div class="panel mt-4">
        <div style="font-weight:700;margin-bottom:16px">我的申请记录</div>
        <div id="myApplications"><div class="skeleton" style="height:60px;"></div></div>
      </div>
    </div>

    
    <div id="applyStep2" class="hidden">
      
      <div class="panel panel-sm mb-4" style="border-color:rgba(167,139,250,.3);background:rgba(167,139,250,.05);">
        <div class="flex items-center justify-between">
          <div>
            <div class="flex items-center gap-2">
              <span class="tag tag-purple" id="selBinNetwork">VISA</span>
              <span style="font-weight:700;font-family:monospace" id="selBinCode">—</span>
              <span style="font-size:.8rem;color:var(--text2)" id="selBinArea">—</span>
            </div>
            <div style="font-size:.75rem;color:var(--text3);margin-top:4px" id="selBinType">—</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="backToStep1()">← 重新选择</button>
        </div>
      </div>

      <div class="panel">
        <div style="font-weight:700;margin-bottom:20px">持卡人信息</div>
        <div class="form-row col2">
          <div class="form-group"><label>名字 (First Name)*</label><input class="form-control" id="ap_first" placeholder="Zhang"/></div>
          <div class="form-group"><label>姓氏 (Last Name)*</label><input class="form-control" id="ap_last" placeholder="San"/></div>
        </div>
          <div class="form-group" style="grid-column:span 2"><label>卡片标签</label><input class="form-control" id="ap_label" placeholder="例如：广告投放卡"/></div>

        <div class="divider"></div>
        <div style="font-weight:700;margin-bottom:16px">充值 / 数量</div>
        <div class="form-row col2">
          <div class="form-group"><label>卡内充值金额 * (≥$20/张)</label><input class="form-control" type="number" id="ap_topup" placeholder="20" min="20"/></div>
          <div class="form-group"><label>开卡数量</label><input class="form-control" type="number" id="ap_qty" placeholder="1" value="1" min="1"/></div>
        </div>

        <button class="btn btn-primary btn-lg btn-block mt-2" id="submitApplyBtn" onclick="submitApply()">
          🚀 提交开卡申请
        </button>
      </div>
    </div>
  `;

  // 加载卡段 + 申请记录
  loadBins();
  loadMyApplications();
}

let _binFilter = 'all';
function filterBin(f) {
  _binFilter = f;
  ['All','Visa','MC'].forEach(n=>document.getElementById('bin'+n)?.classList.remove('btn-primary'));
  ['All','Visa','MC'].forEach(n=>document.getElementById('bin'+n)?.classList.add('btn-outline'));
  const id = f==='all'?'binAll':f==='visa'?'binVisa':'binMC';
  document.getElementById(id)?.classList.replace('btn-outline','btn-primary');
  if (_productList) renderBins(_productList, f);
}

async function loadBins() {
  if (_productList) { renderBins(_productList, _binFilter); return; }
  try {
    const res = await apiFetch('/cards/meta/products');
    if (res.code!==0) { document.getElementById('binGrid').innerHTML='<div style="color:var(--red)">'+res.msg+'</div>'; return; }
    _productList = res.data?.list||[];
    renderBins(_productList, _binFilter);
  } catch(e) {
    if (e.message!=='Unauthorized') document.getElementById('binGrid').innerHTML='<div style="color:var(--red)">加载失败</div>';
  }
}

function renderBins(list, filter) {
  const grid = document.getElementById('binGrid');
  if (!grid) return;
  const filtered = filter==='visa' ? list.filter(p=>/visa/i.test(p.network))
                 : filter==='mc'   ? list.filter(p=>/master|mc/i.test(p.network))
                 : list;
  if (!filtered.length) { grid.innerHTML='<div style="color:var(--text2)">暂无匹配卡段</div>'; return; }
  grid.innerHTML = filtered.map(p=>{
    const isVisa = /visa/i.test(p.network);
    return `<div class="bin-card" onclick="selectBin(${JSON.stringify(p).replace(/"/g,'&quot;')})">
      <div class="flex items-center justify-between mb-2">
        <span class="bin-code">${p.product_code}</span>
        <span class="tag ${isVisa?'tag-cyan':'tag-yellow'}">${p.network}</span>
      </div>
      <div class="bin-info">BIN: ${p.bin} · ${p.issuing_area}</div>
      <div class="bin-info mt-1" style="color:${p.type==='save'?'var(--green)':'var(--purple)'}">${p.type==='save'?'储值卡':'额度卡'}</div>
    </div>`;
  }).join('');
}

function selectBin(p) {
  _selectedBin = p;
  document.getElementById('selBinCode').textContent    = p.product_code;
  document.getElementById('selBinNetwork').textContent = p.network;
  document.getElementById('selBinArea').textContent    = p.issuing_area;
  document.getElementById('selBinType').textContent    = p.type==='save'?'储值卡（预充值）':'额度卡';
  // 步骤条更新
  document.getElementById('step1Indicator').classList.remove('active');
  document.getElementById('step1Indicator').classList.add('done');
  document.getElementById('step2Indicator').classList.add('active');
  // 切换 Step
  document.getElementById('applyStep1').classList.add('hidden');
  document.getElementById('applyStep2').classList.remove('hidden');
  document.getElementById('contentArea').scrollTo({top:0,behavior:'smooth'});
}

function backToStep1() {
  _selectedBin = null;
  document.getElementById('step1Indicator').classList.remove('done');
  document.getElementById('step1Indicator').classList.add('active');
  document.getElementById('step2Indicator').classList.remove('active');
  document.getElementById('applyStep1').classList.remove('hidden');
  document.getElementById('applyStep2').classList.add('hidden');
}

async function loadMyApplications() {
  const wrap = document.getElementById('myApplications');
  if (!wrap) return;
  try {
    const res = await apiFetch('/cards/applications');
    if (res.code!==0||!(res.data||[]).length) {
      wrap.innerHTML='<div class="empty-state" style="padding:20px"><div class="empty-text text-muted">暂无申请记录</div></div>';
      return;
    }
    const items = res.data.map(a=>{
      const statusMap = {
        pending:  {tag:'tag-yellow', label:'⏳ 待审批'},
        approved: {tag:'tag-green',  label:'✅ 已批准'},
        rejected: {tag:'tag-red',    label:'❌ 已拒绝'},
      };
      const s = statusMap[a.status]||{tag:'tag-purple',label:a.status};
      const dt = new Date(a.created_at).toLocaleDateString('zh-CN');
      return `<div class="app-item">
        <div class="app-item-main">
          <div class="app-item-code">${a.product_code} · ${a.first_name} ${a.last_name}</div>
          <div class="app-item-meta">${dt}${a.label?' · '+a.label:''}${a.reject_reason?' · 原因：'+a.reject_reason:''}</div>
        </div>
        <span class="tag ${s.tag}">${s.label}</span>
      </div>`;
    }).join('');
    wrap.innerHTML = `<div class="app-list">${items}</div>`;
  } catch(e) {
    if (e.message!=='Unauthorized') wrap.innerHTML='<div style="color:var(--red);font-size:.85rem">加载失败</div>';
  }
}

async function submitApply() {
  if (!_selectedBin) { toast('⚠️ 请先选择卡段'); return; }
  const g = id => (document.getElementById(id)||{}).value||'';
  const payload = {
    product_code: _selectedBin.code||_selectedBin.product_code,
    card_bin:     _selectedBin.bin||'',
    first_name:   g('ap_first'),
    last_name:    g('ap_last'),
    label:        g('ap_label'),
    email:        _me?.email||'',
    topup_amount: parseFloat(g('ap_topup'))||0,
    quantity:     parseInt(g('ap_qty'))||1,
    };
  if (!payload.first_name||!payload.last_name) { toast('⚠️ 请填写持卡人姓名'); return; }
  // vmcardio 不支持姓名含数字，自动去除
  payload.first_name = payload.first_name.replace(/[0-9]/g,'').trim();
  payload.last_name  = payload.last_name.replace(/[0-9]/g,'').trim();
  if (!payload.first_name||!payload.last_name) { toast('⚠️ 姓名不能全为数字'); return; }
  if (payload.topup_amount < 20) { toast('⚠️ 卡内充值金额不能低于 $20'); return; }

  const btn = document.getElementById('submitApplyBtn');
  btn.disabled=true; btn.innerHTML='<span class="spinner"></span> 提交中…';
  try {
    const res = await apiFetch('/cards',{method:'POST',body:JSON.stringify(payload)});
    if (res.code!==0) { toast('❌ 提交失败：'+(res.msg||'')); return; }
    toast('✅ 申请已提交，等待管理员审批');
    backToStep1();
    loadMyApplications();
  } catch(e) {
    if (e.message!=='Unauthorized') toast('❌ 提交失败');
  } finally {
    btn.disabled=false; btn.textContent='🚀 提交开卡申请';
  }
}

// ══════════════════════════════════════════════
//  PAGE: 充值
// ══════════════════════════════════════════════
let _topupType = 'usdt'; // 当前充值类型：'usdt' | 'usd'

function openTopupTypeModal() {
  document.getElementById('topupTypeOverlay').classList.add('open');
}
function closeTopupTypeModal() {
  document.getElementById('topupTypeOverlay').classList.remove('open');
}
function selectTopupType(type) {
  _topupType = type;
  closeTopupTypeModal();
  // 更新导航激活状态
  document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
  const navEl = document.getElementById('nav-topup');
  if (navEl) navEl.classList.add('active');
  gotoPage('topup');
}

async function renderTopup() {
  const area = document.getElementById('contentArea');
  const isUSDT = _topupType === 'usdt';
  const typeLabel = isUSDT ? '₮ USDT' : '💵 USD';
  const typeName  = isUSDT ? 'USDT（加密稳定币）' : 'USD（美元电汇）';

  // 根据类型决定展示哪些支付方式（USD 保持原样选择框）
  const networkChips = `
    <div class="network-chip" id="nc_wire" onclick="selectNetwork('Wire Transfer',this)">
      <span class="nc-icon">🏦</span>
      <div><div class="nc-name">银行电汇</div><div class="nc-sub">Wire Transfer</div></div>
    </div>
    <div class="network-chip" id="nc_swift" onclick="selectNetwork('SWIFT',this)">
      <span class="nc-icon">🌐</span>
      <div><div class="nc-name">SWIFT 汇款</div><div class="nc-sub">国际电汇</div></div>
    </div>
  `;

  const remarkPlaceholder = '例如：汇款参考号、汇款银行';

  // USDT 专属：收款地址
  const TRC20_ADDR = 'TWJ7pHoj1uSBeHHaFDM9eFJNNmfYt1X9zr';
  const ERC20_ADDR = '0x0984967bbe780dd605ac815c6a2845ba8062fa32';

  // 左侧面板：USDT 展示二维码 / USD 展示金额选择
  const leftPanel = isUSDT ? `
        <div class="panel">
          <div style="font-weight:700;margin-bottom:20px">发起充值申请</div>

          
          <div class="usdt-tab-bar">
            <div class="usdt-tab selected" id="tab_trc20" onclick="switchUsdtTab('trc20')">
              <span class="usdt-tab-icon">₮</span>
              <div>
                <div class="usdt-tab-name">TRC20</div>
                <div class="usdt-tab-sub">Tron 网络</div>
              </div>
            </div>
            <div class="usdt-tab" id="tab_erc20" onclick="switchUsdtTab('erc20')">
              <span class="usdt-tab-icon">₮</span>
              <div>
                <div class="usdt-tab-name">ERC20</div>
                <div class="usdt-tab-sub">Ethereum 网络</div>
              </div>
            </div>
          </div>

          
          <div class="usdt-qr-panel">
            <div class="usdt-network-label" id="usdt_net_label">
              <span class="usdt-network-dot"></span>
              <span id="usdt_net_label_text">USDT · TRC20 (Tron)</span>
            </div>
            <div class="usdt-qr-ring">
              <div class="usdt-qr-box" id="usdt_qr_main"></div>
            </div>
            <div class="usdt-addr-wrap">
              <div class="usdt-addr-label">收款地址</div>
              <div class="usdt-addr" id="usdt_addr_main">${TRC20_ADDR}</div>
            </div>
            <button class="usdt-copy-btn" id="usdt_copy_main" onclick="copyAddr(event, document.getElementById('usdt_addr_main').textContent)">📋 复制地址</button>
          </div>

          <div class="form-group" style="margin-top:20px">
            <label>TxHash 交易哈希</label>
            <input class="form-control" id="topupRemark" placeholder="转账后请填写链上 TxHash"/>
          </div>

          <button class="btn btn-primary btn-block btn-lg" id="topupSubmitBtn" onclick="submitTopup()">
            提交充值申请
          </button>
          <div style="font-size:.75rem;color:var(--text3);text-align:center;margin-top:10px">
            扫码转账后填写 TxHash，管理员将在 1-24 小时内审核到账
          </div>
        </div>
  ` : `
        <div class="panel">
          <div style="font-weight:700;margin-bottom:20px">发起充值申请</div>

          <div class="form-group">
            <label>选择金额（USD）</label>
            <div class="topup-amount-grid" id="amtChips">
              ${[100,200,500,1000].map(v=>`<div class="amount-chip" onclick="selectAmt(${v},this)">$${v}</div>`).join('')}
            </div>
            <input class="form-control" type="number" id="topupAmt" placeholder="或手动输入金额" min="1"/>
          </div>

          <div class="form-group">
            <label>充值方式</label>
            <div class="network-grid">
              ${networkChips}
            </div>
          </div>

          <div class="form-group">
            <label>备注（可选）</label>
            <input class="form-control" id="topupRemark" placeholder="${remarkPlaceholder}"/>
          </div>

          <button class="btn btn-primary btn-block btn-lg" id="topupSubmitBtn" onclick="submitTopup()">
            提交充值申请
          </button>
          <div style="font-size:.75rem;color:var(--text3);text-align:center;margin-top:10px">
            申请提交后，管理员将在 1-24 小时内处理
          </div>
        </div>
  `;

  area.innerHTML = `
    <div class="page-header">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <h2>充值</h2>
        <span class="topup-type-badge" onclick="openTopupTypeModal()" title="切换充值类型">
          ${typeLabel} <span style="opacity:.6;font-size:.72rem;margin-left:2px">切换 ▾</span>
        </span>
      </div>
      <p class="text-muted mt-1">当前方式：${typeName} · 提交申请后管理员审核到账</p>
    </div>
    <div class="topup-layout">
      
      <div>
        ${leftPanel}
      </div>

      
      <div style="display:flex;flex-direction:column;">
        <div class="panel" style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
          <div style="font-weight:700;margin-bottom:16px;flex-shrink:0">充值记录</div>
          <div id="topupHistory" style="flex:1;overflow-y:auto;"><div class="skeleton" style="height:80px;"></div></div>
        </div>
      </div>
    </div>
  `;

  loadTopupHistory();

  // USDT 模式下生成二维码（默认 TRC20）
  if (isUSDT) {
    _topupNetwork = 'USDT TRC20';
    setTimeout(() => {
      const wrap = document.getElementById('usdt_qr_main');
      if (!wrap) return;
      wrap.innerHTML = '';
      new QRCode(wrap, { text: 'TWJ7pHoj1uSBeHHaFDM9eFJNNmfYt1X9zr', width: 144, height: 144, correctLevel: QRCode.CorrectLevel.M });
    }, 0);
  }
}

let _topupNetwork = '';
const _USDT_ADDRS = {
  trc20: 'TWJ7pHoj1uSBeHHaFDM9eFJNNmfYt1X9zr',
  erc20: '0x0984967bbe780dd605ac815c6a2845ba8062fa32'
};
function switchUsdtTab(type) {
  // 切换 tab 高亮
  document.querySelectorAll('.usdt-tab').forEach(e => e.classList.remove('selected'));
  const tab = document.getElementById('tab_' + type);
  if (tab) tab.classList.add('selected');
  // 更新网络标记
  _topupNetwork = type === 'trc20' ? 'USDT TRC20' : 'USDT ERC20';
  // 更新网络标签
  const labelEl = document.getElementById('usdt_net_label_text');
  if (labelEl) labelEl.textContent = type === 'trc20' ? 'USDT · TRC20 (Tron)' : 'USDT · ERC20 (Ethereum)';
  // 更新地址文本
  const addr = _USDT_ADDRS[type];
  const addrEl = document.getElementById('usdt_addr_main');
  if (addrEl) addrEl.textContent = addr;
  // 重新生成二维码
  const wrap = document.getElementById('usdt_qr_main');
  if (wrap) {
    wrap.innerHTML = '';
    new QRCode(wrap, { text: addr, width: 140, height: 140, correctLevel: QRCode.CorrectLevel.M });
  }
}
function selectUsdtCard(name, el) {
  // 兼容旧调用，直接忽略
}
function copyAddr(ev, addr) {
  ev.stopPropagation();
  navigator.clipboard.writeText(addr).then(() => toast('✅ 地址已复制'));
}
function selectAmt(val, el) {
  document.querySelectorAll('.amount-chip').forEach(e=>e.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('topupAmt').value = val;
}
function selectNetwork(name, el) {
  document.querySelectorAll('.network-chip').forEach(e=>e.classList.remove('selected'));
  el.classList.add('selected');
  _topupNetwork = name;
}

async function submitTopup() {
  const isUSDT = _topupType === 'usdt';
  const amtEl = document.getElementById('topupAmt');
  const amt = amtEl ? parseFloat(amtEl.value) : 0;
  if (!isUSDT && (!amt||amt<=0)) { toast('⚠️ 请输入充值金额'); return; }
  if (!isUSDT && !_topupNetwork) { toast('⚠️ 请选择充值方式'); return; }
  const network = isUSDT ? _topupNetwork || 'USDT TRC20' : _topupNetwork;
  const remarkEl = document.getElementById('topupRemark');
  const remark = remarkEl ? remarkEl.value.trim() : '';

  const btn = document.getElementById('topupSubmitBtn');
  btn.disabled=true; btn.innerHTML='<span class="spinner"></span> 提交中…';
  try {
    // USDT 模式：remark 字段作为 txhash 传给后端；amount_usdt 传 0（无金额输入框）
    const body = isUSDT
      ? { network, amount_usdt: 0, txhash: remark, remark: '' }
      : { network, amount_usdt: amt, txhash: '', remark };
    const res = await apiFetch('/topup',{method:'POST',body:JSON.stringify(body)});
    if (res.code!==0) { toast('❌ '+(res.msg||'提交失败')); return; }
    toast('✅ 充值申请已提交');
    if (amtEl) amtEl.value='';
    if (remarkEl) remarkEl.value='';
    document.querySelectorAll('.amount-chip,.network-chip,.usdt-pay-card').forEach(e=>e.classList.remove('selected'));
    _topupNetwork='';
    loadTopupHistory();
  } catch(e) {
    if (e.message!=='Unauthorized') toast('❌ 提交失败');
  } finally {
    btn.disabled=false; btn.textContent='提交充值申请';
  }
}

async function loadTopupHistory() {
  const wrap = document.getElementById('topupHistory');
  if (!wrap) return;
  try {
    const res = await apiFetch('/topup?limit=9');
    if (res.code!==0||!(res.data?.list||[]).length) {
      wrap.innerHTML='<div class="empty-state" style="padding:24px"><div class="empty-text text-muted">暂无充值记录</div></div>';
      return;
    }
    const statusMap = {
      pending:  {tag:'tag-yellow',label:'⏳ 待处理'},
      approved: {tag:'tag-green', label:'✅ 已到账'},
      rejected: {tag:'tag-red',   label:'❌ 已拒绝'},
    };
    const items = res.data.list.slice(0,9).map(r=>{
      const s = statusMap[r.status]||{tag:'tag-purple',label:r.status};
      const dt = new Date(r.created_at).toLocaleString('zh-CN');
      const isPending = r.status === 'pending';
      const hasAmt = r.amount_usdt && Number(r.amount_usdt) > 0;
      // 右侧：pending 时显示「填写金额」按钮 + 已填金额（如有）
      const rightExtra = isPending ? `
        ${hasAmt ? `<span class="th-filled-amt">$${Number(r.amount_usdt).toFixed(2)}</span>` : ''}
        <button class="th-fill-btn" onclick="toggleThAmt(${r.id})">${hasAmt ? '修改金额' : '+ 填写金额'}</button>
      ` : (hasAmt ? `<span class="th-filled-amt" style="margin-right:8px">$${Number(r.amount_usdt).toFixed(2)}</span>` : '');
      // 行内输入区（pending 才有）
      const amtRow = isPending ? `
        <div class="th-amt-row" id="th-amt-row-${r.id}">
          <input class="th-amt-input" id="th-amt-input-${r.id}" type="number" min="0.01" step="0.01"
            placeholder="请输入实际转账金额 (USDT)"
            value="${hasAmt ? Number(r.amount_usdt).toFixed(2) : ''}" />
          <button class="th-amt-save" onclick="saveThAmt(${r.id})">保存</button>
          <button class="th-amt-cancel" onclick="toggleThAmt(${r.id})">取消</button>
        </div>
      ` : '';
      return `<div class="th-item" id="th-item-${r.id}">
        <div class="th-item-row">
          <div class="th-left">
            <div class="th-amount" style="background:var(--grad);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">
              ${dt}
            </div>
            <div class="th-meta">${r.network||'—'}${r.remark?' · '+r.remark:''}</div>
          </div>
          <div class="th-right">
            ${rightExtra}
            <span class="tag ${s.tag}">${s.label}</span>
          </div>
        </div>
        ${amtRow}
      </div>`;
    }).join('');
    wrap.innerHTML = `<div class="topup-history">${items}</div>`;
  } catch(e) {
    if (e.message!=='Unauthorized') wrap.innerHTML='<div style="color:var(--red);font-size:.85rem">加载失败</div>';
  }
}

// 展开/收起金额输入行
function toggleThAmt(id) {
  const row = document.getElementById('th-amt-row-' + id);
  if (!row) return;
  row.classList.toggle('open');
  if (row.classList.contains('open')) {
    const input = document.getElementById('th-amt-input-' + id);
    if (input) setTimeout(() => input.focus(), 0);
  }
}

// 保存金额
async function saveThAmt(id) {
  const input = document.getElementById('th-amt-input-' + id);
  if (!input) return;
  const amt = parseFloat(input.value);
  if (!amt || amt <= 0) { toast('⚠️ 请输入有效金额'); return; }
  try {
    const res = await apiFetch(`/topup/${id}/amount`, {
      method: 'PATCH',
      body: JSON.stringify({ amount_usdt: amt })
    });
    if (res.code !== 0) { toast('❌ ' + (res.msg || '保存失败')); return; }
    toast('✅ 金额已更新');
    const row = document.getElementById('th-amt-row-' + id);
    if (row) row.classList.remove('open');
    loadTopupHistory();
  } catch(e) {
    if (e.message !== 'Unauthorized') toast('❌ 保存失败');
  }
}

// ══════════════════════════════════════════════
//  PAGE: 卡片管理
// ══════════════════════════════════════════════
async function renderCardManage() {

  // 初始化搜索状态
  if (!window._cmSearch) {
    window._cmSearch = { q: '', status: '', dateFrom: '', dateTo: '', page: 1 };
  }
  
  const isAdmin = _me?.role === 'admin';
  
  const area = document.getElementById('contentArea');
  if (isAdmin) { area.style.paddingTop = '10px'; area.style.paddingLeft = '12px'; area.style.maxWidth = '100%'; }
  else { area.style.paddingTop = ''; area.style.paddingLeft = ''; area.style.maxWidth = ''; }
  area.innerHTML = `
    ${!isAdmin ? '<div class="page-header"><div class="flex items-center justify-between"><div><h2>卡片管理</h2><p class="text-muted mt-1">管理您的所有虚拟卡</p></div><button class="btn btn-primary" onclick="gotoPage(\'apply\')">✨ 申请新卡</button></div></div>' : ''}
    ${isAdmin ? renderCmSearchBar() : ''}
    <div class="cm-results-section"><div id="cmListWrap">
      <div class="skeleton" style="height:240px;border-radius:16px;"></div>
    </div></div>`;
  
  drInit();  // 初始化日期范围选择器
  loadCmList();
}

// 卡片管理搜索栏 HTML（管理员版，替代标题区）
function renderCmSearchBar() {
  var s = window._cmSearch || {};
  function tabCls(v) { return 'cm-status-tab' + (s.status === v ? ' active' : ''); }
  var dateDisp = '开始日期 — 结束日期';
  if (s.dateFrom && s.dateTo) {
    dateDisp = s.dateFrom.replace(/-/g,'/') + ' — ' + s.dateTo.replace(/-/g,'/');
  } else if (s.dateFrom) {
    dateDisp = s.dateFrom.replace(/-/g,'/') + ' — 结束日期';
  }
  var hasValCls = (s.dateFrom || s.dateTo) ? ' has-val' : '';
  return '<div class="cm-search-section">'
    // 搜索栏一行（标题由 topbar 展示，此处不重复）
    + '<div class="cm-search-row">'
    // 文本搜索框（收窄）
    + '<div class="cm-search-input-wrap">'
    + '<svg style="position:absolute;left:12px;top:50%;transform:translateY(-50%);opacity:.45;" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
    + '<input id="cmSearchInput" type="text" placeholder="用户名 / 邮箱 / 卡号 / 用户ID..."'
    + ' onkeydown="if(event.key===\'Enter\'){doCmSearch();}">'
    + '</div>'
    // 状态标签组
    + '<div class="cm-tabs-group">'
    + '<button class="' + tabCls('') + '" onclick="cmSelectTab(this,\'\')">全部</button>'
    + '<button class="' + tabCls('active') + '" onclick="cmSelectTab(this,\'active\')">正常</button>'
    + '<button class="' + tabCls('cancelled') + '" onclick="cmSelectTab(this,\'cancelled\')">冻结</button>'
    + '<button class="' + tabCls('deleted') + '" onclick="cmSelectTab(this,\'deleted\')">已删除</button>'
    + '</div>'
    // 日期选择器前标签
    + '<span class="cm-date-label">卡片创建时间</span>'
    // 日期选择器容器（由通用组件填充）
    + '<span id="cmDateWrap"></span>'
    // 搜索/重置按钮组（与日期选择器拉开距离）
    + '<div class="cm-search-actions">'
    + '<button class="cm-btn-search" onclick="doCmSearch();">🔍 搜索</button>'
    + '<button class="cm-btn-reset" onclick="resetCmSearch();">重置</button>'
    + '<button class="cm-btn-reset" onclick="cmRefreshList();" title="立即从上游同步数据">🔄 刷新</button>'
    + '</div>'
    + '</div>' // 关闭 cm-search-row
    + '</div>'; // 关闭 cm-search-section
}

// 执行搜索
function doCmSearch() {
  window._cmSearch.q = (document.getElementById('cmSearchInput')?.value || '').trim();
  window._cmSearch.page = 1;
  // 日期从 _cmSearch 读取（由日历确认时写入）
  loadCmList();
}

// 按钮组点击（自动触发搜索）
function cmSelectTab(btn, value) {
  btn.closest('div').querySelectorAll('.cm-status-tab').forEach(function(t) { t.classList.remove('active'); });
  btn.classList.add('active');
  window._cmSearch.status = value;
  window._cmSearch.page = 1;
  loadCmList();
}

// 重置搜索
function resetCmSearch() {
  window._cmSearch = { q: '', status: '', dateFrom: '', dateTo: '', page: 1 };
  if (document.getElementById('cmSearchInput')) document.getElementById('cmSearchInput').value = '';
  // 重置按钮组高亮
  document.querySelectorAll('.cm-status-tab').forEach(function(t) { t.classList.remove('active'); });
  var firstTab = document.querySelector('.cm-status-tab');
  if (firstTab) firstTab.classList.add('active');
  loadCmList();
}

// 手动刷新卡片列表（从上游实时同步）
function cmRefreshList() {
  const btn = document.querySelector('.cm-search-actions button[onclick="cmRefreshList();"]');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ 同步中...';
  }
  loadCmList(true).then(() => {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '🔄 刷新';
    }
    toast('✅ 卡片数据已同步');
  }).catch(() => {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '🔄 刷新';
    }
  });
}

// ══════════════════════════════════════════════
//  通用日期范围选择器组件（v2 - 多实例支持）
// ══════════════════════════════════════════════
// 用法：
//   var picker = new DateRangePicker({
//     id: 'myPicker',           // 唯一标识
//     container: '#wrap',       // 插入容器（可选，默认 body）
//     placeholder: '选择日期',   // 占位文字
//     onConfirm: function(start, end) { console.log(start, end); }
//   });
//   picker.init();
//   picker.setRange('2026-04-01', '2026-04-21');  // 设置值
//   picker.clear();  // 清空
//
function DateRangePicker(opts) {
  this.id = opts.id || 'drp_' + Math.random().toString(36).slice(2,8);
  this.container = opts.container || document.body;
  this.placeholder = opts.placeholder || '开始日期 — 结束日期';
  this.onConfirm = opts.onConfirm || function(){};
  this.onClear = opts.onClear || function(){};
  this._leftYear = 0; this._leftMonth = 0;
  this._selecting = false; this._start = null; this._end = null; this._hover = null;
}

DateRangePicker.prototype._pad = function(n) { return n < 10 ? '0' + n : '' + n; };
DateRangePicker.prototype._fmtDate = function(d) { return d.getFullYear() + '/' + this._pad(d.getMonth()+1) + '/' + this._pad(d.getDate()); };
DateRangePicker.prototype._fmtISODate = function(d) { return d.getFullYear() + '-' + this._pad(d.getMonth()+1) + '-' + this._pad(d.getDate()); };

DateRangePicker.prototype.init = function() {
  console.log('[DateRangePicker] init called, id:', this.id);
  var self = this;
  var now = new Date();
  this._leftYear = now.getFullYear(); this._leftMonth = now.getMonth();
  this._start = null; this._end = null; this._hover = null; this._selecting = false;

  // 渲染触发器 HTML
  var html = '<div class="dr-trigger" id="' + this.id + '_trigger" style="position:relative;display:inline-flex;align-items:center;gap:8px;padding:0 14px;height:38px;border-radius:9px;border:1px solid rgba(167,139,250,.5);background:rgba(0,0,0,.35);color:var(--text3);font-size:.86rem;cursor:pointer;transition:all .15s;white-space:nowrap;user-select:none;flex-shrink:0;box-shadow:0 1px 3px rgba(0,0,0,.2);">';
  html += '<span class="cal-ico" style="opacity:.5;font-size:.9rem;flex-shrink:0;">📅</span>';
  html += '<span id="' + this.id + '_display">' + this.placeholder + '</span>';
  html += '<span class="clear-x" id="' + this.id + '_clear" style="margin-left:auto;opacity:.4;font-size:.8rem;display:none;transition:opacity .15s;cursor:pointer;">✕</span>';
  html += '<div class="dr-panel" id="' + this.id + '_panel" style="display:none;position:absolute;top:calc(100% + 8px);left:0;z-index:1000;background:#181b2e;border:1px solid rgba(167,139,250,.2);border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.7);overflow:hidden;" onclick="event.stopPropagation()">';
  html += '<div style="display:flex;"><div class="dr-shortcuts" style="width:100px;border-right:1px solid rgba(255,255,255,.06);padding:14px 0;display:flex;flex-direction:column;">';
  html += '<div class="dr-sc" data-sc="today">今天</div>';
  html += '<div class="dr-sc" data-sc="7d">近7天</div>';
  html += '<div class="dr-sc" data-sc="30d">近30天</div>';
  html += '<div class="dr-sc" data-sc="thisMonth">本月</div>';
  html += '<div class="dr-sc" data-sc="lastMonth">上月</div>';
  html += '</div><div class="dr-cals" style="padding:14px 18px 10px;display:flex;flex-direction:column;">';
  html += '<div class="dr-cals-row" style="display:flex;gap:24px;"><div class="cal" id="' + this.id + '_cal0"></div><div class="cal" id="' + this.id + '_cal1"></div></div>';
  html += '<div class="dr-footer" style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid rgba(255,255,255,.06);padding:10px 18px 12px;">';
  html += '<div class="dr-footer-info" id="' + this.id + '_info" style="font-size:.78rem;color:var(--text3);">请选择开始日期</div>';
  html += '<div class="dr-footer-btns" style="display:flex;gap:8px;">';
  html += '<button class="dr-btn-cancel" id="' + this.id + '_cancel" style="padding:6px 16px;border-radius:8px;border:none;background:rgba(255,255,255,.06);color:var(--text2);font-size:.82rem;cursor:pointer;transition:all .15s;">取消</button>';
  html += '<button class="dr-btn-confirm" id="' + this.id + '_confirm" disabled style="opacity:.4;padding:6px 16px;border-radius:8px;border:none;background:var(--grad);color:#fff;font-size:.82rem;font-weight:600;cursor:default;transition:all .15s;">确认</button>';
  html += '</div></div></div></div></div></div>';

  var wrap = typeof this.container === 'string' ? document.querySelector(this.container) : this.container;
  if (wrap) {
    var div = document.createElement('div'); div.innerHTML = html;
    wrap.appendChild(div.firstElementChild);
  }

  // 绑定事件
  var trigger = document.getElementById(this.id + '_trigger');
  this._trigger = trigger; // 保存引用供 _shortcut 使用
  this._cal0 = document.getElementById(this.id + '_cal0'); // 保存日历引用
  this._cal1 = document.getElementById(this.id + '_cal1');
  trigger.addEventListener('click', function(e) { self._toggle(e); });
  var clearBtn = document.getElementById(this.id + '_clear');
  var confirmBtn = document.getElementById(this.id + '_confirm');
  var cancelBtn = document.getElementById(this.id + '_cancel');
  if (clearBtn) clearBtn.addEventListener('click', function(e) { self._clear(e); });
  if (confirmBtn) confirmBtn.addEventListener('click', function() { self._confirm(); });
  if (cancelBtn) cancelBtn.addEventListener('click', function() { self._close(); });

  // 快捷方式点击
  if (trigger) {
    trigger.querySelectorAll('.dr-sc').forEach(function(el) {
      el.addEventListener('click', function(e) { self._shortcut(el.dataset.sc, el); });
    });
  }

  this._renderCals();
  this._bindOutside();
  // 注册到全局实例表（供内联 onclick 使用）
  window._drpInstances = window._drpInstances || {};
  window._drpInstances[this.id] = this;
  // 绑定日历容器的 mouseenter 事件委托
  this._bindCalHover();
};
DateRangePicker.prototype._bindCalHover = function() {
  var self = this;
  var panel = document.getElementById(this.id + '_panel');
  if (!panel) return;
  // 使用事件委托处理 mouseenter
  panel.addEventListener('mouseover', function(e) {
    var el = e.target;
    if (el && el.classList && el.classList.contains('cal-day')) {
      var ds = el.getAttribute('data-date');
      if (ds) self._hoverDay(ds);
    }
  });
  // 使用事件委托处理点击（替代内联 onclick）
  panel.addEventListener('click', function(e) {
    var el = e.target;
    if (el && el.classList && el.classList.contains('cal-day')) {
      var ds = el.getAttribute('data-date');
      if (ds) {
        console.log('[DateRangePicker] Delegated click:', ds);
        self._clickDay(ds);
      }
    }
  });
};

DateRangePicker.prototype._bindOutside = function() {
  var self = this;
  // 先移除旧的监听器（防止泄漏）
  if (self._outsideHandler) {
    document.removeEventListener('click', self._outsideHandler);
  }
  self._outsideHandler = function(e) {
    var t = document.getElementById(self.id + '_trigger');
    var p = document.getElementById(self.id + '_panel');
    if (t && !t.contains(e.target)) {
      t.classList.remove('open');
      if (p) { p.style.display = 'none'; p.style.left = '0'; p.style.right = 'auto'; }
    }
  };
  document.addEventListener('click', self._outsideHandler);
};

DateRangePicker.prototype._toggle = function(e) {
  e.stopPropagation();
  var t = document.getElementById(this.id + '_trigger');
  var p = document.getElementById(this.id + '_panel');
  var isOpen = t.classList.contains('open');
  // 先关闭所有其他 picker
  var self = this;
  document.querySelectorAll('.dr-trigger.open').forEach(function(el) {
    el.classList.remove('open');
    var pid = el.id.replace('_trigger','_panel');
    var pel = document.getElementById(pid);
    if (pel) { pel.style.display = 'none'; pel.style.left = '0'; pel.style.right = 'auto'; }
  });
  if (!isOpen) {
    t.classList.add('open');
    if (p) {
      p.style.display = 'block';
      // 检测是否超出屏幕右边界，若超出则右对齐
      var rect = t.getBoundingClientRect();
      var panelWidth = p.offsetWidth || 560;
      if (rect.left + panelWidth > window.innerWidth - 16) {
        p.style.left = 'auto';
        p.style.right = '0';
      } else {
        p.style.left = '0';
        p.style.right = 'auto';
      }
    }
  }
};
DateRangePicker.prototype._close = function() {
  var t = document.getElementById(this.id + '_trigger');
  var p = document.getElementById(this.id + '_panel');
  if (t) t.classList.remove('open');
  if (p) { p.style.display = 'none'; p.style.left = '0'; p.style.right = 'auto'; }
};

DateRangePicker.prototype._renderCals = function() {
  this._renderCal(0, this._leftYear, this._leftMonth);
  var ry = this._leftMonth === 11 ? this._leftYear + 1 : this._leftYear;
  var rm = this._leftMonth === 11 ? 0 : this._leftMonth + 1;
  this._renderCal(1, ry, rm);
  // 每次渲染后同步更新信息提示和确认按钮状态
  var canConfirm = !!this._start && !!this._end;
  this._updateInfo();
  this._enableConfirm(canConfirm);
};

DateRangePicker.prototype._renderCal = function(idx, year, month) {
  var el = document.getElementById(this.id + '_cal' + idx);
  if (!el) return;
  var months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  var weeks = ['日','一','二','三','四','五','六'];
  var today = new Date(); today.setHours(0,0,0,0);
  var self = this;
  var h = '<div class="cal-head" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">';
  if (idx === 0) {
    h += '<button class="cal-nav" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:.85rem;padding:2px 5px;border-radius:5px;transition:all .15s;display:flex;align-items:center;justify-content:center;width:22px;height:22px;" onclick="window._drpInstances[\'' + this.id + '\']._navMonth(-12)">\u00AB</button>';
    h += '<button class="cal-nav" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:.85rem;padding:2px 5px;border-radius:5px;transition:all .15s;display:flex;align-items:center;justify-content:center;width:22px;height:22px;" onclick="window._drpInstances[\'' + this.id + '\']._navMonth(-1)">\u2039</button>';
  } else { h += '<span style="width:46px"></span>'; }
  h += '<span class="cal-title" style="font-size:.85rem;font-weight:600;color:var(--text1);flex:1;text-align:center;">' + year + ' 年 ' + months[month] + '</span>';
  if (idx === 1) {
    h += '<button class="cal-nav" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:.85rem;padding:2px 5px;border-radius:5px;transition:all .15s;display:flex;align-items:center;justify-content:center;width:22px;height:22px;" onclick="window._drpInstances[\'' + this.id + '\']._navMonth(1)">\u203A</button>';
    h += '<button class="cal-nav" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:.85rem;padding:2px 5px;border-radius:5px;transition:all .15s;display:flex;align-items:center;justify-content:center;width:22px;height:22px;" onclick="window._drpInstances[\'' + this.id + '\']._navMonth(12)">\u00BB</button>';
  } else { h += '<span style="width:46px"></span>'; }
  h += '</div><div class="cal-week" style="display:grid;grid-template-columns:repeat(7,1fr);margin-bottom:3px;">';
  weeks.forEach(function(w){ h += '<span style="text-align:center;font-size:.72rem;color:var(--text3);padding:3px 0;">' + w + '</span>'; });
  h += '</div><div class="cal-days" style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;">';
  var firstDay = new Date(year, month, 1).getDay();
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var daysInPrev = new Date(year, month, 0).getDate();
  for (var i = firstDay - 1; i >= 0; i--) {
    var d = daysInPrev - i, dm = month === 0 ? 11 : month - 1, dy = month === 0 ? year - 1 : year;
    h += this._dayCell(dy, dm, d, true);
  }
  for (var d = 1; d <= daysInMonth; d++) { h += this._dayCell(year, month, d, false); }
  var total = firstDay + daysInMonth;
  var rem = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (var d = 1; d <= rem; d++) {
    var nm = month === 11 ? 0 : month + 1, ny = month === 11 ? year + 1 : year;
    h += this._dayCell(ny, nm, d, true);
  }
  h += '</div>';
  el.innerHTML = h;
};

DateRangePicker.prototype._dayCell = function(year, month, day, isOther) {
  var dt = new Date(year, month, day); dt.setHours(0,0,0,0);
  var today = new Date(); today.setHours(0,0,0,0);
  var cls = 'cal-day';
  var style = 'text-align:center;font-size:.8rem;padding:6px 2px;cursor:pointer;border-radius:6px;color:var(--text1);transition:background .12s,color .12s;position:relative;';
  if (isOther) { cls += ' other-month'; style += 'color:var(--text3);opacity:.25;'; }
  if (dt.getTime() === today.getTime()) { cls += ' today'; style += 'color:var(--accent);font-weight:700;'; }
  if (!isOther) {
    var s = this._start, e = this._end || this._hover;
    if (s && e) {
      var lo = s.getTime() <= e.getTime() ? s : e, hi = s.getTime() <= e.getTime() ? e : s;
      if (dt.getTime() === lo.getTime()) { cls += ' range-start'; style += 'background:var(--grad);color:#fff!important;border-radius:6px;font-weight:600;'; }
      else if (dt.getTime() === hi.getTime()) { cls += ' range-end'; style += 'background:var(--grad);color:#fff!important;border-radius:6px;font-weight:600;'; }
      else if (dt.getTime() > lo.getTime() && dt.getTime() < hi.getTime()) { cls += ' in-range'; style += 'background:rgba(126,184,247,.1);border-radius:0;color:var(--text1);'; }
    } else if (s && dt.getTime() === s.getTime()) { cls += ' range-start'; style += 'background:var(--grad);color:#fff!important;border-radius:6px;font-weight:600;'; }
  }
  var ds = year + '-' + this._pad(month+1) + '-' + this._pad(day);
  // 使用事件委托处理点击和 hover，避免内联事件处理器
  return '<div class="' + cls + '" style="' + style + '" data-date="' + ds + '">' + day + '</div>';
};

DateRangePicker.prototype._navMonth = function(delta) {
  this._leftMonth += delta;
  while (this._leftMonth < 0) { this._leftMonth += 12; this._leftYear--; }
  while (this._leftMonth > 11) { this._leftMonth -= 12; this._leftYear++; }
  this._renderCals();
};
DateRangePicker.prototype._clickDay = function(dateStr) {
  console.log('[DateRangePicker] _clickDay called with:', dateStr, 'picker id:', this.id);
  var parts = dateStr.split('-');
  var dt = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
  dt.setHours(0,0,0,0);
  console.log('[DateRangePicker] _clickDay: dateStr=', dateStr, '_start=', this._start ? this._fmtDate(this._start) : null, '_end=', this._end ? this._fmtDate(this._end) : null);
  if (!this._start || (this._start && this._end)) {
    this._start = dt; this._end = null; this._hover = null; this._selecting = true;
    console.log('[DateRangePicker] Reset selection, _start set to:', this._fmtDate(this._start));
  } else {
    if (dt.getTime() < this._start.getTime()) { this._end = this._start; this._start = dt; } else { this._end = dt; }
    this._hover = null; this._selecting = false;
    console.log('[DateRangePicker] Complete selection, _start:', this._fmtDate(this._start), '_end:', this._fmtDate(this._end));
  }
  this._renderCals();
};
DateRangePicker.prototype._hoverDay = function(dateStr) {
  if (this._selecting && this._start && !this._end) {
    var parts = dateStr.split('-');
    var newHover = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
    newHover.setHours(0,0,0,0);
    // 避免不必要的重复渲染
    if (this._hover && this._hover.getTime() === newHover.getTime()) return;
    this._hover = newHover;
    // 轻量级更新：只更新范围样式，不重渲染整个日历
    this._updateHoverStyles();
  }
};
DateRangePicker.prototype._updateHoverStyles = function() {
  // 清除旧的高亮
  var panel = document.getElementById(this.id + '_panel');
  if (!panel) return;
  panel.querySelectorAll('.cal-day').forEach(function(el) {
    el.classList.remove('in-range', 'range-start', 'range-end');
    el.style.background = '';
    el.style.color = '';
    el.style.borderRadius = '';
  });
  // 重新应用样式
  if (!this._start || !this._hover) return;
  var s = this._start, e = this._hover;
  var lo = s.getTime() <= e.getTime() ? s : e, hi = s.getTime() <= e.getTime() ? e : s;
  var self = this;
  panel.querySelectorAll('.cal-day').forEach(function(el) {
    var ds = el.getAttribute('data-date');
    if (!ds) return;
    var parts = ds.split('-');
    var dt = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
    dt.setHours(0,0,0,0);
    if (dt.getTime() === lo.getTime()) {
      el.classList.add('range-start');
      el.style.background = 'var(--grad)';
      el.style.color = '#fff';
      el.style.borderRadius = '6px';
    } else if (dt.getTime() === hi.getTime()) {
      el.classList.add('range-end');
      el.style.background = 'var(--grad)';
      el.style.color = '#fff';
      el.style.borderRadius = '6px';
    } else if (dt.getTime() > lo.getTime() && dt.getTime() < hi.getTime()) {
      el.classList.add('in-range');
      el.style.background = 'rgba(126,184,247,.1)';
      el.style.borderRadius = '0';
    }
  });
};
DateRangePicker.prototype._updateInfo = function() {
  var el = document.getElementById(this.id + '_info');
  if (!el) return;
  if (this._start && !this._end) { el.innerHTML = '开始：<span style="color:var(--accent);">' + this._fmtDate(this._start) + '</span>，请选择结束日期'; }
  else if (this._start && this._end) { el.innerHTML = '<span style="color:var(--accent);">' + this._fmtDate(this._start) + '</span> — <span style="color:var(--accent);">' + this._fmtDate(this._end) + '</span>'; }
  else { el.innerHTML = '请选择开始日期'; }
};
DateRangePicker.prototype._enableConfirm = function(yes) {
  var btn = document.getElementById(this.id + '_confirm');
  console.log('[DateRangePicker] _enableConfirm:', yes, 'btn found:', !!btn);
  if (btn) { btn.disabled = !yes; btn.style.opacity = yes ? '1' : '.4'; btn.style.cursor = yes ? 'pointer' : 'default'; }
};
DateRangePicker.prototype._shortcut = function(type, el) {
  console.log('[DateRangePicker] _shortcut called:', type);
  var self = this;
  // 添加空值检查，防止 _trigger 未定义时报错
  if (this._trigger) {
    this._trigger.querySelectorAll('.dr-sc').forEach(function(e){ e.classList.remove('active'); });
  }
  if (el && el.classList) el.classList.add('active');
  var today = new Date(); today.setHours(0,0,0,0);
  var from, to;
  if (type === 'today') { 
    from = new Date(today); 
    to = new Date(today);
  }
  else if (type === '7d') { 
    from = new Date(today); 
    from.setDate(from.getDate() - 6); 
    to = new Date(today);
  }
  else if (type === '30d') { 
    from = new Date(today); 
    from.setDate(from.getDate() - 29); 
    to = new Date(today);
  }
  else if (type === 'thisMonth') { 
    from = new Date(today.getFullYear(), today.getMonth(), 1); 
    to = new Date(today);
  }
  else if (type === 'lastMonth') { 
    from = new Date(today.getFullYear(), today.getMonth()-1, 1); 
    to = new Date(today.getFullYear(), today.getMonth(), 0); 
  }
  this._start = from; this._end = to; this._selecting = false;
  this._leftYear = from.getFullYear(); this._leftMonth = from.getMonth();
  // 重新渲染日历，UI状态更新由 _renderCals 末尾统一处理
  this._renderCals();
};
DateRangePicker.prototype._confirm = function() {
  if (!this._start || !this._end) return;
  var s = this._fmtISODate(this._start), e = this._fmtISODate(this._end);
  var display = document.getElementById(this.id + '_display');
  var trigger = document.getElementById(this.id + '_trigger');
  var clearBtn = document.getElementById(this.id + '_clear');
  if (display) display.textContent = this._fmtDate(this._start) + ' — ' + this._fmtDate(this._end);
  if (trigger) trigger.classList.add('has-val');
  if (clearBtn) clearBtn.style.display = 'block';
  this._close();
  if (this.onConfirm) this.onConfirm(s, e);
};
DateRangePicker.prototype._clear = function(e) {
  e.stopPropagation();
  this._start = null; this._end = null; this._hover = null; this._selecting = false;
  var display = document.getElementById(this.id + '_display');
  var trigger = document.getElementById(this.id + '_trigger');
  var clearBtn = document.getElementById(this.id + '_clear');
  if (display) display.textContent = this.placeholder;
  if (trigger) trigger.classList.remove('has-val', 'open');
  if (clearBtn) clearBtn.style.display = 'none';
  if (trigger) trigger.querySelectorAll('.dr-sc').forEach(function(el){ el.classList.remove('active'); });
  this._updateInfo(); this._enableConfirm(false); this._renderCals();
  if (this.onClear) this.onClear();
};
DateRangePicker.prototype.setRange = function(start, end) {
  var s = new Date(start); var e = new Date(end);
  // 验证日期是否有效
  if (isNaN(s.getTime()) || isNaN(e.getTime())) { return; }
  s.setHours(0,0,0,0); e.setHours(0,0,0,0);
  this._start = s; this._end = e; this._selecting = false;
  var display = document.getElementById(this.id + '_display');
  var trigger = document.getElementById(this.id + '_trigger');
  var clearBtn = document.getElementById(this.id + '_clear');
  if (display) display.textContent = this._fmtDate(this._start) + ' — ' + this._fmtDate(this._end);
  if (trigger) trigger.classList.add('has-val');
  if (clearBtn) clearBtn.style.display = 'block';
  this._leftYear = this._start.getFullYear(); this._leftMonth = this._start.getMonth();
  this._updateInfo(); this._enableConfirm(true); this._renderCals();
};
DateRangePicker.prototype.clear = function() {
  this._start = null; this._end = null; this._hover = null; this._selecting = false;
  var d = document.getElementById(this.id + '_display');
  if (d) d.textContent = this.placeholder;
  var t = document.getElementById(this.id + '_trigger');
  if (t) t.classList.remove('has-val');
  var c = document.getElementById(this.id + '_clear');
  if (c) c.style.display = 'none';
  this._updateInfo(); this._enableConfirm(false); this._renderCals();
};

// 全局实例注册表（供内联 onclick 使用）
window._drpInstances = window._drpInstances || {};

// ══════════════════════════════════════════════
//  旧版兼容：卡片管理继续使用全局函数（内部调用通用组件）
// ══════════════════════════════════════════════
var _drLeftYear, _drLeftMonth, _drSelecting = false, _drStart = null, _drEnd = null, _drHover = null;

function drInit() {
  // 每次重新初始化：彻底清理旧实例（防止内存泄漏和事件堆积）
  if (window._cmDrPicker) {
    // 移除 document 上的 click 监听器
    if (window._cmDrPicker._outsideHandler) {
      document.removeEventListener('click', window._cmDrPicker._outsideHandler);
    }
    // 移除所有相关 DOM（注意：panel 的 ID 是 cmDr_panel，不是 cmDr_drop）
    var oldTrigger = document.getElementById('cmDr_trigger');
    if (oldTrigger) oldTrigger.remove();
    var oldPanel = document.getElementById('cmDr_panel');
    if (oldPanel) oldPanel.remove();
    // 从注册表删除
    delete window._drpInstances['cmDr'];
    window._cmDrPicker = null;
  }
  window._cmDrPicker = new DateRangePicker({
    id: 'cmDr',
    container: '#cmDateWrap',
    placeholder: '开始日期 — 结束日期',
    onConfirm: function(start, end) {
      window._cmSearch.dateFrom = start;
      window._cmSearch.dateTo = end;
      doCmSearch();
    },
    onClear: function() {
      window._cmSearch.dateFrom = '';
      window._cmSearch.dateTo = '';
      doCmSearch();
    }
  });
  window._cmDrPicker.init();
  // 如果有已保存的值，且面板未打开（用户不在选择中），才恢复显示
  var trigger = document.getElementById('cmDr_trigger');
  var isOpen = trigger && trigger.classList.contains('open');
  if (!isOpen && window._cmSearch?.dateFrom && window._cmSearch?.dateTo) {
    window._cmDrPicker.setRange(window._cmSearch.dateFrom, window._cmSearch.dateTo);
  }
}
function drOutsideClick(e) {
  var t = document.getElementById('cmDr_trigger');
  if (t && !t.contains(e.target)) t.classList.remove('open');
}
function toggleDrPanel(e) {
  e.stopPropagation();
  var t = document.getElementById('cmDr_trigger');
  if (t) {
    var isOpen = t.classList.contains('open');
    document.querySelectorAll('.dr-trigger.open').forEach(function(el) { el.classList.remove('open'); });
    if (!isOpen) t.classList.add('open');
  }
}
function drRenderCals() { if (window._cmDrPicker) window._cmDrPicker._renderCals(); }
function drRenderCal(idx, year, month) { if (window._cmDrPicker) window._cmDrPicker._renderCal(idx, year, month); }
function drPad(n) { return n < 10 ? '0' + n : '' + n; }
function drDayCell(year, month, day, isOther) { if (window._cmDrPicker) return window._cmDrPicker._dayCell(year, month, day, isOther); return ''; }
function drNavMonth(delta) { if (window._cmDrPicker) window._cmDrPicker._navMonth(delta); }
function drClickDay(dateStr) { 
  console.log('[DateRangePicker] drClickDay called:', dateStr, 'window._cmDrPicker:', !!window._cmDrPicker, 'window._drpInstances.cmDr:', !!window._drpInstances?.cmDr);
  if (window._cmDrPicker) window._cmDrPicker._clickDay(dateStr); 
}
function drHoverDay(dateStr) { if (window._cmDrPicker) window._cmDrPicker._hoverDay(dateStr); }
function drFmtDate(d) { return d.getFullYear() + '/' + drPad(d.getMonth()+1) + '/' + drPad(d.getDate()); }
function drUpdateInfo() { if (window._cmDrPicker) window._cmDrPicker._updateInfo(); }
function drEnableConfirm(yes) { if (window._cmDrPicker) window._cmDrPicker._enableConfirm(yes); }
function drShortcut(type, el) {
  if (window._cmDrPicker) {
    window._cmDrPicker._shortcut(type, el);
    // 同步更新旧版显示
    var display = document.getElementById('drDisplay');
    if (display && window._cmDrPicker._start && window._cmDrPicker._end) {
      display.textContent = drFmtDate(window._cmDrPicker._start) + ' — ' + drFmtDate(window._cmDrPicker._end);
    }
  }
}
function drConfirm() {
  if (window._cmDrPicker && window._cmDrPicker._start && window._cmDrPicker._end) {
    var fmtD = function(d) { return d.getFullYear() + '-' + drPad(d.getMonth()+1) + '-' + drPad(d.getDate()); };
    window._cmSearch.dateFrom = fmtD(window._cmDrPicker._start);
    window._cmSearch.dateTo = fmtD(window._cmDrPicker._end);
    var display = document.getElementById('drDisplay');
    if (display) display.textContent = drFmtDate(window._cmDrPicker._start) + ' — ' + drFmtDate(window._cmDrPicker._end);
    var trigger = document.getElementById('drTrigger');
    if (trigger) trigger.classList.add('has-val');
    window._cmDrPicker._close();
    doCmSearch();
  }
}
function drCancel() { if (window._cmDrPicker) window._cmDrPicker._close(); }
function clearDrRange(e) {
  e.stopPropagation();
  if (window._cmDrPicker) window._cmDrPicker._clear(e);
  window._cmSearch.dateFrom = ''; window._cmSearch.dateTo = '';
  var display = document.getElementById('drDisplay');
  if (display) display.textContent = '开始日期 — 结束日期';
  var trigger = document.getElementById('drTrigger');
  if (trigger) trigger.classList.remove('has-val', 'open');
  doCmSearch();
}

// 加载卡片列表（带搜索参数）
async function loadCmList(forceRefresh = false) {
  const wrap = document.getElementById('cmListWrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading" style="text-align:center;padding:60px;">加载中...</div>';

  const isAdmin = _me?.role === 'admin';
  const s = window._cmSearch || {};

  let apiUrl;
  if (isAdmin) {
    const params = new URLSearchParams({ pageSize: 20, page: s.page || 1 });
    if (s.q) params.set('search', s.q);
    if (s.status) params.set('status', s.status);
    if (s.dateFrom) params.set('date_from', s.dateFrom);
    if (s.dateTo) params.set('date_to', s.dateTo);
    if (forceRefresh) params.set('force', 'true');
    params.set('sync', 'true'); // 每次加载从上游拉取最新状态
    apiUrl = '/admin/cards?' + params.toString();
  } else {
    apiUrl = '/cards';
  }

  const res = await apiFetch(apiUrl);    

  // 错误处理
  if (res.code === 429) {
    wrap.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⏰</div>
        <div class="empty-text">请求过于频繁</div>
        <div class="empty-sub">请等待1分钟后重试</div>
        <button class="btn btn-outline mt-4" onclick="loadCmList()">🔄 重新加载</button>
      </div>`;
    return;
  }
  
  if (res.code !== 0) {
    let errorHtml = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <div class="empty-text">${res.msg||'加载失败'}</div>`;
    if (res.code === 401 || (res.code === -1 && res.msg && res.msg.includes('Unauthorized'))) {
      errorHtml += `
        <div class="empty-sub">登录状态已失效，请重新登录</div>
        <div class="mt-4">
          <button class="btn btn-primary" onclick="doLogout(); location.reload();">🔑 重新登录</button>
        </div>`;
    } else {
      errorHtml += `
        <div class="empty-sub">请检查网络连接</div>
        <button class="btn btn-outline mt-4" onclick="loadCmList()">🔄 重新加载</button>`;
    }
    errorHtml += '</div>';
    wrap.innerHTML = errorHtml;
    return;
  }
  
  // 提取卡片列表
  let cards = [];
  if (isAdmin && res.data && res.data.list) {
    cards = res.data.list;
  } else {
    const rawData = res.data || {};
    const rawList = rawData.list || [];
    cards = rawList.filter(c => !c.error);
  }
  
  if (!cards.length) {
    wrap.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">💳</div>
        <div class="empty-text">暂无卡片</div>
        <div class="empty-sub">${s.q ? '未找到匹配的卡片，试试其他搜索条件' : '点击右上角申请您的第一张虚拟卡'}</div>
        <button class="btn btn-primary mt-4" onclick="${s.q ? 'resetCmSearch()' : 'gotoPage(\'apply\')'}">✨ ${s.q ? '重置搜索' : '立即申请'}</button>
      </div>`;
    return;
  }
  
  // 渲染卡片列表
  renderCmList(cards);
}

// 管理员查看卡片详情
window.showAdminCardDetail = async function(cardId) {
  // 先从缓存取基础数据，立即展示弹窗（避免白屏等待）
  const cards = window.currentCardList || [];
  const baseData = cards.find(c => c.card_id === cardId) || { card_id: cardId };
  
  // 展示弹窗，敏感字段先显示加载态
  showCardDetailModal({
    ...baseData,
    card_number: '加载中...',
    cvv: '···',
    available_amount: null,  // null 触发加载态
    _loading: true
  });

  // 同时调实时接口获取完整数据（含 vmcardio 实时数据）
  try {

    const res = await apiFetch(`/admin/cards/${cardId}/detail`);
    console.log('[cardDetail] 接口返回:', JSON.stringify({
      code: res.code,
      msg: res.msg,
      card_number: res.data?.card_number,
      cvv: res.data?.cvv,
      expire: res.data?.expire,
      available_amount: res.data?.available_amount,
      from_cache: res.data?._from_cache
    }));
    if (res.code === 0 && res.data) {
      // 用真实数据更新弹窗
      showCardDetailModal(res.data);
    } else {

      if (baseData.card_id) showCardDetailModal(baseData);
      else showToast('无法获取卡片详情', 'error');
    }
  } catch (e) {

    // 网络错误，用缓存数据
    if (baseData.card_id) showCardDetailModal(baseData);
    else showToast('获取卡片详情失败', 'error');
  }
}

function renderCmList(cards) {


  // 存储当前卡片列表供详情使用
  window.currentCardList = cards;
  
  const rows = cards.map(c => {
    const isActive = (c.status||'').toUpperCase() === 'ACTIVE';
    const isFrozen = (c.status||'').toUpperCase() === 'CANCELLED' || c.status === 'frozen';
    const isDeleted = (c.status||'').toLowerCase() === 'deleted';
    const masked = (c.card_number||'').replace(/^(\d{4})\d+(\d{4})$/,'$1 **** **** $2') || '**** **** **** ****';
    const isVisa = /visa/i.test(c.network||c.card_type||'');
    const statusBadge = isDeleted
      ? `<span class="tag tag-gray">已删除</span>`
      : isActive
        ? `<span class="tag tag-green">正常</span>`
        : isFrozen
          ? `<span class="tag tag-red">已冻结</span>`
          : `<span class="tag tag-yellow">${c.status||'—'}</span>`;
    var isInvalid = (c.verified_status === 'invalid');
    // 所有卡片都显示"可用余额"，失效卡片金额用浅灰色
    const balDisplay = Number(c.available_amount||0).toFixed(2);
    const balLabel = '可用余额';
    const balValueClass = isInvalid ? 'cm-bal-value cm-bal-invalid' : 'cm-bal-value';
    
    // 按钮逻辑：失效卡片显示"失效"、"详情"、"已冻结"
    var freezeBtn = '';
    if (isDeleted) {
      // 已删除卡片：显示灰色的"已删除"按钮（不可点击）
      freezeBtn = '<button class="cm-btn cm-btn-disabled" disabled style="background:#374151;color:#9CA3AF;cursor:not-allowed;border:1px solid #4B5563;">🗑️ 已失效</button>';
    } else if (isInvalid) {
      // 失效卡片：显示红色的"已冻结"按钮（不可点击）
      freezeBtn = '<button class="cm-btn cm-btn-frozen" disabled>❄️ 已冻结</button>';
    } else if (isActive) {
      freezeBtn = '<button class="cm-btn cm-btn-freeze" onclick="window.cmFreezeCard(\'' + c.card_id + '\',\'CANCELLED\',this)">❄️ 冻结</button>';
    } else if (isFrozen) {
      freezeBtn = '<button class="cm-btn cm-btn-unfreeze" onclick="window.cmFreezeCard(\'' + c.card_id + '\',\'ACTIVE\',this)">✅ 解冻</button>';
    }
    
    // 处理有效期显示
    let expireDisplay = '—';
    if (c.expire) {
      expireDisplay = c.expire;
    } else if (c.expiry_month && c.expiry_year) {
      expireDisplay = `${String(c.expiry_month).padStart(2, '0')}/${String(c.expiry_year).slice(-2)}`;
    }
    
    // 处理持卡人姓名显示
    let holderName = '';
    if (c.first_name && c.last_name) {
      holderName = `${c.first_name} ${c.last_name}`;
    } else if (c.user_name) {
      holderName = c.user_name;
    } else if (c.label) {
      holderName = c.label;
    }
    
    // 验证状态显示
    let verifyBadge = '';
    if (c.verified_status) {
      if (c.verified_status === 'valid') {
        verifyBadge = `<span class="tag tag-green" title="✅ 卡片已验证">有效</span>`;
      } else if (c.verified_status === 'invalid') {
        verifyBadge = `<span class="tag tag-red" title="❌ 卡片验证失败: ${c.verification_error || '未知错误'}">失效</span>`;
      } else if (c.verified_status === 'pending') {
        verifyBadge = `<span class="tag tag-yellow" title="🔄 待验证">待验证</span>`;
      }
    }
    
    // 如果是管理员，显示用户信息
    const userInfo = _me?.role === 'admin' && c.user_email 
      ? `<div class="cm-user-info">
           <span class="tag ${c.user_role === 'admin' ? 'tag-purple' : 'tag-blue'}">${c.user_role === 'admin' ? '管理员' : '用户'}</span>
           <span class="cm-user-email">${c.user_email}</span>
           ${verifyBadge}
         </div>`
      : verifyBadge ? `<div class="cm-user-info">${verifyBadge}</div>` : '';
    
    return `
      <div class="cm-card" id="cm-${c.card_id}">
        <div class="cm-card-left">
          <div class="cm-network-badge ${isVisa?'cm-visa':'cm-mc'}">${isVisa?'VISA':'MC'}</div>
          <div class="cm-info">
            <div class="cm-number">${masked}</div>
            <div class="cm-meta">
              <span>${holderName || '—'}</span>
              <span class="cm-sep">·</span>
              <span>有效期 ${expireDisplay}</span>
              <span class="cm-sep">·</span>
              <span>${c.card_id||'—'}</span>
            </div>
            ${userInfo}
          </div>
        </div>
        <div class="cm-card-right">
          <div class="cm-bal">
            <div class="cm-bal-label">${balLabel}</div>
            <div class="${balValueClass}">$${balDisplay}</div>
          </div>
          <div class="cm-actions-row">
            ${isInvalid ? '<span class="cm-status-badge cm-status-invalid">失效</span>' : `<div class="cm-status">${statusBadge}</div>`}
            ${_me?.role === 'admin' ? `<button class="cm-btn cm-btn-detail" onclick="window.showAdminCardDetail('${c.card_id}')">🔍 详情</button>` : ''}
            ${_me?.role !== 'admin' && !isInvalid ? '<button class="cm-btn cm-btn-topup" onclick="window.cmRechargeCard(\'' + c.card_id + '\')">💰 充值</button>' : ''}
            ${freezeBtn}
          </div>
        </div>
      </div>`;
  }).join('');
  document.getElementById('cmListWrap').innerHTML = `<div class="cm-list">${rows}</div>`;
}

// 卡片管理 — 充值弹窗
window.cmRechargeCard = function(cardId) {
  // 复用已有的充值逻辑 or 弹一个简单 prompt
  const amt = prompt('请输入充值金额（USD）：');
  if (!amt || isNaN(Number(amt)) || Number(amt) <= 0) { toast('❌ 请输入有效金额'); return; }
  apiFetch('/cards/recharge', { method:'POST', body: JSON.stringify({ card_id: cardId, amount: Number(amt) }) })
    .then(r => {
      if (r.code === 0) { toast('✅ 充值成功'); renderCardManage(); }
      else toast('❌ ' + (r.msg||'充值失败'));
    }).catch(() => toast('❌ 充值请求失败'));
}

// 卡片管理 — 冻结/解冻
window.cmFreezeCard = async function(cardId, targetStatus, btnEl) {
  const label = targetStatus === 'CANCELLED' ? '冻结' : '解冻';
  // 前置校验：失效卡片不允许操作
  var cards = window.currentCardList || [];
  var card = cards.find(function(c) { return c.card_id === cardId; });
  if (card && card.verified_status === 'invalid') {
    toast('该卡片已失效，无法执行' + label + '操作', 3000);
    return;
  }
  // 防重复点击 + 立即视觉反馈
  if (btnEl && btnEl.disabled) return;
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.dataset.originalText = btnEl.innerHTML;
    btnEl.innerHTML = '<span class="spin">⟳</span> ' + label + '中...';
  }
  try {
    const r = await apiFetch('/cards/' + cardId + '/freeze', { method:'POST', body: JSON.stringify({ status: targetStatus }) });
    if (r.code === 0) { toast('✅ 卡片已' + label); renderCardManage(); }
    else toast('❌ ' + (r.msg||label + '失败'));
  } catch(e) {
    if (e.message !== 'Unauthorized') toast('❌ ' + label + '请求失败');
  } finally {
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.innerHTML = btnEl.dataset.originalText || (targetStatus === 'CANCELLED' ? '❄️ 冻结' : '✅ 解冻');
    }
  }
}

// ══════════════════════════════════════════════
//  PAGE: 账户流水
// ══════════════════════════════════════════════
async function renderLedger() {
  const area = document.getElementById('contentArea');
  area.innerHTML = `
    <div class="page-header">
      <div><h2>账户流水</h2><p class="text-muted mt-1">账户余额变动历史记录</p></div>
    </div>
    <div class="panel" style="height:calc(100vh - 180px);display:flex;flex-direction:column;">
      <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;font-size:.75rem;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.05em;">
        <div>交易时间</div>
        <div>币种</div>
        <div style="text-align:right">交易金额</div>
        <div style="text-align:right">账户余额</div>
      </div>
      <div id="ledgerWrap" style="flex:1;overflow-y:auto;padding:0;">
        <div class="skeleton" style="height:300px;border-radius:0;margin:0;"></div>
      </div>
    </div>`;
  
  try {
    const r = await apiFetch('/ledger?page_size=50');
    if (r.code !== 0) { 
      document.getElementById('ledgerWrap').innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">加载失败</div></div>`;
      return; 
    }
    const items = r.data?.list || [];
    if (!items.length) {
      document.getElementById('ledgerWrap').innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">暂无账户流水</div></div>`;
      return;
    }
    const html = items.map(item => {
      const dt = new Date(item.created_at || item.timestamp).toLocaleString('zh-CN');
      const currency = item.currency || 'USD';
      const txAmt = item.amount || 0;
      const balance = item.balance || 0;
      const amtColor = txAmt > 0 ? 'var(--green)' : txAmt < 0 ? 'var(--red)' : 'var(--text2)';
      return `
      <div style="padding:12px 20px;border-bottom:1px solid rgba(255,255,255,.03);display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;align-items:center;font-size:.85rem;transition:background .12s;">
        <div style="color:var(--text2);">${dt}</div>
        <div style="color:var(--text1);font-weight:600;">${currency}</div>
        <div style="text-align:right;font-weight:700;color:${amtColor};">${txAmt > 0 ? '+' : ''}${txAmt.toFixed(2)}</div>
        <div style="text-align:right;color:var(--text1);font-weight:600;">$${balance.toFixed(2)}</div>
      </div>`;
    }).join('');
    document.getElementById('ledgerWrap').innerHTML = html || '<div class="empty-state"><div class="empty-text">暂无记录</div></div>';
  } catch(e) {
    if (e.message !== 'Unauthorized') {
      document.getElementById('ledgerWrap').innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">加载失败，请稍后重试</div></div>`;
    }
  }
}

// ══════════════════════════════════════════════
//  PAGE: 卡交易记录
// ══════════════════════════════════════════════
async function renderCardTx() {
  const area = document.getElementById('contentArea');
  area.innerHTML = `
    <div class="page-header">
      <div><h2>卡交易记录</h2><p class="text-muted mt-1">所有虚拟卡的交易明细</p></div>
    </div>
    <div class="panel">
      <div id="cardTxWrap" style="padding:24px;">
        <div class="skeleton" style="height:300px;border-radius:12px;"></div>
      </div>
    </div>`;
  try {
    const r = await apiFetch('/transactions?page_size=50');
    if (r.code !== 0) { 
      document.getElementById('cardTxWrap').innerHTML = `<div class="empty-state"><div class="empty-text">加载失败</div></div>`;
      return; 
    }
    const items = r.data?.list || [];
    if (!items.length) {
      document.getElementById('cardTxWrap').innerHTML = `<div class="empty-state"><div class="empty-text">暂无交易记录</div></div>`;
      return;
    }
    const txTypeMap = {
      Authorization: '消费授权',
      Settlement: '清算',
      Refund: '退款',
      Reversal: '撤销',
    };
    const txStatusMap = {
      PENDING: '清算中',
      DECLINED: '失败',
      COMPLETE: '完成',
    };
    const html = items.map(item => `
      <div style="padding:12px;border-bottom:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;align-items:center;font-size:.85rem;">
        <div>
          <div style="font-weight:600;color:var(--text1);">${item.card_id?.slice(0,6) || '—'}</div>
          <div style="color:var(--text3);margin-top:2px;">${item.product_code || '—'}</div>
        </div>
        <div>
          <div style="color:var(--text2);">${item.merchant_name || '—'}</div>
          <div style="color:var(--text3);margin-top:2px;">${txTypeMap[item.transaction_type] || item.transaction_type || '—'}</div>
        </div>
        <div>
          <span class="tag ${item.status === 'COMPLETE' ? 'tag-green' : item.status === 'PENDING' ? 'tag-yellow' : 'tag-red'}" style="font-size:.7rem;">
            ${txStatusMap[item.status] || item.status || '—'}
          </span>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:700;color:${item.amount < 0 ? 'var(--red)' : 'var(--green)'};">${item.amount?.toFixed(2) || '—'}</div>
          <div style="color:var(--text3);margin-top:2px;">${new Date(item.start_time).toLocaleDateString('zh-CN')}</div>
        </div>
      </div>
    `).join('');
    document.getElementById('cardTxWrap').innerHTML = html;
  } catch(e) {
    if (e.message !== 'Unauthorized') {
      document.getElementById('cardTxWrap').innerHTML = `<div class="empty-state"><div class="empty-text">加载失败</div></div>`;
    }
  }
}

// ══════════════════════════════════════════════
//  PAGE: 卡结算记录
// ══════════════════════════════════════════════
async function renderCardSettle() {
  const area = document.getElementById('contentArea');
  area.innerHTML = `
    <div class="page-header">
      <div><h2>卡结算记录</h2><p class="text-muted mt-1">虚拟卡的结算对账记录</p></div>
    </div>
    <div class="panel">
      <div id="cardSettleWrap" style="padding:24px;">
        <div class="skeleton" style="height:300px;border-radius:12px;"></div>
      </div>
    </div>`;
  
  const r = await apiFetch('/transactions?type=settlement&page_size=50');
  
  // 检查API响应
  if (r.code === 429) {
    // 频率限制错误
    document.getElementById('cardSettleWrap').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⏰</div>
        <div class="empty-text">请求过于频繁</div>
        <div class="empty-sub">请等待1分钟后重试</div>
        <button class="btn btn-outline mt-4" onclick="renderCardSettle()">🔄 重新加载</button>
      </div>`;
    return;
  }
  
  if (r.code !== 0) { 
    // 其他错误
    document.getElementById('cardSettleWrap').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <div class="empty-text">${r.msg||'加载失败'}</div>
        <div class="empty-sub">请检查网络连接</div>
        <button class="btn btn-outline mt-4" onclick="renderCardSettle()">🔄 重新加载</button>
      </div>`;
    return; 
  }
  
  const items = r.data?.list || [];
  if (!items.length) {
    document.getElementById('cardSettleWrap').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📊</div>
        <div class="empty-text">暂无结算记录</div>
        <div class="empty-sub">暂无卡片的结算记录</div>
      </div>`;
    return;
  }
  const html = items.map(item => `
      <div style="padding:12px;border-bottom:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;align-items:center;font-size:.85rem;">
        <div>
          <div style="font-weight:600;color:var(--text1);">${item.card_id?.slice(0,6) || '—'}</div>
          <div style="color:var(--text3);margin-top:2px;">结算周期</div>
        </div>
        <div>
          <div style="color:var(--text2);">交易总额</div>
          <div style="font-weight:700;color:var(--text1);margin-top:2px;">${item.total_amount?.toFixed(2) || '—'}</div>
        </div>
        <div>
          <div style="color:var(--text2);">手续费</div>
          <div style="font-weight:700;color:var(--red);margin-top:2px;">-${item.fee?.toFixed(2) || '—'}</div>
        </div>
        <div style="text-align:right;">
          <div style="color:var(--text3);">结算时间</div>
          <div style="font-weight:600;color:var(--text1);margin-top:2px;">${new Date(item.settle_time).toLocaleDateString('zh-CN')}</div>
        </div>
      </div>
    `).join('');
  document.getElementById('cardSettleWrap').innerHTML = html;
}

// ══════════════════════════════════════════════
//  PAGE: 管理员 - 用户管理
// ══════════════════════════════════════════════
// 管理员总览页面
async function renderAdminDashboard() {
  if (_me?.role !== 'admin') return gotoPage('cards');
  const area = document.getElementById('contentArea');
  area.innerHTML = `
    <div class="page-header">
      <div><h2>管理总览</h2><p class="text-muted mt-1">商户余额与平台数据监控</p></div>
    </div>

    
    <div class="ov-stat-row">
      <div class="ov-stat-card" style="background: linear-gradient(135deg, #1e253a 0%, #13192a 100%); border: 1px solid #2d344a;">
        <div class="flex" style="justify-content:space-between;align-items:center;">
          <div class="ov-stat-label">商户余额</div>
          <button class="btn btn-primary btn-sm" onclick="loadMerchantBalance(true)" style="font-size:.7rem;padding:3px 10px;">⟳ 刷新</button>
        </div>
        <div class="ov-stat-val grad-text" id="adminMerchantBalance">$—</div>
        <div class="ov-stat-sub" id="adminWalletBalance">额度钱包：$—</div>
        <div class="ov-stat-sub" style="font-size:0.7rem; margin-top: 4px;" id="adminLastSync">最后同步：—</div>
      </div>
      
      
      <div class="ov-stat-card" id="balanceStatusCard" style="background: #13192a;">
        <div class="ov-stat-label">余额状态</div>
        <div class="flex items-center gap-2">
          <div class="status-indicator" id="balanceIndicator">●</div>
          <div class="ov-stat-val" style="font-size: 1.1rem;" id="balanceStatusText">正常</div>
        </div>
        <div class="ov-stat-sub" id="balanceWarningMsg" style="color: #ffb347;"></div>
        <div class="mt-2" style="font-size: 0.75rem; color: var(--text3);">
          警戒线：<span style="color: #ffb347;">$100</span> | 余额不足时请手动充值
        </div>
      </div>

      
      <div class="ov-stat-card" style="background: #13192a;">
        <div class="ov-stat-label">平台统计</div>
        <div class="ov-stat-val" style="font-size: 1.4rem;" id="adminUserCount">—</div>
        <div class="ov-stat-sub">注册用户</div>
      </div>
      
      <div class="ov-stat-card" style="background: #13192a;">
        <div class="ov-stat-label">平台统计</div>
        <div class="ov-stat-val" style="font-size: 1.4rem;" id="adminCardCount">—</div>
        <div class="ov-stat-sub">激活卡片</div>
      </div>
    </div>

    
    <div class="alert alert-warning hidden" id="lowBalanceAlert">
      <div class="flex items-center gap-2">
        <span>⚠️</span>
        <div>
          <strong>商户余额不足 $100</strong>
          <div style="font-size: 0.85rem;">请及时充值，避免影响用户开卡与消费</div>
        </div>
      </div>
      <div class="flex gap-2 mt-2">
        <button class="btn btn-warning btn-sm" onclick="gotoPage('settings')">充值设置</button>
        <button class="btn btn-outline btn-sm" onclick="closeAlert()">忽略</button>
      </div>
    </div>

    
    <div class="panel mt-4">
      <div style="font-weight: 700; margin-bottom: 12px;">同步状态</div>
      <div class="flex items-center justify-between">
        <div>
          <div style="font-size: 0.9rem; color: var(--text2);">自动同步频率：<span style="color: var(--text1);">每分钟</span></div>
          <div style="font-size: 0.8rem; color: var(--text3); margin-top: 4px;">服务端定时拉取最新余额</div>
        </div>
        <button class="btn btn-outline btn-sm" onclick="loadMerchantBalance(true)">手动同步</button>
      </div>
      <div class="mt-3" style="font-size: 0.8rem; color: var(--text3);">
        <div>最后同步时间：<span id="syncTimestamp">—</span></div>
        <div>最后错误：<span id="lastError">无</span></div>
      </div>
    </div>
  `;

  // 异步加载数据（不阻塞 UI 渲染）
  Promise.all([loadMerchantBalance(), loadAdminStats()]).catch(e => console.error('管理总览数据加载异常:', e));
}

// 加载商户余额
async function loadMerchantBalance(forceRefresh = false) {
  try {
    const res = await apiFetch('/admin/merchant-balance');
    if (res.code !== 0) throw new Error(res.msg);
    
    const data = res.data;
    
    // 防止页面已切换导致 DOM 元素不存在
    if (!document.getElementById('adminMerchantBalance')) return;
    
    // 更新余额显示
    document.getElementById('adminMerchantBalance').textContent = `$${data.balance.toFixed(2)}`;
    document.getElementById('adminWalletBalance').textContent = `额度钱包：$${(data.wallet_balance || 0).toFixed(2)}`;
    
    // 更新同步时间
    const syncTime = data.last_sync ? new Date(data.last_sync).toLocaleString('zh-CN') : '刚刚';
    document.getElementById('adminLastSync').textContent = `最后同步：${syncTime}`;
    var syncTsEl = document.getElementById('syncTimestamp');
    if (syncTsEl) syncTsEl.textContent = syncTime;
    
    // 更新错误信息
    var errEl = document.getElementById('lastError');
    if (errEl) errEl.textContent = data.last_error || '无';
    
    // 更新余额状态
    updateBalanceStatus(data.balance, data.is_low_balance);
    
    // 显示/隐藏警告横幅
    const alertEl = document.getElementById('lowBalanceAlert');
    if (alertEl) {
      if (data.is_low_balance) {
        alertEl.classList.remove('hidden');
        alertEl.innerHTML = `
        <div class="flex items-center gap-2">
          <span>⚠️</span>
          <div>
            <strong>商户余额不足 $100</strong>
            <div style="font-size: 0.85rem;">当前余额：$${data.balance.toFixed(2)}，请及时充值</div>
          </div>
        </div>
        <div class="flex gap-2 mt-2">
          <button class="btn btn-warning btn-sm" onclick="gotoPage('settings')">充值设置</button>
          <button class="btn btn-outline btn-sm" onclick="closeAlert()">忽略</button>
        </div>
      `;
      } else {
        alertEl.classList.add('hidden');
      }
    }
    
    if (forceRefresh) {
      toast('✅ 商户余额已刷新');
    }
  } catch (err) {

    var bstEl = document.getElementById('balanceStatusText');
    var biEl = document.getElementById('balanceIndicator');
    if (bstEl) bstEl.textContent = '连接失败';
    if (biEl) biEl.style.color = '#ff5f5f';
    if (forceRefresh) toast('❌ 加载商户余额失败');
  }
}

// 更新余额状态显示
function updateBalanceStatus(balance, isLow) {
  const indicator = document.getElementById('balanceIndicator');
  const statusText = document.getElementById('balanceStatusText');
  const warningMsg = document.getElementById('balanceWarningMsg');
  
  if (balance <= 0) {
    indicator.style.color = '#ff5f5f';
    statusText.textContent = '危险';
    statusText.style.color = '#ff5f5f';
    warningMsg.textContent = '商户余额已用完，请立即充值！';
    warningMsg.style.color = '#ff5f5f';
  } else if (isLow) {
    indicator.style.color = '#ffb347';
    statusText.textContent = '不足';
    statusText.style.color = '#ffb347';
    warningMsg.textContent = '余额不足 $100，建议及时充值';
    warningMsg.style.color = '#ffb347';
  } else {
    indicator.style.color = '#00c758';
    statusText.textContent = '正常';
    statusText.style.color = '#00c758';
    warningMsg.textContent = '';
  }
}

// 刷新余额不足提醒
function refreshLowBalanceAlert() {
  loadMerchantBalance(true);
}

// 关闭警告横幅
function closeAlert() {
  document.getElementById('lowBalanceAlert').classList.add('hidden');
}

// 加载管理员统计数据
async function loadAdminStats() {
  try {
    const res = await apiFetch('/admin/stats');
    if (res.code !== 0) throw new Error(res.msg);
    
    const data = res.data;
    var ucEl = document.getElementById('adminUserCount');
    var ccEl = document.getElementById('adminCardCount');
    if (ucEl) ucEl.textContent = data.users.total;
    if (ccEl) ccEl.textContent = data.cards.total;
  } catch (err) {
    console.error('[loadAdminStats] 加载统计失败:', err.message || err);
  }
}

async function renderAdminUsers() {
  if (_me?.role !== 'admin') return gotoPage('cards');
  const area = document.getElementById('contentArea');
  area.innerHTML = `
    <div class="page-header">
      <div><h2>用户管理</h2><p class="text-muted mt-1">查看所有用户，充值/冻结/解冻账号</p></div>
    </div>
    <div class="panel">
      <div id="adminUserListWrap"><div class="skeleton" style="height:200px;"></div></div>
    </div>`;
  try {
    const res = await apiFetch('/admin/users');
    if (res.code !== 0) { toast('❌ 加载失败'); return; }
    const users = res.data.list || [];
    if (!users.length) {
      document.getElementById('adminUserListWrap').innerHTML = '<div style="color:var(--text3);font-size:.85rem;text-align:center;padding:32px">暂无用户</div>';
      return;
    }
    const statusBadge = s => {
      if (s === 'disabled') return `<span class="tag" style="background:rgba(248,113,113,.15);color:#f87171;border:1px solid rgba(248,113,113,.3)">已冻结</span>`;
      if (s === 'locked')   return `<span class="tag" style="background:rgba(251,191,36,.12);color:#fbbf24;border:1px solid rgba(251,191,36,.3)">已锁定</span>`;
      return `<span class="tag tag-green">正常</span>`;
    };
    const rows = users.map(u => `
      <tr id="au-row-${u.id}">
        <td><div style="font-weight:600">${u.name||'—'}</div><div style="font-size:.72rem;color:var(--text3)">${u.email}</div></td>
        <td><span class="tag ${u.role==='admin'?'tag-purple':'tag-blue'}">${u.role==='admin'?'管理员':'用户'}</span></td>
        <td>${statusBadge(u.status)}</td>
        <td style="color:var(--text3);font-size:.8rem">${u.card_count} 张</td>
        <td id="au-balance-${u.id}" style="color:#00f2fe;font-weight:600;font-size:.85rem">${u.role !== 'admin' ? '$' + parseFloat(u.balance||0).toFixed(2) : '—'}</td>
        <td style="color:var(--text3);font-size:.78rem">${u.created_at ? new Date(u.created_at).toLocaleDateString('zh-CN') : '—'}</td>
        <td>
          ${u.role !== 'admin' ? `
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button class="au-btn" style="background:rgba(0,242,254,.1);color:#00f2fe;border:1px solid rgba(0,242,254,.25);" onclick="openTopupModal(${u.id},'${String(u.name||u.email||'该用户').replace(/'/g, "\\'").replace(/"/g, '&quot;')}',${parseFloat(u.balance||0).toFixed(2)})">💰 充值</button>
              ${u.status === 'disabled'
                ? `<button class="au-btn au-btn-enable" onclick="confirmFreezeOrUnfreeze(${u.id},'active','${String(u.name||u.email||'该用户').replace(/'/g, "\\'").replace(/"/g, '&quot;')}')">🔓 解冻</button>
                   <button class="au-btn au-btn-disabled" disabled>🔒 冻结</button>`
                : `<button class="au-btn au-btn-disable" onclick="confirmFreezeOrUnfreeze(${u.id},'disabled','${String(u.name||u.email||'该用户').replace(/'/g, "\\'").replace(/"/g, '&quot;')}')">🔒 冻结</button>
                   <button class="au-btn au-btn-disabled" disabled>🔓 解冻</button>`
              }
            </div>
          ` : '<span style="color:var(--text3);font-size:.75rem">—</span>'}
        </td>
      </tr>`).join('');
    document.getElementById('adminUserListWrap').innerHTML = `
      <div style="overflow-x:auto;">
        <table class="au-table">
          <thead><tr><th>用户</th><th>角色</th><th>状态</th><th>持卡</th><th>余额</th><th>注册时间</th><th>操作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  } catch(e) {
    if (e.message !== 'Unauthorized') toast('❌ 加载失败');
  }
}

// 冻结/解冻账户确认弹窗
function confirmFreezeOrUnfreeze(userId, targetStatus, userName) {
  const isFreeze = targetStatus === 'disabled';
  const title = isFreeze ? '🔒 确认冻结账户' : '🔓 确认解冻账户';
  const actionText = isFreeze ? '冻结' : '解冻';
  const description = isFreeze
    ? '确定要冻结 <strong style="color:#00f2fe;">' + userName + '</strong> 的账户吗？冻结后用户将无法登录和消费。'
    : '确定要解冻 <strong style="color:#00f2fe;">' + userName + '</strong> 的账户吗？解冻后用户可恢复正常使用。';

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999;';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:linear-gradient(135deg, #0d1322 0%, #13192a 100%);border:1px solid rgba(0,242,254,.2);border-radius:16px;padding:28px;max-width:400px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.4);';

  const color = isFreeze ? '#ff5f5f' : '#00c758';
  const bg = isFreeze ? 'rgba(255,95,95,.15)' : 'rgba(0,199,88,.15)';
  
  modal.innerHTML = '<div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">' +
    '<div style="font-size:28px;line-height:1;">' + (isFreeze ? '🔒' : '🔓') + '</div>' +
    '<h3 style="margin:0;color:' + color + ';font-size:17px;font-weight:700;">' + title + '</h3>' +
    '</div>' +
    '<p style="margin:0 0 24px;color:var(--text2);font-size:.88rem;line-height:1.6;">' + description + '</p>' +
    '<div style="display:flex;gap:12px;justify-content:flex-end;">' +
    '<button id="cancelBtn" style="padding:10px 22px;border-radius:10px;border:none;background:linear-gradient(135deg, #2d3746 0%, #1a2332 100%);color:#9fa8ba;cursor:pointer;font-weight:700;font-size:.9rem;transition:all .2s ease;box-shadow:0 3px 10px rgba(0,0,0,.2);letter-spacing:0.5px;">取消</button>' +
    '<button id="confirmBtn" style="padding:10px 22px;border-radius:10px;border:none;color:white;cursor:pointer;font-weight:700;font-size:.9rem;transition:all .2s ease;box-shadow:0 4px 15px rgba(0,0,0,.3);letter-spacing:0.5px;">' + actionText + '</button>' +
    '</div>';

  const cancelBtn = modal.querySelector('#cancelBtn');
  
  cancelBtn.addEventListener('mouseenter', function() {
    this.style.transform = 'translateY(-2px)';
    this.style.boxShadow = '0 4px 12px rgba(0,0,0,.3)';
    this.style.background = 'linear-gradient(135deg, #3c4557 0%, #232a39 100%)';
  });
  
  cancelBtn.addEventListener('mouseleave', function() {
    this.style.transform = 'translateY(0)';
    this.style.boxShadow = '0 3px 10px rgba(0,0,0,.2)';
    this.style.background = 'linear-gradient(135deg, #2d3746 0%, #1a2332 100%)';
  });
  
  cancelBtn.addEventListener('click', function() {
    overlay.remove();
  });

  // 设置确认按钮的渐变背景
  const confirmBtn = modal.querySelector('#confirmBtn');
  const gradient = isFreeze
    ? 'linear-gradient(135deg, #ff5f5f 0%, #e53935 100%)'
    : 'linear-gradient(135deg, #00c758 0%, #00a849 100%)';
  confirmBtn.style.background = gradient;
  
  confirmBtn.addEventListener('click', async function() {
    overlay.remove();
    await setUserStatus(userId, targetStatus);
  });

  modal.querySelector('#confirmBtn').addEventListener('mouseenter', function() {
    this.style.transform = 'translateY(-2px)';
    this.style.boxShadow = '0 6px 20px rgba(0,0,0,.4)';
    // 悬停时渐变变亮
    const hoverGradient = isFreeze
      ? 'linear-gradient(135deg, #ff7b7b 0%, #ff5252 100%)'
      : 'linear-gradient(135deg, #00e472 0%, #00d062 100%)';
    this.style.background = hoverGradient;
  });
  modal.querySelector('#confirmBtn').addEventListener('mouseleave', function() {
    this.style.transform = 'translateY(0)';
    this.style.boxShadow = '0 4px 15px rgba(0,0,0,.3)';
    this.style.background = gradient;
  });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', function(e) {
    if (e.target === this) this.remove();
  });
}

async function setUserStatus(userId, status) {
  const label = status === 'disabled' ? '冻结' : '解冻';
  try {
    const res = await apiFetch(`/admin/users/${userId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    if (res.code !== 0) { toast('❌ ' + (res.msg||'操作失败')); return; }
    toast(`✅ 已${label}该用户`);
    renderAdminUsers(); // 刷新列表
  } catch(e) {
    if (e.message !== 'Unauthorized') toast('❌ 操作失败');
  }
}

// ── 管理员充值弹窗 ────────────────────────────────────────────────────────────
function openTopupModal(userId, userName, currentBalance) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;z-index:9999;';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:linear-gradient(135deg, #0d1322 0%, #13192a 100%);border:1px solid rgba(0,242,254,.25);border-radius:16px;padding:28px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.5);';

  modal.innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;">
      <div style="font-size:28px;line-height:1;">💰</div>
      <div>
        <h3 style="margin:0;color:#00f2fe;font-size:17px;font-weight:700;">为用户充值</h3>
        <p style="margin:4px 0 0;color:var(--text3);font-size:.8rem;">${userName}</p>
      </div>
    </div>
    <div style="background:rgba(0,242,254,.06);border:1px solid rgba(0,242,254,.12);border-radius:10px;padding:12px 16px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;">
      <span style="color:var(--text3);font-size:.82rem;">当前余额</span>
      <span style="color:#00f2fe;font-weight:700;font-size:1.1rem;">$${parseFloat(currentBalance||0).toFixed(2)}</span>
    </div>
    <div style="margin-bottom:16px;">
      <label style="display:block;color:var(--text2);font-size:.82rem;margin-bottom:8px;">充值金额 (USD)</label>
      <div style="display:flex;align-items:center;gap:0;border:1px solid rgba(0,242,254,.3);border-radius:10px;overflow:hidden;background:rgba(255,255,255,.04);">
        <span style="padding:0 14px;color:#00f2fe;font-weight:700;font-size:1rem;background:rgba(0,242,254,.08);height:44px;display:flex;align-items:center;">$</span>
        <input id="topupAmountInput" type="number" min="0.01" step="0.01" placeholder="输入充值金额"
          style="flex:1;border:none;background:transparent;padding:0 14px;height:44px;color:var(--text1);font-size:.95rem;outline:none;"/>
      </div>
    </div>
    <div style="margin-bottom:24px;">
      <label style="display:block;color:var(--text2);font-size:.82rem;margin-bottom:8px;">备注（可选）</label>
      <input id="topupNoteInput" type="text" placeholder="如：微信转账 ¥200"
        style="width:100%;border:1px solid rgba(255,255,255,.1);border-radius:10px;background:rgba(255,255,255,.04);padding:10px 14px;color:var(--text1);font-size:.88rem;outline:none;box-sizing:border-box;"/>
    </div>
    <div style="display:flex;gap:12px;justify-content:flex-end;">
      <button id="topupCancelBtn" style="padding:10px 22px;border-radius:10px;border:none;background:linear-gradient(135deg,#2d3746,#1a2332);color:#9fa8ba;cursor:pointer;font-weight:700;font-size:.9rem;">取消</button>
      <button id="topupConfirmBtn" style="padding:10px 26px;border-radius:10px;border:none;background:linear-gradient(135deg,#00f2fe,#0ab8d4);color:#090e1c;cursor:pointer;font-weight:700;font-size:.9rem;letter-spacing:.5px;">确认充值</button>
    </div>`;

  modal.querySelector('#topupCancelBtn').onclick = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  modal.querySelector('#topupConfirmBtn').onclick = async function() {
    const amtVal = modal.querySelector('#topupAmountInput').value;
    const noteVal = modal.querySelector('#topupNoteInput').value.trim();
    const amt = parseFloat(amtVal);
    if (!amtVal || isNaN(amt) || amt <= 0) {
      toast('⚠️ 请输入有效的充值金额');
      return;
    }
    this.disabled = true;
    this.textContent = '处理中...';
    try {
      const res = await apiFetch(`/admin/users/${userId}/topup`, {
        method: 'POST',
        body: JSON.stringify({ amount: amt, note: noteVal })
      });
      if (res.code !== 0) {
        toast('❌ ' + (res.msg || '充值失败'));
        this.disabled = false;
        this.textContent = '确认充值';
        return;
      }
      overlay.remove();
      toast(`✅ 充值成功！${res.data.user_name} 新余额 $${res.data.new_balance}`);
      // 直接更新表格中的余额显示
      const balanceCell = document.getElementById(`au-balance-${userId}`);
      if (balanceCell) balanceCell.textContent = '$' + parseFloat(res.data.new_balance).toFixed(2);
    } catch(e) {
      if (e.message !== 'Unauthorized') toast('❌ 操作失败');
      this.disabled = false;
      this.textContent = '确认充值';
    }
  };

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  // 自动聚焦金额输入框
  setTimeout(() => modal.querySelector('#topupAmountInput').focus(), 100);
}

// ══════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════
function initApp() {
  if (_token && _me) {
    enterDash();
  } else {
    showAuth();
  }
}

// ══════════════════════════════════════════════
//  PARTICLE NETWORK — 鼠标交互连线粒子（登录页）
// ══════════════════════════════════════════════
function initParticles() {
  const canvas = document.getElementById('authCanvas');
  if (!canvas) return;

  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:1;display:block;';

  const ctx = canvas.getContext('2d');
  const COLORS = ['#7eb8f7','#a78bfa','#e879f9'];
  const COUNT  = 90;
  const DIST   = 140;
  const REPEL  = 130;

  let W = 0, H = 0;
  let mouse = { x: -9999, y: -9999 };
  let pts = [];
  let rafId = null;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function mkPt() {
    return {
      x: rnd(0, W), y: rnd(0, H),
      vx: rnd(-0.7, 0.7), vy: rnd(-0.7, 0.7),
      r: rnd(1.3, 2.5),
      col: COLORS[Math.floor(Math.random() * COLORS.length)],
      a: rnd(0.55, 1)
    };
  }

  function rebuild() { pts = []; for (let i = 0; i < COUNT; i++) pts.push(mkPt()); }

  function tick() {
    // 登录后 canvas 隐藏时，完全停止计算和绘制，释放 CPU
    if (canvas.style.display === 'none') return;

    // 更新位置
    for (const p of pts) {
      const dx = p.x - mouse.x, dy = p.y - mouse.y;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < REPEL && d > 0) {
        const f = (REPEL - d) / REPEL * 1.2;
        p.vx += (dx / d) * f;
        p.vy += (dy / d) * f;
      }
      p.vx *= 0.995; p.vy *= 0.995;
      const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      if (spd > 2.0) { p.vx *= 2.0 / spd; p.vy *= 2.0 / spd; }
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) { p.x = 0; p.vx *= -1; } if (p.x > W) { p.x = W; p.vx *= -1; }
      if (p.y < 0) { p.y = 0; p.vy *= -1; } if (p.y > H) { p.y = H; p.vy *= -1; }
    }

    ctx.clearRect(0, 0, W, H);

    // 粒子间连线
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < DIST) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(167,139,250,${(1 - d / DIST) * 0.38})`;
          ctx.lineWidth = 0.7; ctx.stroke();
        }
      }
    }

    // 鼠标连线（品粉，更亮）
    for (const p of pts) {
      const dx = p.x - mouse.x, dy = p.y - mouse.y;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < DIST * 1.4) {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y); ctx.lineTo(mouse.x, mouse.y);
        ctx.strokeStyle = `rgba(232,121,249,${(1 - d / (DIST * 1.4)) * 0.65})`;
        ctx.lineWidth = 1; ctx.stroke();
      }
    }

    // 粒子点
    for (const p of pts) {
      ctx.globalAlpha = p.a;
      ctx.fillStyle   = p.col;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    rafId = requestAnimationFrame(tick);
  }

  function startTick() { if (!rafId) rafId = requestAnimationFrame(tick); }
  function stopTick() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }

  // 保存事件监听器引用，便于登录后移除
  const onMouseMove = e => { mouse.x = e.clientX; mouse.y = e.clientY; };
  const onMouseLeave = () => { mouse.x = -9999; mouse.y = -9999; };
  const onResize = () => { resize(); rebuild(); };

  // 登录/后台切换时显隐 canvas + 启停动画
  const _sa = window.showAuth, _ed = window.enterDash;
  window.showAuth  = function(...a) {
    _sa && _sa(...a);
    canvas.style.display = 'block';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseleave', onMouseLeave);
    window.addEventListener('resize', onResize);
    startTick();
  };
  window.enterDash = function(...a) {
    _ed && _ed(...a);
    canvas.style.display = 'none';
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseleave', onMouseLeave);
    window.removeEventListener('resize', onResize);
    stopTick();
  };

  // 如果已在 dashboard 页面，直接隐藏
  if (document.getElementById('authWrap').classList.contains('hidden')) {
    canvas.style.display = 'none';
  } else {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseleave', onMouseLeave);
    window.addEventListener('resize', onResize);
    startTick();
  }

  resize();
  rebuild();
}

// 管理员卡片详情模态框
const cardDetailModal = document.createElement('div');
cardDetailModal.className = 'modal-overlay hidden';
cardDetailModal.innerHTML = `
  <div class="modal" style="max-width:520px;">
    <div class="modal-header">
      <div class="modal-title" style="gap:8px;">
        <span class="modal-close" onclick="window.hideCardDetailModal()" style="position:static;width:28px;height:28px;font-size:14px;flex-shrink:0;">✕</span>
        <span>卡片详情</span>
        <span id="modalCardStatusBadge" class="tag tag-green">正常</span>
      </div>
      <button class="btn-copy-all" onclick="window.copyAllCardInfo()">一键复制</button>
    </div>
    <div class="modal-subtitle" id="modalCardSubtitle">卡片信息</div>
    
    <div class="card-frozen-banner" id="modalFrozenBanner" style="display:none;">
      <div class="cfb-header"><svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg><span>该卡片当前处于冻结状态</span></div>
      <div class="cfb-body"><ul style="margin:0;padding-left:14px;"><li>如已绑定任何平台或服务，请尽快解绑，避免因自动扣费产生不必要的支出</li><li>卡片余额如有剩余，建议尽快转出至账户余额</li></ul></div>
    </div>
    
    <div class="ro-grid" id="roGrid">
      <div class="ro-field">
        <span class="ro-label">卡号</span>
        <span class="ro-value mono copyable" id="modalCardNumber" data-copy="" onclick="window.copyField(this)">**** **** **** **** <span class="copy-ico">复制</span></span>
      </div>
      <div class="ro-field">
        <span class="ro-label">CVV</span>
        <span class="ro-value mono copyable" id="modalCardCVV" data-copy="" onclick="window.copyField(this)">*** <span class="copy-ico">复制</span></span>
      </div>
      <div class="ro-field">
        <span class="ro-label">有效期</span>
        <span class="ro-value mono copyable" id="modalCardExpiry" data-copy="" onclick="window.copyField(this)">— <span class="copy-ico">复制</span></span>
      </div>
      <div class="ro-field">
        <span class="ro-label">可用余额</span>
        <span class="ro-value amount" id="modalCardBalance">$0.00</span>
      </div>
      <div class="ro-field">
        <span class="ro-label">单笔限额</span>
        <span class="ro-value amount" id="modalCardSingleLimit">$0.00</span>
      </div>
      <div class="ro-field">
        <span class="ro-label">日限额</span>
        <span class="ro-value amount" id="modalCardDayLimit">$0.00</span>
      </div>
      <div class="ro-field">
        <span class="ro-label">月限额</span>
        <span class="ro-value amount" id="modalCardMonthLimit">$0.00</span>
      </div>
      <div class="ro-field">
        <span class="ro-label">卡段/产品码</span>
        <span class="ro-value mono" id="modalCardProductCode">—</span>
      </div>
      <div class="ro-field">
        <span class="ro-label">持卡人姓名</span>
        <span class="ro-value" id="modalCardHolder">—</span>
      </div>
      <div class="ro-field">
        <span class="ro-label">账单地址</span>
        <span class="ro-value" id="modalCardAddress" style="font-size:13px;">—</span>
      </div>
    </div>
    
    <div class="modal-footer">
      <div class="modal-user-info" id="modalUserInfo">
        <span class="modal-user-email" id="modalUserEmail">user@example.com</span>
      </div>
      <div>
        <button class="cm-btn cm-btn-freeze" id="modalFreezeBtn" onclick="window.modalFreezeCard(this)" style="display: none;">冻结</button>
        <button class="cm-btn cm-btn-unfreeze" id="modalUnfreezeBtn" onclick="window.modalUnfreezeCard(this)" style="display: none;">解冻</button>
        <button class="cm-btn" id="modalFbCodeBtn" onclick="window.modalFbCodes()" style="display:none;border-color:#1877f2;color:#1877f2;">FB验证码</button>
      </div>
    </div>
  </div>
</div>`;
document.body.appendChild(cardDetailModal);

// 设置可复制字段的文本（保留 copy-ico 子元素）
function setCopyFieldVal(id, displayText, copyText) {
  var el = document.getElementById(id);
  if (!el) return;
  // 设置显示文本：保留 copy-ico span
  var ico = el.querySelector('.copy-ico');
  // 使用 innerHTML 替代 textContent，保留 span 结构
  if (ico) {
    // 先保存 span
    var spanHtml = ico.outerHTML;
    el.innerHTML = displayText + ' ' + spanHtml;
  } else {
    el.textContent = displayText;
  }
  // 设置 data-copy（确保即使是空字符串也设置）
  el.setAttribute('data-copy', copyText || '');
}

// 显示卡片详情模态框
window.showCardDetailModal = function(cardData) {
  const loading = cardData._loading === true;

  // 卡号 & CVV
  const cn = cardData.card_number || '';
  setCopyFieldVal('modalCardNumber',
    loading ? '加载中...' : (cn ? cn.replace(/(\d{4})(?=\d)/g, '$1 ') : '**** **** **** ****'),
    loading ? '' : cn
  );
  setCopyFieldVal('modalCardCVV',
    loading ? '···' : (cardData.cvv || '***'),
    loading ? '' : (cardData.cvv || '')
  );

  // 有效期
  let expiryDisplay = loading ? '···' : '—';
  let expiryCopy = '';
  if (!loading) {
    if (cardData.expire) {
      expiryDisplay = cardData.expire;
      expiryCopy = cardData.expire;
    } else if (cardData.expiry_month && cardData.expiry_year) {
      expiryDisplay = `${String(cardData.expiry_month).padStart(2, '0')}/${String(cardData.expiry_year).slice(-2)}`;
      expiryCopy = expiryDisplay;
    }
  }
  setCopyFieldVal('modalCardExpiry', expiryDisplay, expiryCopy);

  // 余额和限额（null = 加载态）
  const fmtAmt = (v) => loading || v === null || v === undefined ? '···' : `$${Number(v).toFixed(2)}`;
  document.getElementById('modalCardBalance').textContent      = fmtAmt(cardData.available_amount);
  document.getElementById('modalCardSingleLimit').textContent  = fmtAmt(cardData.single_limit);
  document.getElementById('modalCardDayLimit').textContent     = fmtAmt(cardData.day_limit);
  document.getElementById('modalCardMonthLimit').textContent   = fmtAmt(cardData.month_limit);
  
  // 产品码和持卡人信息
  document.getElementById('modalCardProductCode').textContent = cardData.product_code || cardData.bin || '—';
  let holderName = '';
  if (cardData.first_name && cardData.last_name) {
    holderName = `${cardData.first_name} ${cardData.last_name}`;
  } else if (cardData.user_name) {
    holderName = cardData.user_name;
  } else if (cardData.label) {
    holderName = cardData.label;
  }
  document.getElementById('modalCardHolder').textContent = holderName || '—';
  
  // 账单地址
  const addr1 = cardData.address_line_one || cardData.addr1 || '';
  const addr2 = cardData.address_line_two || cardData.addr2 || '';
  const city = cardData.city || '';
  const state = cardData.state || '';
  const country = cardData.country || '';
  const postCode = cardData.post_code || '';
  const addressParts = [addr1, addr2, city, state, country, postCode].filter(Boolean);
  document.getElementById('modalCardAddress').textContent = addressParts.join(', ') || '—';
  
  // 状态标签
  const isActive = (cardData.status||'').toUpperCase() === 'ACTIVE';
  const isFrozen = (cardData.status||'').toUpperCase() === 'CANCELLED' || cardData.status === 'frozen';
  const statusBadge = document.getElementById('modalCardStatusBadge');
  statusBadge.textContent = isActive ? '正常' : isFrozen ? '已冻结' : (cardData.status||'—');
  statusBadge.className = isActive ? 'tag tag-green' : isFrozen ? 'tag tag-red' : 'tag tag-yellow';
  
  // 冻结警示横幅
  var frozenBanner = document.getElementById('modalFrozenBanner');
  if (frozenBanner) frozenBanner.style.display = isFrozen ? 'flex' : 'none';
  
  // 用户信息（管理员可见）
  const userInfoEl = document.getElementById('modalUserInfo');
  const userEmailEl = document.getElementById('modalUserEmail');
  if (cardData.user_email && _me?.role === 'admin') {
    userInfoEl.style.display = 'flex';
    userEmailEl.textContent = cardData.user_email;
  } else {
    userInfoEl.style.display = 'none';
  }
  
  // 操作按钮
  var cardInvalid = cardData.verified_status === 'invalid';
  const freezeBtn = document.getElementById('modalFreezeBtn');
  const unfreezeBtn = document.getElementById('modalUnfreezeBtn');
  const rechargeBtn = document.getElementById('modalRechargeBtn');
  if (rechargeBtn) rechargeBtn.style.display = 'none';
  if (freezeBtn) {
    if (cardInvalid) {
      freezeBtn.style.display = 'none';
    } else if (isActive) {
      freezeBtn.style.display = 'inline-block';
    } else if (isFrozen) {
      freezeBtn.style.display = 'none';
    } else {
      freezeBtn.style.display = 'none';
    }
  }
  if (unfreezeBtn) {
    if (cardInvalid) {
      unfreezeBtn.style.display = 'none';
    } else if (isActive) {
      unfreezeBtn.style.display = 'none';
    } else if (isFrozen) {
      unfreezeBtn.style.display = 'inline-block';
    } else {
      unfreezeBtn.style.display = 'none';
    }
  }
  if (rechargeBtn && _me?.role !== 'admin' && !cardInvalid) {
    rechargeBtn.style.display = 'inline-block';
  }
  var fbCodeBtn = document.getElementById('modalFbCodeBtn');
  if (fbCodeBtn) fbCodeBtn.style.display = 'inline-block';
  
  // 存储当前卡片ID以便操作
  cardDetailModal.dataset.cardId = cardData.card_id;
  
  // 显示模态框
  cardDetailModal.classList.remove('hidden');
  setTimeout(() => cardDetailModal.classList.add('show'), 10);
}

// 隐藏模态框
window.hideCardDetailModal = function() {
  cardDetailModal.classList.remove('show');
  setTimeout(() => cardDetailModal.classList.add('hidden'), 300);
}

// 点击遮罩层关闭
cardDetailModal.addEventListener('click', (e) => {
  if (e.target === cardDetailModal) {
    hideCardDetailModal();
  }
});

// 复制文本到剪贴板（带fallback）
function copyToClipboard(text, successMsg, errorMsg) {
  if (!text) { showToast('暂无数据', 'warning'); return; }
  
  // 优先使用现代 Clipboard API
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() {
      showToast(successMsg || '已复制', 'success');
    }).catch(function(err) {
      console.error('Clipboard API 失败:', err);
      // 降级到传统方法
      fallbackCopyTextToClipboard(text, successMsg, errorMsg);
    });
  } else {
    // 使用传统方法
    fallbackCopyTextToClipboard(text, successMsg, errorMsg);
  }
}

// 传统复制方法（兼容旧浏览器）
function fallbackCopyTextToClipboard(text, successMsg, errorMsg) {
  var textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  
  try {
    var successful = document.execCommand('copy');
    if (successful) {
      showToast(successMsg || '已复制', 'success');
    } else {
      showToast(errorMsg || '复制失败', 'error');
    }
  } catch (err) {
    console.error('execCommand 复制失败:', err);
    showToast(errorMsg || '复制失败', 'error');
  }
  document.body.removeChild(textArea);
}

// 复制单个字段
window.copyField = function(el) {
  var text = el.getAttribute('data-copy') || '';
  // 如果 data-copy 为空，尝试从文本内容获取
  if (!text) {
    // 获取纯文本（去掉“复制”字样）
    var clone = el.cloneNode(true);
    var copyBtn = clone.querySelector('.copy-ico');
    if (copyBtn) copyBtn.remove();
    text = clone.textContent.trim();
  }
  copyToClipboard(text, '已复制', '复制失败');
}

// 一键复制全部卡片信息
window.copyAllCardInfo = function() {
  var fields = document.querySelectorAll('#roGrid .ro-field');
  var text = '';
  fields.forEach(function(f) {
    var label = f.querySelector('.ro-label');
    var val = f.querySelector('.ro-value');
    var labelText = label ? label.textContent.trim() : '';
    
    // 优先使用 data-copy，如果没有则从文本获取
    var valText = '';
    if (val) {
      valText = val.getAttribute('data-copy');
      if (!valText) {
        var clone = val.cloneNode(true);
        var copyBtn = clone.querySelector('.copy-ico');
        if (copyBtn) copyBtn.remove();
        valText = clone.textContent.trim();
      }
    }
    
    if (labelText && valText && valText !== '—' && valText !== '***') {
      text += labelText + ': ' + valText + '\n';
    }
  });
  
  if (!text.trim()) {
    showToast('暂无数据可复制', 'warning');
    return;
  }
  
  copyToClipboard(text.trim(), '已复制全部卡片信息', '复制失败');
}

// 模态框内操作卡片
window.modalFreezeCard = function(btnEl) {
  const cardId = cardDetailModal.dataset.cardId;
  if (cardId) {
    cmFreezeCard(cardId, 'CANCELLED', btnEl).then(function() {
      if (btnEl && !btnEl.disabled) hideCardDetailModal();
    });
  }
}

window.modalUnfreezeCard = function(btnEl) {
  const cardId = cardDetailModal.dataset.cardId;
  if (cardId) {
    cmFreezeCard(cardId, 'ACTIVE', btnEl).then(function() {
      if (btnEl && !btnEl.disabled) hideCardDetailModal();
    });
  }
}

window.modalRechargeCard = function() {
  const cardId = cardDetailModal.dataset.cardId;
  if (cardId) {
    cmRechargeCard(cardId);
    hideCardDetailModal();
  }
}

// ── FB 验证码查询 ──────────────────────────────────────────────────────
window.modalFbCodes = function() {
  var cardId = cardDetailModal.dataset.cardId;
  if (cardId) {
    hideCardDetailModal();
    showFbCodesModal(cardId);
  }
}

function showFbCodesModal(cardId) {
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.onclick = function(e) { if (e.target === overlay) { overlay.remove(); } };

  var modal = document.createElement('div');
  modal.style.cssText = 'background:#13192a;border:1px solid #2d344a;border-radius:16px;max-width:540px;width:100%;max-height:80vh;overflow:hidden;display:flex;flex-direction:column;';
  modal.innerHTML = '<div style="padding:20px 24px;border-bottom:1px solid #1e253a;display:flex;align-items:center;justify-content:space-between;">'
    + '<div><div style="font-size:16px;font-weight:700;color:#e2e8f0;">\uD83D\uDD0D FB 验证码查询</div>'
    + '<div style="font-size:12px;color:#6b7a90;margin-top:4px;">从交易记录中筛选 Facebook 验证扣款</div></div>'
    + '<button onclick="this.closest(\'div[style]\').parentElement.parentElement.remove()" style="width:32px;height:32px;border-radius:8px;border:1px solid #2d344a;background:transparent;color:#6b7a90;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;">\u2715</button>'
    + '</div>'
    + '<div id="fbCodesBody" style="padding:24px;overflow-y:auto;flex:1;"><div style="text-align:center;padding:40px;color:#6b7a90;"><span class="spinner"></span><br><span style="margin-top:12px;display:inline-block;">正在查询交易记录...</span></div></div>';

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  apiFetch('/cards/' + cardId + '/fb-codes').then(function(r) {
    var body = document.getElementById('fbCodesBody');
    if (!body) return;
    if (r.code !== 0) {
      body.innerHTML = '<div style="color:#ff5f5f;font-size:14px;padding:20px;text-align:center;">' + (r.msg || '查询失败') + '</div>';
      return;
    }
    var codes = r.data.codes || [];
    if (codes.length === 0) {
      body.innerHTML = '<div style="text-align:center;padding:40px;"><div style="font-size:40px;margin-bottom:12px;">\uD83D\uDCED</div><div style="color:#6b7a90;font-size:14px;">未找到 Facebook 验证码记录</div><div style="color:#4a5568;font-size:12px;margin-top:6px;">当您在 Facebook 绑卡时产生的验证扣款会出现在这里</div></div>';
      return;
    }
    var html = '<div style="font-size:12px;color:#6b7a90;margin-bottom:16px;">共找到 <span style="color:#1877f2;font-weight:700;">' + codes.length + '</span> 条 Facebook 验证扣款记录</div>';
    for (var i = 0; i < codes.length; i++) {
      var c = codes[i];
      var codeVal = c.verification_code || '--';
      var amt = c.amount !== null && c.amount !== undefined ? Number(c.amount).toFixed(2) : '--';
      var amtColor = c.amount !== null && c.amount < 0 ? '#ff5f5f' : '#00c758';
      var time = c.time ? new Date(c.time).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '--';
      var copyBtn = '';
      if (codeVal !== '--') {
        copyBtn = '<button onclick="navigator.clipboard.writeText(\'' + codeVal + '\');this.textContent=\'已复制\';this.style.color=\'#00c758\';var self=this;setTimeout(function(){self.textContent=\'复制\';self.style.color=\'#1877f2\'},1500)" style="margin-top:6px;font-size:11px;padding:3px 12px;border-radius:6px;border:1px solid #1877f2;background:transparent;color:#1877f2;cursor:pointer;">复制验证码</button>';
      }
      html += '<div style="background:#0d1322;border:1px solid #1e253a;border-radius:12px;padding:16px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:12px;">'
        + '<div style="display:flex;align-items:center;gap:14px;">'
        + '<div style="width:42px;height:42px;border-radius:10px;background:rgba(24,119,242,.12);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#1877f2;font-family:monospace;">' + (codeVal !== '--' ? codeVal : '?') + '</div>'
        + '<div>'
        + '<div style="font-size:14px;font-weight:600;color:#e2e8f0;">' + (c.merchant_name || 'FACEBK') + '</div>'
        + '<div style="font-size:12px;color:#6b7a90;margin-top:3px;">' + time + '</div>'
        + '</div></div>'
        + '<div style="text-align:right;">'
        + '<div style="font-size:16px;font-weight:700;color:' + amtColor + ';">' + amt + '</div>'
        + copyBtn
        + '</div></div>';
    }
    body.innerHTML = html;
  }).catch(function(e) {
    var body = document.getElementById('fbCodesBody');
    if (body) body.innerHTML = '<div style="color:#ff5f5f;font-size:14px;padding:20px;text-align:center;">查询失败，请稍后再试</div>';
  });
}

// ============================================================
//  费用设置页面
// ============================================================
// ─────────────────────────────────────────────────────────────────────────────
//  费用设置页面（用户费率管理）
// ─────────────────────────────────────────────────────────────────────────────

// 页面状态
var _feePageState = { q: '', page: 1 };

function renderFeeConfigPage() {
  const content = `
    <div style="margin-bottom:20px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <div style="flex:1;min-width:220px;position:relative;">
        <svg style="position:absolute;left:12px;top:50%;transform:translateY(-50%);opacity:.45;" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="feeUserSearch" type="text" placeholder="搜索用户名 / 邮箱 / 手机号..."
          style="width:100%;padding:10px 14px 10px 36px;border-radius:9px;border:1px solid rgba(0,242,254,.2);background:rgba(0,0,0,.25);color:var(--text1);font-size:.88rem;outline:none;box-sizing:border-box;"
          oninput="clearTimeout(window._feeSearchTimer);window._feeSearchTimer=setTimeout(()=>{_feePageState.q=this.value.trim();_feePageState.page=1;loadFeeUserList();},320)">
      </div>
      <button class="btn btn-primary" onclick="_feePageState.q='';_feePageState.page=1;document.getElementById('feeUserSearch').value='';loadFeeUserList();">✨ 点击搜索</button>
    </div>

    <div class="card">
      <div id="feeUserListWrap">
        <div class="loading" style="text-align:center;padding:60px;">加载中...</div>
      </div>
    </div>
  `;
  document.getElementById('contentArea').innerHTML = content;
  _feePageState = { q: '', page: 1 };
  loadFeeUserList();
}

// 加载用户费率列表
async function loadFeeUserList() {
  const wrap = document.getElementById('feeUserListWrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading" style="text-align:center;padding:60px;">加载中...</div>';

  try {
    const { q, page } = _feePageState;
    const res = await apiFetch(`/admin/fee-configs/users?q=${encodeURIComponent(q)}&page=${page}&limit=20`);
    if (res.code !== 0) throw new Error(res.msg);

    const { users, fee_types, total, limit } = res.data;
    const totalPages = Math.ceil(total / limit) || 1;

    if (!users.length) {
      wrap.innerHTML = `
        <div style="text-align:center;padding:60px;">
          <div style="font-size:40px;opacity:.35;">👤</div>
          <div style="margin-top:16px;color:var(--text2);">没有找到匹配的用户</div>
        </div>`;
      return;
    }

    // 表头：基础列 + 各费用类型列
    const feeCols = fee_types.map(ft =>
      `<th style="text-align:center;line-height:1.4;min-width:100px;">${ft.description}</th>`
    ).join('');

    // 表行
    const rows = users.map(u => {
      // 预处理安全字符串，避免在模板字符串内做转义
      var safeName = (u.name || u.email || '').replace(/'/g, "\\'");

      const feeCells = fee_types.map(ft => {
        const f = u.fees[ft.fee_type];
        const isCustom = f && f.is_custom;
        const rate = f && f.fee_rate != null ? (f.fee_rate * 100).toFixed(1) : null;
        const fixed = f && f.fee_fixed != null ? parseFloat(f.fee_fixed).toFixed(2) : null;
        var ftDesc = (ft.description || '').replace(/'/g, "\\'");
        var bgC = isCustom ? 'rgba(0,140,255,.12)' : 'rgba(255,255,255,.04)';
        var bdC = isCustom ? 'rgba(0,140,255,.25)' : 'rgba(255,255,255,.1)';
        var txC = isCustom ? '#6ab4ff' : 'var(--text2)';
        var tagStyle = 'background:' + bgC + ';color:' + txC + ';border:1px solid ' + bdC + ';';
        var labelColor = isCustom ? 'rgba(106,180,255,.65)' : 'var(--text3)';
        var valColor = isCustom ? '#6ab4ff' : 'var(--text1)';
        var dividerColor = isCustom ? 'rgba(0,140,255,.2)' : 'rgba(255,255,255,.06)';
        // 构建两行显示：费率 xx% / 固定 $xx.xx
        var line1 = rate !== null
          ? '<span style="color:' + labelColor + ';font-size:.7rem;">费率</span> <span style="color:' + valColor + ';font-weight:600;font-size:.85rem;">' + rate + '%</span>'
          : '<span style="color:' + labelColor + ';font-size:.7rem;">费率</span> <span style="color:var(--text3);font-size:.85rem;">默认</span>';
        var line2 = fixed !== null
          ? '<span style="color:' + labelColor + ';font-size:.7rem;">固定</span> <span style="color:' + valColor + ';font-weight:600;font-size:.85rem;">$' + fixed + '</span>'
          : '<span style="color:' + labelColor + ';font-size:.7rem;">固定</span> <span style="color:var(--text3);font-size:.85rem;">默认</span>';
        var outBg = bgC, outBd = bdC, outTx = txC;
        var cellId = 'fee_' + u.id + '_' + ft.fee_type;
        return '<td style="text-align:center;">'
          + '<span id="' + cellId + '" style="display:inline-flex;flex-direction:column;align-items:center;gap:2px;padding:6px 12px;border-radius:8px;cursor:pointer;transition:all .2s;' + tagStyle + 'min-width:80px;"'
          + ' onmouseover="this.style.borderColor=\'#00f2fe\';this.style.color=\'#00f2fe\';this.style.background=\'rgba(0,242,254,.08)\';"'
          + ' onmouseout="this.style.borderColor=\'' + outBd + '\';this.style.color=\'' + outTx + '\';this.style.background=\'' + outBg + '\';"'
          + ' onclick="openEditFeeModal(' + u.id + ', \'' + safeName + '\', \'' + ft.fee_type + '\', \'' + ftDesc + '\', ' + (f ? (f.fee_rate != null ? f.fee_rate : 'null') : 'null') + ', ' + (f ? (f.fee_fixed != null ? f.fee_fixed : 'null') : 'null') + ')"'
          + ' title="点击修改">'
          + '<div>' + line1 + '</div>'
          + '<div style="width:100%;height:1px;background:' + dividerColor + ';margin:1px 0;"></div>'
          + '<div>' + line2 + '</div>'
          + '</span></td>';
      }).join('');

      const statusTag = u.status === 'active'
        ? '<span class="tag tag-green" style="font-size:.75rem;">正常</span>'
        : '<span class="tag tag-red" style="font-size:.75rem;">冻结</span>';

      return `
        <tr>
          <td class="frozen fz0" style="font-size:.85rem;padding-left:12px;text-align:left;">#${u.id}</td>
          <td class="frozen fz1" style="font-size:.85rem;padding:0 8px 0 16px;text-align:left;">${u.name || '—'}</td>
          <td class="frozen fz2" style="font-size:.85rem;padding:0 16px;text-align:center;">${u.email}</td>
          <td class="frozen fz3" style="font-size:.85rem;padding:0 16px;text-align:center;">${u.phone || '<span style="color:var(--text3);">—</span>'}</td>
          <td class="frozen fz4" style="text-align:center;padding-right:16px;">${statusTag}</td>
          ${feeCells}
        </tr>`;
    }).join('');

    // 分页
    const pagination = totalPages > 1 ? `
      <div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;padding:16px 20px;border-top:1px solid rgba(255,255,255,.06);">
        <span style="color:var(--text3);font-size:.82rem;">共 ${total} 人 · 第 ${page}/${totalPages} 页</span>
        <button class="btn-secondary" style="padding:5px 14px;font-size:.82rem;" ${page <= 1 ? 'disabled' : ''}
          onclick="_feePageState.page=${page - 1};loadFeeUserList();">上一页</button>
        <button class="btn-secondary" style="padding:5px 14px;font-size:.82rem;" ${page >= totalPages ? 'disabled' : ''}
          onclick="_feePageState.page=${page + 1};loadFeeUserList();">下一页</button>
      </div>` : '';

    wrap.innerHTML = `
      <style>
        /* 费用设置表格：冻结前5列 */
        #feeTableWrap table { border-collapse: separate; border-spacing: 0; }
        #feeTableWrap th.frozen,
        #feeTableWrap td.frozen {
          position: sticky;
          z-index: 2;
          background: #0d1322;
        }
        #feeTableWrap th.frozen { z-index: 3; }
        #feeTableWrap td.frozen { background: #0f1628; }
        #feeTableWrap .fz0 { left: 0; }
        #feeTableWrap .fz1 { left: 70px; }
        #feeTableWrap .fz2 { left: 170px; }
        #feeTableWrap .fz3 { left: 350px; }
        #feeTableWrap .fz4 { left: 480px; }
        /* 冻结列右侧阴影分割线 */
        #feeTableWrap .fz4::after {
          content: '';
          position: absolute;
          top: 0; right: -8px; bottom: 0; width: 8px;
          background: linear-gradient(90deg, rgba(0,0,0,.35), transparent);
          pointer-events: none;
        }
      </style>
      <div id="feeTableWrap" style="overflow-x:auto;">
        <table class="table" style="min-width:1050px;">
          <thead>
            <tr style="height:52px;vertical-align:middle;">
              <th class="frozen fz0" style="white-space:nowrap;padding-left:12px;min-width:70px;text-align:left;">ID</th>
              <th class="frozen fz1" style="white-space:nowrap;padding:0 8px 0 16px;min-width:100px;text-align:left;">用户名</th>
              <th class="frozen fz2" style="white-space:nowrap;padding:0 16px;min-width:180px;text-align:center;">邮箱</th>
              <th class="frozen fz3" style="white-space:nowrap;padding:0 16px;min-width:130px;text-align:center;">手机号</th>
              <th class="frozen fz4" style="text-align:center;white-space:nowrap;padding-right:16px;min-width:80px;">状态</th>
              ${feeCols}
            </tr>
          </thead>
          <tbody style="vertical-align:middle;">${rows}</tbody>
        </table>
      </div>
      ${pagination}
      <div style="padding:10px 20px 14px;color:var(--text3);font-size:.78rem;">
        💡 蓝色标签为自定义费率，灰色为全局默认。点击费率单元格可直接编辑。
      </div>`;
  } catch(err) {
    wrap.innerHTML = `<div style="text-align:center;padding:40px;color:#ff5f5f;">加载失败: ${err.message}</div>`;
  }
}

// 内联编辑单项费率弹窗
function openEditFeeModal(userId, userName, feeType, feeDesc, currentRate, currentFixed) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999;';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:linear-gradient(135deg,#0d1322,#13192a);border:1px solid rgba(0,242,254,.25);border-radius:16px;padding:28px;width:420px;max-width:92vw;box-shadow:0 20px 60px rgba(0,0,0,.5);';

  const rateVal = currentRate !== null && currentRate !== undefined ? (currentRate * 100) : '';
  const fixedVal = currentFixed !== null && currentFixed !== undefined ? parseFloat(currentFixed).toFixed(2) : '';

  modal.innerHTML = `
    <div style="margin-bottom:20px;">
      <h3 style="margin:0 0 4px;color:#00f2fe;font-size:16px;">编辑费率 · ${feeDesc}</h3>
      <p style="margin:0;color:var(--text3);font-size:.82rem;">用户：${userName}</p>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px;">
      <div>
        <label style="display:block;color:var(--text2);font-size:.8rem;margin-bottom:6px;">百分比费率（%）</label>
        <input id="_editFeeRate" type="number" step="0.01" min="0" max="100" placeholder="全局默认"
          value="${rateVal}"
          style="width:100%;padding:10px 12px;border-radius:9px;border:1px solid rgba(0,242,254,.25);background:rgba(0,0,0,.3);color:var(--text1);font-size:.9rem;outline:none;box-sizing:border-box;">
        <div style="margin-top:4px;color:var(--text3);font-size:.76rem;">留空 = 恢复全局默认</div>
      </div>
      <div>
        <label style="display:block;color:var(--text2);font-size:.8rem;margin-bottom:6px;">固定费用（$）</label>
        <input id="_editFeeFixed" type="number" step="0.01" min="0" placeholder="全局默认"
          value="${fixedVal}"
          style="width:100%;padding:10px 12px;border-radius:9px;border:1px solid rgba(0,242,254,.25);background:rgba(0,0,0,.3);color:var(--text1);font-size:.9rem;outline:none;box-sizing:border-box;">
        <div style="margin-top:4px;color:var(--text3);font-size:.76rem;">留空 = 恢复全局默认</div>
      </div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;">
      <button id="_editFeeCancelBtn" style="padding:9px 20px;border-radius:9px;border:none;background:rgba(255,255,255,.06);color:#9fa8ba;cursor:pointer;font-size:.88rem;">取消</button>
      <button id="_editFeeResetBtn" style="padding:9px 20px;border-radius:9px;border:none;background:rgba(255,95,95,.15);color:#ff5f5f;cursor:pointer;font-size:.88rem;">恢复默认</button>
      <button id="_editFeeConfirmBtn" style="padding:9px 22px;border-radius:9px;border:none;background:linear-gradient(135deg,#00f2fe,#0ab8d4);color:#090e1c;cursor:pointer;font-weight:700;font-size:.88rem;">保存</button>
    </div>
  `;

  const close = () => overlay.remove();
  modal.querySelector('#_editFeeCancelBtn').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  // 恢复全局默认（传 null）
  modal.querySelector('#_editFeeResetBtn').onclick = async () => {
    const btn = modal.querySelector('#_editFeeResetBtn');
    btn.disabled = true; btn.textContent = '恢复中...';
    try {
      const r = await apiFetch(`/admin/fee-configs/user/${userId}/${feeType}`, {
        method: 'PUT', body: JSON.stringify({ fee_rate: null, fee_fixed: null })
      });
      if (r.code !== 0) throw new Error(r.msg);
      close();
      toast('✅ 已恢复为全局默认');
      loadFeeUserList();
    } catch(e) {
      toast('❌ ' + e.message);
      btn.disabled = false; btn.textContent = '恢复默认';
    }
  };

  // 保存
  modal.querySelector('#_editFeeConfirmBtn').onclick = async () => {
    const rateInput = modal.querySelector('#_editFeeRate').value.trim();
    const fixedInput = modal.querySelector('#_editFeeFixed').value.trim();
    const ratePayload = rateInput !== '' ? parseFloat(rateInput) / 100 : null;
    const fixedPayload = fixedInput !== '' ? parseFloat(fixedInput) : null;

    const btn = modal.querySelector('#_editFeeConfirmBtn');
    btn.disabled = true; btn.textContent = '保存中...';
    try {
      const r = await apiFetch(`/admin/fee-configs/user/${userId}/${feeType}`, {
        method: 'PUT', body: JSON.stringify({ fee_rate: ratePayload, fee_fixed: fixedPayload })
      });
      if (r.code !== 0) throw new Error(r.msg);
      close();
      toast('✅ 费率已更新');
      loadFeeUserList();
    } catch(e) {
      toast('❌ ' + e.message);
      btn.disabled = false; btn.textContent = '保存';
    }
  };

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

// 用户费率总览（展示该用户所有费率的弹窗）
async function openUserFeeOverview(userId, userName) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999;';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:linear-gradient(135deg,#0d1322,#13192a);border:1px solid rgba(0,242,254,.25);border-radius:16px;padding:28px;width:560px;max-width:94vw;max-height:82vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.5);';

  modal.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
      <div>
        <h3 style="margin:0 0 4px;color:#00f2fe;font-size:16px;">${userName} · 费率详情</h3>
        <p style="margin:0;color:var(--text3);font-size:.8rem;">蓝色为自定义，灰色为全局默认</p>
      </div>
      <button onclick="this.closest('[style]').parentNode.remove()" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:22px;line-height:1;padding:4px;">×</button>
    </div>
    <div id="_overviewBody" style="text-align:center;padding:30px;"><div class="loading">加载中...</div></div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  try {
    const res = await apiFetch(`/admin/fee-configs/users?q=&page=1&limit=100`);
    if (res.code !== 0) throw new Error(res.msg);
    const { users, fee_types } = res.data;
    const u = users.find(x => x.id === userId);
    if (!u) throw new Error('未找到该用户数据');

    const rows = fee_types.map(ft => {
      const f = u.fees[ft.fee_type];
      const isCustom = f && f.is_custom;
      const rate = f && f.fee_rate != null ? (f.fee_rate * 100).toFixed(2) + '%' : '—';
      const fixed = f && f.fee_fixed != null ? '$' + parseFloat(f.fee_fixed).toFixed(2) : '—';
      return `
        <tr>
          <td style="font-weight:600;">${ft.description}</td>
          <td style="text-align:center;">${rate}</td>
          <td style="text-align:center;">${fixed}</td>
          <td style="text-align:center;">
            ${isCustom ? '<span class="tag tag-blue" style="font-size:.75rem;">自定义</span>' : '<span style="color:var(--text3);font-size:.82rem;">全局默认</span>'}
          </td>
          <td style="text-align:right;">
            <button class="btn-secondary" style="font-size:.78rem;padding:4px 10px;"
              onclick="overlay.remove();openEditFeeModal(${u.id},'${(userName).replace(/'/g, "\\'")}','${ft.fee_type}','${ft.description}',${f && f.fee_rate != null ? f.fee_rate : 'null'},${f && f.fee_fixed != null ? f.fee_fixed : 'null'})">编辑</button>
          </td>
        </tr>`;
    }).join('');

    modal.querySelector('#_overviewBody').innerHTML = `
      <table class="table" style="width:100%;">
        <thead><tr>
          <th>费用类型</th>
          <th style="text-align:center;">百分比</th>
          <th style="text-align:center;">固定费用</th>
          <th style="text-align:center;">来源</th>
          <th style="text-align:right;">操作</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

    // 让编辑按钮里用到的 overlay 引用正确
    const editBtns = modal.querySelectorAll('button[onclick*="overlay.remove"]');
    editBtns.forEach(btn => {
      const origOnclick = btn.getAttribute('onclick');
      btn.onclick = function() {
        overlay.remove();
        eval(origOnclick.replace('overlay.remove();', ''));
      };
    });
  } catch(e) {
    modal.querySelector('#_overviewBody').innerHTML = `<div style="color:#ff5f5f;">加载失败: ${e.message}</div>`;
  }
}

// ============================================================
//  账务明细页面
// ============================================================
function renderBalanceDetailPage() {
  const content = `
    <div class="page-header">
      <h2>账务明细</h2>
      <p class="text-muted mt-1">详细展示账户收支构成，清晰了解资金去向</p>
    </div>
    
    <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:30px;">
      <button class="btn-primary" onclick="loadBalanceDetails()">
        <span style="margin-right:8px">🔄</span>刷新数据
      </button>
      <button class="btn-secondary" onclick="loadTransactionStats()">
        <span style="margin-right:8px">📊</span>查看分类统计
      </button>
      <button class="btn-secondary" onclick="loadBalanceTrend()">
        <span style="margin-right:8px">📈</span>查看趋势图
      </button>
    </div>
    
    <div id="balanceDetailContainer">
      <div class="loading" style="text-align:center;padding:60px;">加载中...</div>
    </div>
  `;
  document.getElementById('contentArea').innerHTML = content;
  loadBalanceDetails();
}

// 加载余额详情
async function loadBalanceDetails() {
  const container = document.getElementById('balanceDetailContainer');
  container.innerHTML = '<div class="loading" style="text-align:center;padding:60px;">加载中...</div>';
  
  try {
    const res = await apiFetch('/user/balance/details');
    if (res.code !== 0) throw new Error(res.msg);
    
    const data = res.data;
    
    // 收入部分
    const incomeItems = [
      { label: '初始余额', value: data.income.initial, color: '#00f2fe' },
      { label: '管理员充值', value: data.income.topup, color: '#00c758' },
      { label: '退款返还', value: data.income.refund, color: '#00a8ff' },
      { label: '拒付返还', value: data.income.chargeback, color: '#9d4edd' }
    ].filter(item => item.value > 0);
    
    // 支出部分
    const outcomeItems = [
      { label: '总消费', value: data.outcome.spend, color: '#ff5f5f' },
      { label: '总手续费', value: data.outcome.fees, color: '#ffaa00' }
    ].filter(item => item.value > 0);
    
    const totalIncome = incomeItems.reduce((sum, item) => sum + item.value, 0);
    const totalOutcome = outcomeItems.reduce((sum, item) => sum + item.value, 0);
    const netBalance = totalIncome - totalOutcome;
    
    // 余额公式验证状态
    const formulaStatus = data.is_consistent 
      ? '<span class="tag tag-green" style="margin-left:10px;">✅ 余额一致</span>'
      : `<span class="tag tag-red" style="margin-left:10px;">⚠️ 余额不一致 (差异 ${data.discrepancy.toFixed(2)})</span>`;
    
    container.innerHTML = `
      <div class="grid-2-col" style="gap:24px;margin-bottom:30px;">
        
        <div class="card">
          <div class="card-header">
            <h3>账户余额总览</h3>
            <div class="text-muted" style="font-size:.85rem;">${data.user_name} (${data.user_email})</div>
          </div>
          <div style="padding:24px;">
            <div style="text-align:center;margin-bottom:24px;">
              <div style="font-size:48px;line-height:1;margin-bottom:10px;color:#00f2fe;">$${data.balance.toFixed(2)}</div>
              <div style="color:var(--text3);font-size:.9rem;">可用余额</div>
            </div>
            
            <div style="background:rgba(0,0,0,.2);border-radius:12px;padding:20px;">
              <div style="margin-bottom:16px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                  <span style="color:var(--text2);font-size:.9rem;">余额公式</span>
                  ${formulaStatus}
                </div>
                <div style="color:var(--text3);font-size:.8rem;line-height:1.4;">
                  余额 = 初始余额 + 充值总额 - 净消费 - 总手续费<br>
                  <span style="color:#00f2fe;">$${data.initial_balance.toFixed(2)} + $${data.topup_total.toFixed(2)} - $${data.total_net_spend.toFixed(2)} - $${data.total_fees.toFixed(2)} = $${data.calculated_balance.toFixed(2)}</span>
                </div>
              </div>
              
              <div style="margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;">
                  <span style="color:var(--text2);">总收入</span>
                  <span style="color:#00c758;font-weight:700;">$${totalIncome.toFixed(2)}</span>
                </div>
                <div style="display:flex;justify-content:space-between;">
                  <span style="color:var(--text2);">总支出</span>
                  <span style="color:#ff5f5f;font-weight:700;">$${totalOutcome.toFixed(2)}</span>
                </div>
              </div>
              
              <div style="height:1px;background:rgba(255,255,255,.1);margin:16px 0;"></div>
              
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="color:var(--text1);font-weight:700;">净余额</span>
                <span style="color:${netBalance >= 0 ? '#00c758' : '#ff5f5f'};font-weight:800;font-size:1.2rem;">$${netBalance.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
        
        
        <div class="card">
          <div class="card-header">
            <h3>收支构成</h3>
            <div class="text-muted" style="font-size:.85rem;">收入来源与支出去向</div>
          </div>
          <div style="padding:24px;">
            ${incomeItems.length > 0 ? `
              <div style="margin-bottom:24px;">
                <h4 style="margin:0 0 16px 0;color:#00c758;font-size:1rem;">收入 ($${totalIncome.toFixed(2)})</h4>
                ${incomeItems.map(item => `
                  <div style="margin-bottom:12px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                      <span style="color:var(--text1);font-size:.9rem;">${item.label}</span>
                      <span style="color:${item.color};font-weight:700;">$${item.value.toFixed(2)}</span>
                    </div>
                    <div style="height:6px;background:rgba(255,255,255,.05);border-radius:3px;overflow:hidden;">
                      <div style="height:100%;width:${(item.value / totalIncome * 100).toFixed(1)}%;background:${item.color};border-radius:3px;"></div>
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : ''}
            
            ${outcomeItems.length > 0 ? `
              <div>
                <h4 style="margin:0 0 16px 0;color:#ff5f5f;font-size:1rem;">支出 ($${totalOutcome.toFixed(2)})</h4>
                ${outcomeItems.map(item => `
                  <div style="margin-bottom:12px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                      <span style="color:var(--text1);font-size:.9rem;">${item.label}</span>
                      <span style="color:${item.color};font-weight:700;">$${item.value.toFixed(2)}</span>
                    </div>
                    <div style="height:6px;background:rgba(255,255,255,.05);border-radius:3px;overflow:hidden;">
                      <div style="height:100%;width:${(item.value / totalOutcome * 100).toFixed(1)}%;background:${item.color};border-radius:3px;"></div>
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        </div>
      </div>
      
      
      <div class="card" style="margin-top:20px;">
        <div class="card-header">
          <h3>统计详情</h3>
          <div class="text-muted" style="font-size:.85rem;">详细统计指标</div>
        </div>
        <div style="padding:20px;">
          <div class="grid-4-col" style="gap:16px;">
            <div class="stat-card">
              <div class="stat-value" style="color:#00c758;">$${data.topup_total.toFixed(2)}</div>
              <div class="stat-label">充值总额</div>
            </div>
            <div class="stat-card">
              <div class="stat-value" style="color:#ff5f5f;">$${data.total_spend.toFixed(2)}</div>
              <div class="stat-label">消费总额</div>
            </div>
            <div class="stat-card">
              <div class="stat-value" style="color:#00a8ff;">$${(data.total_refund + data.total_chargeback).toFixed(2)}</div>
              <div class="stat-label">退款/拒付返还</div>
            </div>
            <div class="stat-card">
              <div class="stat-value" style="color:#ffaa00;">$${data.total_fees.toFixed(2)}</div>
              <div class="stat-label">手续费合计</div>
            </div>
          </div>
          
          <div style="margin-top:20px;padding:16px;background:rgba(0,0,0,.2);border-radius:12px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
              <span style="color:var(--text2);">净消费</span>
              <span style="color:#ff5f5f;font-weight:700;">$${data.total_net_spend.toFixed(2)}</span>
            </div>
            <div style="color:var(--text3);font-size:.85rem;">
              净消费 = 消费总额($${data.total_spend.toFixed(2)}) - 退款($${data.total_refund.toFixed(2)}) - 拒付($${data.total_chargeback.toFixed(2)})
            </div>
          </div>
        </div>
      </div>
    `;
  } catch(err) {
    container.innerHTML = `<div class="error" style="text-align:center;padding:60px;color:#ff5f5f;">加载失败: ${err.message}</div>`;
  }
}

// 加载交易分类统计
async function loadTransactionStats() {
  try {
    const res = await apiFetch('/user/balance/category-stats');
    if (res.code !== 0) throw new Error(res.msg);
    
    const { transaction_stats, fee_stats, summary } = res.data;
    
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;z-index:9999;';
    
    const modal = document.createElement('div');
    modal.style.cssText = 'background:linear-gradient(135deg, #0d1322 0%, #13192a 100%);border:1px solid rgba(0,242,254,.25);border-radius:16px;padding:28px;max-width:700px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.5);';
    
    // 交易类型统计
    const transactionRows = transaction_stats.map(stat => `
      <tr>
        <td style="font-weight:600;">${stat.type}</td>
        <td style="text-align:center;">${stat.count}</td>
        <td style="text-align:right;color:${stat.total_amount >= 0 ? '#00c758' : '#ff5f5f'};">$${stat.total_amount.toFixed(2)}</td>
        <td style="text-align:right;color:#ffaa00;">$${stat.total_fee.toFixed(2)}</td>
        <td style="text-align:right;color:${stat.total_net >= 0 ? '#00c758' : '#ff5f5f'};">$${stat.total_net.toFixed(2)}</td>
      </tr>
    `).join('');
    
    // 费用类型统计
    const feeRows = fee_stats.map(stat => `
      <tr>
        <td><code style="background:rgba(0,242,254,.1);padding:4px 8px;border-radius:4px;">${stat.fee_type}</code></td>
        <td style="text-align:center;">${stat.count}</td>
        <td style="text-align:right;color:#ffaa00;">$${stat.total_fee.toFixed(2)}</td>
      </tr>
    `).join('');
    
    modal.innerHTML = `
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;">
        <div style="font-size:28px;line-height:1;">📊</div>
        <div>
          <h3 style="margin:0;color:#00f2fe;font-size:17px;font-weight:700;">交易分类统计</h3>
          <p style="margin:4px 0 0;color:var(--text3);font-size:.8rem;">总交易数: ${summary.total_transactions} | 总手续费: $${summary.total_fees.toFixed(2)}</p>
        </div>
      </div>
      
      <h4 style="margin:20px 0 12px 0;color:#00f2fe;font-size:.95rem;">按交易类型统计</h4>
      <table class="table">
        <thead>
          <tr>
            <th>交易类型</th>
            <th style="text-align:center;">笔数</th>
            <th style="text-align:right;">总金额</th>
            <th style="text-align:right;">总手续费</th>
            <th style="text-align:right;">净金额</th>
          </tr>
        </thead>
        <tbody>${transactionRows}</tbody>
      </table>
      
      <h4 style="margin:20px 0 12px 0;color:#00f2fe;font-size:.95rem;">按费用类型统计</h4>
      ${fee_stats.length > 0 ? `
        <table class="table">
          <thead>
            <tr>
              <th>费用类型</th>
              <th style="text-align:center;">笔数</th>
              <th style="text-align:right;">总费用</th>
            </tr>
          </thead>
          <tbody>${feeRows}</tbody>
        </table>
      ` : '<p style="color:var(--text3);text-align:center;padding:20px;">暂无手续费记录</p>'}
      
      <div style="margin-top:20px;text-align:center;">
        <button class="btn-secondary" style="padding:10px 24px;" onclick="overlay.remove()">关闭</button>
      </div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  } catch(err) {
    toast('❌ 加载统计失败: ' + err.message);
  }
}

// 加载余额趋势图
async function loadBalanceTrend() {
  try {
    const res = await apiFetch('/user/balance/balance-trend');
    if (res.code !== 0) throw new Error(res.msg);
    
    const trend = res.data;
    
    if (trend.length === 0) {

      return;
    }
    
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;z-index:9999;';
    
    const modal = document.createElement('div');
    modal.style.cssText = 'background:linear-gradient(135deg, #0d1322 0%, #13192a 100%);border:1px solid rgba(0,242,254,.25);border-radius:16px;padding:28px;max-width:800px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.5);';
    
    // 按日期倒序显示
    const rows = trend.map(day => `
      <tr>
        <td style="font-weight:600;">${day.date}</td>
        <td style="text-align:center;">${day.transaction_count}</td>
        <td style="text-align:right;color:#00c758;">$${day.income.toFixed(2)}</td>
        <td style="text-align:right;color:#ff5f5f;">$${Math.abs(day.expense).toFixed(2)}</td>
        <td style="text-align:right;color:#ffaa00;">$${day.fees.toFixed(2)}</td>
        <td style="text-align:right;color:${day.net_change >= 0 ? '#00c758' : '#ff5f5f'};">$${day.net_change.toFixed(2)}</td>
        <td style="text-align:right;color:#00f2fe;font-weight:700;">$${day.cumulative_balance.toFixed(2)}</td>
      </tr>
    `).join('');
    
    modal.innerHTML = `
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;">
        <div style="font-size:28px;line-height:1;">📈</div>
        <div>
          <h3 style="margin:0;color:#00f2fe;font-size:17px;font-weight:700;">余额变化趋势（最近30天）</h3>
          <p style="margin:4px 0 0;color:var(--text3);font-size:.8rem;">展示每日收支变化及累计余额</p>
        </div>
      </div>
      
      <table class="table">
        <thead>
          <tr>
            <th>日期</th>
            <th style="text-align:center;">交易笔数</th>
            <th style="text-align:right;">收入</th>
            <th style="text-align:right;">支出</th>
            <th style="text-align:right;">手续费</th>
            <th style="text-align:right;">净变化</th>
            <th style="text-align:right;">累计余额</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      
      <div style="margin-top:20px;text-align:center;">
        <button class="btn-secondary" style="padding:10px 24px;" onclick="overlay.remove()">关闭</button>
      </div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  } catch(err) {
    toast('❌ 加载趋势图失败: ' + err.message);
  }
}

// 页面路由中添加费用设置页面
const pageRenderers = window.pageRenderers || {};
pageRenderers['admin-fee-config'] = renderFeeConfigPage;
pageRenderers['balance-detail'] = renderBalanceDetailPage;

// ══════════════════════════════════════════════════════════════
//  开卡审核页面
// ══════════════════════════════════════════════════════════════
async function renderCardReviewPage() {
  if (_me?.role !== 'admin') return gotoPage('cards');
  const area = document.getElementById('contentArea');
  area.innerHTML = `
    <div style="padding:24px;">
      
      <div style="display:flex;gap:12px;margin-bottom:20px;" id="crStats"></div>
      
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap;">
        <div style="display:flex;gap:6px;">
          <button class="btn btn-sm" id="crTabAll"    onclick="crSetTab('all')"     style="background:#1a2340;border:1px solid #00f2fe33;color:#00f2fe;padding:6px 14px;border-radius:6px;cursor:pointer;">全部</button>
          <button class="btn btn-sm" id="crTabPending" onclick="crSetTab('pending')" style="background:#1a2340;border:1px solid #ffaa0033;color:#ffaa00;padding:6px 14px;border-radius:6px;cursor:pointer;">待审核</button>
          <button class="btn btn-sm" id="crTabApproved" onclick="crSetTab('approved')" style="background:#1a2340;border:1px solid #00c75833;color:#00c758;padding:6px 14px;border-radius:6px;cursor:pointer;">已通过</button>
          <button class="btn btn-sm" id="crTabRejected" onclick="crSetTab('rejected')" style="background:#1a2340;border:1px solid #ff5f5f33;color:#ff5f5f;padding:6px 14px;border-radius:6px;cursor:pointer;">已拒绝</button>
        </div>
      </div>
      
      <div id="crList"><div class="loading-spinner" style="margin:40px auto;"></div></div>
    </div>
  `;
  window._crTab = window._crTab || 'pending';
  await crLoad();
}

window._crTab = 'pending';
function crSetTab(tab) {
  window._crTab = tab;
  ['all','pending','approved','rejected'].forEach(t => {
    const el = document.getElementById('crTab' + t.charAt(0).toUpperCase() + t.slice(1));
    if (el) el.style.opacity = t === tab ? '1' : '0.5';
  });
  crLoad();
}

async function crLoad() {
  const tab = window._crTab || 'pending';
  const statusParam = tab === 'all' ? '' : '?status=' + tab;
  const r = await apiFetch('/admin/card-applications' + statusParam, {}, true);
  if (!r || r.code !== 0) return;
  const list = r.data || [];

  // 统计
  const statsEl = document.getElementById('crStats');
  if (statsEl) {
    const all = await apiFetch('/admin/card-applications', {}, true);
    const allList = all?.data || [];
    const cnt = { pending: 0, approved: 0, rejected: 0 };
    allList.forEach(a => { if (cnt[a.status] !== undefined) cnt[a.status]++; });
    statsEl.innerHTML = [
      { label:'待审核', val: cnt.pending, color:'#ffaa00' },
      { label:'已通过', val: cnt.approved, color:'#00c758' },
      { label:'已拒绝', val: cnt.rejected, color:'#ff5f5f' },
      { label:'共计', val: allList.length, color:'#00f2fe' },
    ].map(s => '<div style="background:#0d1322;border:1px solid #ffffff0f;border-radius:10px;padding:14px 20px;min-width:100px;">' +
      '<div style="font-size:1.4rem;font-weight:700;color:' + s.color + ';">' + s.val + '</div>' +
      '<div style="font-size:.75rem;color:var(--text3);margin-top:2px;">' + s.label + '</div></div>'
    ).join('');
  }

  // Tab 高亮
  ['all','pending','approved','rejected'].forEach(t => {
    const el = document.getElementById('crTab' + t.charAt(0).toUpperCase() + t.slice(1));
    if (el) el.style.opacity = t === tab ? '1' : '0.5';
  });

  const wrap = document.getElementById('crList');
  if (!wrap) return;
  if (!list.length) {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">暂无申请记录</div></div>';
    return;
  }

  const statusMap = { pending:'待审核', approved:'已通过', rejected:'已拒绝' };
  const statusColor = { pending:'#ffaa00', approved:'#00c758', rejected:'#ff5f5f' };

  wrap.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
    '<th>ID</th><th>申请人</th><th>卡产品</th><th>持卡人</th><th>充值/数量</th><th>状态</th><th>申请时间</th><th>操作</th>' +
    '</tr></thead><tbody>' +
    list.map(a => {
      const isPending = a.status === 'pending';
      const st = statusMap[a.status] || a.status;
      const sc = statusColor[a.status] || '#aaa';
      const dt = (a.created_at||'').replace('T',' ').slice(0,16);
      return '<tr>' +
        '<td style="color:var(--text3);font-size:.8rem;">#' + a.id + '</td>' +
        '<td>' +
          '<div style="font-size:.85rem;">' + (a.user_name||'-') + '</div>' +
          '<div style="font-size:.75rem;color:var(--text3);">' + (a.user_email||'') + '</div>' +
        '</td>' +
        '<td><span style="background:#1a2340;padding:3px 8px;border-radius:4px;font-size:.8rem;">' + (a.product_code||'-') + '</span></td>' +
        '<td style="font-size:.85rem;">' + (a.first_name||'') + ' ' + (a.last_name||'') + '</td>' +
        '<td style="color:#00f2fe;font-weight:600;">$' + Number(a.amount||0).toFixed(2) + '</td>' +
          '<td>' + (a.quantity||1) + '</td>' +
        '<td><span style="background:' + sc + '22;color:' + sc + ';padding:3px 10px;border-radius:12px;font-size:.78rem;">' + st + '</span>' +
          (a.reject_reason ? '<div style="font-size:.72rem;color:#ff5f5f;margin-top:2px;">原因: ' + a.reject_reason + '</div>' : '') +
        '</td>' +
        '<td style="font-size:.8rem;color:var(--text3);">' + dt + '</td>' +
        '<td>' +
          (isPending
            ? '<button class="btn btn-sm" onclick="crApprove(' + a.id + ')" style="background:#00c75822;color:#00c758;border:1px solid #00c75844;padding:4px 10px;border-radius:5px;cursor:pointer;margin-right:4px;">✅ 通过</button>' +
              '<button class="btn btn-sm" onclick="crReject(' + a.id + ')" style="background:#ff5f5f22;color:#ff5f5f;border:1px solid #ff5f5f44;padding:4px 10px;border-radius:5px;cursor:pointer;">❌ 拒绝</button>'
            : '<span style="color:var(--text3);font-size:.8rem;">—</span>'
          ) +
        '</td>' +
        '</tr>';
    }).join('') +
    '</tbody></table></div>';
}

async function crApprove(id) {
  if (!confirm('确认审批通过该开卡申请？系统将调用 vmcardio 真实开卡，此操作不可撤销。')) return;
  const btn = event.target;
  btn.disabled = true; btn.textContent = '开卡中…';
  try {
    const r = await apiFetch('/admin/card-applications/' + id + '/approve', { method:'POST' });
    if (r.code === 0) {
      toast('✅ 审批通过，卡片已创建：' + r.data.card_id);
      crLoad();
    } else {
      toast('❌ 开卡失败：' + (r.msg || '未知错误'));
      btn.disabled = false; btn.textContent = '✅ 通过';
    }
  } catch(e) {
    toast('❌ 请求失败：' + e.message);
    btn.disabled = false; btn.textContent = '✅ 通过';
  }
}

async function crReject(id) {
  const reason = prompt('请输入拒绝原因（可留空）：');
  if (reason === null) return;
  try {
    const r = await apiFetch('/admin/card-applications/' + id + '/reject', {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
    if (r.code === 0) { toast('已拒绝该申请'); crLoad(); }
    else toast('❌ ' + (r.msg || '操作失败'));
  } catch(e) { toast('❌ 请求失败：' + e.message); }
}

// ══════════════════════════════════════════════════════════════
//  充值审核页面
// ══════════════════════════════════════════════════════════════
async function renderTopupReviewPage() {
  if (_me?.role !== 'admin') return gotoPage('cards');
  const area = document.getElementById('contentArea');
  area.innerHTML = `
    <div style="padding:24px;">
      <div style="display:flex;gap:12px;margin-bottom:20px;" id="trStats"></div>
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap;">
        <div style="display:flex;gap:6px;">
          <button id="trTabAll"      onclick="trSetTab('all')"      style="background:#1a2340;border:1px solid #00f2fe33;color:#00f2fe;padding:6px 14px;border-radius:6px;cursor:pointer;">全部</button>
          <button id="trTabPending"  onclick="trSetTab('pending')"  style="background:#1a2340;border:1px solid #ffaa0033;color:#ffaa00;padding:6px 14px;border-radius:6px;cursor:pointer;">待审核</button>
          <button id="trTabApproved" onclick="trSetTab('approved')" style="background:#1a2340;border:1px solid #00c75833;color:#00c758;padding:6px 14px;border-radius:6px;cursor:pointer;">已通过</button>
          <button id="trTabRejected" onclick="trSetTab('rejected')" style="background:#1a2340;border:1px solid #ff5f5f33;color:#ff5f5f;padding:6px 14px;border-radius:6px;cursor:pointer;">已拒绝</button>
        </div>
      </div>
      <div id="trList"><div class="loading-spinner" style="margin:40px auto;"></div></div>
    </div>
  `;
  window._trTab = window._trTab || 'pending';
  await trLoad();
}

window._trTab = 'pending';
function trSetTab(tab) {
  window._trTab = tab;
  ['all','pending','approved','rejected'].forEach(t => {
    const el = document.getElementById('trTab' + t.charAt(0).toUpperCase() + t.slice(1));
    if (el) el.style.opacity = t === tab ? '1' : '0.5';
  });
  trLoad();
}

async function trLoad() {
  const tab = window._trTab || 'pending';
  const statusParam = tab === 'all' ? '' : '?status=' + tab;
  const r = await apiFetch('/topup/admin' + statusParam, {}, true);
  if (!r || r.code !== 0) return;
  const list = r.data?.list || [];

  // 统计条
  const statsEl = document.getElementById('trStats');
  if (statsEl) {
    const all = await apiFetch('/topup/admin', {}, true);
    const allList = all?.data?.list || [];
    const cnt = { pending: 0, approved: 0, rejected: 0 };
    let totalUsdt = 0;
    allList.forEach(a => {
      if (cnt[a.status] !== undefined) cnt[a.status]++;
      if (a.status === 'approved') totalUsdt += Number(a.amount_usdt || 0);
    });
    statsEl.innerHTML = [
      { label:'待审核', val: cnt.pending, color:'#ffaa00', prefix:'' },
      { label:'已通过', val: cnt.approved, color:'#00c758', prefix:'' },
      { label:'已拒绝', val: cnt.rejected, color:'#ff5f5f', prefix:'' },
      { label:'累计入账 USDT', val: totalUsdt.toFixed(2), color:'#00f2fe', prefix:'$' },
    ].map(s => '<div style="background:#0d1322;border:1px solid #ffffff0f;border-radius:10px;padding:14px 20px;min-width:110px;">' +
      '<div style="font-size:1.3rem;font-weight:700;color:' + s.color + ';">' + s.prefix + s.val + '</div>' +
      '<div style="font-size:.75rem;color:var(--text3);margin-top:2px;">' + s.label + '</div></div>'
    ).join('');
  }

  ['all','pending','approved','rejected'].forEach(t => {
    const el = document.getElementById('trTab' + t.charAt(0).toUpperCase() + t.slice(1));
    if (el) el.style.opacity = t === tab ? '1' : '0.5';
  });

  const wrap = document.getElementById('trList');
  if (!wrap) return;
  if (!list.length) {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">暂无充值申请</div></div>';
    return;
  }

  const statusMap = { pending:'待审核', approved:'已通过', rejected:'已拒绝' };
  const statusColor = { pending:'#ffaa00', approved:'#00c758', rejected:'#ff5f5f' };
  const networkBadge = n => '<span style="background:#00f2fe22;color:#00f2fe;padding:2px 7px;border-radius:4px;font-size:.75rem;">' + (n||'-') + '</span>';

  wrap.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
    '<th>ID</th><th>用户</th><th>网络</th><th>USDT 金额</th><th>TxHash</th><th>备注</th><th>状态</th><th>申请时间</th><th>操作</th>' +
    '</tr></thead><tbody>' +
    list.map(a => {
      const isPending = a.status === 'pending';
      const st = statusMap[a.status] || a.status;
      const sc = statusColor[a.status] || '#aaa';
      const dt = (a.created_at||'').replace('T',' ').slice(0,16);
      const txShort = a.txhash ? (a.txhash.length > 16 ? a.txhash.slice(0,8)+'…'+a.txhash.slice(-6) : a.txhash) : '—';
      return '<tr>' +
        '<td style="color:var(--text3);font-size:.8rem;">#' + a.id + '</td>' +
        '<td>' +
          '<div style="font-size:.85rem;">' + (a.user_name||'-') + '</div>' +
          '<div style="font-size:.75rem;color:var(--text3);">' + (a.user_email||'') + '</div>' +
        '</td>' +
        '<td>' + networkBadge(a.network) + '</td>' +
        '<td style="color:#00f2fe;font-weight:600;">' + (a.amount_usdt ? '$' + Number(a.amount_usdt).toFixed(2) : '—') + '</td>' +
        '<td><span style="font-size:.78rem;color:var(--text2);font-family:monospace;" title="' + (a.txhash||'') + '">' + txShort + '</span></td>' +
        '<td style="font-size:.8rem;color:var(--text2);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + (a.remark||'') + '">' + (a.remark||'—') + '</td>' +
        '<td><span style="background:' + sc + '22;color:' + sc + ';padding:3px 10px;border-radius:12px;font-size:.78rem;">' + st + '</span></td>' +
        '<td style="font-size:.8rem;color:var(--text3);">' + dt + '</td>' +
        '<td>' +
          (isPending
            ? '<button onclick="trApprove(' + a.id + ',' + Number(a.amount_usdt||0) + ')" style="background:#00c75822;color:#00c758;border:1px solid #00c75844;padding:4px 10px;border-radius:5px;cursor:pointer;margin-right:4px;font-size:.8rem;">✅ 通过</button>' +
              '<button onclick="trReject(' + a.id + ')" style="background:#ff5f5f22;color:#ff5f5f;border:1px solid #ff5f5f44;padding:4px 10px;border-radius:5px;cursor:pointer;font-size:.8rem;">❌ 拒绝</button>'
            : '<span style="color:var(--text3);font-size:.8rem;">—</span>'
          ) +
        '</td>' +
        '</tr>';
    }).join('') +
    '</tbody></table></div>';
}

async function trApprove(id, amount) {
  const usdtAmt = amount > 0 ? amount : parseFloat(prompt('请输入入账 USDT 金额（USD）：') || '0');
  if (!usdtAmt || usdtAmt <= 0) return toast('⚠️ 请输入有效金额');
  if (!confirm('确认通过充值申请 #' + id + '，入账 $' + usdtAmt.toFixed(2) + '？\n通过后系统将自动增加用户余额。')) return;
  try {
    const r = await apiFetch('/topup/' + id, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'approved', note: '' })
    });
    if (r.code === 0) { toast('✅ 已审批通过，用户余额已增加'); trLoad(); }
    else toast('❌ ' + (r.msg || '操作失败'));
  } catch(e) { toast('❌ 请求失败：' + e.message); }
}

async function trReject(id) {
  const note = prompt('请输入拒绝原因（可留空）：');
  if (note === null) return;
  try {
    const r = await apiFetch('/topup/' + id, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'rejected', note })
    });
    if (r.code === 0) { toast('已拒绝充值申请'); trLoad(); }
    else toast('❌ ' + (r.msg || '操作失败'));
  } catch(e) { toast('❌ 请求失败：' + e.message); }
}

// ══════════════════════════════════════════════════════════════
//  系统设置页面
// ══════════════════════════════════════════════════════════════
async function renderAdminSettingsPage() {
  if (_me?.role !== 'admin') return gotoPage('cards');
  const area = document.getElementById('contentArea');
  area.style.paddingTop = '10px'; area.style.paddingLeft = '12px'; area.style.maxWidth = '100%';
  area.innerHTML = `
    <div id="settingsWrap" style="padding-right:12px;">
      <div id="settingsLoading" style="text-align:center;padding:40px;color:var(--text3);">加载中…</div>
      <div id="settingsForm" style="display:none;">

        <div style="background:#13192a;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:20px;margin-bottom:16px;">
          <div style="font-weight:700;color:#00f2fe;margin-bottom:6px;display:flex;align-items:center;gap:8px;font-size:1rem;">
            <span>🏗️</span> 上游费用成本
          </div>
          <div style="font-size:.75rem;color:var(--text3);margin-bottom:14px;">vmcardio 平台收费标准，仅供参考（最近更新：<span id="upstreamUpdateTime">—</span>）</div>
          <div id="upstreamFeeWrap" style="text-align:center;padding:20px;color:var(--text3);font-size:.85rem;">加载中…</div>
        </div>

        <div style="display:flex;gap:10px;padding:16px 0;">
          <button onclick="saveAdminSettings()" style="background:linear-gradient(135deg,#00c6ff,#0072ff);color:#fff;border:none;border-radius:8px;padding:10px 28px;font-size:.9rem;font-weight:600;cursor:pointer;flex:1;">💾 保存设置</button>
        </div>
        <div id="stSaveMsg" style="margin-top:10px;text-align:center;font-size:.85rem;"></div>
      </div>
    </div>
  `;
  await loadAdminSettings();
}

async function loadAdminSettings() {
  try {
    const r = await apiFetch('/admin/settings', {}, true);
    document.getElementById('settingsLoading').style.display = 'none';
    document.getElementById('settingsForm').style.display = 'block';
    if (r?.code === 0) {
      const s = r.data || {};
      const f = id => document.getElementById(id);
      if (f('st_trc20'))       f('st_trc20').value       = s.wallet_trc20 || '';
      if (f('st_erc20'))       f('st_erc20').value       = s.wallet_erc20 || '';
      if (f('st_bep20'))       f('st_bep20').value       = s.wallet_bep20 || '';
      if (f('st_sol'))         f('st_sol').value         = s.wallet_sol   || '';
      if (f('st_usdt_rate'))   f('st_usdt_rate').value   = s.usdt_rate    || '1.00';
      if (f('st_min_topup'))   f('st_min_topup').value   = s.min_topup    || '10';
      if (f('st_topup_notice')) f('st_topup_notice').value = s.topup_notice || '';
    }
  } catch(e) {
    const el = document.getElementById('settingsLoading');
    if (el) el.textContent = '加载失败，请刷新重试';
  }
  // 加载上游费用成本
  loadUpstreamFees();
}

async function loadUpstreamFees() {
  const wrap = document.getElementById('upstreamFeeWrap');
  if (!wrap) return;
  try {
    const r = await apiFetch('/admin/upstream-fees', {}, true);
    if (!r?.data?.length) { wrap.textContent = '暂无数据'; return; }
    const rows = r.data;
    // 取最新更新时间
    const latest = rows.reduce((a, b) => b.updated_at > a ? b.updated_at : a, '');
    const timeEl = document.getElementById('upstreamUpdateTime');
    if (timeEl && latest) timeEl.textContent = latest.replace('T',' ').substring(0, 16);

    // 分类：上游 API 费用 vs 平台自定义
    const apiFees = rows.filter(f => ['card_creation','transaction','refund','chargeback','auth_reversal','cross_border','small_transaction','card_monthly'].includes(f.fee_type));

    function renderCard(fee, accentColor) {
      const rules = fee.rules || {};
      const hasRate = fee.upstream_rate > 0;
      const hasFixed = fee.upstream_fixed > 0;
      const rateStr = hasRate ? (fee.upstream_rate * 100).toFixed(fee.upstream_rate < 0.1 ? 1 : 0) + '%' : '—';
      const fixedStr = hasFixed ? '$' + fee.upstream_fixed.toFixed(2) : '—';
      let ruleTags = '';
      if (rules.free_count) ruleTags += '<span style="background:#ff980033;color:#ffb74d;padding:1px 8px;border-radius:10px;font-size:.7rem;">前' + rules.free_count + '笔豁免</span>';
      if (rules.threshold) ruleTags += '<span style="background:#e040fb33;color:#ce93d8;padding:1px 8px;border-radius:10px;font-size:.7rem;">' + rules.threshold + '</span>';
      if (rules.charge_timing) ruleTags += '<span style="background:#ffffff12;color:var(--text3);padding:1px 8px;border-radius:10px;font-size:.7rem;">' + rules.charge_timing + '</span>';
      if (rules.exempt) ruleTags += '<span style="background:#00c75833;color:#69f0ae;padding:1px 8px;border-radius:10px;font-size:.7rem;">' + rules.exempt + '</span>';
      // 将 fee 对象存入全局缓存，编辑时使用
      if (!window._upstreamFeesCache) window._upstreamFeesCache = {};
      window._upstreamFeesCache[fee.fee_type] = fee;
      return '<div style="background:#0a0f1e;border:1px solid #ffffff0a;border-radius:8px;padding:12px 14px;">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">'
        + '<div style="display:flex;align-items:center;gap:6px;">'
        + '<div style="width:3px;height:18px;border-radius:2px;background:' + accentColor + ';"></div>'
        + '<span style="font-weight:600;font-size:.85rem;color:var(--text1);">' + fee.name + '</span>'
        + '<span style="font-size:.7rem;color:var(--text3);background:#ffffff0a;padding:1px 6px;border-radius:4px;">' + fee.fee_type + '</span>'
        + '</div>'
        + '<button onclick="editUpstreamFee(\'' + fee.fee_type + '\')" style="background:#ffffff0a;border:none;color:var(--text3);font-size:.75rem;padding:3px 10px;border-radius:6px;cursor:pointer;" onmouseover="this.style.background=\'#ffffff1a\';this.style.color=\'#00f2fe\'" onmouseout="this.style.background=\'#ffffff0a\';this.style.color=\'var(--text3)\'">✏️ 编辑</button>'
        + '</div>'
        + '<div style="display:flex;gap:16px;margin-bottom:6px;">'
        + '<div><span style="font-size:.7rem;color:var(--text3);">费率</span><div style="font-size:.9rem;color:#00f2fe;font-weight:600;">' + rateStr + '</div></div>'
        + '<div><span style="font-size:.7rem;color:var(--text3);">固定费</span><div style="font-size:.9rem;color:#00f2fe;font-weight:600;">' + fixedStr + '</div></div>'
        + '</div>'
        + (ruleTags ? '<div style="display:flex;flex-wrap:wrap;gap:4px;">' + ruleTags + '</div>' : '')
        + '</div>';
    }

    let html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">';
    apiFees.forEach((fee, i) => {
      const colors = ['#00f2fe','#00c758','#ff9800','#e040fb','#ff5252','#7c4dff','#ffd740','#18ffff'];
      html += renderCard(fee, colors[i % colors.length]);
    });
    html += '</div>';
    html += '<div style="margin-top:12px;font-size:.72rem;color:var(--text3);text-align:center;">'
      + '💡 点击卡片右上角「编辑」可修改上游成本，修改后即时生效。</div>';
    wrap.innerHTML = html;
  } catch(e) {
    wrap.textContent = '加载失败';
  }
}

// ── 编辑上游费用弹窗 ──
function editUpstreamFee(feeType) {
  const fee = (window._upstreamFeesCache || {})[feeType];
  if (!fee) return toast('❌ 数据未加载');
  const rules = fee.rules || {};

  // 构建规则字段
  let rulesFields = '';
  const ruleKeys = {
    charge_timing: '收费时机',
    threshold: '金额阈值',
    free_count: '豁免笔数',
    exempt: '豁免条件',
    min: '最低规则',
    rate: '费率说明',
    refund_policy: '退款策略',
    condition: '条件',
    risk_control: '风控',
    note: '备注'
  };
  Object.keys(ruleKeys).forEach(key => {
    const val = rules[key] || '';
    rulesFields += '<div style="display:grid;grid-template-columns:90px 1fr;gap:6px;align-items:center;">'
      + '<span style="font-size:.78rem;color:var(--text3);">' + ruleKeys[key] + '</span>'
      + '<input data-rule-key="' + key + '" type="text" value="' + val + '" style="background:#0a0f1e;border:1px solid #ffffff1a;border-radius:6px;padding:7px 10px;color:var(--text1);font-size:.82rem;">'
      + '</div>';
  });

  const overlay = document.createElement('div');
  overlay.id = 'upstreamEditOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = '<div style="background:#0d1322;border:1px solid #ffffff15;border-radius:14px;padding:24px;width:420px;max-height:90vh;overflow-y:auto;">'
    + '<div style="font-weight:700;color:#00f2fe;margin-bottom:16px;display:flex;align-items:center;gap:8px;">'
    + '<span>✏️</span> 编辑上游费用 — ' + fee.name
    + '</div>'
    + '<div style="display:grid;gap:12px;">'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
    + '<div><label style="font-size:.78rem;color:var(--text3);display:block;margin-bottom:4px;">费率（%）</label><input id="ufEditRate" type="number" step="0.1" min="0" value="' + (fee.upstream_rate > 0 ? (fee.upstream_rate * 100) : '') + '" placeholder="如 2 表示 2%" style="width:100%;background:#0a0f1e;border:1px solid #ffffff1a;border-radius:6px;padding:7px 10px;color:var(--text1);font-size:.85rem;"></div>'
    + '<div><label style="font-size:.78rem;color:var(--text3);display:block;margin-bottom:4px;">固定费（$）</label><input id="ufEditFixed" type="number" step="0.01" min="0" value="' + (fee.upstream_fixed > 0 ? fee.upstream_fixed : '') + '" placeholder="如 0.30" style="width:100%;background:#0a0f1e;border:1px solid #ffffff1a;border-radius:6px;padding:7px 10px;color:var(--text1);font-size:.85rem;"></div>'
    + '</div>'
    + '<div style="border-top:1px solid #ffffff0a;padding-top:12px;margin-top:4px;">'
    + '<div style="font-size:.82rem;color:var(--text3);margin-bottom:8px;">📋 规则明细</div>'
    + '<div style="display:grid;gap:8px;">' + rulesFields + '</div>'
    + '</div>'
    + '<div><label style="font-size:.78rem;color:var(--text3);display:block;margin-bottom:4px;">备注</label><input id="ufEditNotes" type="text" value="' + (fee.notes || '') + '" style="width:100%;background:#0a0f1e;border:1px solid #ffffff1a;border-radius:6px;padding:7px 10px;color:var(--text1);font-size:.85rem;"></div>'
    + '</div>'
    + '<div style="display:flex;gap:10px;margin-top:18px;">'
    + '<button onclick="saveUpstreamFee(\'' + feeType + '\')" style="flex:1;background:linear-gradient(135deg,#00c6ff,#0072ff);color:#fff;border:none;border-radius:8px;padding:9px;font-size:.88rem;font-weight:600;cursor:pointer;">💾 保存</button>'
    + '<button onclick="document.getElementById(\'upstreamEditOverlay\').remove()" style="flex:1;background:#ffffff0a;color:var(--text2);border:none;border-radius:8px;padding:9px;font-size:.88rem;cursor:pointer;">取消</button>'
    + '</div>'
    + '</div>';
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

async function saveUpstreamFee(feeType) {
  const rateVal = document.getElementById('ufEditRate').value;
  const fixedVal = document.getElementById('ufEditFixed').value;
  const notesVal = document.getElementById('ufEditNotes').value;

  // 收集规则字段
  const newRules = {};
  document.querySelectorAll('#upstreamEditOverlay [data-rule-key]').forEach(el => {
    const key = el.getAttribute('data-rule-key');
    if (el.value.trim()) newRules[key] = el.value.trim();
  });

  const payload = {
    upstream_rate: rateVal === '' ? 0 : parseFloat(rateVal) / 100,
    upstream_fixed: fixedVal === '' ? 0 : parseFloat(fixedVal),
    upstream_rules: JSON.stringify(newRules),
    notes: notesVal.trim()
  };

  try {
    const r = await apiFetch('/admin/upstream-fees/' + feeType, { method: 'PUT', body: JSON.stringify(payload) });
    if (r?.code === 0) {
      toast('✅ 已更新：' + feeType);
      const overlay = document.getElementById('upstreamEditOverlay');
      if (overlay) overlay.remove();
      loadUpstreamFees();
    } else {
      toast('❌ ' + (r?.msg || '保存失败'));
    }
  } catch(e) { toast('❌ 请求失败：' + e.message); }
}

async function saveAdminSettings() {
  const f = id => (document.getElementById(id)?.value || '').trim();
  const payload = {
    wallet_trc20:   f('st_trc20'),
    wallet_erc20:   f('st_erc20'),
    wallet_bep20:   f('st_bep20'),
    wallet_sol:     f('st_sol'),
    usdt_rate:      f('st_usdt_rate'),
    min_topup:      f('st_min_topup'),
    topup_notice:   f('st_topup_notice'),
  };
  try {
    const r = await apiFetch('/admin/settings', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (r?.code === 0) {
      toast('✅ 设置已保存');
      const msg = document.getElementById('stSaveMsg');
      if (msg) { msg.style.color = '#00c758'; msg.textContent = '✅ 已于 ' + new Date().toLocaleTimeString() + ' 保存成功'; }
    } else {
      toast('❌ 保存失败：' + (r?.msg || '未知错误'));
    }
  } catch(e) { toast('❌ 请求失败：' + e.message); }
}

// ══════════════════════════════════════════════
//  PAGE: 全局交易监控（管理员）
// ══════════════════════════════════════════════
let _txMonitorCards = [];
let _txMonitorFilter = {};

async function renderAdminTxMonitor() {
  if (_me?.role !== 'admin') return gotoPage('cards');
  const area = document.getElementById('contentArea');
  area.innerHTML = `
    <div class="page-header">
      <div><h2>交易监控</h2><p class="text-muted mt-1">所有用户所有卡的实时交易记录</p></div>
    </div>

    
    <div class="ov-stat-row" id="txMonStats">
      <div class="ov-stat-card" style="background:#13192a;">
        <div class="ov-stat-label">交易总笔数</div>
        <div class="ov-stat-val" id="txMonTotal">—</div>
      </div>
      <div class="ov-stat-card" style="background:#13192a;">
        <div class="ov-stat-label">交易总金额</div>
        <div class="ov-stat-val" id="txMonAmount">$—</div>
      </div>
      <div class="ov-stat-card" style="background:#13192a;">
        <div class="ov-stat-label">消费授权</div>
        <div class="ov-stat-val" style="font-size:1.1rem;" id="txMonAuth">— / $—</div>
      </div>
      <div class="ov-stat-card" style="background:#13192a;">
        <div class="ov-stat-label">清算结算</div>
        <div class="ov-stat-val" style="font-size:1.1rem;" id="txMonSettle">— / $—</div>
      </div>
    </div>

    
    <div class="panel mt-4">
      <div class="flex flex-wrap gap-3 items-center" style="margin-bottom:12px;">
        <select id="txMonCardSel" onchange="txMonFilterChange()" style="min-width:200px;padding:6px 10px;border-radius:8px;background:#1a2035;border:1px solid #2d344a;color:#e2e8f0;font-size:.85rem;">
          <option value="">全部卡片</option>
        </select>
        <select id="txMonTypeSel" onchange="txMonFilterChange()" style="padding:6px 10px;border-radius:8px;background:#1a2035;border:1px solid #2d344a;color:#e2e8f0;font-size:.85rem;">
          <option value="">全部类型</option>
          <option value="Authorization">消费授权</option>
          <option value="Settlement">清算</option>
          <option value="Refund">退款</option>
          <option value="Reversal">撤销</option>
        </select>
        <select id="txMonStatusSel" onchange="txMonFilterChange()" style="padding:6px 10px;border-radius:8px;background:#1a2035;border:1px solid #2d344a;color:#e2e8f0;font-size:.85rem;">
          <option value="">全部状态</option>
          <option value="COMPLETE">完成</option>
          <option value="PENDING">清算中</option>
          <option value="DECLINED">失败</option>
        </select>
        <span id="txMonDateWrap" style="display:inline-flex;align-items:center;gap:8px;"></span>
        <button class="btn btn-primary btn-sm" onclick="loadTxMonitor()">查询</button>
        <button class="btn btn-outline btn-sm" onclick="txMonReset()">重置</button>
      </div>
    </div>

    
    <div class="panel mt-3">
      <div id="txMonListWrap" style="padding:24px;">
        <div class="skeleton" style="height:400px;border-radius:12px;"></div>
      </div>
    </div>
  `;

  // 加载卡片列表
  try {
    const r = await apiFetch('/admin/cards?page_size=100');
    if (r.code === 0 && r.data?.list) {
      _txMonitorCards = r.data.list;
      const sel = document.getElementById('txMonCardSel');
      r.data.list.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.card_id;
        opt.textContent = (c.card_number ? c.card_number.slice(-4).padStart(8, '****') : c.card_id.slice(0, 8)) + ' — ' + (c.user_name || c.user_email || '未知用户');
        sel.appendChild(opt);
      });
    }
  } catch(_) {}

  // 初始化日期选择器（每次重新创建，彻底清理防止泄漏）
  if (window._txMonDrPicker) {
    if (window._txMonDrPicker._outsideHandler) {
      document.removeEventListener('click', window._txMonDrPicker._outsideHandler);
    }
    var oldTrigger = document.getElementById('txMonDr_trigger');
    if (oldTrigger) oldTrigger.remove();
    var oldDrop = document.getElementById('txMonDr_drop');
    if (oldDrop) oldDrop.remove();
    delete window._drpInstances['txMonDr'];
    window._txMonDrPicker = null;
  }
  window._txMonDrPicker = new DateRangePicker({
    id: 'txMonDr',
    container: '#txMonDateWrap',
    placeholder: '开始日期 — 结束日期',
    onConfirm: function(start, end) {
      window._txMonFilter = window._txMonFilter || {};
      window._txMonFilter.dateFrom = start;
      window._txMonFilter.dateTo = end;
    },
    onClear: function() {
      window._txMonFilter = window._txMonFilter || {};
      window._txMonFilter.dateFrom = '';
      window._txMonFilter.dateTo = '';
    }
  });
  window._txMonDrPicker.init();
  // 恢复已保存的值
  if (window._txMonFilter?.dateFrom && window._txMonFilter?.dateTo) {
    window._txMonDrPicker.setRange(window._txMonFilter.dateFrom, window._txMonFilter.dateTo);
  }

  // 加载交易数据
  loadTxMonitor();
}

function txMonFilterChange() {}

function txMonReset() {
  document.getElementById('txMonCardSel').value = '';
  document.getElementById('txMonTypeSel').value = '';
  document.getElementById('txMonStatusSel').value = '';
  if (window._txMonDrPicker) window._txMonDrPicker.clear();
  loadTxMonitor();
}

async function loadTxMonitor() {
  const wrap = document.getElementById('txMonListWrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="skeleton" style="height:400px;border-radius:12px;"></div>';

  const params = new URLSearchParams();
  const cardId = document.getElementById('txMonCardSel')?.value;
  const txType = document.getElementById('txMonTypeSel')?.value;
  const txStatus = document.getElementById('txMonStatusSel')?.value;
  const dateFrom = window._txMonFilter?.dateFrom || '';
  const dateTo = window._txMonFilter?.dateTo || '';

  if (cardId) params.set('card_id', cardId);
  if (txType) params.set('transaction_type', txType);
  if (txStatus) params.set('status', txStatus);
  if (dateFrom) params.set('start_time', dateFrom);
  if (dateTo) params.set('end_time', dateTo + 'T23:59:59');
  params.set('page_size', '50');

  try {
    const r = await apiFetch('/admin/transactions?' + params.toString());
    if (r.code !== 0) {
      wrap.innerHTML = '<div class="empty-state"><div class="empty-text">加载失败</div></div>';
      return;
    }

    const items = r.data?.list || [];
    const summary = r.data?.summary || {};

    // 更新统计卡片
    const el = (id) => document.getElementById(id);
    if (el('txMonTotal')) el('txMonTotal').textContent = summary.total_count || 0;
    if (el('txMonAmount')) el('txMonAmount').textContent = '$' + (summary.total_amount || 0).toFixed(2);
    if (el('txMonAuth')) el('txMonAuth').textContent = (summary.auth_count || 0) + ' / $' + (summary.auth_amount || 0).toFixed(2);
    if (el('txMonSettle')) el('txMonSettle').textContent = (summary.settle_count || 0) + ' / $' + (summary.settle_amount || 0).toFixed(2);

    if (!items.length) {
      wrap.innerHTML = '<div class="empty-state"><div class="empty-text">暂无交易记录</div></div>';
      return;
    }

    const txTypeMap = { Authorization:'消费授权', Settlement:'清算', Refund:'退款', Reversal:'撤销' };
    const txStatusMap = { PENDING:'清算中', DECLINED:'失败', COMPLETE:'完成' };

    const html = items.map(item => {
      const amt = parseFloat(item.amount) || 0;
      const amtColor = amt < 0 ? 'var(--red)' : amt > 0 ? 'var(--green)' : 'var(--text2)';
      const statusClass = item.status === 'COMPLETE' ? 'tag-green' : item.status === 'PENDING' ? 'tag-yellow' : 'tag-red';
      const userLabel = item._user ? (item._user.user_name || item._user.user_email || '') : '未知';
      const cardLabel = item._card_number ? ('****' + item._card_number.slice(-4)) : (item.card_id ? item.card_id.slice(0, 8) + '...' : '—');
      return '<div style="padding:14px 16px;border-bottom:1px solid var(--border);display:grid;grid-template-columns:140px 120px 1fr 100px 120px 100px;gap:12px;align-items:center;font-size:.83rem;">' +
        '<div>' +
          '<div style="font-weight:600;color:var(--text1);">' + cardLabel + '</div>' +
          '<div style="color:var(--text3);margin-top:2px;font-size:.75rem;">' + userLabel + '</div>' +
        '</div>' +
        '<div>' +
          '<div style="color:var(--text2);">' + (item.merchant_name || '—') + '</div>' +
          '<div style="color:var(--text3);margin-top:2px;">' + (txTypeMap[item.transaction_type] || item.transaction_type || '—') + '</div>' +
        '</div>' +
        '<div style="color:var(--text3);font-size:.78rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (item.description || item.merchant_name || '—') + '</div>' +
        '<div>' +
          '<span class="tag ' + statusClass + '" style="font-size:.68rem;">' + (txStatusMap[item.status] || item.status || '—') + '</span>' +
        '</div>' +
        '<div style="text-align:right;font-weight:700;color:' + amtColor + ';">$' + Math.abs(amt).toFixed(2) + (item.auth_amount ? '<div style="font-weight:400;color:var(--text3);font-size:.72rem;">授权 $' + parseFloat(item.auth_amount).toFixed(2) + '</div>' : '') + '</div>' +
        '<div style="text-align:right;color:var(--text3);font-size:.75rem;">' + (item.start_time ? new Date(item.start_time).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—') + '</div>' +
      '</div>';
    }).join('');

    wrap.innerHTML = '<div style="font-size:.78rem;color:var(--text3);padding:8px 16px;border-bottom:1px solid var(--border);display:grid;grid-template-columns:140px 120px 1fr 100px 120px 100px;gap:12px;">' +
      '<span>卡号 / 用户</span><span>商户 / 类型</span><span>描述</span><span>状态</span><span style="text-align:right;">金额</span><span style="text-align:right;">时间</span>' +
    '</div>' + html;

  } catch(e) {
    if (e.message !== 'Unauthorized') {
      wrap.innerHTML = '<div class="empty-state"><div class="empty-text">加载失败：' + e.message + '</div></div>';
    }
  }
}

// ══════════════════════════════════════════════
//  PAGE: 财务中心（管理员）
// ══════════════════════════════════════════════
async function renderAdminFinance() {
  if (_me?.role !== 'admin') return gotoPage('cards');
  const area = document.getElementById('contentArea');
  area.style.paddingTop = '10px'; area.style.paddingLeft = '12px'; area.style.maxWidth = '100%';
  area.innerHTML = `
    <div id="financeWrap" style="padding-right:12px;">
      <div class="skeleton" style="height:600px;border-radius:12px;"></div>
    </div>
  `;

  try {
    const r = await apiFetch('/admin/finance-summary');
    if (r.code !== 0) {
      document.getElementById('financeWrap').innerHTML = '<div class="empty-state"><div class="empty-text">加载失败</div></div>';
      return;
    }
    const d = r.data;

    const lastSync = d.merchant_last_sync ? new Date(d.merchant_last_sync).toLocaleString('zh-CN') : '未同步';
    const balanceOk = d.merchant_balance >= 100;

    let html = '';

    // ── 区块1：资金概览（2列） ──
    const verifyColor = balanceOk ? '#00c758' : '#ff5f5f';
    const verifyText  = balanceOk ? '正常' : '异常';
    const verifySum   = (d.balance_check.users_total_balance + d.balance_check.system_reserved).toFixed(2);

    html += '<div class="fin-section">';
    html += '  <div class="fin-section-title">资金概览</div>';
    html += '  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">';

    // 商户余额（含资金验证）
    html += '  <div class="ov-stat-card" style="background:linear-gradient(135deg,#1e253a,#13192a);border:1px solid #2d344a;">';
    html += '    <div class="ov-stat-label">商户余额</div>';
    html += '    <div class="ov-stat-val grad-text">$' + d.merchant_balance.toFixed(2) + '</div>';
    html += '    <div class="ov-stat-sub">额度钱包：$' + d.wallet_balance.toFixed(2) + '　同步：' + lastSync + '</div>';
    html += '    <div style="border-top:1px solid rgba(255,255,255,.08);margin:10px 0 8px;"></div>';
    html += '    <div class="flex items-center gap-2">';
    html += '      <div style="width:7px;height:7px;border-radius:50%;background:' + verifyColor + ';flex-shrink:0;"></div>';
    html += '      <div style="font-size:.78rem;color:' + verifyColor + ';font-weight:600;">资金验证' + verifyText + '</div>';
    html += '    </div>';
    html += '    <div class="ov-stat-sub" style="font-size:.68rem;margin-top:3px;">$' + d.balance_check.vmcardio_balance + ' ≈ $' + verifySum + '</div>';
    html += '  </div>';

    // 资金分配（系统预留 + 用户总余额 + 验证）
    html += '  <div class="ov-stat-card" style="background:#13192a;display:flex;flex-direction:column;">';
    html += '    <div style="display:flex;">';
    html += '      <div style="flex:1;">';
    html += '        <div style="font-size:.7rem;color:var(--text3);margin-bottom:2px;">用户总余额</div>';
    html += '        <div style="font-size:1.3rem;font-weight:800;color:#00f2fe;">$' + d.total_user_balance.toFixed(2) + '</div>';
    html += '        <div class="ov-stat-sub">' + d.users_balance.length + ' 位用户</div>';
    html += '      </div>';
    html += '      <div style="width:1px;background:rgba(255,255,255,.08);margin:0 24px;flex-shrink:0;"></div>';
    html += '      <div style="flex:1;">';
    html += '        <div style="font-size:.7rem;color:var(--text3);margin-bottom:2px;">系统预留</div>';
    html += '        <div style="font-size:1.3rem;font-weight:800;color:#ffb347;">$' + d.system_balance.toFixed(2) + '</div>';
    html += '        <div class="ov-stat-sub">未分配资金</div>';
    html += '      </div>';
    html += '    </div>';
    html += '    <div style="flex:1;"></div>';
    html += '    <div style="border-top:1px solid rgba(255,255,255,.08);margin:10px 0 8px;"></div>';
    html += '    <div class="flex items-center gap-2">';
    html += '      <div style="width:7px;height:7px;border-radius:50%;background:' + verifyColor + ';flex-shrink:0;"></div>';
    html += '      <div style="font-size:.78rem;color:' + verifyColor + ';font-weight:600;">分配验证' + verifyText + '</div>';
    html += '    </div>';
    html += '    <div class="ov-stat-sub" style="font-size:.68rem;margin-top:3px;">用户 $' + d.balance_check.users_total_balance.toFixed(2) + ' + 预留 $' + d.balance_check.system_reserved.toFixed(2) + ' = $' + verifySum + '</div>';
    html += '  </div>';

    html += '  </div>';
    html += '</div>';

    // ── 区块2：收支统计（4列）+ 开卡统计 ──
    html += '<div class="fin-section">';
    html += '  <div class="fin-section-title">收支统计</div>';
    html += '  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;">';

    html += '  <div class="ov-stat-card" style="background:#13192a;display:flex;flex-direction:column;min-height:130px;">';
    html += '    <div class="ov-stat-label">累计充值</div>';
    html += '    <div class="ov-stat-val" style="font-size:1.2rem;color:#00c758;">$' + d.total_topup.toFixed(2) + '</div>';
    html += '    <div style="flex:1;"></div>';
    html += '    <div class="ov-stat-sub">' + d.topup.total_count + ' 笔已入账</div>';
    html += '  </div>';

    html += '  <div class="ov-stat-card" style="background:#13192a;display:flex;flex-direction:column;min-height:130px;">';
    html += '    <div class="ov-stat-label">今日充值</div>';
    html += '    <div class="ov-stat-val" style="font-size:1.2rem;color:#00f2fe;">$' + d.topup.today_approved.toFixed(2) + '</div>';
    html += '    <div style="flex:1;"></div>';
    html += '    <div class="ov-stat-sub">待审核 ' + d.topup.pending_count + ' 笔</div>';
    html += '  </div>';

    html += '  <div class="ov-stat-card" style="background:#13192a;display:flex;flex-direction:column;min-height:130px;">';
    html += '    <div class="ov-stat-label">累计费用</div>';
    html += '    <div class="ov-stat-val" style="font-size:1.2rem;color:#ffb347;">$' + d.total_fees.toFixed(2) + '</div>';
    html += '    <div style="flex:1;"></div>';
    html += '    <div class="ov-stat-sub">平台手续费收入</div>';
    html += '  </div>';

    html += '  <div class="ov-stat-card" style="background:#13192a;display:flex;flex-direction:column;min-height:130px;">';
    html += '    <div class="ov-stat-label">开卡统计</div>';
    html += '    <div class="flex" style="gap:20px;">';
    html += '      <div><span style="color:var(--text3);font-size:.85rem;">通过 </span><span style="font-size:1.2rem;font-weight:800;color:#00c758;">' + d.card_apps.approved_count + '</span></div>';
    html += '      <div><span style="color:var(--text3);font-size:.85rem;">待审 </span><span style="font-size:1.2rem;font-weight:800;color:#ffb347;">' + d.card_apps.pending_count + '</span></div>';
    html += '      <div><span style="color:var(--text3);font-size:.85rem;">拒绝 </span><span style="font-size:1.2rem;font-weight:800;color:#ff5f5f;">' + d.card_apps.rejected_count + '</span></div>';
    html += '    </div>';
    html += '    <div style="flex:1;"></div>';
    html += '    <div class="ov-stat-sub">总申请 ' + d.card_apps.total_count + ' 笔</div>';
    html += '  </div>';

    html += '  </div>';
    html += '</div>';

    // ── 区块3：用户余额分布表 ──
    html += '<div class="fin-section">';
    html += '  <div class="fin-section-title">用户余额分布</div>';
    if (d.users_balance.length === 0) {
      html += '<div class="empty-state"><div class="empty-text">暂无用户数据</div></div>';
    } else {
      html += '<div class="fin-table-wrap">';
      html += '  <div class="fin-table-head">';
      html += '    <span style="width:40px;">ID</span><span>用户</span><span style="width:100px;text-align:right;">余额</span><span style="width:100px;text-align:right;">充值</span><span style="width:100px;text-align:right;">消费</span><span style="width:90px;text-align:right;">费用</span>';
      html += '  </div>';
      d.users_balance.forEach(u => {
        html += '<div class="fin-table-row">';
        html += '  <span style="width:40px;color:var(--text3);">' + u.id + '</span>';
        html += '  <span><span style="color:var(--text1);">' + (u.name || '—') + '</span> <span style="color:var(--text3);font-size:.75rem;margin-left:6px;">' + u.email + '</span></span>';
        html += '  <span style="width:100px;text-align:right;font-weight:600;color:#00f2fe;">$' + (u.balance || 0).toFixed(2) + '</span>';
        html += '  <span style="width:100px;text-align:right;color:#00c758;">$' + (u.topup_total || 0).toFixed(2) + '</span>';
        html += '  <span style="width:100px;text-align:right;color:#ff5f5f;">$' + (u.total_spend || 0).toFixed(2) + '</span>';
        html += '  <span style="width:90px;text-align:right;color:#ffb347;">$' + (u.total_fees || 0).toFixed(2) + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    document.getElementById('financeWrap').innerHTML = html;
  } catch(e) {
    if (e.message !== 'Unauthorized') {
      document.getElementById('financeWrap').innerHTML = '<div class="empty-state"><div class="empty-text">加载失败：' + e.message + '</div></div>';
    }
  }
}

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', function() {
  // 初始化应用
  initApp();
  // 初始化粒子背景
  initParticles();

  // 移除加载骨架屏
  const splash = document.getElementById('splash');
  if (splash) {
    document.getElementById('splashBar').style.width = '100%';
    document.getElementById('splashText').textContent = '加载完成';
    setTimeout(() => { splash.style.opacity = '0'; setTimeout(() => splash.remove(), 300); }, 200);
  }
  // 保险：最多5秒后强制移除splash，防止JS报错导致遮罩不消失
  setTimeout(() => {
    const s = document.getElementById('splash');
    if (s) { s.style.opacity = '0'; setTimeout(() => s.remove(), 300); }
  }, 5000);
});
