const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ 
    executablePath: '/root/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',
    headless: true 
  });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  
  page.on('console', msg => { if (msg.type() === 'error' || msg.type() === 'warn') console.log(`[${msg.type()}]`, msg.text().slice(0,150)); });
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
  
  // 2. 调扣款 - 模拟点 UI 按钮
  // 找扣款按钮并点
  const deductBtns = await page.locator('button:has-text("扣款")').count();
  console.log('扣款按钮数:', deductBtns);
  
  if (deductBtns > 0) {
    await page.locator('button:has-text("扣款")').first().click({ force: true });
    await page.waitForTimeout(800);
    
    console.log('--- 弹窗显示中？---');
    const modalVisible = await page.locator('#deductModal').isVisible();
    console.log('  弹窗可见:', modalVisible);
    
    if (modalVisible) {
      await page.fill('#deductAmountInput', '1');
      await page.fill('#deductReasonInput', 'playwright force test');
      await page.locator('#deductConfirmBtn').click();
      await page.waitForTimeout(3000);
      
      const toastText = await page.locator('#toast').textContent();
      console.log('--- TOAST:', JSON.stringify(toastText));
    }
  } else {
    // 截图看为什么没看到扣款按钮
    await page.screenshot({ path: '/tmp/admin-panel.png', fullPage: true });
    console.log('截图存 /tmp/admin-panel.png');
  }
  
  await browser.close();
})().catch(e => { console.log('FATAL:', e.message); });
