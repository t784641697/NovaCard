// ═══════════════════════════════════════════════════════
//  Router 模块 - 路由和页面导航
// ═══════════════════════════════════════════════════════

import { setCurPage } from '../utils/config.js';
import { isAdmin } from './Auth.js';

// 页面元数据
export const PAGE_META = {
  cards: { title: '账户总览', sub: '' },
  apply: { title: '申请开卡', sub: '选择卡段，提交开卡申请' },
  topup: { title: '充值', sub: '充值到账户余额，支持 USDT 等方式' },
  ledger: { title: '账户流水', sub: '账户资金进出记录' },
  'card-tx': { title: '卡交易记录', sub: '所有虚拟卡的交易明细' },
  'card-settle': { title: '卡结算记录', sub: '虚拟卡的结算对账记录' },
  'card-mgmt': { title: '卡片管理', sub: '查看和操作所有用户卡片' },
  'admin-dashboard': { title: '管理总览', sub: '平台数据概览' },
  'admin-users': { title: '用户管理', sub: '查看和管理平台用户' },
  'admin-fee-config': { title: '费用设置', sub: '配置全局费率，可为指定用户设置自定义费率' },
  'balance-detail': { title: '账务明细', sub: '账户资金构成、分类统计和余额趋势' },
  'admin-card-review': { title: '开卡审核', sub: '审核用户提交的开卡申请，通过后自动调用 vmcardio 开卡' },
  'admin-topup-review': { title: '充值审核', sub: '审核用户提交的充值申请，通过后自动入账用户余额' },
  'admin-settings': { title: '系统设置', sub: '配置钱包收款地址、USDT汇率等系统参数' },
  'admin-finance': { title: '财务中心', sub: '平台资金概览、用户余额分布、充值与费用统计' },
  'admin-tx-monitor': { title: '交易监控', sub: '所有用户所有卡的实时交易记录与统计' },
};

// 页面名 → nav元素id 的映射
export const PAGE_NAV_MAP = {
  'card-mgmt': ['nav-card-mgmt', 'nav-admin-cards'],
  'admin-dashboard': ['nav-admin-dashboard'],
  'admin-users': ['nav-admin-users'],
  'admin-fee-config': ['nav-admin-fee-config'],
  'admin-card-review': ['nav-admin-card-review'],
  'admin-topup-review': ['nav-admin-topup-review'],
  'admin-finance': ['nav-admin-finance'],
  'admin-tx-monitor': ['nav-admin-tx-monitor'],
  'admin-settings': ['nav-admin-settings'],
};

// 页面渲染函数映射（将在初始化时注册）
const pageRenderers = {};

/**
 * 注册页面渲染函数
 */
export function registerPage(page, renderer) {
  pageRenderers[page] = renderer;
}

/**
 * 批量注册页面
 */
export function registerPages(pages) {
  Object.assign(pageRenderers, pages);
}

/**
 * 导航到指定页面
 */
export function gotoPage(page) {
  setCurPage(page);
  localStorage.setItem('vcc_page', page);

  // 恢复 contentArea 默认样式
  const area = document.getElementById('contentArea');
  if (area) {
    area.style.paddingTop = '';
    area.style.paddingLeft = '';
    area.style.maxWidth = '';
  }

  // nav 高亮
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const navIds = PAGE_NAV_MAP[page] || ['nav-' + page];
  navIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  });

  // 更新顶部标题
  const meta = PAGE_META[page] || {};
  const topbarTitle = document.getElementById('topbarTitle');
  const topbarSub = document.getElementById('topbarSub');
  if (topbarTitle) topbarTitle.textContent = meta.title || page;
  if (topbarSub) topbarSub.textContent = meta.sub || '';

  // 滚动到顶部
  if (area?.scrollTo) {
    area.scrollTo({ top: 0 });
  }

  // 渲染页面
  const renderer = pageRenderers[page];
  if (renderer) {
    renderer();
  } else {
    console.warn(`页面 "${page}" 没有注册的渲染函数`);
    // 尝试调用全局的渲染函数（兼容旧代码）
    const globalRenderer = window[`render${page.charAt(0).toUpperCase() + page.slice(1)}`];
    if (globalRenderer) {
      globalRenderer();
    }
  }
}

/**
 * 刷新当前页面
 */
export function refreshPage() {
  const currentPage = localStorage.getItem('vcc_page') || 'cards';
  gotoPage(currentPage);
}

/**
 * 获取当前页面
 */
export function getCurrentPage() {
  return localStorage.getItem('vcc_page') || 'cards';
}

/**
 * 获取默认页面（根据用户角色）
 */
export function getDefaultPage() {
  return isAdmin() ? 'admin-dashboard' : 'cards';
}

/**
 * 初始化路由
 * 恢复上次访问的页面或跳转到默认页面
 */
export function initRouter() {
  const lastPage = localStorage.getItem('vcc_page');
  const defaultPage = getDefaultPage();

  if (lastPage && pageRenderers[lastPage]) {
    gotoPage(lastPage);
  } else {
    gotoPage(defaultPage);
  }
}

/**
 * 创建导航链接点击处理函数
 */
export function createNavHandler(page) {
  return (e) => {
    e?.preventDefault();
    gotoPage(page);
  };
}

/**
 * 绑定导航事件
 */
export function bindNavEvents() {
  document.querySelectorAll('[data-page]').forEach(el => {
    const page = el.dataset.page;
    el.addEventListener('click', createNavHandler(page));
  });
}

/**
 * 获取页面元数据
 */
export function getPageMeta(page) {
  return PAGE_META[page] || { title: page, sub: '' };
}

/**
 * 检查页面是否存在
 */
export function hasPage(page) {
  return !!pageRenderers[page] || !!PAGE_META[page];
}

/**
 * 获取所有可用页面列表
 */
export function getAvailablePages() {
  return Object.keys(PAGE_META);
}
