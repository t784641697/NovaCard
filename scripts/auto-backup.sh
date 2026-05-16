#!/bin/bash
# ============================================================
#  XiuXiu Card 自动备份脚本
#  每天自动备份数据库和关键配置到 Git
# ============================================================

set -e

# 配置
BACKUP_DIR="/home/ubuntu/vcc"
DB_SOURCE="/opt/xiuxiucard/backend/data/vcc.db"
BACKUP_NAME="vcc-backup-$(date +'%Y%m%d_%H%M%S').db"
LOG_FILE="/home/ubuntu/vcc/backup.log"

# 记录日志的函数
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "======================================"
log "  开始自动备份"
log "======================================"

# 1. 进入Git仓库目录
cd "$BACKUP_DIR" || {
  log "错误: 无法进入目录 $BACKUP_DIR"
  exit 1
}

# 2. 备份数据库文件（如果存在）
if [ -f "$DB_SOURCE" ]; then
  log "→ 备份数据库..."
  cp "$DB_SOURCE" "backups/$BACKUP_NAME"
  # 同时更新最新的备份链接
  cp "$DB_SOURCE" "backups/vcc-latest.db"
  log "✅ 数据库已备份: $BACKUP_NAME"
else
  log "⚠️  数据库文件不存在: $DB_SOURCE"
fi

# 3. 添加所有变更到Git
log "→ 添加文件到Git..."
git add -A

# 4. 检查是否有变更需要提交
if git diff --cached --quiet; then
  log "ℹ️  没有需要提交的更改"
else
  # 5. 提交变更
  COMMIT_MSG="Auto-backup: $(date +'%Y-%m-%d %H:%M') 自动备份"
  git commit -m "$COMMIT_MSG"
  log "✅ 代码已提交: $COMMIT_MSG"
  
  # 6. 推送到GitHub
  log "→ 推送到GitHub..."
  if git push origin main; then
    log "✅ 备份已推送到GitHub"
  else
    log "❌ 推送到GitHub失败"
    exit 1
  fi
fi

log "======================================"
log "  备份完成"
log "======================================"

# 7. 清理旧备份（保留最近30天的）
log "→ 清理旧备份文件..."
find "$BACKUP_DIR/backups" -name "vcc-backup-*.db" -mtime +30 -delete 2>/dev/null || true
log "✅ 旧备份清理完成"
