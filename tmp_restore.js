const db = require('better-sqlite3')('./data/vcc.db');

const count = db.prepare('SELECT COUNT(*) as t FROM cards').get();
console.log('Server current cards:', count.t);

if (count.t === 0) {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO cards (card_id, user_id, card_number, status, available_amount, created_at, updated_at, last_verified, verified_status) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'), 'pending')"
  );
  const cards = [
    ['XR2037152474518786048', 2, '1111111262391666', 'active', 1000],
    ['XR2037032795875827712', 2, '1111111502734022', 'cancelled', 0],
    ['XR2037028791028551680', 2, '1111114951614307', 'active', 500]
  ];
  for (const c of cards) {
    insert.run(c[0], c[1], c[2], c[3], c[4]);
  }
  const after = db.close();
}

const db2 = require('better-sqlite3')('./data/vcc.db');
const after = db2.prepare('SELECT COUNT(*) as t FROM cards').get();
console.log('After re-insert:', after.t, 'cards');
db2.close();