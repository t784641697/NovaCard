const db = require("../src/db");

console.log("=== 修复用户#3余额 ===");
console.log("当前余额:", db.prepare("SELECT balance FROM users WHERE id=3").get().balance);

// 1. 修正管理员扣款 #24: $50 → $30 (只扣幽灵充值$30, 不扣合法退款$20)
const fix1 = db.prepare("UPDATE transactions SET amount = -30, description = '管理员扣款：修正异常抵扣（原$50→$30，仅扣幽灵充值$30，保留合法退款$20）' WHERE id = 24 AND user_id = 3");
fix1.run();
console.log("✓ #24 管理员扣款: -$50 → -$30");

// 2. 修正补录退款 #89: $21 → $20 (删卡只退available_amount, 不含开卡费)
const fix2 = db.prepare("UPDATE transactions SET amount = 20, description = '补录退款：卡已删除，退还卡内余额（不含开卡费）' WHERE id = 89 AND user_id = 3");
fix2.run();
console.log("✓ #89 补录退款: $21 → $20");

// 3. 修正退款 #45: $21 → $22 (被拒绝申请应全额退款)
const fix3 = db.prepare("UPDATE transactions SET amount = 22, description = '开卡申请（G5237OH x 1）被拒绝，退还开卡费+充值冻结（修正：原$21→$22全额退款）' WHERE id = 45 AND user_id = 3");
fix3.run();
console.log("✓ #45 app_rejected:17退款: $21 → $22");

// 4. 重新计算并更新用户余额
const newBalance = db.prepare("SELECT SUM(amount) as total FROM transactions WHERE user_id = 3").get().total;
db.prepare("UPDATE users SET balance = ? WHERE id = 3").run(newBalance);
console.log("\n新余额:", newBalance);

// 验证
console.log("\n=== 验证 ===");
const deposits = db.prepare("SELECT SUM(amount) as total FROM transactions WHERE user_id=3 AND type='充值'").get().total;
const adminOps = db.prepare("SELECT SUM(amount) as total FROM transactions WHERE user_id=3 AND type IN ('管理员充值','管理员扣款')").get().total;
const pairs = db.prepare(`
  SELECT ref_id, 
    SUM(CASE WHEN type='消费' THEN amount ELSE 0 END) as spend, 
    SUM(CASE WHEN type='退款' THEN amount ELSE 0 END) as refund 
  FROM transactions WHERE user_id=3 AND ref_id != '' GROUP BY ref_id
`).all();
let totalFee = 0;
pairs.forEach(p => {
  const net = p.spend + p.refund;
  if (net !== 0) console.log(p.ref_id, "净损失:" + net);
  totalFee += net;
});
const noRef = db.prepare(`
  SELECT SUM(CASE WHEN type='消费' THEN amount ELSE 0 END) as spend, 
    SUM(CASE WHEN type='退款' THEN amount ELSE 0 END) as refund 
  FROM transactions WHERE user_id=3 AND ref_id = '' AND type IN ('消费','退款')
`).get();
console.log("充值:", deposits, "管理员:", adminOps, "开卡费净:", totalFee, "无ref净:", noRef.spend + noRef.refund);
console.log("验证余额:", deposits + adminOps + totalFee + (noRef.spend + noRef.refund));
console.log("实际余额:", db.prepare("SELECT balance FROM users WHERE id=3").get().balance);

// 检查XR2067511181878833152
const xrRows = db.prepare("SELECT id, type, amount, ref_id FROM transactions WHERE user_id=3 AND (ref_id LIKE ? OR id=24)").all("%XR2067511181878833152%");
console.log("\n=== XR2067511181878833152 (修正后) ===");
xrRows.forEach(r => console.log("#" + r.id, r.type, r.amount, "ref:" + r.ref_id));
