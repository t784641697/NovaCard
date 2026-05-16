/**
 * 初始化商户余额设置
 */
const db = require('better-sqlite3')('data/vcc.db');
const now = new Date().toISOString();

console.log('🚀 开始初始化商户余额设置...');

try {
  // 检查settings表是否存在
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get();
  if (!tables) {
    console.log('⚠️ settings表不存在，需要先运行数据库初始化');
  }
  
  // 清空现有的settings余额记录
  db.prepare("DELETE FROM settings WHERE key LIKE '%balance%' OR key LIKE '%topup%' OR key LIKE '%spend%'").run();
  
  // 准备插入语句
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value, updated_at) 
    VALUES (?, ?, ?)
  `);
  
  // 设置初始余额（基于记忆中的沙盒数据）
  const initialData = {
    'account_balance': '5000.00',           // 账户余额
    'total_topup': '5000.00',               // 累计充值
    'total_spend': '64.50',                 // 累计消费（开卡费+卡消费）
    'merchant_balance': '4935.50',          // 商户余额 = 5000 - 64.5
    'merchant_balance_last_sync': now,      // 最后同步时间
    'merchant_balance_cached': '4935.50',   // 缓存余额
    'wallet_balance': '0',                  // 额度钱包余额
    'low_balance_threshold': '100',         // 低余额阈值
  };
  
  // 插入所有设置
  for (const [key, value] of Object.entries(initialData)) {
    stmt.run(key, value, now);
  }
  
  console.log('✅ 商户余额设置已初始化：');
  console.log('  - 账户余额: $', initialData.account_balance);
  console.log('  - 累计充值: $', initialData.total_topup);
  console.log('  - 累计消费: $', initialData.total_spend);
  console.log('  - 商户余额: $', initialData.merchant_balance);
  console.log('  - 最后同步: ', now);
  
  // 验证插入结果
  const allSettings = db.prepare("SELECT key, value, updated_at FROM settings ORDER BY key").all();
  console.log('\n📊 当前settings表中的余额相关记录：');
  allSettings.forEach(row => {
    console.log(`  - ${row.key}: ${row.value} (${row.updated_at})`);
  });
  
} catch (error) {
  console.error('❌ 初始化失败:', error.message);
} finally {
  db.close();
}

console.log('\n🎉 初始化完成！');