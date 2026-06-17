#!/usr/bin/env node

// Load .env first so SDK picks up VMCARDIO_* config
require('dotenv').config();
/**
 * 上游交易自动同步 - 定时任务入口
 *
 * 用途：被 Vultr cron 每天 04:00 调用
 *   0 4 * * * /opt/vcc-hub/src/services/autoSync.js >> /var/log/novacard-sync.log 2>&1
 *
 * 行为：
 *   1. 默认同步最近 24 小时（start=昨天 00:00, end=今天 00:00）
 *   2. 调用 transactionSyncService.syncTransactions()
 *   3. 失败重试 3 次（指数退避：5s / 15s / 45s）
 *   4. 同步结果写入 settings 表（last_tx_sync_time / last_tx_sync_count / last_tx_sync_error）
 *   5. 同步异常时记录 audit_logs
 *
 * 退出码：
 *   0 = 全部成功
 *   1 = 部分失败（健康端点会标 degraded）
 *   2 = 完全失败
 */

const logger = require('../utils/logger');
const db     = require('../db');

const { syncTransactions } = require('./transactionSyncService');

// 同步窗口（小时）
const SYNC_WINDOW_HOURS = parseInt(process.env.TX_SYNC_WINDOW_HOURS || '24', 10);
// 最大重试次数
const MAX_RETRIES = 3;

/**
 * 写入同步状态到 settings 表
 */
function writeSyncStatus({ status, count, error, durationMs }) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
  `);
  stmt.run('last_tx_sync_time',     now,                                                now);
  stmt.run('last_tx_sync_status',   status,                                             now);
  stmt.run('last_tx_sync_count',    String(count || 0),                                 now);
  stmt.run('last_tx_sync_duration', String(durationMs),                                 now);
  // 成功时清空 error 字段 (保持状态干净)
  if (error) stmt.run('last_tx_sync_error', error.substring(0, 500), now);
  else {
    const dbNow = new Date().toISOString();
    const del = db.prepare("DELETE FROM settings WHERE key = 'last_tx_sync_error'");
    del.run();
  }
}

/**
 * 记录同步异常到 audit_logs
 */
function logSyncError(stage, error) {
  try {
    db.prepare(`
      INSERT INTO audit_logs (user_id, action, detail, ip, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      1, // 系统用户
      'TX_SYNC_FAILED',
      JSON.stringify({ stage, error: error.message?.substring(0, 500) }),
      '127.0.0.1',
      new Date().toISOString()
    );
  } catch (e) {
    logger.error('[autoSync] 写 audit_logs 失败:', e.message);
  }
}

/**
 * 同步主流程（带重试）
 */
async function runWithRetry() {
  const startTs = Date.now();
  const endTime   = new Date();
  const startTime = new Date(endTime.getTime() - SYNC_WINDOW_HOURS * 3600 * 1000);

  const fmt = d => d.toISOString().replace('T', ' ').substring(0, 19);
  logger.info(`[autoSync] 开始同步: ${fmt(startTime)} → ${fmt(endTime)} (窗口=${SYNC_WINDOW_HOURS}h)`);

  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await syncTransactions({
        startTime: fmt(startTime),
        endTime:   fmt(endTime),
        pageSize:  500,
      });

      const durationMs = Date.now() - startTs;
      logger.info(`[autoSync] 同步成功: synced=${result.synced} total=${result.total} duration=${durationMs}ms`);

      writeSyncStatus({
        status:    'ok',
        count:     result.synced,
        error:     null,
        durationMs,
      });
      return 0;
    } catch (err) {
      lastErr = err;
      const waitMs = [0, 5000, 15000, 45000][attempt] || 45000;
      logger.warn(`[autoSync] 第 ${attempt}/${MAX_RETRIES} 次失败: ${err.message} (${waitMs}ms 后重试)`);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
  }

  // 三次都失败
  const durationMs = Date.now() - startTs;
  logger.error(`[autoSync] 同步失败: ${lastErr?.message}`);
  logSyncError('autoSync', lastErr);
  writeSyncStatus({
    status:    'failed',
    count:     0,
    error:     lastErr?.message || 'unknown',
    durationMs,
  });
  return 2;
}

// 主入口
(async () => {
  const exitCode = await runWithRetry();
  process.exit(exitCode);
})().catch(e => {
  logger.error('[autoSync] 未捕获异常:', e);
  process.exit(2);
});
