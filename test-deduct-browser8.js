const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ 
    executablePath: '/root/.cache/ms-playwright/chromium-1161/chrome-linux/chrome',
    headless: true 
  });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  
  page.on('response', res => {
    if (res.url().includes('/api/')) console.log(`[RES ${res.status()}]`, res.url().slice(-50));
  });
  page.on('requestfailed', req => console.log(`[REQFAIL]`, req.url().slice(-60), '|', req.failure()?.errorText));
  
  await page.goto('http://43.135.26.36/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  
  // 用 page.evaluate 在浏览器内执行 fetch，模拟用户点扣款
  const result = await page.evaluate(async () => {
    try {
      // 1. 登录
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ email: 'admin@vcc.hub', password: 'Admin@2026' })
      });
      const loginJson = await loginRes.json();
      const token = loginJson.data?.token;
      if (!token) return { step: 'login', json: loginJson };
      
      // 2. 调扣款
      const deductRes = await fetch('/api/admin/users/2/deduct', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ amount: 1, reason: 'in-browser fetch test' })
      });
      const deductJson = await deductRes.json();
      return { 
        step: 'deduct',
        login: { code: loginJson.code },
        deduct: { code: deductJson.code, msg: deductJson.msg, data: deductJson.data }
      };
    } catch (e) {
      return { error: e.name + ': ' + e.message };
    }
  });
  console.log('=== 结果 ===');
  console.log(JSON.stringify(result, null, 2));
  
  await browser.close();
})().catch(e => { console.log('FATAL:', e.message); });
