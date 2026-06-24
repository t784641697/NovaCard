const { Client } = require('ssh2');
const fs = require('fs');
const c = new Client();
c.on('ready', () => {
  c.exec('tail -n 80 /opt/vcc-hub/logs/app.log 2>/dev/null | grep -E "ambiguous|walletRows|SqliteError|SyntaxError|column|Error" | tail -30', (err, stream) => {
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
