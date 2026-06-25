/**
 * v1.0.99.25 迁移脚本：统一历史 description 格式
 * 
 * 将补录数据统一为标准格式：
 * - 补录-充值冻结 → 申请{数量}张虚拟卡{产品名}（充值冻结$${amount}）
 * - 补录-拒绝退款 → 开卡申请（{产品名}x{数量}）被拒绝，退还开卡费+充值冻结
 * - 补录-删卡退款 → [删卡退款]{产品名}{卡号掩码}余额退还$${amount}(卡已删除)
 * 
 * 同时修复其他历史格式不统一的记录
 */

'use strict';

const path = require('path');
// 确保在项目根目录执行
process.chdir(path.resolve(__dirname, '..'));

const db = require('../src/db');

function run() {
  console.log('=== v1.0.99.25 迁移：统一 description 格式 ===\n');

  // 1. 补录-充值冻结 #18: [补 v1.0.94] 申请 #4 充值冻结 $20.00 (VC113 x 1)
  //    → 申请 1 张虚拟卡 VC113（充值冻结 $20.00）
  db.prepare('UPDATE transactions SET description = ? WHERE id = ?').run(
    '申请 1 张虚拟卡 VC113（充值冻结 $20.00）', 18
  );
  console.log('✓ #18: 补录-充值冻结 → 统一格式');

  // 2. 补录-拒绝退款 #19: [补 v1.0.94] 申请 #4 被拒绝/失败，退还开卡费+充值 $21.00 (VC113 x 1)
  //    → 开卡申请（VC113 x 1）被拒绝，退还开卡费+充值冻结
  db.prepare('UPDATE transactions SET description = ? WHERE id = ?').run(
    '开卡申请（VC113 x 1）被拒绝，退还开卡费+充值冻结', 19
  );
  console.log('✓ #19: 补录-拒绝退款 → 统一格式');

  // 3. 补录-充值冻结 #20: [补 v1.0.94] 申请 #5 充值冻结 $20.00 (G5554LC x 1)
  //    → 申请 1 张虚拟卡 G5554LC（充值冻结 $20.00）
  db.prepare('UPDATE transactions SET description = ? WHERE id = ?').run(
    '申请 1 张虚拟卡 G5554LC（充值冻结 $20.00）', 20
  );
  console.log('✓ #20: 补录-充值冻结 → 统一格式');

  // 4. 补录-删卡退款 #22: [补 v1.0.99.5] 5258 卡 (2069455464522190849) 删卡后...
  //    → [删卡退款] S5258LL **** **** **** 3750 余额退还 $20.00 (卡已删除)
  db.prepare('UPDATE transactions SET description = ? WHERE id = ?').run(
    '[删卡退款] S5258LL **** **** **** 3750 余额退还 $20.00 (卡已删除)', 22
  );
  console.log('✓ #22: 补录-删卡退款 → 统一格式');

  // 5. 旧版申请开卡 #47: 申请 1 张虚拟卡 G5554LC，每张充值 $20
  //    → 申请 1 张虚拟卡 G5554LC（开卡费 $1.00 + 充值冻结 $20.00）
  const old47 = db.prepare('SELECT description FROM transactions WHERE id = 47').get();
  if (old47 && old47.description.includes('每张充值')) {
    db.prepare('UPDATE transactions SET description = ? WHERE id = ?').run(
      '申请 1 张虚拟卡 G5554LC（开卡费 $1.00 + 充值冻结 $20.00）', 47
    );
    console.log('✓ #47: 旧版申请开卡 → 统一格式');
  }

  // 6. 修复历史"审批失败"退款记录：去掉申请号和失败原因，统一为固定文案
  const failRows = db.prepare("SELECT id, description FROM transactions WHERE description LIKE '%审批失败%'").all();
  for (const row of failRows) {
    db.prepare('UPDATE transactions SET description = ? WHERE id = ?').run(
      '开卡申请-开卡失败，退还开卡费+充值冻结', row.id
    );
    console.log(`✓ #${row.id}: 审批失败退款 → 固定文案`);
  }

  // 7. 修复历史"被拒绝"退款记录：改为统一格式（含产品名和数量）
  const rejectRows = db.prepare("SELECT id, description FROM transactions WHERE description LIKE '%被拒绝%' AND description NOT LIKE '开卡申请（%'").all();
  for (const row of rejectRows) {
    // 尝试从旧描述中提取产品名和数量
    const m = row.description.match(/(VC113|G5450SU|G5237OH|S5258LL|S5331GL|S5395PL|G5554LC|VC102)\s*x\s*(\d+)/i);
    if (m) {
      const newDesc = `开卡申请（${m[1]} x ${m[2]}）被拒绝，退还开卡费+充值冻结`;
      db.prepare('UPDATE transactions SET description = ? WHERE id = ?').run(newDesc, row.id);
      console.log(`✓ #${row.id}: 拒绝退款 → ${newDesc}`);
    } else {
      // 提取不到产品名就用通用格式
      db.prepare('UPDATE transactions SET description = ? WHERE id = ?').run(
        '开卡申请-已拒绝，退还开卡费+充值冻结', row.id
      );
      console.log(`✓ #${row.id}: 拒绝退款(无产品名) → 通用格式`);
    }
  }

  // 8. 修复充值记录去掉 USDT
  const topupRows = db.prepare("SELECT id, description FROM transactions WHERE description LIKE '%USDT%'").all();
  for (const row of topupRows) {
    const newDesc = row.description.replace(/ USDT/, '');
    db.prepare('UPDATE transactions SET description = ? WHERE id = ?').run(newDesc, row.id);
    console.log(`✓ #${row.id}: 充值去掉 USDT → ${newDesc}`);
  }

  console.log('\n=== 迁移完成 ===');
  
  // 验证
  const all = db.prepare('SELECT id, type, description FROM transactions ORDER BY id').all();
  console.log('\n--- 验证 ---');
  all.forEach(r => console.log(`#${r.id} [${r.type}] ${r.description}`));
}

run();
