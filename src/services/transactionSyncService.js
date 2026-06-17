/**
 * 交易流水同步服务
 * 从 vmcardio 上游拉取 /cardTransaction 数据，存入本地 card_transactions 表
 */
const db = require('../db');
const logger = require('../utils/logger');

/**
 * 同步所有卡片的交易流水
 * @param {Object} opts
 * @param {string} opts.startTime - 开始时间 (YYYY-MM-DD HH:mm:ss)
 * @param {string} opts.endTime   - 结束时间
 * @param {number} opts.pageSize  - 每页大小，默认 200
 * @returns {Promise<{synced:number, total:number}>}
 */
async function syncTransactions(opts = {}) {
  const sdk = require('./vmcardioSDK');
  const startTime = opts.startTime;
  const endTime   = opts.endTime;
  const pageSize  = opts.pageSize || 200;

  let page = 1;
  let totalSynced = 0;
  let total = 0;

  try {
    while (true) {
      const params = { page, page_size: pageSize };
      if (startTime) params.start_time = startTime;
      if (endTime)   params.end_time = endTime;

      const result = await sdk.cardTransaction(params);
      const list = result.list || [];
      total = result.total || 0;

      for (const tx of list) {
        const existing = db.prepare('SELECT id FROM card_transactions WHERE auth_id = ?').get(tx.auth_id);
        if (existing) {
          db.prepare(`UPDATE card_transactions SET status=?, settle_amount=?, sync_time=nowiso() WHERE auth_id=?`)
            .run(tx.status || '', tx.settle_amount || 0, tx.auth_id);
        } else {
          db.prepare(`INSERT INTO card_transactions
            (auth_id, card_id, type, status, auth_amount, settle_amount, auth_currency, settle_currency, merchant_name, create_time, auth_time, sync_time)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,nowiso())`)
            .run(
              tx.auth_id || '',
              tx.card_id || '',
              tx.type || '',
              tx.status || '',
              tx.auth_amount || 0,
              tx.settle_amount || 0,
              tx.auth_currency || 'USD',
              tx.settle_currency || 'USD',
              tx.merchant_name || '',
              tx.create_time || '',
              tx.auth_time || ''
            );
        }
        totalSynced++;
      }

      if (list.length < pageSize) break;
      page++;
    }

    logger.info(`[txSync] synced ${totalSynced} transactions (total=${total})`);
    return { synced: totalSynced, total };
  } catch (e) {
    logger.error(`[txSync] failed: ${e.message}`);
    throw e;
  }
}

module.exports = { syncTransactions };