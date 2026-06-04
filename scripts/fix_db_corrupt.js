/**
 * SQLite 数据库损坏修复
 * 执行 WAL checkpoint + VACUUM + 完整性检查
 */
const db = require('./src/db');

console.log("=== 修复数据库损坏 ===");

// 1. 强行完成 WAL checkpoint
const cp = db.pragma("wal_checkpoint(TRUNCATE)");
console.log("checkpoint:", JSON.stringify(cp));

// 2. 完整性检查
const ck1 = db.pragma("integrity_check");
console.log("修复前完整性:", JSON.stringify(ck1));

// 3. VACUUM 重建数据库
try {
  console.log("正在 VACUUM...");
  // VACUUM 需要切换到非 WAL 模式
  db.exec("PRAGMA journal_mode=DELETE");
  db.exec("VACUUM");
  db.exec("PRAGMA journal_mode=WAL");
  console.log("VACUUM 完成");
} catch(e) {
  console.log("VACUUM 失败:", e.message);
  // 试试只 REINDEX
  db.exec("REINDEX");
  console.log("REINDEX 完成");
}

// 4. 再次完整性检查
const ck2 = db.pragma("integrity_check");
console.log("修复后完整性:", JSON.stringify(ck2));

// 5. 简单测试
try {
  const test = db.prepare("SELECT COUNT(*) as c FROM users").get();
  console.log("测试查询:", test.c, "users");
} catch(e) {
  console.log("测试查询失败:", e.message);
}

console.log("=== 数据库修复完成 ===");