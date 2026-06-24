const { Client } = require('ssh2');
const fs = require('fs');
const c = new Client();
c.on('ready', () => {
  // 用 pm2 logs --lines 看错误堆栈
  c.exec('pm2 logs vcc-hub --lines 60 --nostream --raw 2>&1 | grep -E "ambiguous|at /opt|walletRows|Error" | tail -20', (err, stream) => {
    if (err) { console.log('exec err', err.message); c.end(); return; }
    let out = '';
    stream.on('data', d => out += d);
    stream.on('close', () => { console.log(out); c.end(); });
  });
});
c.on('error', e => console.log('ssh err', e.message));
c.connect({
  host: '139.180.188.104', port: 22, username: 'root',
  privateKey: fs.readFileSync('/workspace/projects/.ssh/vultr_new_key')
});
