// ══════════════════════════════════════════════
//  CONFIG & STATE
// ══════════════════════════════════════════════
export const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3000/api'
  : '/api';

// 全局状态（将在重构过程中逐步移除）
export let _token = localStorage.getItem('vcc_token') || null;
export let _me = JSON.parse(localStorage.getItem('vcc_me') || 'null');
export let _curPage = 'cards';

// 状态管理函数
export function setToken(token) {
  _token = token;
  if (token) {
    localStorage.setItem('vcc_token', token);
  } else {
    localStorage.removeItem('vcc_token');
  }
}

export function setMe(me) {
  _me = me;
  if (me) {
    localStorage.setItem('vcc_me', JSON.stringify(me));
  } else {
    localStorage.removeItem('vcc_me');
  }
}

export function setCurPage(page) {
  _curPage = page;
}

export function clearAuth() {
  _token = null;
  _me = null;
  localStorage.removeItem('vcc_token');
  localStorage.removeItem('vcc_me');
}

// 验证正则
export const PWD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()\-_=+\[\]{};:'",.<>/?\\|`~])[A-Za-z\d!@#$%^&*()\-_=+\[\]{};:'",.<>/?\\|`~]{8,16}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 页面元数据
export const PAGE_META = {
  overview: { title: '总览', icon: '📊', admin: false },
  cards: { title: '我的卡片', icon: '💳', admin: false },
  apply: { title: '申请卡片', icon: '✨', admin: false },
  topup: { title: '充值中心', icon: '💰', admin: false },
  cardManage: { title: '卡片管理', icon: '⚙️', admin: true },
  ledger: { title: '资金流水', icon: '📒', admin: false },
  cardTx: { title: '卡片交易', icon: '💸', admin: false },
  cardSettle: { title: '卡片结算', icon: '📋', admin: false },
  adminUsers: { title: '用户管理', icon: '👥', admin: true },
  adminDashboard: { title: '数据看板', icon: '📈', admin: true },
  feeConfig: { title: '费用设置', icon: '💵', admin: true },
  balanceDetail: { title: '余额明细', icon: '💵', admin: true },
  transactionStats: { title: '交易统计', icon: '📊', admin: true },
  cardReview: { title: '开卡审核', icon: '🔍', admin: true },
  topupReview: { title: '充值审核', icon: '💰', admin: true },
  adminSettings: { title: '系统设置', icon: '⚙️', admin: true }
};

// 页面导航映射
export const PAGE_NAV_MAP = {
  cards: ['cards', 'apply'],
  apply: ['cards', 'apply'],
  topup: ['topup'],
  ledger: ['ledger', 'cardTx', 'cardSettle'],
  cardTx: ['ledger', 'cardTx', 'cardSettle'],
  cardSettle: ['ledger', 'cardTx', 'cardSettle'],
  adminDashboard: ['adminDashboard', 'cardReview', 'topupReview', 'adminUsers', 'cardManage', 'feeConfig', 'balanceDetail', 'transactionStats', 'adminSettings'],
  cardReview: ['adminDashboard', 'cardReview', 'topupReview', 'adminUsers', 'cardManage', 'feeConfig', 'balanceDetail', 'transactionStats', 'adminSettings'],
  topupReview: ['adminDashboard', 'cardReview', 'topupReview', 'adminUsers', 'cardManage', 'feeConfig', 'balanceDetail', 'transactionStats', 'adminSettings'],
  adminUsers: ['adminDashboard', 'cardReview', 'topupReview', 'adminUsers', 'cardManage', 'feeConfig', 'balanceDetail', 'transactionStats', 'adminSettings'],
  cardManage: ['adminDashboard', 'cardReview', 'topupReview', 'adminUsers', 'cardManage', 'feeConfig', 'balanceDetail', 'transactionStats', 'adminSettings'],
  feeConfig: ['adminDashboard', 'cardReview', 'topupReview', 'adminUsers', 'cardManage', 'feeConfig', 'balanceDetail', 'transactionStats', 'adminSettings'],
  balanceDetail: ['adminDashboard', 'cardReview', 'topupReview', 'adminUsers', 'cardManage', 'feeConfig', 'balanceDetail', 'transactionStats', 'adminSettings'],
  transactionStats: ['adminDashboard', 'cardReview', 'topupReview', 'adminUsers', 'cardManage', 'feeConfig', 'balanceDetail', 'transactionStats', 'adminSettings'],
  adminSettings: ['adminDashboard', 'cardReview', 'topupReview', 'adminUsers', 'cardManage', 'feeConfig', 'balanceDetail', 'transactionStats', 'adminSettings']
};
