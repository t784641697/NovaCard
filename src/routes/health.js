/**
 * 健康检查端点（强化版）
 *
 * 用法：GET /health
 *
 * 返回 HTTP 200 + status="ok" + 7 维度健康详情
 * 任意关键指标异常 → HTTP 503 + status="degraded"
 *
 * 设计目的：
 *  1. 供 UptimeRobot 5 分钟 ping 一次
 *  2. 挂掉立即发邮件告警
 *  3. 一站式反映系统健康，无需额外 6 个 cron
 *
 * 检查项：
 *  - process:   进程运行时间
 *  - db:        SQLite 完整性 + 大小 + 表数 + 用户数
 *  - disk:      磁盘使用率（< 85% 健康，>= 90% 告警）
 *  - memory:    进程内存占用
 *  - ssl:       Cloudflare Origin 证书剩余天数
 *  - backup:    最近一次备份距今（> 36h 告警）
 *  - vmcardio:  配置文件存在性检查（不调用远端，避免健康检查拖垮系统）
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// ── 启动时间（用于计算 uptime）────────────────────────────────────────────
const START_TIME = Date.now();

// ── 缓存：避免 health 检查在并发压垮事件循环 ────────────────────────────
// better-sqlite3 是同步的, db.pragma + execSync 都阻塞 event loop
// 100 并发会让 P99 飙到秒级. 用 5 秒内存缓存让 UptimeRobot 这种低频检查受益
const CACHE_TTL_MS = 5000;
let cachedResult = null;
let cachedAt = 0;

const db = require('../db');

// ── 阈值配置 ──────────────────────────────────────────────────────────────
const THRESHOLDS = {
  DISK_WARN_PCT: 85,    // 磁盘使用率告警阈值
  DISK_FAIL_PCT: 95,    // 磁盘使用率失败阈值
  MEM_WARN_PCT: 85,     // 进程内存告警阈值
  MEM_FAIL_MB:  512,    // 进程 RSS 失败阈值
  SSL_WARN_DAYS: 30,    // SSL 证书告警
  SSL_FAIL_DAYS: 7,     // SSL 证书失败
  BACKUP_WARN_HOURS: 36, // 备份告警
  BACKUP_FAIL_HOURS: 72, // 备份失败
};

// ── 辅助：检查 DB ─────────────────────────────────────────────────────────
function checkDb() {
  const dbPath = path.resolve(__dirname, '../../data/vcc.db');
  const result = { ok: false, path: dbPath };

  try {
    if (!fs.existsSync(dbPath)) {
      result.error = '数据库文件不存在';
      return result;
    }

    const stat = fs.statSync(dbPath);
    result.size_mb = +(stat.size / 1024 / 1024).toFixed(2);

    // 只读模式打开（避免健康检查意外写入）
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const integrityRaw = db.pragma('integrity_check');
      // better-sqlite3 把 PRAGMA 返回 [{column: value}] 形式
      const integrity = Array.isArray(integrityRaw)
        ? integrityRaw[0]?.integrity_check
        : integrityRaw;
      result.integrity = integrity;

      if (integrity !== 'ok') {
        result.error = `数据库损坏: ${JSON.stringify(integrity)}`;
        return result;
      }

      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      ).all();
      result.tables = tables.length;

      try {
        const userCount = db.prepare('SELECT count(*) as c FROM users').get();
        result.users = userCount.c;
      } catch (e) {
        result.users = '?';
      }

      result.ok = true;
    } finally {
      db.close();
    }
  } catch (e) {
    result.error = e.message;
  }

  return result;
}

// ── 辅助：检查磁盘 ────────────────────────────────────────────────────────
function checkDisk() {
  const result = { ok: false };
  try {
    // 读取 /opt/vcc-hub 所在分区的可用空间
    // 简化方案：用 statvfs 不可靠（Node 没有），改为 exec df 命令
    const { execSync } = require('child_process');
    const dfOutput = execSync(
      "df -P /opt/vcc-hub | tail -1 | awk '{print $2, $3, $4, $5}'",
      { timeout: 3000, encoding: 'utf8' }
    ).trim();
    const [total, used, avail, pctStr] = dfOutput.split(/\s+/);
    const usedPct = parseInt(pctStr, 10);
    result.total_gb  = +(parseInt(total, 10) / 1024 / 1024).toFixed(2);
    result.used_gb   = +(parseInt(used, 10)  / 1024 / 1024).toFixed(2);
    result.free_gb   = +(parseInt(avail, 10) / 1024 / 1024).toFixed(2);
    result.used_pct  = usedPct;

    if (usedPct >= THRESHOLDS.DISK_FAIL_PCT) {
      result.error = `磁盘使用率 ${usedPct}% >= ${THRESHOLDS.DISK_FAIL_PCT}%`;
    } else {
      result.ok = true;
    }
  } catch (e) {
    result.error = '检查失败: ' + e.message;
  }
  return result;
}

// ── 辅助：检查内存（当前 Node 进程）────────────────────────────────────────
function checkMemory() {
  const m = process.memoryUsage();
  const rss_mb  = +(m.rss / 1024 / 1024).toFixed(2);
  const heap_mb = +(m.heapUsed / 1024 / 1024).toFixed(2);
  const result  = {
    ok: true,
    rss_mb,
    heap_mb,
    heap_total_mb: +(m.heapTotal / 1024 / 1024).toFixed(2),
    external_mb:   +(m.external / 1024 / 1024).toFixed(2),
  };
  if (rss_mb >= THRESHOLDS.MEM_FAIL_MB) {
    result.ok = false;
    result.error = `进程 RSS ${rss_mb}MB >= ${THRESHOLDS.MEM_FAIL_MB}MB`;
  }
  return result;
}

// ── 辅助：检查 SSL 证书（Cloudflare Origin）──────────────────────────────
function checkSsl() {
  const certPath = '/etc/ssl/cloudflare/origin-cert.pem';
  const result = { ok: false, type: 'Cloudflare Origin' };

  try {
    if (!fs.existsSync(certPath)) {
      result.error = '证书文件不存在';
      return result;
    }

    const { execSync } = require('child_process');
    // openssl x509 -enddate -noout 输出: notAfter=Jun 16 19:21:00 2041 GMT
    const output = execSync(
      `openssl x509 -enddate -noout -in ${certPath}`,
      { timeout: 3000, encoding: 'utf8' }
    ).trim();
    const dateStr = output.replace('notAfter=', '');
    const expireDate = new Date(dateStr);
    const now = new Date();
    const expiresInDays = Math.floor((expireDate - now) / 86400000);
    result.expires_at = expireDate.toISOString();
    result.expires_in_days = expiresInDays;

    if (expiresInDays <= THRESHOLDS.SSL_FAIL_DAYS) {
      result.error = `证书仅剩 ${expiresInDays} 天`;
    } else {
      result.ok = true;
      if (expiresInDays <= THRESHOLDS.SSL_WARN_DAYS) {
        result.warning = `证书将在 ${expiresInDays} 天后过期`;
      }
    }
  } catch (e) {
    result.error = '检查失败: ' + e.message;
  }
  return result;
}

// ── 辅助：检查最近备份 ────────────────────────────────────────────────────
function checkBackup() {
  const result = { ok: false };
  const backupDir = '/opt/vcc-hub/backups';
  const logPath = '/var/log/novacard-backup.log';

  try {
    // 优先从备份目录取最新文件
    if (fs.existsSync(backupDir)) {
      const files = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('novacard-') && f.endsWith('.tar.gz'))
        .map(f => ({
          name: f,
          mtime: fs.statSync(path.join(backupDir, f)).mtime,
        }))
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length > 0) {
        const latest = files[0];
        const ageHours = (Date.now() - latest.mtime.getTime()) / 3600000;
        result.latest_file = latest.name;
        result.latest_age_hours = +ageHours.toFixed(1);
        result.total_backups = files.length;

        if (ageHours <= THRESHOLDS.BACKUP_WARN_HOURS) {
          result.ok = true;
        } else if (ageHours <= THRESHOLDS.BACKUP_FAIL_HOURS) {
          result.ok = true;
          result.warning = `距上次备份 ${ageHours.toFixed(1)} 小时`;
        } else {
          result.error = `距上次备份 ${ageHours.toFixed(1)} 小时，超过 ${THRESHOLDS.BACKUP_FAIL_HOURS} 小时`;
        }
        return result;
      }
    }

    // 备份目录为空 → 检查日志
    if (fs.existsSync(logPath)) {
      const stat = fs.statSync(logPath);
      const ageHours = (Date.now() - stat.mtime.getTime()) / 3600000;
      result.log_age_hours = +ageHours.toFixed(1);
      result.error = '备份目录为空，但日志存在';
    } else {
      result.error = '备份目录和日志都不存在，备份可能未配置';
    }
  } catch (e) {
    result.error = '检查失败: ' + e.message;
  }
  return result;
}

// ── 辅助：检查 vmcardio 上游同步状态 ────────────────────────────────────
function checkVmcardioSync() {
  const result = { ok: false };
  try {
    const rows = db.prepare(
      "SELECT key, value FROM settings WHERE key LIKE 'last_tx_sync%'"
    ).all();
    const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    result.status = s.last_tx_sync_status || 'never';
    result.last_time = s.last_tx_sync_time || null;
    result.last_count = parseInt(s.last_tx_sync_count || '0', 10);
    result.last_error = s.last_tx_sync_error || null;
    if (result.last_time) {
      const ageMs = Date.now() - new Date(result.last_time).getTime();
      result.age_hours = Math.round((ageMs / 3600000) * 10) / 10;
    } else {
      result.age_hours = null;
    }
    // 关键：48 小时没成功同步 → 告警
    result.ok =
      ['ok', 'success'].includes(result.status) &&
      result.age_hours !== null &&
      result.age_hours < 48;
  } catch (e) {
    result.error = e.message;
  }
  return result;
}

// ── 辅助：检查 vmcardio 配置 ──────────────────────────────────────────────
function checkVmcardioConfig() {
  const result = { ok: false };
  try {
    const merchantPriv = '/opt/vcc-hub/config/merchant_private.pem';
    const platformPub  = '/opt/vcc-hub/config/vmcardio_platform_public.pem';

    result.merchant_private = fs.existsSync(merchantPriv);
    result.platform_public  = fs.existsSync(platformPub);

    if (result.merchant_private && result.platform_public) {
      result.ok = true;
    } else {
      result.error = 'RSA 密钥缺失';
    }
  } catch (e) {
    result.error = e.message;
  }
  return result;
}

// ── 主路由 ────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  // 命中缓存: 5 秒内的重复请求直接返回 (避免压测/真实高并发阻塞 event loop)
  if (cachedResult && Date.now() - cachedAt < CACHE_TTL_MS) {
    res.set('X-Health-Cache', 'hit');
    return res.status(cachedResult.httpCode).json(cachedResult.body);
  }

  const uptimeSec = Math.floor((Date.now() - START_TIME) / 1000);

  const checks = {
    process: { ok: true,  uptime_sec: uptimeSec, pid: process.pid, node: process.version },
    db:      checkDb(),
    disk:    checkDisk(),
    memory:  checkMemory(),
    ssl:     checkSsl(),
    backup:  checkBackup(),
    vmcardio_sync:    checkVmcardioSync(),
    vmcardio_config:  checkVmcardioConfig(),
  };

  // 总体状态：所有关键项 ok 才算 ok
  // 关键项: db, ssl, backup, vmcardio_sync
  // 非关键: disk/memory/vmcardio_config（有 warning 不影响整体）
  const critical = ['db', 'ssl', 'backup', 'vmcardio_sync'];
  const allOk    = critical.every(k => checks[k].ok);
  const anyFail  = critical.some(k => !checks[k].ok);

  let status, httpCode;
  if (allOk) {
    status = 'ok';
    httpCode = 200;
  } else if (anyFail) {
    status = 'degraded';
    httpCode = 503;
  } else {
    status = 'warning';
    httpCode = 200;
  }

  const body = {
    status,
    env:    process.env.NODE_ENV || 'unknown',
    time:   new Date().toISOString(),
    uptime_sec: uptimeSec,
    checks,
  };

  // 写入缓存
  cachedResult = { httpCode, body };
  cachedAt = Date.now();

  res.set('X-Health-Cache', 'miss');
  res.status(httpCode).json(body);
});

module.exports = router;
