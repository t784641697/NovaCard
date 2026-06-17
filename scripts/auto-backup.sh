#!/bin/bash
# ============================================================
# NovaCard 自动备份脚本 (v2 - 支持 GPG 加密)
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
GPG_BIN="$(command -v gpg)"

# ---- 备份保留天数 ----
LOCAL_RETENTION_DAYS=7

# ---- GitHub Release 配置 (可选) ----
# 启用方法: 在 /opt/vcc-hub/.env 中添加 GITHUB_PAT 和 GITHUB_REPO 变量
GITHUB_PAT=""
GITHUB_REPO=""

# ---- GPG 加密配置 (强烈推荐) ----
# 启用方法: 在 /opt/vcc-hub/.env 中添加 BACKUP_PASSPHRASE=你的强密码
# 推荐 16+ 字符: openssl rand -base64 24
# 加密后产物: backup.tar.gz.gpg (AES-256 对称加密)
# 解密命令: gpg -d --pinentry-mode loopback --passphrase "$PASS" backup.tar.gz.gpg > backup.tar.gz
BACKUP_PASSPHRASE=""
ENABLE_GPG=false

# ---- 加载环境变量 ----
if [[ -f "$APP_DIR/.env" ]]; then
    while IFS='=' read -r key value; do
        case "$key" in
            GITHUB_PAT|GITHUB_REPO|BACKUP_PASSPHRASE)
                value="${value%\"}"; value="${value#\"}"
                value="${value%\'}"; value="${value#\'}"
                if [[ "$key" == "GITHUB_PAT" ]]; then GITHUB_PAT="$value"; fi
                if [[ "$key" == "GITHUB_REPO" ]]; then GITHUB_REPO="$value"; fi
                if [[ "$key" == "BACKUP_PASSPHRASE" ]]; then
                    BACKUP_PASSPHRASE="$value"
                    [[ -n "$value" ]] && ENABLE_GPG=true
                fi
                ;;
        esac
    done < <(grep -E '^(GITHUB_PAT|GITHUB_REPO|BACKUP_PASSPHRASE)=' "$APP_DIR/.env" || true)
fi

# ---- 辅助函数 ----
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE" >&2; }
err() { log "ERROR: $*"; exit 1; }

# ---- 预检查 ----
[[ -d "$APP_DIR" ]] || err "目录不存在: $APP_DIR"
[[ -d "$APP_DIR/data" ]] || err "data 目录不存在: $APP_DIR/data"
[[ -f "$APP_DIR/.env" ]] || err ".env 不存在: $APP_DIR/.env"
[[ -x "$NODE_BIN" ]] || err "node 未安装"
if $ENABLE_GPG; then
    [[ -x "$GPG_BIN" ]] || err "gpg 未安装, 无法启用加密 (apt install gnupg)"
fi

mkdir -p "$BACKUP_DIR"

# ---- 生成备份文件名 ----
TS=$(date '+%Y%m%d-%H%M%S')
DATE=$(date '+%Y-%m-%d')
BACKUP_NAME="novacard-${DATE}-${TS}.tar.gz"
BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"
GPG_PATH="${BACKUP_PATH}.gpg"

log "===== 开始备份 ====="
log "目标: $BACKUP_PATH"
$ENABLE_GPG && log "加密: 启用 (AES-256 GPG 对称)"

# ---- 步骤 1: SQLite 在线热备份 (用 node + better-sqlite3) ----
log "[1/5] SQLite 热备份 (VACUUM INTO)..."
TMP_DB="$BACKUP_DIR/.vcc-${TS}.db.tmp"

cd "$APP_DIR"
"$NODE_BIN" -e "
const Database = require('better-sqlite3');
const src = new Database('data/vcc.db');
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
log "[2/5] 打包 tar.gz..."
TMP_DIR="$BACKUP_DIR/.tmp-${TS}"
mkdir -p "$TMP_DIR"
cp "$APP_DIR/.env" "$TMP_DIR/.env"
mkdir -p "$TMP_DIR/data"
cp "$BACKUP_DIR/.vcc-${TS}.db" "$TMP_DIR/data/vcc.db"
cp -r "$APP_DIR/config" "$TMP_DIR/config"

cd "$TMP_DIR"
tar czf "$BACKUP_PATH" data/ .env config/ 2>> "$LOG_FILE" \
    || { rm -rf "$TMP_DIR"; rm -f "$BACKUP_DIR/.vcc-${TS}.db"; err "tar 打包失败"; }

rm -rf "$TMP_DIR"
rm -f "$BACKUP_DIR/.vcc-${TS}.db"

# ---- 步骤 3: GPG 对称加密 (可选) ----
if $ENABLE_GPG; then
    log "[3/5] GPG 加密 (AES-256)..."
    "$GPG_BIN" --batch --yes --pinentry-mode loopback \
        --passphrase "$BACKUP_PASSPHRASE" \
        --cipher-algo AES256 \
        --symmetric \
        --output "$GPG_PATH" \
        "$BACKUP_PATH" 2>> "$LOG_FILE" \
        || { rm -f "$BACKUP_PATH" "$GPG_PATH"; err "GPG 加密失败"; }

    GPG_SIZE=$(stat -c '%s' "$GPG_PATH")
    log "  ✓ tar.gz: $(du -h "$BACKUP_PATH" | cut -f1) → .gpg: $(du -h "$GPG_PATH" | cut -f1)"

    # 加密后删除明文 tar.gz (降低泄漏风险)
    PLAINTEXT_SHRED=$(command -v shred || true)
    if [[ -n "$PLAINTEXT_SHRED" ]]; then
        shred -u "$BACKUP_PATH" 2>/dev/null || rm -f "$BACKUP_PATH"
    else
        rm -f "$BACKUP_PATH"
    fi
    log "  ✓ 明文 tar.gz 已删除"

    # 切换到 .gpg 文件作为主备份
    BACKUP_PATH="$GPG_PATH"
    BACKUP_NAME="${BACKUP_NAME}.gpg"
else
    log "[3/5] 跳过 GPG 加密 (未配置 BACKUP_PASSPHRASE)"
fi

# ---- 步骤 4: 验证备份完整性 ----
log "[4/5] 验证备份..."
BACKUP_SIZE=$(stat -c '%s' "$BACKUP_PATH")
[[ "$BACKUP_SIZE" -gt 100000 ]] || err "备份文件太小 ($BACKUP_SIZE bytes), 可能不完整"

if $ENABLE_GPG; then
    # 验证 GPG 头 (magic bytes: 0x8c 0x0d 或 0x85 0x01 等)
    HEAD1=$(head -c 2 "$BACKUP_PATH" | od -An -tx1 | tr -d ' ')
    case "$HEAD1" in
        8c0d|8501|8c0d0409*) log "  ✓ GPG magic OK ($HEAD1)" ;;
        *) err "GPG 文件 magic bytes 不对: $HEAD1" ;;
    esac

    # 真正解密一次 (写到临时文件, 验证密码正确)
    DECRYPT_TMP="$BACKUP_DIR/.decrypt-test-${TS}.tar.gz"
    "$GPG_BIN" --batch --yes --pinentry-mode loopback \
        --passphrase "$BACKUP_PASSPHRASE" \
        --decrypt \
        --output "$DECRYPT_TMP" \
        "$BACKUP_PATH" 2>> "$LOG_FILE" \
        || { rm -f "$DECRYPT_TMP"; err "GPG 解密失败 (密码错或文件损坏)"; }

    # 验证解密后的 tar 内容
    TAR_LIST="$BACKUP_DIR/.tar-list-${TS}.txt"
    tar tzf "$DECRYPT_TMP" > "$TAR_LIST" 2>/dev/null
    grep -q "^data/vcc.db$" "$TAR_LIST" || { rm -f "$TAR_LIST" "$DECRYPT_TMP"; err "解密后无 data/vcc.db"; }
    grep -q "^\.env$" "$TAR_LIST" || { rm -f "$TAR_LIST" "$DECRYPT_TMP"; err "解密后无 .env"; }
    rm -f "$TAR_LIST" "$DECRYPT_TMP"
    log "  ✓ GPG 解密 + 内容校验通过"
else
    # 明文模式: 验证 tar 内容
    TAR_LIST="$BACKUP_DIR/.tar-list-${TS}.txt"
    tar tzf "$BACKUP_PATH" > "$TAR_LIST" 2>/dev/null
    grep -q "^data/vcc.db$" "$TAR_LIST" || { rm -f "$TAR_LIST"; err "备份中无 data/vcc.db"; }
    grep -q "^\.env$" "$TAR_LIST" || { rm -f "$TAR_LIST"; err "备份中无 .env"; }
    grep -q "^config/" "$TAR_LIST" || { rm -f "$TAR_LIST"; err "备份中无 config/"; }
    rm -f "$TAR_LIST"
fi

log "  ✓ 最终文件: $(du -h "$BACKUP_PATH" | cut -f1)"

# ---- 步骤 5a: 本地轮转 ----
log "[5a/5] 本地轮转 (保留 ${LOCAL_RETENTION_DAYS} 天)..."
# 同时清理 .tar.gz 和 .tar.gz.gpg 两种格式
DELETED=$(find "$BACKUP_DIR" -maxdepth 1 \( -name "novacard-*.tar.gz" -o -name "novacard-*.tar.gz.gpg" \) -mtime +${LOCAL_RETENTION_DAYS} -print -delete | wc -l)
LOCAL_COUNT=$(find "$BACKUP_DIR" -maxdepth 1 \( -name "novacard-*.tar.gz" -o -name "novacard-*.tar.gz.gpg" \) | wc -l)
log "  ✓ 删除 ${DELETED} 个旧备份, 当前本地保留 ${LOCAL_COUNT} 个"

# ---- 步骤 5b: 可选 GitHub Release 推送 ----
if [[ -n "$GITHUB_PAT" && -n "$GITHUB_REPO" ]]; then
    log "[5b/5] 推送到 GitHub Release..."
    RELEASE_TAG="backup-${DATE}-${TS}"

    CREATE_RELEASE=$(curl -s -X POST \
        -H "Authorization: token ${GITHUB_PAT}" \
        -H "Accept: application/vnd.github+json" \
        "https://api.github.com/repos/${GITHUB_REPO}/releases" \
        -d "{\"tag_name\":\"${RELEASE_TAG}\",\"name\":\"NovaCard Backup ${DATE}\",\"body\":\"自动备份 ${DATE}$($ENABLE_GPG && echo ' (GPG 加密)'\")\",\"draft\":false,\"prerelease\":false}" \
        2>> "$LOG_FILE")

    UPLOAD_URL=$(echo "$CREATE_RELEASE" | grep -o '"upload_url":"[^"]*' | head -1 | cut -d'"' -f4 | sed 's/{?name,label}//')

    if [[ -n "$UPLOAD_URL" ]]; then
        # GPG 文件用二进制上传, MIME 用 application/pgp-encrypted
        CONTENT_TYPE="application/octet-stream"
        $ENABLE_GPG && CONTENT_TYPE="application/pgp-encrypted"

        curl -s -X POST \
            -H "Authorization: token ${GITHUB_PAT}" \
            -H "Content-Type: ${CONTENT_TYPE}" \
            --data-binary "@${BACKUP_PATH}" \
            "${UPLOAD_URL}?name=${BACKUP_NAME}" >> "$LOG_FILE" 2>&1 \
            && log "  ✓ 推送成功: ${GITHUB_REPO}/releases/tag/${RELEASE_TAG}" \
            || log "  ✗ 上传失败 (见日志)"
    else
        log "  ✗ Release 创建失败 (可能 PAT 权限不足)"
    fi
else
    log "[5b/5] 跳过 GitHub 推送 (未配置 GITHUB_PAT/GITHUB_REPO)"
fi

log "===== 备份完成 ====="
log ""
exit 0
