// ══════════════════════════════════════════════
//  VCC Dashboard - New Modular Entry Point
//  新的模块化入口文件（渐进式重构）
// ══════════════════════════════════════════════

// 导入配置
import { _token, _me } from './utils/config.js';
import { api, apiFetch } from './services/api.js';
import {
  toast,
  showToast,
  Modal,
  confirmModal,
  alertModal,
  Table,
  createTable,
  Pagination,
  createPagination
} from './components/ui/index.js';
import {
  copyVal,
  togglePwd,
  focusNext,
  formatNumber,
  formatDate,
  formatCurrency,
  cardGradClass,
  CARD_STATUS_MAP,
  TX_TYPE_MAP,
  debounce,
  throttle
} from './utils/helpers.js';

// 导入业务模块
import {
  // Auth
  switchTab,
  refreshCaptcha,
  validateLoginField,
  validateRegField,
  onRegPwdInput,
  doLogin,
  doRegister,
  showAuth,
  doLogout,
  isAuthenticated,
  isAdmin,
  getCurrentUser,
  // Router
  PAGE_META,
  PAGE_NAV_MAP,
  registerPage,
  registerPages,
  gotoPage,
  refreshPage,
  getCurrentPage,
  getDefaultPage,
  initRouter,
  bindNavEvents,
  getPageMeta
} from './modules/index.js';

// 导入页面模块
import {
  renderOverview,
  renderCards,
  renderApply,
  renderTopup
} from './pages/index.js';

// ══════════════════════════════════════════════
//  注册新页面
// ══════════════════════════════════════════════

function initPages() {
  // 注册新模块化页面
  registerPages({
    'overview': renderOverview,
    'cards': renderCards,
    'apply': renderApply,
    'topup': renderTopup,
    // 其他页面仍由 app.js 处理
  });

  console.log('[VCC Dashboard] 已注册页面:', Object.keys({
    'overview': true, 'cards': true, 'apply': true, 'topup': true
  }).join(', '));
}

// ══════════════════════════════════════════════
//  全局API导出（供HTML内联事件使用）
// ══════════════════════════════════════════════

// API和服务
window.apiFetch = apiFetch;
window.api = api;

// UI组件
window.toast = toast;
window.showToast = showToast;
window.Modal = Modal;
window.confirmModal = confirmModal;
window.alertModal = alertModal;
window.Table = Table;
window.createTable = createTable;
window.Pagination = Pagination;
window.createPagination = createPagination;

// 工具函数
window.copyVal = copyVal;
window.togglePwd = togglePwd;
window.focusNext = focusNext;
window.formatNumber = formatNumber;
window.formatDate = formatDate;
window.formatCurrency = formatCurrency;
window.cardGradClass = cardGradClass;
window.CARD_STATUS_MAP = CARD_STATUS_MAP;
window.TX_TYPE_MAP = TX_TYPE_MAP;
window.debounce = debounce;
window.throttle = throttle;

// 认证模块
window.switchTab = switchTab;
window.refreshCaptcha = refreshCaptcha;
window.validateLoginField = validateLoginField;
window.validateRegField = validateRegField;
window.onRegPwdInput = onRegPwdInput;
window.doLogin = doLogin;
window.doRegister = doRegister;
window.showAuth = showAuth;
window.doLogout = doLogout;
window.isAuthenticated = isAuthenticated;
window.isAdmin = isAdmin;
window.getCurrentUser = getCurrentUser;

// 路由模块
window.PAGE_META = PAGE_META;
window.PAGE_NAV_MAP = PAGE_NAV_MAP;
window.gotoPage = gotoPage;
window.refreshPage = refreshPage;
window.getCurrentPage = getCurrentPage;
window.getDefaultPage = getDefaultPage;
window.initRouter = initRouter;
window.bindNavEvents = bindNavEvents;
window.getPageMeta = getPageMeta;
window.registerPage = registerPage;
window.registerPages = registerPages;

// 全局状态（保持与旧代码兼容）
window._token = _token;
window._me = _me;
window._curPage = getCurrentPage();

// ══════════════════════════════════════════════
//  初始化
// ══════════════════════════════════════════════

function initNew() {
  console.log('[VCC Dashboard] 新模块化系统已加载 v2.0');

  // 初始化页面注册
  initPages();

  // 添加性能监控
  if (window.performance) {
    window.addEventListener('load', () => {
      const timing = performance.timing;
      const loadTime = timing.loadEventEnd - timing.navigationStart;
      console.log(`[Performance] 页面加载时间: ${loadTime}ms`);
    });
  }

  // 全局错误处理
  window.addEventListener('error', (e) => {
    console.error('[Global Error]', e.error);
  });

  window.addEventListener('unhandledrejection', (e) => {
    console.error('[Unhandled Promise Rejection]', e.reason);
  });

  // 绑定导航事件
  bindNavEvents();

  // 如果用户已登录，初始化路由
  if (isAuthenticated()) {
    console.log('[VCC Dashboard] 用户已登录，初始化路由');
  }
}

// DOM加载完成后初始化
document.addEventListener('DOMContentLoaded', initNew);

// ══════════════════════════════════════════════
//  模块导出
// ══════════════════════════════════════════════

export {
  // API和服务
  api,
  apiFetch,
  // UI组件
  toast,
  showToast,
  Modal,
  confirmModal,
  alertModal,
  Table,
  createTable,
  Pagination,
  createPagination,
  // 工具函数
  copyVal,
  togglePwd,
  focusNext,
  formatNumber,
  formatDate,
  formatCurrency,
  cardGradClass,
  CARD_STATUS_MAP,
  TX_TYPE_MAP,
  debounce,
  throttle,
  // 认证模块
  switchTab,
  refreshCaptcha,
  validateLoginField,
  validateRegField,
  onRegPwdInput,
  doLogin,
  doRegister,
  showAuth,
  doLogout,
  isAuthenticated,
  isAdmin,
  getCurrentUser,
  // 路由模块
  PAGE_META,
  PAGE_NAV_MAP,
  registerPage,
  registerPages,
  gotoPage,
  refreshPage,
  getCurrentPage,
  getDefaultPage,
  initRouter,
  bindNavEvents,
  getPageMeta,
  // 页面模块
  renderOverview,
  renderCards,
  renderApply,
  renderTopup
};


// ═══════════════════════════════════════════════════════
//  挂载到 window（兼容旧架构）
// ═══════════════════════════════════════════════════════
window.renderOverview = renderOverview;
window.renderCards = renderCards;
window.renderApply = renderApply;
window.renderTopup = renderTopup;


// ═══════════════════════════════════════════════════════
//  覆盖 app.js 中的旧函数（确保使用新模块）
// ═══════════════════════════════════════════════════════
// 延迟执行以确保 app.js 已加载
document.addEventListener('DOMContentLoaded', () => {
  // 如果有旧函数，用新模块覆盖
  if (typeof window.renderApplyOld === 'undefined') {
    window.renderApplyOld = window.renderApply || function(){};
    window.renderApply = renderApply;
  }
  if (typeof window.renderCardsOld === 'undefined') {
    window.renderCardsOld = window.renderCards || function(){};
    window.renderCards = renderCards;
  }
  if (typeof window.renderOverviewOld === 'undefined') {
    window.renderOverviewOld = window.renderOverview || function(){};
    window.renderOverview = renderOverview;
  }
  if (typeof window.renderTopupOld === 'undefined') {
    window.renderTopupOld = window.renderTopup || function(){};
    window.renderTopup = renderTopup;
  }
  console.log('[VCC重构] 新模块已激活');
});

