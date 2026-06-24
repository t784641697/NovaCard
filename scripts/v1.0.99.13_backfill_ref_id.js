#!/usr/bin/env node
/**
 * v1.0.99.13 历史回滚: 补全所有"删卡退款"流水的 ref_id (从 description 提取 card_number 后 4 位 → 找 cards 表 card_id)
 *
 * 背景: v1.0.99.99 deleteCard 路由调 BalanceService.recordRefund 时漏传第 6 个参数 refId,
 *       导致前端 formatLedgerCardCell 走 Path 3 fallback, 显示产品名(G5554LC) 而非卡号.
 *
 * 用法: node scripts/v1.0.99.13_backfill_ref_id.js [--dry-run]
 */
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'vcc.db');
const db = new Database(DB_PATH);
const dryRun = process.argv.includes('--dry-run');

console.log(`[v1.0.99.13] 模式: ${dryRun ? '预览' : '执行'}`);
console.log(`[v1.0.99.13] DB: ${DB_PATH}`);

// 1. 找所有 ref_id 空 + description 含 "****XXXX" 4位后缀的删卡退款流水
const targets = db.prepare(`
  SELECT t.id, t.user_id, t.type, t.fee_type, t.amount, t.description, t.ref_id
  FROM transactions t
  WHERE (t.ref_id IS NULL OR t.ref_id = '')
    AND t.description LIKE '%*%'
    AND (t.fee_type = 'card_delete_refund' OR t.description LIKE '%删卡退款%')
  ORDER BY t.id
`).all();

if (targets.length === 0) {
  console.log('[v1.0.99.13] 没有需要回滚的流水 ✅');
  process.exit(0);
}

// 2. 找所有 cards 表里的 card_id (按 card_number 后 4 位建索引)
const cards = db.prepare(`SELECT card_id, card_number, product_code FROM cards`).all();
const last4Map = {};
for (const c of cards) {
  if (c.card_number && c.card_number.length >= 4) {
    const last4 = c.card_number.slice(-4);
    if (!last4Map[last4]) last4Map[last4] = [];
    last4Map[last4].push({ card_id: c.card_id, product_code: c.product_code });
  }
}

console.log(`[v1.0.99.13] 找到 ${targets.length} 条需要回滚的流水`);

let fixed = 0, skipped = 0;
for (const t of targets) {
  const m = t.description.match(/\*+\s*(\d{4})\b/);
  if (!m) {
    console.log(`  ⏭  id=${t.id}: desc 里没找到 ****XXXX 格式, 跳过`);
    skipped++;
    continue;
  }
  const last4 = m[1];
  const candidates = last4Map[last4];
  if (!candidates || candidates.length === 0) {
    console.log(`  ⏭  id=${t.id}: last4=${last4} cards 表里找不到, 跳过`);
    skipped++;
    continue;
  }
  if (candidates.length > 1) {
    console.log(`  ⚠️  id=${t.id}: last4=${last4} 匹配到 ${candidates.length} 个候选: ${candidates.map(c=>c.card_id).join(', ')}, 跳过 (需人工判断)`);
    skipped++;
    continue;
  }
  const card = candidates[0];
  console.log(`  ✏️  id=${t.id}: user=${t.user_id} $${t.amount} desc="${t.description.slice(0,60)}..." → ref_id=${card.card_id} (${card.product_code})`);
  if (!dryRun) {
    db.prepare(`UPDATE transactions SET ref_id = ? WHERE id = ?`).run(card.card_id, t.id);
  }
  fixed++;
}

console.log(`\n[v1.0.99.13] 完成: 修复 ${fixed} 条, 跳过 ${skipped} 条`);
if (dryRun && fixed > 0) {
  console.log('[v1.0.99.13] 预览模式, 删 --dry-run 真正执行');
}

db.close();
