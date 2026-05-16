// ══════════════════════════════════════════════
//  通用工具函数
// ══════════════════════════════════════════════

/**
 * 复制文本到剪贴板
 */
export async function copyVal(val) {
  try {
    await navigator.clipboard.writeText(val);
    return true;
  } catch (e) {
    return fallbackCopy(val);
  }
}

/**
 * 降级复制方案（兼容旧浏览器）
 */
function fallbackCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch (e) {
    document.body.removeChild(textarea);
    return false;
  }
}

/**
 * 切换密码输入框显示
 */
export function togglePwd(inputId, icon) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPwd = input.type === 'password';
  input.type = isPwd ? 'text' : 'password';
  icon.textContent = isPwd ? '🙈' : '👁';
  icon.style.opacity = isPwd ? '0.9' : '0.6';
}

/**
 * 聚焦下一个输入框
 */
export function focusNext(id) {
  const el = document.getElementById(id);
  if (el) el.focus();
}

/**
 * 数字千分位格式化
 */
export function formatNumber(num, decimals = 2) {
  if (num === null || num === undefined || isNaN(num)) return '-';
  return Number(num).toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 格式化日期
 */
export function formatDate(date, format = 'YYYY-MM-DD HH:mm:ss') {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '-';

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');

  return format
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds);
}

/**
 * 格式化相对时间
 */
export function timeAgo(date) {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diff = now - d;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 30) return formatDate(date, 'YYYY-MM-DD');
  if (days > 0) return `${days}天前`;
  if (hours > 0) return `${hours}小时前`;
  if (minutes > 0) return `${minutes}分钟前`;
  return '刚刚';
}

/**
 * 防抖函数
 */
export function debounce(fn, delay = 300) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * 节流函数
 */
export function throttle(fn, limit = 300) {
  let inThrottle = false;
  return function (...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * 生成随机ID
 */
export function generateId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).substr(2, 9)}_${Date.now()}`;
}

/**
 * 安全地获取嵌套对象属性
 */
export function get(obj, path, defaultValue = null) {
  const keys = path.split('.');
  let result = obj;
  for (const key of keys) {
    if (result == null || typeof result !== 'object') return defaultValue;
    result = result[key];
  }
  return result !== undefined ? result : defaultValue;
}

/**
 * 卡片状态样式映射
 */
export const CARD_STATUS_MAP = {
  'active': { label: '正常', color: '#00c758', bg: 'rgba(0,199,88,.12)' },
  'frozen': { label: '已冻结', color: '#ff5f5f', bg: 'rgba(255,95,95,.12)' },
  'inactive': { label: '失效', color: '#94a3b8', bg: 'rgba(148,163,184,.12)' }
};

/**
 * 交易类型映射
 */
export const TX_TYPE_MAP = {
  'recharge': { label: '充值', color: '#00c758', icon: '💰' },
  'consumption': { label: '消费', color: '#ff5f5f', icon: '💸' },
  'refund': { label: '退款', color: '#00c758', icon: '↩️' },
  'fee': { label: '手续费', color: '#ffb347', icon: '💵' },
  'settle': { label: '结算', color: '#7eb8f7', icon: '📋' }
};

/**
 * 计算渐变类名（用于卡片视觉效果）
 */
export function cardGradClass(index) {
  const classes = [
    'linear-gradient(135deg,#667eea 0%,#764ba2 100%)',
    'linear-gradient(135deg,#f093fb 0%,#f5576c 100%)',
    'linear-gradient(135deg,#4facfe 0%,#00f2fe 100%)',
    'linear-gradient(135deg,#43e97b 0%,#38f9d7 100%)',
    'linear-gradient(135deg,#fa709a 0%,#fee140 100%)',
    'linear-gradient(135deg,#30cfd0 0%,#330867 100%)'
  ];
  return classes[index % classes.length];
}

/**
 * 金额格式化（带货币符号）
 */
export function formatCurrency(amount, currency = '$') {
  if (amount === null || amount === undefined || isNaN(amount)) return `${currency}0.00`;
  return `${currency}${formatNumber(amount)}`;
}
