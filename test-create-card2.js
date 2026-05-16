/**
 * 测试：先拿产品码，再开卡
 * 运行：node test-create-card2.js
 */
require('dotenv').config();
const axios = require('axios');
const rsa   = require('./src/utils/rsaCrypto');

const BASE_URL   = process.env.VMCARDIO_BASE_URL;
const APP_ID     = process.env.VMCARDIO_APP_ID;
const APP_SECRET = process.env.VMCARDIO_APP_SECRET;

async function getToken() {
  for (let i = 0; i < 10; i++) {
    try {
      const resp = await axios.get(`${BASE_URL}/getAccessToken`, {
        params: { app_id: APP_ID, app_secret: APP_SECRET },
        timeout: 8000,
      });
      if (resp.data.code === 0) {
        console.log(`✅ Token 获取成功（第${i+1}次尝试）`);
        return resp.data.data.token;
      }
      console.log(`⏳ 第${i+1}次失败：${resp.data.msg}，1秒后重试...`);
    } catch (e) {
      console.log(`⏳ 第${i+1}次出错：${e.message}，1秒后重试...`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('多次重试后仍无法获取 Token');
}

async function apiPost(token, path, payload = {}) {
  let body, headers;

  if (Object.keys(payload).length === 0) {
    // 无 payload，content 传空字符串
    body    = { content: '' };
    headers = { 'Authorization': token, 'Content-Type': 'application/json' };
  } else {
    const content = rsa.encrypt(payload);
    body    = { content };
    headers = { 'Authorization': token, 'Content-Type': 'application/json' };
  }

  const resp = await axios.post(`${BASE_URL}${path}`, body, { headers, timeout: 15000 });
  return resp.data;
}

async function main() {
  const token = await getToken();
  console.log('   Token:', token.slice(0,8) + '...\n');

  // ── Step 1：获取可用产品码 ─────────────────────────────────────────────
  console.log('📋 Step 1：获取卡产品码...');
  const productResp = await apiPost(token, '/getProductCode');
  console.log('原始响应：', JSON.stringify(productResp, null, 2));

  if (productResp.code !== 0) {
    console.error('❌ 获取产品码失败：', productResp.msg);
    return;
  }

  let productList;
  try {
    productList = rsa.decrypt(productResp.data);
    console.log('\n✅ 产品码列表：', JSON.stringify(productList, null, 2));
  } catch(e) {
    console.log('⚠️  解密失败：', e.message, '\n   原始 data：', productResp.data);
    return;
  }

  // 取第一个储值卡（type=save）产品码
  const saveCard = (productList.list || []).find(p => p.type === 'save') || productList.list?.[0];
  if (!saveCard) {
    console.error('❌ 没有可用的卡产品码');
    return;
  }

  const productCode = saveCard.product_code;
  console.log(`\n✅ 使用产品码：${productCode} (BIN: ${saveCard.bin}, ${saveCard.network})\n`);

  // ── Step 2：开卡 ───────────────────────────────────────────────────────
  console.log('💳 Step 2：申请卡片...');

  const payload = {
    product_code: productCode,
    first_name: 'Test',
    last_name: 'User',
    amount: 10,
    label: '测试卡',
    card_address: {
      address_line_one: '123 Test Street',
      address_line_two: '',
      city: 'Hong Kong',
      state: 'HK',
      country: 'HK',
      post_code: '999077'
    },
    area_code: '+86',
    mobile: '13800138000',
    email: 'test@example.com',
  };

  const createResp = await apiPost(token, '/createCard', payload);
  console.log('原始响应：', JSON.stringify(createResp, null, 2));

  if (createResp.code !== 0) {
    console.error('❌ 开卡失败：', createResp.msg);
    return;
  }

  try {
    const result = rsa.decrypt(createResp.data);
    console.log('\n🎉 开卡成功！解密结果：', JSON.stringify(result, null, 2));
  } catch(e) {
    console.log('⚠️  解密失败：', e.message, '\n   原始 data：', createResp.data);
  }
}

main().catch(err => {
  console.error('\n💥 异常：', err.message);
  if (err.response) {
    console.error('   HTTP:', err.response.status, JSON.stringify(err.response.data));
  }
});
