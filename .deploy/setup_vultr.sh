#!/bin/bash
# 在 Vultr 新服务器上部署 NovaCard
# 用法: scp 到新服务器后执行

set -e

echo "🚀 开始部署 NovaCard 到 Vultr 新加坡服务器..."

# 1. 安装 Node.js 24
echo "📦 安装 Node.js 24..."
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs

# 2. 安装 pnpm
echo "📦 安装 pnpm..."
npm install -g pnpm

# 3. 克隆 NovaCard 项目
echo "📦 克隆 NovaCard 项目..."
cd /opt
git clone https://github.com/t784641697/NovaCard.git vcc-hub
cd vcc-hub

# 4. 安装依赖
echo "📦 安装依赖..."
pnpm install

# 5. 复制 .env 和 config（需要从生产拉取）
echo "📦 复制 .env 和 config/*.pem..."
# 等待用户从生产拉取这些文件到本机 /tmp/vcc-config/ 然后 scp 上来

# 6. 初始化数据库
echo "📦 初始化 SQLite 数据库..."
mkdir -p data
# 数据库会在 src/app.js 启动时自动建表

# 7. 启动服务
echo "🚀 启动服务..."
pm2 delete vcc-hub 2>/dev/null || true
pm2 start src/app.js --name vcc-hub --update-env
pm2 save

echo "✅ NovaCard 已启动"
pm2 list
echo ""
echo "🌐 访问地址: http://139.180.188.104/"
