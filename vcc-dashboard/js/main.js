// ══════════════════════════════════════════════
//  VCC Dashboard - Main Entry
// ══════════════════════════════════════════════

import { initApp } from './app.js';

// DOM加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  console.log('[VCC Dashboard] 应用初始化...');
  initApp();
});
