const { chromium } = require('playwright');
(async () => {
  // 用生产 IP 但**直接 fetch 的 page** → 模拟真实用户浏览器
  const browser = await chromium.launch({ 
    executablePath: '/root/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',
    headless: true 
  });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  
  // 收集 console + network
  page.on('console', msg => console.log(`[CONSOLE.${msg.type()}]`, msg.text()));
  page.on('pageerror', err => console.log(`[PAGEERROR]`, err.message));
  page.on('requestfailed', req => console.log(`[REQFAIL]`, req.method(), req.url(), '|', req.failure()?.errorText));
  page.on('response', res => {
    if (res.url().includes('/api/')) console.log(`[RES]`, res.status(), res.url());
  });
  
  // 1. 打开首页
  console.log('--- 1. 打开 http://43.135.26.36/ ---');
  await page.goto('http://43.135.26.36/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('--- 当前 URL:', page.url(), '---');
  
  // 2. 登录
  console.log('--- 2. 登录 admin ---');
  // 找登录按钮
  const loginExists = await page.locator('button:has-text("登录")').count();
  console.log('  登录按钮数量:', loginExists);
  if (loginExists > 0) {
    // 找 input
    await page.fill('input[type="email"]', 'admin@vcc.hub');
    await page.fill('input[type="password"]', 'Admin@2026');
    // 触发登录
    const loginBtn = await page.locator('button:has-text("登录")').first();
    await loginBtn.click();
    await page.waitForTimeout(2000);
  }
  
  // 3. 找用户管理
  console.log('--- 3. 找用户管理菜单 ---');
  const userMenu = page.locator('text=用户管理').first();
  if (await userMenu.count() > 0) {
    await userMenu.click();
    await page.waitForTimeout(1000);
  }
  
  // 4. 找"扣款"按钮
  console.log('--- 4. 找扣款按钮 ---');
  const deductBtns = await page.locator('button:has-text("扣款")').count();
  console.log('  扣款按钮数:', deductBtns);
  
  if (deductBtns > 0) {
    // 点击第一个用户的扣款
    await page.locator('button:has-text("扣款")').first().click();
    await page.waitForTimeout(500);
    
    // 5. 弹窗应该已打开，输入金额和原因
    console.log('--- 5. 输入金额+原因 ---');
    await page.fill('#deductAmountInput', '1');
    await page.fill('#deductReasonInput', 'browser test');
    
    // 6. 点击"确认扣款"
    console.log('--- 6. 点击确认扣款 ---');
    await page.locator('#deductConfirmBtn').click();
    await page.waitForTimeout(2000);
    
    // 7. 看弹出的 toast 文字
    const toastText = await page.locator('#toast').textContent();
    console.log('--- TOAST:', JSON.stringify(toastText));
  }
  
  await page.screenshot({ path: '/tmp/deduct-test.png', fullPage: true });
  console.log('--- 截图已存 /tmp/deduct-test.png ---');
  
  await browser.close();
})().catch(e => { console.log('FATAL:', e.message); process.exit(1); });
