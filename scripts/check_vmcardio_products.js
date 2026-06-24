/**
 * 查询 vmcardio 上游真实产品列表
 */
require('dotenv').config();
const sdk = require('../src/services/vmcardioSDK');

(async () => {
  try {
    console.log('查询 vmcardio 上游产品列表...\n');
    const products = await sdk.getProductCode();
    console.log('产品列表：');
    console.log(JSON.stringify(products, null, 2));
    
    // 检查 G5237OH 是否存在
    const g5237 = products.find(p => p.product_code === 'G5237OH');
    console.log('\n---');
    console.log('G5237OH 是否存在:', g5237 ? '✅ 存在' : '❌ 不存在');
    if (g5237) {
      console.log('G5237OH 详情:', JSON.stringify(g5237, null, 2));
    }
    
    // 检查其他失败的卡段
    ['G5450SU', 'S5331GL', 'G5554LC', 'VC102'].forEach(code => {
      const p = products.find(x => x.product_code === code);
      console.log(`${code}: ${p ? '✅' : '❌'}`);
    });
    
  } catch (err) {
    console.error('查询失败:', err.message);
    if (err.vmCode) {
      console.error(`vmcardio 错误码: ${err.vmCode}, 消息: ${err.vmMsg}`);
    }
  }
})();
