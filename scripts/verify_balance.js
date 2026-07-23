const db = require("../src/db");

// 从业务逻辑计算正确余额
// 规则：充值=用户实得金额，开卡费不退，充值冻结=删卡时退回available_amount

// 1. 所有充值
const deposits = db.prepare(`SELECT SUM(amount) as total FROM transactions WHERE user_id=3 AND type='充值'`).get();
console.log("充值总额:", deposits.total);

// 2. 每个ref_id的消费退款差额
const pairs = db.prepare(`
  SELECT ref_id, 
    SUM(CASE WHEN type='消费' THEN amount ELSE 0 END) as spend, 
    SUM(CASE WHEN type='退款' THEN amount ELSE 0 END) as refund 
  FROM transactions WHERE user_id=3 AND ref_id != '' 
  GROUP BY ref_id
`).all();
console.log("\n=== 每个ref_id的净损失(应=开卡费) ===");
let totalFee = 0;
pairs.forEach(p => {
  const net = p.spend + p.refund;
  console.log(p.ref_id, "消费:" + p.spend, "退款:" + p.refund, "净损失:" + net);
  totalFee += net;
});
console.log("\n总净损失(开卡费):", totalFee);

// 3. 管理员操作
const adminNet = db.prepare(`SELECT SUM(amount) as total FROM transactions WHERE user_id=3 AND type IN ('管理员充值','管理员扣款')`).get();
console.log("管理员操作净额:", adminNet.total);

// 4. 卡充值(无ref_id)
const noRef = db.prepare(`
  SELECT SUM(CASE WHEN type='消费' THEN amount ELSE 0 END) as spend, 
    SUM(CASE WHEN type='退款' THEN amount ELSE 0 END) as refund 
  FROM transactions WHERE user_id=3 AND ref_id = '' AND type IN ('消费','退款')
`).get();
console.log("\n无ref_id消费退款:", "消费:" + noRef.spend, "退款:" + noRef.refund, "净:" + (noRef.spend + noRef.refund));

console.log("\n=== 正确余额计算 ===");
console.log("充值:", deposits.total);
console.log("+ 管理员操作:", adminNet.total);
console.log("+ 无ref消费退款净:", noRef.spend + noRef.refund);
console.log("+ 有ref消费退款净(开卡费):", totalFee);
const expected = deposits.total + adminNet.total + (noRef.spend + noRef.refund) + totalFee;
console.log("= 预期余额:", expected);
console.log("\n实际余额:", db.prepare("SELECT balance FROM users WHERE id=3").get().balance);
console.log("差额:", db.prepare("SELECT balance FROM users WHERE id=3").get().balance - expected);

// XR2067511181878833152 特殊分析
console.log("\n=== XR2067511181878833152 特殊分析 ===");
console.log("这张卡：用户花了$21，卡内有$50(含$30幽灵充值)，删卡退$50，管理员扣$50");
console.log("正确做法：管理员应扣$30(幽灵充值)，不应扣$50");
console.log("多扣了：$20 → 用户少$20");
console.log("2069793414578311169：补录退款$21，但删卡只应退$20(不含开卡费$1)");
console.log("多退了：$1 → 用户多$1");
console.log("净误差：-$20 + $1 = -$19 (用户少$19)");
console.log("修正后余额：" + (db.prepare("SELECT balance FROM users WHERE id=3").get().balance + 19));
