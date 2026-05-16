// ═══════════════════════════════════════════════════════
//  Modules 索引 - 业务模块统一导出
// ═══════════════════════════════════════════════════════

// 认证模块
export {
  switchTab,
  refreshCaptcha,
  validateLoginField,
  validateRegField,
  onRegPwdInput,
  doLogin,
  doRegister,
  showAuth,
  doLogout,
  getCaptchaToken,
  isAuthenticated,
  isAdmin,
  getCurrentUser
} from './Auth.js';

// 路由模块
export {
  PAGE_META,
  PAGE_NAV_MAP,
  registerPage,
  registerPages,
  gotoPage,
  refreshPage,
  getCurrentPage,
  getDefaultPage,
  initRouter,
  createNavHandler,
  bindNavEvents,
  getPageMeta,
  hasPage,
  getAvailablePages
} from './Router.js';
