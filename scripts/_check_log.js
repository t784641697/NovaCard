'use strict';
const { Client } = require('ssh2');
const fs = require('fs');
const KEY = fs.readFileSync('/workspace/projects/.ssh/vultr_new_key');

async function main() {
  const conn = new Client();
  await new Promise((r, j) => { conn.on('ready', r); conn.on('error', j); conn.connect({ host: '139.180.188.104', port: 22, username: 'root', privateKey: KEY }); });
  await new Promise((r) => {
    conn.exec("pm2 logs vcc-hub --lines 80 --nostream 2>&1 | grep -iE 'error|exception|500|walletRows|ambiguous' | tail -30", (e, s) => {
      if (e) { console.error(e); r(); return; }
      s.on('data', d => process.stdout.write(d.toString()));
      s.stderr.on('data', d => process.stderr.write(d.toString()));
      s.on('close', r);
    });
  });
  conn.end();
}
main();
