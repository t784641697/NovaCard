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
