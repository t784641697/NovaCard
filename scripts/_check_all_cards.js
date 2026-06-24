/**
 * v1.0.99.10 诊断: 列生产所有卡 DB 状态, 找出 available_amount != 上游值的卡
 */
'use strict';
const fs   = require('fs');
const { Client } = require('ssh2');
const KEY_PATH = '/workspace/projects/.ssh/vultr_new_key';

const conn = new Client();
conn.on('ready', () => {
  conn.exec(`cd /opt/vcc-hub && node -e "const db=require('better-sqlite3')('/opt/vcc-hub/data/vcc.db'); const rows = db.prepare(\\\"SELECT card_id, user_id, status, available_amount, last_verified, verified_status FROM cards WHERE card_id IS NOT NULL ORDER BY updated_at DESC LIMIT 20\\\").all(); console.log(JSON.stringify(rows, null, 2));"`, (err, stream) => {
    let d = ''; stream.on('data', c => d += c);
    stream.stderr.on('data', c => d += '\n[ERR]' + c);
    stream.on('close', () => { console.log(d); conn.end(); });
  });
}).on('error', e => console.error('SSH ERR', e.message))
.connect({ host: '139.180.188.104', port: 22, username: 'root', privateKey: fs.readFileSync(KEY_PATH) });
