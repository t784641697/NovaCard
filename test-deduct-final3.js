const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ 
    executablePath: '/root/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',
    headless: true 
  });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  
  page.on('response', res => {
    if (res.url().includes('/api/')) console.log(`[RES ${res.status()}]`, res.url().slice(-60));
  });
  page.on('requestfailed', req => console.log(`[REQFAIL]`, req.url().slice(-60), '|', req.failure()?.errorText));
  page.on('pageerror', err => console.log(`[PAGEERROR]`, err.message));
  
  await page.goto('http://43.135.26.36/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  
  await page.evaluate(async () => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ email: 'admin@vcc.hub', password: 'Admin@2026' })
    });
    const j = await r.json();
    if (j.data?.token) {
      localStorage.setItem('vcc_token', j.data.token);
      localStorage.setItem('vcc_me', JSON.stringify(j.data.user || {}));
    }
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  
  // 点用户管理
  await page.locator('text=用户管理').first().click({ force: true });
  await page.waitForTimeout(3000);
  
  // 点扣款
  console.log('--- 点扣款按钮 ---');
  await page.locator('button:has-text("扣款")').first().click();
  await page.waitForTimeout(1500);
  
  // 检查 modal 是否创建（用 deductAmountInput 看）
  const modalExists = await page.locator('#deductAmountInput').count();
  console.log('扣款弹窗内 input 数量:', modalExists);
  
  if (modalExists > 0) {
    const inputVisible = await page.locator('#deductAmountInput').isVisible();
    console.log('扣款弹窗 input 可见:', inputVisible);
    
    if (inputVisible) {
      await page.fill('#deductAmountInput', '1');
      await page.fill('#deductReasonInput', 'playwright final test');
      console.log('--- 点确认扣款 ---');
      await page.locator('#deductConfirmBtn').click();
      await page.waitForTimeout(5000);
      
      const toastText = await page.locator('#toast').textContent();
      console.log('--- TOAST:', JSON.stringify(toastText));
    }
  }
  
  await browser.close();
})().catch(e => { console.log('FATAL:', e.message); });
