/**
 * v1.0.99.7: 在生产服务器上执行 backfill (直接读/写生产 SQLite)
 * 通过 ssh2 远程执行同目录下的 backfill 脚本
 */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const HOST = '139.180.188.104';
const KEY_PATH = '/workspace/projects/.ssh/vultr_new_key';
const SCRIPT_REMOTE = '/opt/vcc-hub/scripts/v1.0.99.7_backfill_ledger_ref_id.js';
const MODE = process.argv.includes('--apply') ? '--apply' : '--dry-run';

console.log(`Mode: ${MODE}`);

const c = new Client();
c.on('ready', () => {
  c.exec(`cd /opt/vcc-hub && node ${SCRIPT_REMOTE} ${MODE}`, (err, stream) => {
    if (err) { console.error(err); c.end(); return; }
    stream.on('data', d => process.stdout.write(d));
    stream.stderr.on('data', d => process.stderr.write(d));
    stream.on('close', code => {
      console.log(`\n[exit code: ${code}]`);
      c.end();
    });
  });
});
c.on('error', err => { console.error('SSH error:', err); process.exit(1); });
c.connect({ host: HOST, port: 22, username: 'root', privateKey: fs.readFileSync(KEY_PATH) });
