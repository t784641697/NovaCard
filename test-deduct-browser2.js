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
  page.on('requestfailed', req => console.log(`[REQFAIL]`, req.method(), req.url().slice(-80), '|', req.failure()?.errorText));
  page.on('response', res => {
    if (res.url().includes('/api/')) console.log(`[RES ${res.status()}]`, res.url().slice(-80));
  });
  
  console.log('--- goto http://43.135.26.36/ ---');
  await page.goto('http://43.135.26.36/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  
  console.log('--- 当前 URL:', page.url());
  console.log('--- 页面 title:', await page.title());
  console.log('--- 是否有登录 tab ---');
  const tabs = await page.locator('text=登录').count();
  console.log('  登录字样数:', tabs);
  
  // 试着找所有 input
  const inputs = await page.locator('input').count();
  console.log('  input 数:', inputs);
  for (let i = 0; i < inputs; i++) {
    const ph = await page.locator('input').nth(i).getAttribute('placeholder');
    const type = await page.locator('input').nth(i).getAttribute('type');
    console.log(`    input[${i}] type=${type} placeholder=${ph}`);
  }
  
  // 找登录按钮（点击 tab 文字）
  const allBtns = await page.locator('button').count();
  console.log('  按钮数:', allBtns);
  for (let i = 0; i < allBtns; i++) {
    const txt = await page.locator('button').nth(i).textContent();
    if (txt && txt.trim()) console.log(`    btn[${i}]: "${txt.trim()}"`);
  }
  
  await browser.close();
})().catch(e => { console.log('FATAL:', e.message); });
