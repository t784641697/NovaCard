/**
 * 交易流水同步服务
 * 从 vmcardio 上游拉取 /cardTransaction 数据，存入本地 card_transactions 表
 */
const db = require('../db');
const logger = require('../utils/logger');
const FeeCalculator = require('./feeCalculator');
const { getFeeRate } = require('./feeCalculator');

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
          db.prepare(`UPDATE card_transactions SET type=?, status=?, settle_amount=?, description=?, sync_time=nowiso() WHERE auth_id=?`)
            .run(tx.type || '', tx.status || '', tx.settle_amount || 0, tx.description || '', tx.auth_id);
        } else {
          db.prepare(`INSERT INTO card_transactions
            (auth_id, card_id, type, status, auth_amount, settle_amount, auth_currency, settle_currency, merchant_name, description, create_time, auth_time, sync_time)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,nowiso())`)
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
              tx.description || '',
              tx.create_time || '',
              tx.auth_time || ''
            );
        }
        totalSynced++;
      }

      if (list.length < pageSize) break;
      page++;
    }

    // ---- DECLINED 消费失败手续费扣费 ----
    try {
      _deductDeclinedFees();
    } catch (e) {
      logger.error(`[txSync] declined fee deduction failed: ${e.message}`);
    }

    // ---- Authorization Cancel 撤销手续费扣费 ----
    try {
      _deductReversalFees();
    } catch (e) {
      logger.error(`[txSync] reversal fee deduction failed: ${e.message}`);
    }

    logger.info(`[txSync] synced ${totalSynced} transactions (total=${total})`);
    return { synced: totalSynced, total };
  } catch (e) {
    logger.error(`[txSync] failed: ${e.message}`);
    throw e;
  }
}

/**
 * 对 fee_deducted=0 的 DECLINED 交易扣手续费
 * 优先扣卡内余额 → 不够再扣账户余额
 */
function _deductDeclinedFees() {
  const declinedRows = db.prepare(
    `SELECT ct.id, ct.auth_id, ct.card_id, ct.auth_amount
     FROM card_transactions ct
     WHERE ct.status = 'DECLINED' AND ct.fee_deducted = 0`
  ).all();

  if (!declinedRows.length) return;

  const stmtUpdateFee = db.prepare(`UPDATE card_transactions SET fee_deducted = 1 WHERE id = ?`);
  const stmtUpdateCardBal = db.prepare(`UPDATE cards SET available_amount = ? WHERE card_id = ?`);
  const stmtUpdateUserBal = db.prepare(`UPDATE users SET balance = ? WHERE id = ?`);
  const stmtInsertTx = db.prepare(
    `INSERT INTO transactions (user_id, type, amount, description, ref_id, created_at)
     VALUES (?, '手续费', ?, ?, ?, datetime('now'))`
  );

  let deducted = 0;

  for (const row of declinedRows) {
    // 找到卡片和所属用户
    const card = db.prepare(`SELECT card_id, user_id, available_amount FROM cards WHERE card_id = ?`).get(row.card_id);
    if (!card) {
      // 没找到卡片，无法扣费，标记已处理避免重复
      stmtUpdateFee.run(row.id);
      logger.warn(`[declinedFee] card_id=${row.card_id} not found in cards, skip (auth_id=${row.auth_id})`);
      continue;
    }

    const userId = card.user_id;

    // 查用户的 declined_fee 费率
    let feeConfig;
    try {
      feeConfig = FeeCalculator.getFeeConfig('declined_fee', userId);
    } catch (e) {
      // 无费率配置，跳过
      stmtUpdateFee.run(row.id);
      continue;
    }

    // 计算手续费 = 固定金额 + 百分比 × 授权金额
    const authAmt = Math.abs(row.auth_amount || 0);
    const feeFixed = feeConfig.fee_fixed || 0;
    const feePercent = feeConfig.fee_rate || 0;
    const feeAmount = Math.round((feeFixed + authAmt * feePercent) * 100) / 100;
    if (feeAmount <= 0) {
      stmtUpdateFee.run(row.id);
      continue;
    }

    // 扣费：只从账户余额扣（卡内余额会被上游同步覆盖，不可靠）
    const user = db.prepare(`SELECT id, balance FROM users WHERE id = ?`).get(userId);
    const userBal = user ? (user.balance || 0) : 0;

    const fromAccount = Math.min(feeAmount, userBal);

    if (fromAccount <= 0) {
      // 账户余额不足，标记已处理
      stmtUpdateFee.run(row.id);
      logger.warn(`[declinedFee] user=${userId} card=${row.card_id} no balance to deduct fee $${feeAmount} (auth_id=${row.auth_id})`);
      continue;
    }

    // 扣账户余额
    stmtUpdateUserBal.run(userBal - fromAccount, userId);

    // 写流水
    const desc = `消费失败手续费(${row.auth_id}) 账户扣$${fromAccount.toFixed(2)}`;

    stmtInsertTx.run(userId, -fromAccount, desc, row.card_id);

    // 标记已扣费
    stmtUpdateFee.run(row.id);

    deducted++;
    logger.info(`[declinedFee] user=${userId} card=${row.card_id} fee=$${feeAmount.toFixed(2)}(card=$${fromCard.toFixed(2)} acct=$${fromAccount.toFixed(2)}) auth_id=${row.auth_id}`);
  }

  if (deducted > 0) {
    logger.info(`[declinedFee] deducted ${deducted} DECLINED fees`);
  }
}

/**
 * 对 fee_deducted=0 的 Authorization Cancel 交易扣撤销手续费 (auth_reversal)
 * 优先扣卡内余额 → 不够再扣账户余额
 */
function _deductReversalFees() {
  const reversalRows = db.prepare(
    `SELECT ct.id, ct.auth_id, ct.card_id, ct.auth_amount
     FROM card_transactions ct
     WHERE ct.type IN ('Authorization Cancel', 'Reversal') AND ct.fee_deducted = 0`
  ).all();

  if (!reversalRows.length) return;

  const stmtUpdateFee = db.prepare(`UPDATE card_transactions SET fee_deducted = 1 WHERE id = ?`);
  const stmtUpdateCardBal = db.prepare(`UPDATE cards SET available_amount = ? WHERE card_id = ?`);
  const stmtUpdateUserBal = db.prepare(`UPDATE users SET balance = ? WHERE id = ?`);
  const stmtInsertTx = db.prepare(
    `INSERT INTO transactions (user_id, type, amount, description, ref_id, created_at)
     VALUES (?, '手续费', ?, ?, ?, datetime('now'))`
  );

  let deducted = 0;

  for (const row of reversalRows) {
    const card = db.prepare(`SELECT card_id, user_id, available_amount FROM cards WHERE card_id = ?`).get(row.card_id);
    if (!card) {
      stmtUpdateFee.run(row.id);
      logger.warn(`[reversalFee] card_id=${row.card_id} not found in cards, skip (auth_id=${row.auth_id})`);
      continue;
    }

    const userId = card.user_id;

    let feeConfig;
    try {
      feeConfig = FeeCalculator.getFeeConfig('auth_reversal', userId);
    } catch (e) {
      stmtUpdateFee.run(row.id);
      continue;
    }

    const authAmt = Math.abs(row.auth_amount || 0);
    const feeFixed = feeConfig.fee_fixed || 0;
    const feePercent = feeConfig.fee_rate || 0;
    const feeAmount = Math.round((feeFixed + authAmt * feePercent) * 100) / 100;
    if (feeAmount <= 0) {
      stmtUpdateFee.run(row.id);
      continue;
    }

    // 扣费：只从账户余额扣（卡内余额会被上游同步覆盖，不可靠）
    const user = db.prepare(`SELECT id, balance FROM users WHERE id = ?`).get(userId);
    const userBal = user ? (user.balance || 0) : 0;

    const fromAccount = Math.min(feeAmount, userBal);

    if (fromAccount <= 0) {
      stmtUpdateFee.run(row.id);
      logger.warn(`[reversalFee] user=${userId} card=${row.card_id} no balance to deduct fee $${feeAmount} (auth_id=${row.auth_id})`);
      continue;
    }

    // 扣账户余额
    stmtUpdateUserBal.run(userBal - fromAccount, userId);

    const desc = `撤销手续费(${row.auth_id}) 账户扣$${fromAccount.toFixed(2)}`;

    stmtInsertTx.run(userId, -fromAccount, desc, row.card_id);

    stmtUpdateFee.run(row.id);

    deducted++;
    logger.info(`[reversalFee] user=${userId} card=${row.card_id} fee=$${feeAmount.toFixed(2)}(card=$${fromCard.toFixed(2)} acct=$${fromAccount.toFixed(2)}) auth_id=${row.auth_id}`);
  }

  if (deducted > 0) {
    logger.info(`[reversalFee] deducted ${deducted} reversal fees`);
  }
}

module.exports = { syncTransactions };