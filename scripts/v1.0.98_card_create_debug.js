/**
 * v1.0.98 DEBUG: 完整记录创建测试卡时上游返回的所有数据
 *
 * 目的：判断 vmcardio createCard/cardDetail 是否真返回账单地址
 *       (用户后台显示有 Street/City/State/Zip Code，但 API 返回空对象)
 *
 * 记录：
 *   1. createCard 请求 payload (明文 + RSA加密后)
 *   2. createCard 响应 (RSA加密前 body + RSA解密后 result)
 *   3. cardDetail 请求 payload (明文 + RSA加密后)
 *   4. cardDetail 响应 (RSA加密前 body + RSA解密后 result)
 *
 * 输出：/tmp/v1.0.98_card_create_debug_<timestamp>.json (完整 dump)
 *       stdout 摘要
 */
require("dotenv").config({ path: "/opt/vcc-hub/.env" });

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const https = require("https");
const Database = require("better-sqlite3");

const rsa = require("./src/utils/rsaCrypto");
const sdk = require("./src/services/vmcardioSDK");

// 强制 IPv4 (跟 SDK 一致)
const _agent = new https.Agent({ family: 4 });

// ============ 参数 ============
const USER_ID = 3; // taoliang.ligh@gmail.com
const PRODUCT_CODE = "G5554LC"; // VC102
const TOPUP_AMOUNT = 20;
const QUANTITY = 1;

// 用户姓名 (从 DB 拿, 模拟 admin.js 审批时 sanitized)
function sanitizeName(name) {
  return (name || "").replace(/[0-9]/g, "").trim() || "User";
}

async function main() {
  const db = new Database("/opt/vcc-hub/data/vcc.db");

  // 1. 拿用户
  const user = db.prepare("SELECT id, email, name, balance FROM users WHERE id = ?").get(USER_ID);
  if (!user) throw new Error(`用户 ${USER_ID} 不存在`);
  console.log(`[USER] id=${user.id} email=${user.email} name=${user.name} balance=$${user.balance}`);

  if (user.balance < TOPUP_AMOUNT) {
    throw new Error(`用户余额不足: $${user.balance} < $${TOPUP_AMOUNT}`);
  }

  // 2. 准备 createParams (跟 admin.js 审批流程一致)
  const firstName = sanitizeName(user.name?.split(/\s+/)[0] || "Test");
  const lastName = sanitizeName(user.name?.split(/\s+/).slice(1).join(" ") || "User");

  let cardBillingAddress = null;
  if (process.env.VMCARDIO_DEFAULT_BILLING_ADDRESS) {
    try { cardBillingAddress = JSON.parse(process.env.VMCARDIO_DEFAULT_BILLING_ADDRESS); } catch {}
  }

  const createParams = {
    product_code: PRODUCT_CODE,
    amount: TOPUP_AMOUNT,
    first_name: firstName,
    last_name: lastName,
    user_id: String(USER_ID),
  };
  if (cardBillingAddress) createParams.card_address = cardBillingAddress;

  console.log(`[CREATE_PARAMS]`, JSON.stringify(createParams, null, 2));

  // 3. 调 createCard 并记录所有 raw 数据
  const token = await sdk._getToken();
  const encrypted = rsa.encrypt(createParams);

  const createResp = await axios.post(
    `${process.env.VMCARDIO_BASE_URL}/createCard`,
    { content: encrypted },
    {
      headers: { Authorization: token, "Content-Type": "application/json" },
      httpsAgent: _agent,
      timeout: 45000,
    }
  );
  const createBody = createResp.data;
  const createResult = createBody.code === 0 ? rsa.decrypt(createBody.data) : null;

  console.log(`[CREATE_RESP] code=${createBody.code} msg=${createBody.msg}`);
  if (createResult) {
    console.log(`[CREATE_RESULT] card_id=${createResult.card_id} 所有顶层 keys:`,
      Object.keys(createResult).join(","));
    console.log(`[CREATE_RESULT.card_address]`, JSON.stringify(createResult.card_address));
  } else {
    console.log(`[CREATE_BODY]`, JSON.stringify(createBody));
    throw new Error("createCard 失败");
  }

  const card_id = createResult.card_id;

  // 4. 调 cardDetail 记录完整数据
  const detailPayload = { card_id };
  const detailEncrypted = rsa.encrypt(detailPayload);
  const detailResp = await axios.post(
    `${process.env.VMCARDIO_BASE_URL}/cardDetail`,
    { content: detailEncrypted },
    {
      headers: { Authorization: token, "Content-Type": "application/json" },
      httpsAgent: _agent,
      timeout: 45000,
    }
  );
  const detailBody = detailResp.data;
  const detailResult = detailBody.code === 0 ? rsa.decrypt(detailBody.data) : null;

  console.log(`\n[DETAIL_RESP] code=${detailBody.code} msg=${detailBody.msg}`);
  if (detailResult) {
    console.log(`[DETAIL_RESULT 所有顶层 keys]`, Object.keys(detailResult).join(","));
    console.log(`[DETAIL_RESULT.card_address]`, JSON.stringify(detailResult.card_address));
  }

  // 5. dump 完整原始数据到文件
  const dump = {
    timestamp: new Date().toISOString(),
    test_config: {
      USER_ID, PRODUCT_CODE, TOPUP_AMOUNT, QUANTITY,
      firstName, lastName,
      vmc_env: {
        VMCARDIO_BASE_URL: process.env.VMCARDIO_BASE_URL,
        VMCARDIO_APP_ID: process.env.VMCARDIO_APP_ID,
        VMCARDIO_DEFAULT_BILLING_ADDRESS: cardBillingAddress,
      },
    },
    user: { id: user.id, email: user.email, name: user.name, balance: user.balance },
    createCard: {
      payload_clear: createParams,
      payload_encrypted: encrypted,
      response_body: createBody, // {code, msg, data: encrypted}
      result_decrypted: createResult, // 解密后的对象
    },
    cardDetail: {
      card_id,
      payload_clear: detailPayload,
      payload_encrypted: detailEncrypted,
      response_body: detailBody,
      result_decrypted: detailResult,
    },
  };

  const ts = Date.now();
  const dumpFile = `/tmp/v1.0.98_card_create_debug_${ts}.json`;
  fs.writeFileSync(dumpFile, JSON.stringify(dump, null, 2), "utf8");
  console.log(`\n[💾 完整数据已 dump] ${dumpFile}`);
  console.log(`[📊 file size] ${(fs.statSync(dumpFile).size / 1024).toFixed(1)} KB`);

  // 6. **不写 DB** — 让用户决定是否入库
  console.log(`\n[⚠️  卡 ${card_id} 未写入 DB, 用户决定是否要入库`);

  db.close();
  return { card_id, dumpFile };
}

main().catch(e => {
  console.error("❌ ERROR:", e.message);
  console.error(e.stack);
  process.exit(1);
});
