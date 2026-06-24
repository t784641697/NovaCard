/**
 * 生产部署脚本 (v1.0.99.6)
 *
 * 流程: SSH 登录 Vultr 新加坡服务器 → git reset --hard origin/main → pm2 reload
 *
 * 跑法: node scripts/deploy_prod.js [commit_sha]
 *   commit_sha 可选, 默认 4b444fe (当前 HEAD)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const KEY_PATH = '/workspace/projects/.ssh/vultr_new_key';
const HOST = '139.180.188.104';
const USER = 'root';
const PORT = 22;
const TARGET_COMMIT = process.argv[2] || 'origin/main';

function loadKey() {
  return fs.readFileSync(KEY_PATH);
}

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    console.log(`\n>>> ${cmd}`);
    let stdout = '';
    let stderr = '';
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      stream
        .on('close', (code) => {
          console.log(`[exit ${code}]`);
          if (code !== 0) {
            console.log('STDOUT:', stdout);
            console.log('STDERR:', stderr);
            return reject(new Error(`命令退出码 ${code}: ${cmd}`));
          }
          resolve({ stdout, stderr, code });
        })
        .on('data', (data) => {
          const s = data.toString();
          stdout += s;
          process.stdout.write(s);
        })
        .stderr.on('data', (data) => {
          const s = data.toString();
          stderr += s;
          process.stderr.write(s);
        });
    });
  });
}

async function main() {
  const key = loadKey();
  const conn = new Client();

  console.log(`[deploy] 连接 ${USER}@${HOST}:${PORT} (密钥: ${KEY_PATH})`);
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect({
      host: HOST,
      port: PORT,
      username: USER,
      privateKey: key,
      readyTimeout: 15000,
    });
  });
  console.log('[deploy] SSH 连接成功');

  try {
    // 1. 备份当前 HEAD (出问题时可回滚)
    console.log('\n[1/5] 备份当前 HEAD');
    await exec(conn, 'cd /opt/vcc-hub && git rev-parse HEAD');

    // 2. 拉取 + 重置
    console.log('\n[2/5] 拉取最新代码 + 重置到 ' + TARGET_COMMIT);
    await exec(conn, 'cd /opt/vcc-hub && git fetch origin 2>&1 | tail -3');
    await exec(conn, 'cd /opt/vcc-hub && git reset --hard ' + TARGET_COMMIT + ' 2>&1 | tail -3');
    const newHead = await exec(conn, 'cd /opt/vcc-hub && git rev-parse HEAD');
    console.log('[deploy] 新 HEAD:', newHead.stdout.trim());

    // 3. 装依赖 (如果 package.json 改了)
    console.log('\n[3/5] 检查依赖');
    await exec(conn, 'cd /opt/vcc-hub && (test -d node_modules && echo "node_modules 存在, 跳过 pnpm install") || pnpm install 2>&1 | tail -5');

    // 4. 重启服务
    console.log('\n[4/5] pm2 reload vcc-hub');
    const reload = await exec(conn, 'pm2 reload vcc-hub --update-env 2>&1 | tail -10');
    console.log('[deploy] pm2 reload 完成');

    // 5. 状态检查
    console.log('\n[5/5] pm2 状态 + 健康检查');
    await new Promise(r => setTimeout(r, 3000)); // 等服务起来
    await exec(conn, 'pm2 list 2>&1 | head -20');
    await exec(conn, 'curl -s -I --max-time 5 http://127.0.0.1:5000/health 2>&1 | head -5');
    await exec(conn, 'pm2 logs vcc-hub --lines 10 --nostream 2>&1 | tail -15');

    console.log('\n✅ 部署完成');
  } catch (e) {
    console.error('\n❌ 部署失败:', e.message);
    process.exit(1);
  } finally {
    conn.end();
  }
}

main().catch((e) => {
  console.error('❌ 部署异常:', e);
  process.exit(1);
});
