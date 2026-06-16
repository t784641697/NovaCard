const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ 
    executablePath: '/root/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',
    headless: true 
  });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  
  page.on('console', msg => console.log(`[${msg.type()}]`, msg.text().slice(0,200)));
  page.on('pageerror', err => console.log(`[PAGEERROR]`, err.message));
  page.on('request', req => {
    if (req.url().includes('/api/')) console.log(`[REQ ${req.method()}]`, req.url().slice(-50));
  });
  page.on('response', res => {
    if (res.url().includes('/api/')) console.log(`[RES ${res.status()}]`, res.url().slice(-50));
  });
  page.on('requestfailed', req => console.log(`[REQFAIL]`, req.method(), req.url().slice(-60), '|', req.failure()?.errorText));
  
  await page.goto('http://43.135.26.36/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  
  console.log('=== 1. 登录 ===');
  await page.locator('input[type="email"]').first().fill('admin@vcc.hub');
  await page.locator('input[type="password"]').first().fill('Admin@2026');
  await page.locator('button:has-text("登 录")').first().click();
  await page.waitForTimeout(8000);
  
  console.log('=== 2. 当前 URL:', page.url());
  console.log('=== 2. 页面文本片段:');
  const txt = await page.locator('body').innerText();
  console.log(txt.slice(0, 800));
  
  await browser.close();
})().catch(e => { console.log('FATAL:', e.message); });
