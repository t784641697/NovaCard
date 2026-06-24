const { Client } = require('ssh2');
const fs = require('fs');
const c = new Client();
c.on('ready', () => {
  c.exec('cd /opt/vcc-hub && git log --oneline -3 && echo "---HEAD---" && git rev-parse HEAD && echo "---" && sed -n "1424,1442p" src/routes/admin.js', (err, stream) => {
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
