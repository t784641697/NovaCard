#!/usr/bin/env node

const db = require('better-sqlite3')('data/vcc.db');

console.log('🔄 更新商户余额数据（基于真实vmcardio沙盒数据）\n');

// 基于您提供的真实数据
const merchantBalance = 4922.5;      // 商户余额
const cardBalance = 70;             // 卡内余额（5张卡）
const totalTopup = 5000;            // 累积入金
const totalSpend = totalTopup - merchantBalance - cardBalance; // 计算总消费

console.log('📊 真实vmcardio沙盒数据：');
console.log(`  商户余额: $${merchantBalance}`);
console.log(`  卡内余额: $${cardBalance}（5张卡）`);
console.log(`  累积入金: $${totalTopup}`);
console.log(`  总消费: $${totalSpend}（开卡费$1.5/张 × 5张 = $7.5）\n`);

const now = new Date().toISOString();

// 更新设置表
const updateSettings = db.prepare(`
  INSERT OR REPLACE INTO settings (key, value, updated_at) 
  VALUES (?, ?, ?)
`);

const settingsUpdates = [
  ['account_balance', merchantBalance.toString(), now],
  ['total_topup', totalTopup.toString(), now],
  ['total_spend', totalSpend.toString(), now],
  ['merchant_balance', merchantBalance.toString(), now],
  ['merchant_balance_cached', merchantBalance.toString(), now],
  ['merchant_balance_last_sync', now, now]
];

console.log('🔧 更新设置表...');
settingsUpdates.forEach(([key, value, timestamp]) => {
  updateSettings.run(key, value, timestamp);
});

// 我们需要先同步vmcardio卡片数据
console.log('\n📋 需要从vmcardio同步的卡片数据：');
console.log('  卡片数量: 5张');
console.log('  卡内余额总额: $70');
console.log('  平均每卡余额: $14');

// 计算卡内余额分布（假设平均分布）
const cards = [
  { card_id: 'XR2037150794163163136', available_amount: 30 },
  { card_id: 'XR2037152474518786048', available_amount: 10 },
  { card_id: 'XR2037028791028551680', available_amount: 10 },
  { card_id: 'XR2037029991028551680', available_amount: 10 },
  { card_id: 'XR2037030791028551680', available_amount: 10 }
];

console.log('\n📊 卡内余额分布（假设）：');
cards.forEach((card, index) => {
  console.log(`  卡${index + 1}: ${card.card_id.substring(0, 10)}... 余额: $${card.available_amount}`);
});

console.log('\n✅ 设置表更新完成！');
console.log('\n📋 下一步需要：');
console.log('  1. 运行 vmcardio 同步脚本（需要调用API）');
console.log('  2. 或者手动添加卡片数据到 cards 表');
console.log('  3. 重启后端服务');

db.close();