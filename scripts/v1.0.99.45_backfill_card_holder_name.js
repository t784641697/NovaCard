/**
 * v1.0.99.45 回填脚本：从 card_applications 表把 first_name/last_name 写入 cards 表
 * 用法: node scripts/v1.0.99.45_backfill_card_holder_name.js
 */
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.resolve(__dirname, '../data/vcc.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = DELETE');

// 查所有 cards 表中 first_name 为空或 NULL 的卡
const cards = db.prepare(`
  SELECT c.id, c.card_id, c.first_name, c.last_name
  FROM cards c
  WHERE c.first_name IS NULL OR c.first_name = '' OR c.last_name IS NULL OR c.last_name = ''
`).all();

console.log(`需要回填的卡片: ${cards.length} 张`);

if (cards.length === 0) {
  console.log('无需回填，退出');
  process.exit(0);
}

const updateStmt = db.prepare(`
  UPDATE cards SET first_name = ?, last_name = ?, updated_at = ? WHERE id = ?
`);

let updated = 0;
const now = new Date().toISOString();

const tx = db.transaction(() => {
  for (const card of cards) {
    // 通过 card_id 关联 card_applications（card_applications.card_id 可能是逗号分隔的多 card_id）
    const app = db.prepare(`
      SELECT first_name, last_name
      FROM card_applications
      WHERE card_id LIKE '%' || ? || '%'
         OR card_id = ?
      ORDER BY id DESC LIMIT 1
    `).get(card.card_id, card.card_id);

    if (app && (app.first_name || app.last_name)) {
      updateStmt.run(app.first_name || '', app.last_name || '', now, card.id);
      updated++;
      console.log(`  ✓ card_id=${card.card_id} → ${app.first_name} ${app.last_name}`);
    } else {
      console.log(`  ⚠ card_id=${card.card_id} → 无匹配申请记录，跳过`);
    }
  }
});

tx();
console.log(`\n回填完成: ${updated}/${cards.length} 张卡片已更新`);
