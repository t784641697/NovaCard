const Database = require('better-sqlite3');
const fs = require('fs');

// Open corrupted DB
const db = new Database('/opt/vcc-hub/data/vcc.db', { fileMustExist: true });

// Check integrity
try {
  const qi = db.prepare('PRAGMA quick_check').get();
  console.log('quick_check:', JSON.stringify(qi));
} catch(e) {
  console.log('quick_check failed:', e.message);
}

try {
  const ic = db.prepare('PRAGMA integrity_check').all();
  console.log('integrity_check:', ic);
} catch(e) {
  console.log('integrity_check failed:', e.message);
}

// Create new clean DB
const db2 = new Database('/opt/vcc-hub/data/vcc_new.db');
db2.exec('PRAGMA journal_mode = DELETE');
db2.exec('PRAGMA foreign_keys = OFF');

// Copy all tables
const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
let totalRows = 0;

tables.forEach(t => {
  try {
    db2.exec(t.sql);
    const rows = db.prepare('SELECT * FROM "' + t.name + '"').all();
    if (rows.length > 0) {
      const cols = Object.keys(rows[0]);
      const placeholders = cols.map(() => '?').join(',');
      const insert = db2.prepare('INSERT INTO "' + t.name + '" (' + cols.join(',') + ') VALUES (' + placeholders + ')');
      
      const insertAll = db.transaction((rows) => {
        for (const row of rows) {
          insert.run(...cols.map(c => row[c]));
        }
      });
      insertAll(rows);
      totalRows += rows.length;
    }
    console.log(t.name + ': ' + rows.length + ' rows');
  } catch(e) {
    console.log(t.name + ' failed:', e.message);
    // Try to create table without FK constraints and retry
    try {
      const createSql = t.sql.replace(/REFERENCES\s+\([^)]*\)/gi, '');
      db2.exec(createSql);
      const rows = db.prepare('SELECT * FROM "' + t.name + '"').all();
      if (rows.length > 0) {
        const cols = Object.keys(rows[0]);
        const placeholders = cols.map(() => '?').join(',');
        const insert = db2.prepare('INSERT INTO "' + t.name + '" (' + cols.join(',') + ') VALUES (' + placeholders + ')');
        for (const row of rows) {
          insert.run(...cols.map(c => row[c]));
        }
        totalRows += rows.length;
      }
      console.log(t.name + ' (retry): ' + rows.length + ' rows');
    } catch(e2) {
      console.log(t.name + ' retry failed:', e2.message);
    }
  }
});

// Copy indexes
const indices = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").all();
indices.forEach(i => {
  try {
    db2.exec(i.sql);
  } catch(e) {
    console.log('index failed:', e.message);
  }
});

db2.exec('PRAGMA foreign_keys = ON');
db2.close();
db.close();

// Replace old DB
fs.renameSync('/opt/vcc-hub/data/vcc.db', '/opt/vcc-hub/data/vcc_corrupted_' + Date.now() + '.db');
fs.renameSync('/opt/vcc-hub/data/vcc_new.db', '/opt/vcc-hub/data/vcc.db');
console.log('DB rebuilt successfully, total rows: ' + totalRows);