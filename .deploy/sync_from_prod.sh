#!/bin/bash
# 从生产服务器 43.135.26.36 拉取 .env + config/*.pem 到新服务器
# 用法: ./sync_from_prod.sh

set -e

PROD_HOST="ubuntu@43.135.26.36"
PROD_PATH="/opt/vcc-hub"
SSH_PASS="System.error.9"

echo "📦 准备拉取 .env 和 config/*.pem ..."
mkdir -p /tmp/vcc-config

# 用 sshpass 从生产服务器拉取
which sshpass >/dev/null || apt-get install -y sshpass

sshpass -p "$SSH_PASS" scp -o StrictHostKeyChecking=no \
  $PROD_HOST:$PROD_PATH/.env /tmp/vcc-config/.env
sshpass -p "$SSH_PASS" scp -o StrictHostKeyChecking=no \
  $PROD_HOST:$PROD_PATH/config/vmcardio_platform_public.pem /tmp/vcc-config/
sshpass -p "$SSH_PASS" scp -o StrictHostKeyChecking=no \
  $PROD_HOST:$PROD_PATH/config/merchant_private.pem /tmp/vcc-config/
sshpass -p "$SSH_PASS" scp -o StrictHostKeyChecking=no \
  $PROD_HOST:$PROD_PATH/config/merchant_public.pem /tmp/vcc-config/

echo "✅ 已拉取到 /tmp/vcc-config/"
ls -la /tmp/vcc-config/
