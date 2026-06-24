// 生产 v1.0.99.6 备份脚本
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const KEY = fs.readFileSync('/workspace/projects/.ssh/vultr_new_key');
const TS = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15).replace('Z', '');
const FILENAME = `vcc-hub-V1.0.99.6-${TS}.tar.gz`;
const LOCAL_PATH = path.join('/workspace/projects/vcc-dashboard/backups', FILENAME);

const c = new Client();
c.on('ready', () => {
  console.log(`[backup] 上传 ${FILENAME} 到生产 /root/`);
  c.exec(`cd /opt/vcc-hub && tar -czf /root/${FILENAME} --exclude='node_modules' --exclude='.git' --exclude='backups' --exclude='data/*.db' . && ls -la /root/${FILENAME} && echo "[OK] backup done"`, (err, stream) => {
    if (err) { console.log('exec err:', err.message); return c.end(); }
    let out = '';
    stream.on('data', d => { out += d; process.stdout.write(d); });
    stream.stderr.on('data', d => { out += d; process.stderr.write(d); });
    stream.on('close', code => {
      if (code !== 0) { console.log(`[FAIL] exit ${code}`); return c.end(); }
      // 下载到本地
      c.sftp((sftpErr, sftp) => {
        if (sftpErr) { console.log('sftp err:', sftpErr.message); return c.end(); }
        sftp.fastGet(`/root/${FILENAME}`, LOCAL_PATH, (dErr) => {
          if (dErr) { console.log('download err:', dErr.message); return c.end(); }
          const stat = fs.statSync(LOCAL_PATH);
          console.log(`[OK] local saved: ${LOCAL_PATH} (${(stat.size/1024).toFixed(1)} KB)`);
          // 删生产 tmp
          c.exec(`rm /root/${FILENAME}`, () => c.end());
        });
      });
    });
  });
});
c.on('error', e => console.log('[SSH error]', e.message));
c.on('end', () => console.log('[SSH closed]'));
c.connect({ host: '139.180.188.104', port: 22, username: 'root', privateKey: KEY });
