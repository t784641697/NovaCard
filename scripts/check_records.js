const db = require('./src/db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log("=== 所有表 ===");
tables.forEach(t => console.log(t.name));

console.log("\n=== 用户2在各表的数据量 ===");
tables.forEach(t => {
  const cols = db.prepare("PRAGMA table_info(?)").all(t.name).map(c => c.name);
  if (cols.includes("user_id")) {
    const cnt = db.prepare("SELECT COUNT(*) as c FROM \"" + t.name + "\" WHERE user_id=2").get();
    console.log(t.name + ": " + cnt.c + " 条");
  }
});