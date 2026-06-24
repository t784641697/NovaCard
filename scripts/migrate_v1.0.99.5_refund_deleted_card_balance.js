/**
 * v1.0.99.5 历史数据补退：删卡后未自动退余额追回
 *
 * 背景：
 * - v1.0.99 上线删卡功能时, 我误以为 vmcardio 上游 deleteCard 会"自动退余额到用户账户"
 *   (其实只是退到我们 vmcardio 平台账户, 没退到用户在我们系统的账户)
 * - v1.0.99.1 用户口述"自动退余额" 强化了这个错误假设
 * - v1.0.99.4 实测 5258 卡 (S5258LL) 删除时, 商户余额 +$20, 用户账户余额没动 → 确认我们的代码没退
 * - v1.0.99.5 修复: DELETE 路由加 recordRefund, 主动给用户账户 +balance + 写 transactions
 *
 * 本脚本：找出所有"已删除 + available_amount > 0"的卡, 主动给用户补退
 *
 * 使用方法:
 *   node scripts/migrate_v1.0.99.5_refund_deleted_card_balance.js          # 实际执行
 *   node scripts/migrate_v1.0.99.5_refund_deleted_card_balance.js --dry-run # 模拟 (默认)
 */

const path = require('path');
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));
const db = new Database(path.join(__dirname, '..', 'data', 'vcc.db'));

const isDryRun = !process.argv.includes('--no-dry-run');

console.log('=== v1.0.99.5 历史数据补退：删卡未自动退余额追回 ===');
console.log(`模式: ${isDryRun ? '🔍 DRY-RUN（不会真改）' : '🚀 实际执行'}`);
console.log('---');

// 1. 找出所有"已删除 + available_amount > 0"的卡
const candidates = db.prepare(`
  SELECT id, card_id, card_number, user_id, product_code, available_amount, status, updated_at
  FROM cards
  WHERE status = 'deleted' AND available_amount > 0
  ORDER BY id
`).all();

console.log(`\n=== 候选卡 (status=deleted AND available_amount>0): ${candidates.length} 张 ===`);
if (candidates.length === 0) {
  console.log('✅ 无需补退，退出。');
  process.exit(0);
}
console.log(JSON.stringify(candidates, null, 2));

// 2. 检查这些卡是否已经有"删卡退款"流水 (避免重复退)
const refundTxnType = '退款';
const alreadyRefundedCardIds = db.prepare(`
  SELECT DISTINCT ref_id FROM transactions
  WHERE type = ? AND description LIKE '%删卡退款%' AND ref_id != ''
`).all(refundTxnType).map(r => r.ref_id);

console.log(`\n=== 已经退过款的 card_id 列表: ${alreadyRefundedCardIds.length} 张 ===`);
console.log(alreadyRefundedCardIds);

// 3. 过滤出真正需要补退的卡
const toRefund = candidates.filter(c => !alreadyRefundedCardIds.includes(c.card_id));
console.log(`\n=== 待补退: ${toRefund.length} 张 ===`);
if (toRefund.length === 0) {
  console.log('✅ 全部已退过，退出。');
  process.exit(0);
}

if (isDryRun) {
  console.log('\n🔍 DRY-RUN 完成, 未实际改动。加 --no-dry-run 执行实际补退。');
  toRefund.forEach(c => {
    console.log(`  - card_id=${c.card_id} user_id=${c.user_id} amount=$${c.available_amount} (${c.product_code})`);
  });
  process.exit(0);
}

// 4. 实际补退: 调 BalanceService.recordRefund
const BalanceService = require(path.join(__dirname, '..', 'src', 'services', 'balanceService'));

console.log('\n=== 开始补退 ===');
for (const c of toRefund) {
  try {
    const maskedCardNum = c.card_number ? c.card_number.replace(/\d(?=\d{4})/g, '*') : '';
    const result = BalanceService.recordRefund(
      c.user_id,
      c.available_amount,
      'card_delete_refund_v1.0.99.5_backfill',
      0,
      `[补 v1.0.99.5] ${c.card_id} ${c.product_code} ${maskedCardNum} 删卡后未自动退余额追回 $${c.available_amount.toFixed(2)} (deleted_at=${c.updated_at})`
    );
    console.log(`✅ card_id=${c.card_id} user_id=${c.user_id} refund=$${c.available_amount} txn_id=${result.transaction_id} old_balance=$${result.old_balance} → new_balance=$${result.new_balance}`);
  } catch (err) {
    console.error(`❌ card_id=${c.card_id} 补退失败: ${err.message}`);
  }
}

console.log('\n=== 完成 ===');
console.log('⚠️ 记得: 部署 v1.0.99.5 代码后, 后续删卡会自动退余额, 不用再手动补退');
process.exit(0);
