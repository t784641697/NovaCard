/**
 * v1.0.99.10 生产急救: 手动同步指定卡 DB 余额 (绕过 setTimeout, 直接调 SDK)
 *
 * 用法: node scripts/v1.0.99.10_prod_sync_card.js <card_id>
 */
'use strict';
const fs   = require('fs');
const path = require('path');
const { Client } = require('ssh2');
const KEY_PATH = '/workspace/projects/.ssh/vultr_new_key';

const TARGET_CARD = process.argv[2] || 'XR2067511181878833152';

const exec = (conn, cmd) => new Promise((resolve, reject) => {
  let out='', err='';
  conn.exec(cmd, (e, stream) => {
    if (e) return reject(e);
    stream.stderr.on('data', d => err += d);
    stream.on('close', code => code === 0 ? resolve(out) : reject(new Error(`exit ${code}\nSTDERR: ${err}\nSTDOUT: ${out}`)));
    stream.on('data', d => out += d);
  });
});

const conn = new Client();
conn.on('ready', async () => {
  try {
    console.log(`▶️ SSH 登录成功，准备同步卡 ${TARGET_CARD}`);

    // 1) 在生产 server 上查 DB 当前 available_amount (用 node 而不是 sqlite3 CLI)
    const dbBefore = await exec(conn,
      `cd /opt/vcc-hub && node -e "const db=require('better-sqlite3')('/opt/vcc-hub/data/vcc.db'); console.log(JSON.stringify(db.prepare(\\\"SELECT card_id, available_amount, last_verified FROM cards WHERE card_id='${TARGET_CARD}'\\\").get()));"`);
    console.log('📊 DB BEFORE:', dbBefore.trim());

    // 2) 在生产 server 上跑 Node SDK 调 cardDetail (用 dotenv 加载 .env)
    const script = `
      require('dotenv').config({ path: '/opt/vcc-hub/.env' });
      const { VmcardioSDK } = require('/opt/vcc-hub/src/services/vmcardioSDK');
      const Database = require('better-sqlite3');
      const db = new Database('/opt/vcc-hub/data/vcc.db');
      const sdk = new VmcardioSDK();
      (async () => {
        try {
          const detail = await sdk.cardDetail('${TARGET_CARD}');
          const newAmt = Number(detail?.available_amount);
          console.log('UPSTREAM_AVAILABLE_AMOUNT=' + newAmt);
          if (Number.isFinite(newAmt)) {
            db.prepare(\`UPDATE cards SET available_amount=?, status=COALESCE(NULLIF(?, ''), status), last_verified=datetime('now'), verified_status='verified', updated_at=datetime('now') WHERE card_id=?\`).run(newAmt, detail?.status || '', '${TARGET_CARD}');
            console.log('DB_WRITE_OK');
          } else {
            console.log('DB_SKIP_NO_AMT');
          }
        } catch (e) {
          console.error('SDK_FATAL', e.message);
          process.exit(1);
        }
      })();
    `;
    const scriptB64 = Buffer.from(script).toString('base64');
    const sdkOut = await exec(conn,
      `echo "${scriptB64}" | base64 -d | cd /opt/vcc-hub && node -`);
    console.log('📡 SDK OUTPUT:\n' + sdkOut);

    // 3) 查 DB AFTER
    const dbAfter = await exec(conn,
      `cd /opt/vcc-hub && node -e "const db=require('better-sqlite3')('/opt/vcc-hub/data/vcc.db'); console.log(JSON.stringify(db.prepare(\\\"SELECT card_id, available_amount, last_verified, verified_status FROM cards WHERE card_id='${TARGET_CARD}'\\\").get()));"`);
    console.log('📊 DB AFTER:', dbAfter.trim());

    conn.end();
  } catch (e) { console.error('FATAL', e.message); conn.end(); process.exit(1); }
}).on('error', e => { console.error('SSH ERROR', e.message); process.exit(1); })
.connect({ host: '139.180.188.104', port: 22, username: 'root', privateKey: fs.readFileSync(KEY_PATH) });
