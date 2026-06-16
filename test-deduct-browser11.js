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
  page.on('console', msg => console.log(`[${msg.type()}]`, msg.text().slice(0,300)));
  page.on('pageerror', err => console.log(`[PAGEERROR]`, err.message));
  
  await page.goto('http://43.135.26.36/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  
  // 找到真正的登录按钮 - 看 onclick
  const btnInfo = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.map((b, i) => {
      const onclick = b.getAttribute('onclick') || 'no-onclick';
      return {
        i,
        text: b.textContent.trim().slice(0, 20),
        onclick: onclick.slice(0, 100),
        className: b.className.slice(0, 60)
      };
    }).filter(b => b.text.includes('登') || b.text.includes('录') || b.onclick !== 'no-onclick');
  });
  console.log('--- 按钮 onclick ---');
  console.log(JSON.stringify(btnInfo, null, 2));
  
  // 找到"登 录"提交按钮 (button[2] = btn-primary btn-block)
  console.log('--- 直接点 button[2] ---');
  await page.locator('input[type="email"]').first().fill('admin@vcc.hub');
  await page.locator('input[type="password"]').first().fill('Admin@2026');
  
  // button[2] = submit 按钮
  const submitBtn = page.locator('button.btn-primary').first();
  await submitBtn.click();
  await page.waitForTimeout(8000);
  
  console.log('--- 登录后 localStorage ---');
  const token = await page.evaluate(() => ({
    vcc_token: localStorage.getItem('vcc_token')?.substring(0,30),
    vcc_me: localStorage.getItem('vcc_me'),
    hasAdmin: !!document.querySelector('[class*="admin"], [id*="admin"]')
  }));
  console.log(JSON.stringify(token, null, 2));
  
  // 等 admin 视图
  await page.waitForTimeout(3000);
  
  // 找扣款按钮
  const deductBtnCount = await page.locator('button:has-text("扣款")').count();
  console.log('--- 扣款按钮数:', deductBtnCount);
  
  if (deductBtnCount > 0) {
    await page.locator('button:has-text("扣款")').first().click();
    await page.waitForTimeout(1500);
    
    const modalVisible = await page.locator('#deductModal').isVisible();
    console.log('modal 可见:', modalVisible);
    
    if (modalVisible) {
      await page.fill('#deductAmountInput', '1');
      await page.fill('#deductReasonInput', 'playwright UI 11');
      console.log('--- 点确认扣款 ---');
      await page.locator('#deductConfirmBtn').click();
      await page.waitForTimeout(5000);
      
      const toastText = await page.locator('#toast').textContent();
      console.log('--- TOAST:', JSON.stringify(toastText));
    }
  } else {
    const bodyTxt = await page.locator('body').innerText();
    console.log('--- 登录后页面文本(前 400) ---');
    console.log(bodyTxt.slice(0, 400));
  }
  
  await browser.close();
})().catch(e => { console.log('FATAL:', e.message); });
