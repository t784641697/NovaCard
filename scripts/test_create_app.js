const db = require('../src/db/database');
const stmt = db.prepare(`INSERT INTO card_applications 
  (user_id, product_code, card_bin, topup_amount, quantity, first_name, last_name, label, fee_amount, status, created_at, updated_at) 
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))`);
stmt.run(2, 'VC102', '555671', 30, 1, 'John', 'Doe', 'test-card', 3);
const id = db.prepare('SELECT last_insert_rowid() as id').get();
console.log('Created app id:', id.id);