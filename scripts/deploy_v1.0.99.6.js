// v1.0.99.6 部署脚本 — 用 ssh2 拉代码 + reload pm2
const { Client } = require('ssh2');
const fs = require('fs');

const KEY = fs.readFileSync('/workspace/projects/.ssh/vultr_new_key');

const c = new Client();
let stepNum = 0;
const steps = [
  { name: 'fetch + reset', cmd: 'cd /opt/vcc-hub && git fetch origin && git reset --hard origin/main' },
  { name: 'verify HEAD',  cmd: 'cd /opt/vcc-hub && git log --oneline -1' },
  { name: 'pm2 reload',   cmd: 'pm2 reload vcc-hub --update-env' },
  { name: 'pm2 list',     cmd: 'sleep 3 && pm2 list | head -8' },
  { name: 'service probe',cmd: 'sleep 2 && curl -s -o /dev/null -w "HTTP %{http_code}\\n" http://127.0.0.1:5000/health' },
];

function runNext() {
  if (stepNum >= steps.length) {
    return c.end();
  }
  const step = steps[stepNum++];
  console.log(`\n=== [${stepNum}/${steps.length}] ${step.name} ===`);
  c.exec(step.cmd, (err, stream) => {
    if (err) { console.log('exec err:', err.message); return c.end(); }
    let out = '';
    stream.on('data', d => { out += d; process.stdout.write(d); });
    stream.stderr.on('data', d => { out += d; process.stderr.write(d); });
    stream.on('close', code => {
      if (code !== 0 && step.name !== 'service probe') {
        console.log(`\n[FAIL] step ${stepNum} exit code ${code}`);
        return c.end();
      }
      runNext();
    });
  });
}

c.on('ready', () => {
  console.log('[SSH connected]');
  runNext();
});
c.on('error', e => console.log('[SSH error]', e.message));
c.on('end', () => console.log('\n[SSH closed]'));
c.connect({ host: '139.180.188.104', port: 22, username: 'root', privateKey: KEY });
