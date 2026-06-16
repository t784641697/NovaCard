const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ 
    executablePath: '/root/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',
    headless: true 
  });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  
  page.on('console', msg => { if (msg.type() === 'error' || msg.type() === 'warn') console.log(`[${msg.type()}]`, msg.text().slice(0,150)); });
  page.on('pageerror', err => console.log(`[PAGEERROR]`, err.message));
  page.on('requestfailed', req => console.log(`[REQFAIL]`, req.method(), req.url().slice(-80), '|', req.failure()?.errorText));
  page.on('response', res => {
    if (res.url().includes('/api/')) console.log(`[RES ${res.status()}]`, res.url().slice(-80));
  });
  
  await page.goto('http://43.135.26.36/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  
  // 1. 登录
  await page.locator('input[type="email"]').first().fill('admin@vcc.hub');
  await page.locator('input[type="password"]').first().fill('Admin@2026');
  await page.locator('button:has-text("登 录")').first().click();
  await page.waitForTimeout(6000);
  
  // 2. 看页面状态
  const bodyHTML = await page.locator('body').innerHTML();
  const hasAdminPanel = bodyHTML.includes('管理总览') || bodyHTML.includes('用户管理') || bodyHTML.includes('卡片管理');
  console.log('--- admin panel rendered?', hasAdminPanel);
  
  // 3. 直接从 JS 内部调扣款（绕过 UI）
  const deductResult = await page.evaluate(async () => {
    // 调内部 apiFetch
    const token = localStorage.getItem('vcc_token') || localStorage.getItem('token') || window._token;
    if (!token) {
      // 试所有可能的 token 存储位置
      const keys = Object.keys(localStorage);
      return { error: 'no token found', localStorage_keys: keys };
    }
    
    try {
      const res = await fetch('/api/admin/users/2/deduct', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ amount: 1, reason: 'in-browser eval test' })
      });
      const txt = await res.text();
      return { status: res.status, body: txt };
    } catch (e) {
      return { error: e.name + ': ' + e.message };
    }
  });
  console.log('--- 浏览器内 fetch /api/admin/users/2/deduct 结果:');
  console.log(JSON.stringify(deductResult, null, 2));
  
  await browser.close();
})().catch(e => { console.log('FATAL:', e.message); });
