#!/usr/bin/env node
// 一次性脚本: 用 SDK cardDetail 拉真上游余额, 写回 DB
// 用法: node scripts/_sync_one_card.js <card_id>
require('dotenv').config();
const path = require('path');
process.chdir('/opt/vcc-hub');
require('dotenv').config({ path: '/opt/vcc-hub/.env' });

const sdk = require('/opt/vcc-hub/src/services/vmcardioSDK');
const Database = require('better-sqlite3');

(async () => {
  const cardId = process.argv[2];
  if (!cardId) { console.error('Usage: node _sync_one_card.js <card_id>'); process.exit(2); }
  const db = new Database('/opt/vcc-hub/data/vcc.db');
  const sdkInstance = require('/opt/vcc-hub/src/services/vmcardioSDK');
  try {
    const detail = await sdk.cardDetail(cardId);
    console.log('UPSTREAM available_amount =', detail.available_amount);
    const now = new Date().toISOString();
    const r = db.prepare(`UPDATE cards SET available_amount=?, last_verified=?, verified_status='verified', updated_at=? WHERE card_id=?`)
      .run(detail.available_amount, now, now, cardId);
    console.log('DB rows updated =', r.changes);
    const after = db.prepare(`SELECT available_amount, last_verified, verified_status FROM cards WHERE card_id=?`).get(cardId);
    console.log('DB_AFTER =', JSON.stringify(after));
  } catch (e) {
    console.error('ERR:', e.message);
    process.exit(1);
  } finally {
    db.close();
  }
})();
