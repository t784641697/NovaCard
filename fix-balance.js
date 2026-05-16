#!/usr/bin/env node

const db = require('better-sqlite3')('data/vcc.db');

// 基于真实vmcardio数据
const merchantBalance = 4922.5;      // 商户余额
const cardBalance = 70;             // 卡内余额（5张卡）
const totalTopup = 5000;            // 累积入金
const totalSpend = totalTopup - merchantBalance - cardBalance; // 计算总消费

console.log('📊 更新服务器数据以匹配真实vmcardio沙盒：');
console.log(`  商户余额: $${merchantBalance}`);
console.log(`  卡内余额: $${cardBalance}（5张卡）`);
console.log(`  累积入金: $${totalTopup}`);
console.log(`  总消费: $${totalSpend}（开卡费$1.5/张 × 5张 = $7.5）\n`);

const now = new Date().toISOString();
const updateSettings = db.prepare(`
  INSERT OR REPLACE INTO settings (key, value, updated_at) 
  VALUES (?, ?, ?)
`);

const updates = [
  ['account_balance', merchantBalance.toString(), now],
  ['total_topup', totalTopup.toString(), now],
  ['total_spend', totalSpend.toString(), now],
  ['merchant_balance', merchantBalance.toString(), now],
  ['merchant_balance_cached', merchantBalance.toString(), now],
  ['merchant_balance_last_sync', now, now]
];

updates.forEach(([key, value, timestamp]) => {
  updateSettings.run(key, value, timestamp);
  console.log(`  ✅ 更新 ${key}: ${value}`);
});

console.log('\n✅ 商户余额设置更新完成！');
db.close();