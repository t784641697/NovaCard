/**
 * 测试 vmcardio 商户余额获取
 */

require('dotenv').config();
const sdk = require('./src/services/vmcardioSDK');

async function testVmcardioBalance() {
  console.log('🔍 开始测试 vmcardio 商户余额获取...');
  
  // 检查环境变量
  console.log('📋 环境变量检查:');
  console.log('- VMCARDIO_APP_ID:', process.env.VMCARDIO_APP_ID ? '已设置' : '未设置');
  console.log('- VMCARDIO_APP_SECRET:', process.env.VMCARDIO_APP_SECRET ? '已设置' : '未设置');
  console.log('- VMCARDIO_BASE_URL:', process.env.VMCARDIO_BASE_URL);
  
  try {
    console.log('\n🚀 调用 getAccountBalance()...');
    const result = await sdk.getAccountBalance();
    console.log('✅ 余额获取成功:');
    console.log('- Balance:', result.balance);
    console.log('- Wallet Balance:', result.wallet_balance || 'N/A');
    console.log('- Full response:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('❌ 余额获取失败:', error.message);
    if (error.vmCode) {
      console.error('- vmcardio 错误码:', error.vmCode);
      console.error('- vmcardio 错误信息:', error.vmMsg);
    }
    console.error('- 堆栈:', error.stack);
  }
}

// 运行测试
testVmcardioBalance().catch(console.error);