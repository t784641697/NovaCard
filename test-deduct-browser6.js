const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ 
    executablePath: '/root/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',
    headless: true 
  });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  
  page.on('console', msg => console.log(`[${msg.type()}]`, msg.text().slice(0,300)));
  page.on('pageerror', err => console.log(`[PAGEERROR]`, err.message));
  page.on('requestfailed', req => console.log(`[REQFAIL]`, req.method(), req.url().slice(-80), '|', req.failure()?.errorText));
  page.on('response', res => {
    if (res.url().includes('/api/')) console.log(`[RES ${res.status()}]`, res.url().slice(-80));
  });
  
  await page.goto('http://43.135.26.36/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  
  console.log('=== 1. 登录 ===');
  await page.locator('input[type="email"]').first().fill('admin@vcc.hub');
  await page.locator('input[type="password"]').first().fill('Admin@2026');
  await page.locator('button:has-text("登 录")').first().click();
  await page.waitForTimeout(5000);
  
  console.log('=== 2. 找扣款按钮 (带 force) ===');
  const deductBtnCount = await page.locator('button:has-text("扣款")').count();
  console.log('  扣款按钮数:', deductBtnCount);
  
  if (deductBtnCount === 0) {
    // 看看 admin panel 里到底什么内容
    const allText = await page.locator('body').innerText();
    console.log('--- 页面文本（前500字符）---');
    console.log(allText.slice(0, 500));
    console.log('---');
    
    // 直接查 _token 在哪
    const tokenInfo = await page.evaluate(() => {
      return {
        localStorage: Object.fromEntries(Object.entries(localStorage)),
        sessionStorage: Object.fromEntries(Object.entries(sessionStorage)),
        cookies: document.cookie,
        windowToken: window._token,
        windowTokenType: typeof window._token
      };
    });
    console.log('--- 存储信息 ---');
    console.log(JSON.stringify(tokenInfo, null, 2));
  }
  
  if (deductBtnCount > 0) {
    console.log('=== 3. 点扣款按钮 ===');
    await page.locator('button:has-text("扣款")').first().click({ force: true });
    await page.waitForTimeout(1500);
    
    const modalVisible = await page.locator('#deductModal').isVisible();
    console.log('  扣款弹窗可见:', modalVisible);
    
    if (modalVisible) {
      await page.fill('#deductAmountInput', '1');
      await page.fill('#deductReasonInput', 'playwright test 6');
      console.log('=== 4. 点确认扣款 ===');
      await page.locator('#deductConfirmBtn').click();
      await page.waitForTimeout(5000);
      
      const toastText = await page.locator('#toast').textContent();
      console.log('=== 5. TOAST 内容:', JSON.stringify(toastText));
    }
  }
  
  await browser.close();
})().catch(e => { console.log('FATAL:', e.message); });
