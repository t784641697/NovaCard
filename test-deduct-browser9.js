const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ 
    executablePath: '/root/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',
    headless: true 
  });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  
  page.on('console', msg => { if (msg.type() === 'error' || msg.type() === 'warn' || msg.text().includes('Error')) console.log(`[${msg.type()}]`, msg.text().slice(0,300)); });
  page.on('pageerror', err => console.log(`[PAGEERROR]`, err.message));
  page.on('response', res => {
    if (res.url().includes('/api/')) console.log(`[RES ${res.status()}]`, res.url().slice(-60));
  });
  page.on('requestfailed', req => console.log(`[REQFAIL]`, req.url().slice(-60), '|', req.failure()?.errorText));
  
  await page.goto('http://43.135.26.36/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  
  // 1. 登录 - 在浏览器内调 fetch 直接登录
  await page.evaluate(async () => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ email: 'admin@vcc.hub', password: 'Admin@2026' })
    });
    const j = await r.json();
    window._token = j.data.token;
    // 触发 UI 切换到 admin 视图
    if (typeof window.onLoginSuccess === 'function') window.onLoginSuccess(j.data);
  });
  await page.waitForTimeout(3000);
  
  console.log('=== 2. 找扣款按钮 ===');
  const deductBtnCount = await page.locator('button:has-text("扣款")').count();
  console.log('  扣款按钮数:', deductBtnCount);
  
  if (deductBtnCount > 0) {
    console.log('=== 3. 点扣款 ===');
    await page.locator('button:has-text("扣款")').first().click();
    await page.waitForTimeout(1500);
    
    const modalVisible = await page.locator('#deductModal').count() > 0;
    console.log('  扣款 modal 在 DOM 中:', modalVisible);
    
    if (modalVisible) {
      const isVisible = await page.locator('#deductModal').isVisible();
      console.log('  modal 可见:', isVisible);
      
      if (isVisible) {
        await page.fill('#deductAmountInput', '1');
        await page.fill('#deductReasonInput', 'playwright ui test');
        
        console.log('=== 4. 点确认扣款 ===');
        await page.locator('#deductConfirmBtn').click();
        await page.waitForTimeout(5000);
        
        const toastText = await page.locator('#toast').textContent();
        console.log('=== 5. TOAST:', JSON.stringify(toastText));
      }
    }
  }
  
  await browser.close();
})().catch(e => { console.log('FATAL:', e.message); });
