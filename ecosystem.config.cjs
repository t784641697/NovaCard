/**
 * PM2 进程管理配置
 * 部署到 Vultr: /opt/vcc-hub/ecosystem.config.cjs
 *
 * 用法:
 *   pm2 start ecosystem.config.cjs    # 启动
 *   pm2 reload ecosystem.config.cjs   # 0 停机重载
 *   pm2 stop ecosystem.config.cjs     # 停止
 *   pm2 delete ecosystem.config.cjs   # 移除
 */
module.exports = {
  apps: [{
    name: "vcc-hub",
    script: "./src/app.js",
    cwd: "/opt/vcc-hub",
    instances: 2,
    exec_mode: "cluster",
    autorestart: true,
    watch: false,
    max_memory_restart: "512M",
    env: {
      NODE_ENV: "production"
    }
  }]
};
