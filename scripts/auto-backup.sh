#!/bin/bash
# ============================================================
# NovaCard 自动备份脚本
# 备份内容: data/vcc.db + .env + config/ (RSA 密钥)
# 备份策略: 本地保留 7 天 (轮转) + 可选推送 GitHub Release
# 执行时间: 每天凌晨 3:00 (通过 crontab)
# ============================================================
set -euo pipefail

# ---- 路径配置 ----
APP_DIR="/opt/vcc-hub"
BACKUP_DIR="/opt/vcc-hub/backups"
LOG_FILE="/var/log/novacard-backup.log"
NODE_BIN="$(command -v node)"
GIT_BIN="$(command -v git)"

# ---- 备份保留天数 ----
LOCAL_RETENTION_DAYS=7

# ---- GitHub Release 配置 (可选) ----
# 启用方法: 在 /opt/vcc-hub/.env 中添加 GITHUB_PAT 和 GITHUB_REPO 变量
# GITHUB_PAT=ghp_xxxxxxxxxxxxxxxxxxxx
# GITHUB_REPO=t784641697/NovaCard
GITHUB_PAT=""
GITHUB_REPO=""

# ---- 加载环境变量 (从 .env 读取 GITHUB_PAT / GITHUB_REPO) ----
if [[ -f "$APP_DIR/.env" ]]; then
    while IFS='=' read -r key value; do
        case "$key" in
            GITHUB_PAT|GITHUB_REPO)
                # 去除值两端引号和空白
                value="${value%\"}"; value="${value#\"}"
                value="${value%\'}"; value="${value#\'}"
                if [[ "$key" == "GITHUB_PAT" ]]; then GITHUB_PAT="$value"; fi
                if [[ "$key" == "GITHUB_REPO" ]]; then GITHUB_REPO="$value"; fi
                ;;
        esac
    done < <(grep -E '^GITHUB_(PAT|REPO)=' "$APP_DIR/.env" || true)
fi

# ---- 辅助函数 ----
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE" >&2; }
err() { log "ERROR: $*"; exit 1; }

# ---- 预检查 ----
[[ -d "$APP_DIR" ]] || err "目录不存在: $APP_DIR"
[[ -d "$APP_DIR/data" ]] || err "data 目录不存在: $APP_DIR/data"
[[ -f "$APP_DIR/.env" ]] || err ".env 不存在: $APP_DIR/.env"
[[ -x "$NODE_BIN" ]] || err "node 未安装"

mkdir -p "$BACKUP_DIR"

# ---- 生成备份文件名 ----
TS=$(date '+%Y%m%d-%H%M%S')
DATE=$(date '+%Y-%m-%d')
BACKUP_NAME="novacard-${DATE}-${TS}.tar.gz"
BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"

log "===== 开始备份 ====="
log "目标: $BACKUP_PATH"

# ---- 步骤 1: SQLite 在线热备份 (用 node + better-sqlite3) ----
log "[1/4] SQLite 热备份 (VACUUM INTO)..."
TMP_DB="$BACKUP_DIR/.vcc-${TS}.db.tmp"

cd "$APP_DIR"
"$NODE_BIN" -e "
const Database = require('better-sqlite3');
const src = new Database('data/vcc.db');
// VACUUM INTO 是 SQLite 3.27+ 的官方热备份方法
src.exec(\`VACUUM INTO '${TMP_DB}'\`);
const dst = new Database('${TMP_DB}', {readonly: true});
const r = dst.prepare('PRAGMA integrity_check').all();
const tables = dst.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all();
const userCount = dst.prepare('SELECT count(*) as c FROM users').get();
console.log('integrity:', JSON.stringify(r));
console.log('tables:', tables.length);
console.log('users:', userCount.c);
dst.close();
src.close();
process.exit(r[0] && r[0].integrity_check === 'ok' ? 0 : 1);
" >> "$LOG_FILE" 2>&1 || err "SQLite 备份失败"

[[ -f "$TMP_DB" ]] || err "临时 DB 文件未生成: $TMP_DB"
ORIG_SIZE=$(stat -c '%s' "$APP_DIR/data/vcc.db")
BCK_SIZE=$(stat -c '%s' "$TMP_DB")
log "  ✓ 源 DB: ${ORIG_SIZE} bytes, 备份: ${BCK_SIZE} bytes"
mv "$TMP_DB" "$BACKUP_DIR/.vcc-${TS}.db"

# ---- 步骤 2: 打包 data/ + .env + config/ ----
log "[2/4] 打包 tar.gz..."
TMP_DIR="$BACKUP_DIR/.tmp-${TS}"
mkdir -p "$TMP_DIR"
cp "$APP_DIR/.env" "$TMP_DIR/.env"
mkdir -p "$TMP_DIR/data"
cp "$BACKUP_DIR/.vcc-${TS}.db" "$TMP_DIR/data/vcc.db"   # 用 VACUUM 备份的 db 替换原 db
cp -r "$APP_DIR/config" "$TMP_DIR/config"

cd "$TMP_DIR"
tar czf "$BACKUP_PATH" data/ .env config/ 2>> "$LOG_FILE" \
    || { rm -rf "$TMP_DIR"; rm -f "$BACKUP_DIR/.vcc-${TS}.db"; err "tar 打包失败"; }

# 清理临时文件
rm -rf "$TMP_DIR"
rm -f "$BACKUP_DIR/.vcc-${TS}.db"

# ---- 步骤 3: 验证备份完整性 ----
log "[3/4] 验证备份..."
BACKUP_SIZE=$(stat -c '%s' "$BACKUP_PATH")
[[ "$BACKUP_SIZE" -gt 100000 ]] || err "备份文件太小 ($BACKUP_SIZE bytes)，可能不完整"

# 验证 tar 内容 (用临时文件避免 pipefail + SIGPIPE 问题)
TAR_LIST="$BACKUP_DIR/.tar-list-${TS}.txt"
tar tzf "$BACKUP_PATH" > "$TAR_LIST" 2>/dev/null
grep -q "^data/vcc.db$" "$TAR_LIST" || { rm -f "$TAR_LIST"; err "备份中无 data/vcc.db"; }
grep -q "^\.env$" "$TAR_LIST" || { rm -f "$TAR_LIST"; err "备份中无 .env"; }
grep -q "^config/" "$TAR_LIST" || { rm -f "$TAR_LIST"; err "备份中无 config/"; }
rm -f "$TAR_LIST"

log "  ✓ 大小: $(du -h "$BACKUP_PATH" | cut -f1)"
log "  ✓ 内容: data/vcc.db + .env + config/"

# ---- 步骤 4a: 本地轮转 (保留 N 天) ----
log "[4a/4] 本地轮转 (保留 ${LOCAL_RETENTION_DAYS} 天)..."
DELETED=$(find "$BACKUP_DIR" -maxdepth 1 -name "novacard-*.tar.gz" -mtime +${LOCAL_RETENTION_DAYS} -print -delete | wc -l)
LOCAL_COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -name "novacard-*.tar.gz" | wc -l)
log "  ✓ 删除 ${DELETED} 个旧备份，当前本地保留 ${LOCAL_COUNT} 个"

# ---- 步骤 4b: 可选 GitHub Release 推送 ----
if [[ -n "$GITHUB_PAT" && -n "$GITHUB_REPO" ]]; then
    log "[4b/4] 推送到 GitHub Release..."
    RELEASE_TAG="backup-${DATE}-${TS}"

    # 用 curl 调用 GitHub API (无需 gh CLI)
    CREATE_RELEASE=$(curl -s -X POST \
        -H "Authorization: token ${GITHUB_PAT}" \
        -H "Accept: application/vnd.github+json" \
        "https://api.github.com/repos/${GITHUB_REPO}/releases" \
        -d "{\"tag_name\":\"${RELEASE_TAG}\",\"name\":\"NovaCard Backup ${DATE}\",\"body\":\"自动备份 ${DATE}\",\"draft\":false,\"prerelease\":false}" \
        2>> "$LOG_FILE")

    UPLOAD_URL=$(echo "$CREATE_RELEASE" | grep -o '"upload_url":"[^"]*' | head -1 | cut -d'"' -f4 | sed 's/{?name,label}//')

    if [[ -n "$UPLOAD_URL" ]]; then
        curl -s -X POST \
            -H "Authorization: token ${GITHUB_PAT}" \
            -H "Content-Type: application/gzip" \
            --data-binary "@${BACKUP_PATH}" \
            "${UPLOAD_URL}?name=${BACKUP_NAME}" >> "$LOG_FILE" 2>&1 \
            && log "  ✓ 推送成功: ${GITHUB_REPO}/releases/tag/${RELEASE_TAG}" \
            || log "  ✗ 上传失败 (见日志)"
    else
        log "  ✗ Release 创建失败 (可能 PAT 权限不足)"
    fi
else
    log "[4b/4] 跳过 GitHub 推送 (未配置 GITHUB_PAT/GITHUB_REPO)"
fi

log "===== 备份完成 ====="
log ""
exit 0
