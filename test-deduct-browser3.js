const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ 
    executablePath: '/root/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',
    headless: true 
  });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  
  page.on('console', msg => { if (msg.type() === 'error') console.log(`[CONSOLE.${msg.type()}]`, msg.text().slice(0,200)); });
  page.on('pageerror', err => console.log(`[PAGEERROR]`, err.message));
  page.on('requestfailed', req => console.log(`[REQFAIL]`, req.method(), req.url().slice(-80), '|', req.failure()?.errorText));
  page.on('response', res => {
    if (res.url().includes('/api/')) console.log(`[RES ${res.status()}]`, res.url().slice(-80));
  });
  
  console.log('--- 1. 打开 http://43.135.26.36/ ---');
  await page.goto('http://43.135.26.36/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  
  console.log('--- 2. 填表登录 ---');
  // input[0] = email, input[1] = password
  await page.locator('input[type="email"]').first().fill('admin@vcc.hub');
  await page.locator('input[type="password"]').first().fill('Admin@2026');
  await page.locator('button:has-text("登 录")').first().click();
  await page.waitForTimeout(3000);
  
  console.log('--- 3. 导航到用户管理 ---');
  // 用户管理菜单项
  await page.evaluate(() => {
    // 找所有菜单项, 模拟点击
    const items = document.querySelectorAll('[onclick*="showSection"], [onclick*="users"], [data-section]');
    items.forEach(el => console.log('  menu:', el.textContent?.slice(0,20)));
  });
  
  // 试着找侧边栏用户管理
  const userMenu = page.locator('text=用户管理').first();
  await userMenu.click({ force: true });
  await page.waitForTimeout(2000);
  
  console.log('--- 4. 找扣款按钮 ---');
  const deductBtns = await page.locator('button:has-text("扣款")').count();
  console.log('  扣款按钮数:', deductBtns);
  
  if (deductBtns > 0) {
    await page.locator('button:has-text("扣款")').first().click();
    await page.waitForTimeout(500);
    
    console.log('--- 5. 填金额+原因 ---');
    await page.fill('#deductAmountInput', '1');
    await page.fill('#deductReasonInput', 'playwright browser test');
    
    console.log('--- 6. 点确认扣款 ---');
    await page.locator('#deductConfirmBtn').click();
    await page.waitForTimeout(3000);
    
    const toastText = await page.locator('#toast').textContent();
    console.log('--- TOAST:', JSON.stringify(toastText));
  }
  
  await browser.close();
})().catch(e => { console.log('FATAL:', e.message); });
