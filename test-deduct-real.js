const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ 
    executablePath: '/root/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',
    headless: true 
  });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  
  // 全部 console + network
  page.on('console', msg => console.log(`[${msg.type()}]`, msg.text().slice(0,200)));
  page.on('pageerror', err => console.log(`[PAGEERROR]`, err.message));
  page.on('request', req => {
    if (req.url().includes('/api/')) console.log(`[REQ ${req.method()}]`, req.url().slice(-50), '| body:', req.postData()?.slice(0,80));
  });
  page.on('response', res => {
    if (res.url().includes('/api/')) console.log(`[RES ${res.status()}]`, res.url().slice(-50));
  });
  page.on('requestfailed', req => console.log(`[REQFAIL]`, req.url().slice(-60), '|', req.failure()?.errorText));
  
  await page.goto('http://43.135.26.36/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  
  // 1. 登录（直接 fetch + 存 localStorage）
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
  
  // 2. 点用户管理
  await page.locator('text=用户管理').first().click({ force: true });
  await page.waitForTimeout(3000);
  
  // 3. 给 user 充点钱（让扣款能成功），用 admin 操作
  // 用 admin topup 接口 (假设已存在)
  // 这里直接给 user 充 10
  const topupResult = await page.evaluate(async () => {
    const token = localStorage.getItem('vcc_token');
    const r = await fetch('/api/admin/users/2/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ amount: 10, reason: 'playwright seed' })
    });
    return { status: r.status, body: (await r.text()).slice(0, 200) };
  });
  console.log('--- topup result:', topupResult);
  
  // 4. 刷新用户列表
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.locator('text=用户管理').first().click({ force: true });
  await page.waitForTimeout(3000);
  
  // 5. 点扣款
  console.log('--- 5. 点扣款 ---');
  await page.locator('button:has-text("扣款")').first().click();
  await page.waitForTimeout(1500);
  
  // 6. 填金额
  await page.fill('#deductAmountInput', '1');
  await page.fill('#deductReasonInput', 'playwright real test');
  
  // 7. 点确认
  console.log('--- 7. 点确认扣款 ---');
  await page.locator('#deductConfirmBtn').click();
  await page.waitForTimeout(5000);
  
  const toastText = await page.locator('#toast').textContent();
  console.log('--- TOAST:', JSON.stringify(toastText));
  
  await browser.close();
})().catch(e => { console.log('FATAL:', e.message); });
