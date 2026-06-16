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
  page.on('console', msg => { if (msg.type() === 'error') console.log(`[CON.ERR]`, msg.text().slice(0,200)); });
  
  await page.goto('http://43.135.26.36/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  
  // 1. 找到表单内的登录按钮（不是 tab）
  // 表单按钮通常有 onsubmit / form
  // 看看有哪些"登 录"按钮
  const loginBtnInfo = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.map((b, i) => ({
      i, 
      text: b.textContent.trim().slice(0, 20), 
      className: b.className.slice(0, 40),
      onsubmitForm: b.form ? b.form.outerHTML.slice(0, 80) : 'no form',
      visible: b.offsetParent !== null
    })).filter(b => b.text.includes('登') || b.text.includes('录'));
  });
  console.log('--- 登 录 按钮列表 ---');
  console.log(JSON.stringify(loginBtnInfo, null, 2));
  
  // 找"表单内"的登录按钮（点击后能 submit 表单的）
  // 简化：直接用 eval 触发前端登录函数
  await page.evaluate(async () => {
    // 看下 window 上有什么登录相关函数
    const keys = Object.keys(window).filter(k => /login|auth|signin|submit|handle/i.test(k));
    console.log('login-related window keys:', keys);
    
    // 找表单的 input + button
    const formInputs = document.querySelectorAll('input[type=email], input[type=password]');
    console.log('email/password inputs count:', formInputs.length);
  });
  
  // 直接 eval: 模拟用户输入+点击表单提交按钮
  // 找到表单内的 password input（注册表单也有 password，要找登录表单的那个）
  // 登录表单：第一个 email + 第一个 password
  await page.locator('input[type="email"]').first().fill('admin@vcc.hub');
  await page.locator('input[type="password"]').first().fill('Admin@2026');
  
  // 触发 form submit
  await page.evaluate(() => {
    const emailInput = document.querySelector('input[type=email]');
    const form = emailInput.closest('form');
    console.log('email form:', form ? form.id || form.className : 'NO FORM');
    if (form) {
      // 触发 submit
      form.requestSubmit ? form.requestSubmit() : form.submit();
    } else {
      // 没 form, 直接调 fetch
      console.log('no form, calling apiFetch directly');
      window.apiFetch('/auth/login', {
        method: 'POST',
        body: { email: 'admin@vcc.hub', password: 'Admin@2026' }
      }).then(r => console.log('login result:', r));
    }
  });
  
  await page.waitForTimeout(6000);
  
  console.log('--- 登录后 ---');
  const localStorageToken = await page.evaluate(() => localStorage.getItem('vcc_token'));
  console.log('localStorage vcc_token:', localStorageToken ? 'YES (' + localStorageToken.substring(0,30) + '...)' : 'NO');
  
  // 2. 找扣款按钮
  const deductBtnCount = await page.locator('button:has-text("扣款")').count();
  console.log('扣款按钮数:', deductBtnCount);
  
  // 3. 即便没显示扣款按钮，我用 eval 模拟点
  // 看看 admin 视图渲染没
  const hasUsersSection = await page.evaluate(() => {
    return document.body.innerText.includes('用户管理') || document.body.innerText.includes('TestUser') || document.body.innerText.includes('test123');
  });
  console.log('admin 视图渲染:', hasUsersSection);
  
  if (deductBtnCount > 0) {
    await page.locator('button:has-text("扣款")').first().click();
    await page.waitForTimeout(1500);
    
    const modalVisible = await page.locator('#deductModal').isVisible();
    console.log('modal 可见:', modalVisible);
    
    if (modalVisible) {
      await page.fill('#deductAmountInput', '1');
      await page.fill('#deductReasonInput', 'playwright UI test 10');
      console.log('--- 4. 点确认扣款 ---');
      await page.locator('#deductConfirmBtn').click();
      await page.waitForTimeout(5000);
      
      const toastText = await page.locator('#toast').textContent();
      console.log('TOAST:', JSON.stringify(toastText));
    }
  } else {
    await page.screenshot({ path: '/tmp/page-after-login.png', fullPage: true });
    console.log('截图存 /tmp/page-after-login.png');
    const bodyTxt = await page.locator('body').innerText();
    console.log('--- 页面文本(前 500) ---');
    console.log(bodyTxt.slice(0, 500));
  }
  
  await browser.close();
})().catch(e => { console.log('FATAL:', e.message); });
