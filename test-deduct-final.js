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
  
  // 1. goto
  await page.goto('http://43.135.26.36/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  
  // 2. 登录 - 用 email/password input + 找有 onsubmit 的 form 或直接调 fetch
  await page.evaluate(async () => {
    // 1. 调登录
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ email: 'admin@vcc.hub', password: 'Admin@2026' })
    });
    const j = await r.json();
    if (j.data?.token) {
      // 2. 存到 localStorage 让前端认账
      localStorage.setItem('vcc_token', j.data.token);
      localStorage.setItem('vcc_me', JSON.stringify(j.data.user || j.data));
    }
    return j;
  });
  await page.waitForTimeout(2000);
  
  // 3. 重新加载让前端读取 token
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  
  // 4. 找扣款按钮
  const deductBtnCount = await page.locator('button:has-text("扣款")').count();
  console.log('扣款按钮数:', deductBtnCount);
  
  if (deductBtnCount > 0) {
    await page.locator('button:has-text("扣款")').first().click();
    await page.waitForTimeout(1500);
    
    const modalVisible = await page.locator('#deductModal').isVisible();
    console.log('modal 可见:', modalVisible);
    
    if (modalVisible) {
      await page.fill('#deductAmountInput', '1');
      await page.fill('#deductReasonInput', 'playwright UI test 11');
      console.log('--- 4. 点确认扣款 ---');
      await page.locator('#deductConfirmBtn').click();
      await page.waitForTimeout(5000);
      
      const toastText = await page.locator('#toast').textContent();
      console.log('--- TOAST:', JSON.stringify(toastText));
    }
  } else {
    // 看下页面状态
    const bodyTxt = await page.locator('body').innerText();
    console.log('--- 页面文本 ---');
    console.log(bodyTxt.slice(0, 600));
    
    // token 在不在
    const t = await page.evaluate(() => localStorage.getItem('vcc_token'));
    console.log('--- token 在:', !!t);
  }
  
  await browser.close();
})().catch(e => { console.log('FATAL:', e.message); });
