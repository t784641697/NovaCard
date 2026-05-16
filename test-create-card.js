/**
 * 测试：创建卡片
 * 运行：node test-create-card.js
 */
require('dotenv').config();
const vmcardio = require('./src/services/vmcardioSDK');

async function testCreateCard() {
  try {
    console.log('📡 正在调用 createCard...');
    
    const result = await vmcardio.createCard({
      product_code: 'VC102',
      first_name: 'Test',
      last_name: 'User',
      amount: 100,           // 开卡金额 $100
      single_limit: 50,      // 单笔限额 $50
      day_limit: 200,        // 日限额 $200
      month_limit: 500,      // 月限额 $500
      card_address: {
        addr1: '123 Test Street',
        addr2: '',
        city: 'Hong Kong',
        state: 'HK',
        country: 'HK',
        post_code: '999077'
      },
      area_code: '+86',
      mobile: '13800138000',
      email: 'test@example.com',
      label: '测试卡-VC102'
    });

    console.log('✅ 开卡成功！');
    console.log('📦 返回数据：', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('❌ 开卡失败：');
    console.error('  错误信息：', err.message);
    console.error('  VM Code：', err.vmCode);
    console.error('  VM Msg：', err.vmMsg);
  }
}

testCreateCard();
