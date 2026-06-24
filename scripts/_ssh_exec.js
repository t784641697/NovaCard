// 通过 ssh2 查生产 DB 交易数据
const { Client } = require('ssh2');
const fs = require('fs');
const c = new Client();
const cmd = process.argv[2] || "sqlite3 /opt/vcc-hub/data/vcc.db \".headers on\" \"\\\"SELECT id, type, amount, fee_type, ref_id, substr(description,1,50) as d FROM transactions WHERE user_id=3 ORDER BY created_at DESC\\\"\"";
c.on('ready', () => {
  c.exec(cmd, (err, stream) => {
    if (err) { console.error(err); c.end(); return; }
    let buf = '';
    stream.on('data', d => buf += d);
    stream.on('close', () => { console.log(buf); c.end(); });
  });
});
c.connect({
  host: '139.180.188.104', port: 22, username: 'root',
  privateKey: fs.readFileSync('/workspace/projects/.ssh/vultr_new_key')
});
