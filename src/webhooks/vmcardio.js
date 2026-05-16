/**
 * vmcardio WebHook 处理器
 * POST /api/webhook/vmcardio
 *
 * vmcardio 推送字段：
 *   auth_id / card_id / auth_time / auth_amount / auth_currency /
 *   settle_amount / settle_currency / status / type / merchant_name /
 *   create_time / description
 *
 * 推送类型（type）：
 *   Authorization — 预授权（消费发生时）
 *   Settlement    — 结算（真正扣款）
 *
 * 响应要求：必须返回 {"code":0,"msg":"ok"}，否则 vmcardio 会重试（最多 3 次）
 *
 * 费用处理逻辑：
 *   - 小额授权费（small_transaction）：Authorization 事件中，auth_amount < $1 时触发
 *   - 跨境交易费（cross_border）：Settlement 事件中，settle_currency ≠ USD 时触发
 */

const express = require('express');
const router  = express.Router();
const logger  = require('../utils/logger');
const FeeCalculator = require('../services/feeCalculator');

// ── 推送事件处理函数映射 ──────────────────────────────────────────────────
const eventHandlers = {
  Authorization: handleAuthorization,
  Settlement:    handleSettlement,
};

// ── POST /api/webhook/vmcardio ────────────────────────────────────────────
router.post('/vmcardio', express.json(), async (req, res) => {
  // 1. 立即响应，告知 vmcardio 已收到（防止超时重试）
  res.json({ code: 0, msg: 'ok' });

  // 2. 异步处理业务逻辑
  try {
    const event = req.body;
    logger.info(`[webhook] 收到推送 type=${event.type} auth_id=${event.auth_id} card_id=${event.card_id}`);

    // 基础字段校验
    if (!event.auth_id || !event.type) {
      logger.warn('[webhook] 推送缺少必要字段，已忽略', event);
      return;
    }

    // 分发到对应处理器
    const handler = eventHandlers[event.type];
    if (handler) {
      await handler(event);
    } else {
      logger.warn(`[webhook] 未知推送类型：${event.type}`);
    }
  } catch (err) {
    // 这里的错误不影响响应（已先 res.json），仅记录日志
    logger.error('[webhook] 处理推送时出错：', err);
  }
});

// ── 预授权事件处理 ────────────────────────────────────────────────────────
async function handleAuthorization(event) {
  const authAmount = parseFloat(event.auth_amount) || 0;
  const authCurrency = (event.auth_currency || 'USD').toUpperCase();
  const cardId = event.card_id;
  const authId = event.auth_id;

  logger.info(`[webhook:Authorization] 商户=${event.merchant_name} 金额=${authAmount} ${authCurrency} card_id=${cardId}`);

  try {
    const db = require('../db/database');
    const card = db.prepare('SELECT user_id FROM cards WHERE card_id = ?').get(cardId);

    if (!card) {
      logger.warn(`[webhook:Authorization] 找不到卡 ${cardId} 的用户信息`);
      return;
    }

    const userId = card.user_id;

    // ── 小额授权费判断：单笔授权金额 < $1 ──
    // 只对 USD 计算金额阈值，非 USD 的授权由 Settlement 阶段处理
    if (authCurrency === 'USD' && authAmount > 0 && authAmount < 1) {
      try {
        const feeResult = FeeCalculator.calculateFee('small_transaction', authAmount, userId);
        const feeAmount = feeResult.fee_amount;

        if (feeAmount > 0) {
          const BalanceService = require('../services/balanceService');
          const result = BalanceService.recordFeeOnly(
            userId,
            'small_transaction',
            feeAmount,
            `小额授权费（授权 $${authAmount.toFixed(2)} @ ${event.merchant_name || '未知商户'}）`,
            authId
          );
          logger.info(`[webhook:Authorization] 用户 ${userId} 小额授权费 $${feeAmount.toFixed(2)} 已扣除，余额 $${result.old_balance} → $${result.new_balance}`);
        }
      } catch (feeErr) {
        logger.error(`[webhook:Authorization] 小额授权费计算/扣除失败:`, feeErr.message);
      }
    }

    // TODO: 插入 PENDING 状态的交易记录
    // TODO: 推送实时通知给前端（WebSocket / Server-Sent Events）

  } catch (err) {
    logger.error(`[webhook:Authorization] 处理失败:`, err);
  }
}

// ── 结算事件处理 ──────────────────────────────────────────────────────────
async function handleSettlement(event) {
  const settleAmount = parseFloat(event.settle_amount) || 0;
  const settleCurrency = (event.settle_currency || 'USD').toUpperCase();
  const cardId = event.card_id;
  const authId = event.auth_id;
  const merchantName = event.merchant_name || '未知商户';

  logger.info(`[webhook:Settlement] auth_id=${authId} settle_amount=${settleAmount} ${settleCurrency} status=${event.status} card_id=${cardId}`);

  try {
    const db = require('../db/database');
    const card = db.prepare('SELECT user_id FROM cards WHERE card_id = ?').get(cardId);

    if (!card) {
      logger.warn(`[webhook:Settlement] 找不到卡 ${cardId} 的用户信息`);
      return;
    }

    const userId = card.user_id;
    const BalanceService = require('../services/balanceService');

    // ── 跨境交易费判断：结算币种 ≠ USD ──
    if (settleCurrency !== 'USD' && settleAmount > 0) {
      try {
        const feeResult = FeeCalculator.calculateFee('cross_border', settleAmount, userId);
        const feeAmount = feeResult.fee_amount;

        if (feeAmount > 0) {
          const result = BalanceService.recordFeeOnly(
            userId,
            'cross_border',
            feeAmount,
            `跨境交易费（${settleCurrency} $${settleAmount.toFixed(2)} @ ${merchantName}）`,
            authId
          );
          logger.info(`[webhook:Settlement] 用户 ${userId} 跨境交易费 $${feeAmount.toFixed(2)} 已扣除，余额 $${result.old_balance} → $${result.new_balance}`);
        }
      } catch (feeErr) {
        logger.error(`[webhook:Settlement] 跨境交易费计算/扣除失败:`, feeErr.message);
      }
    }

    // TODO: 记录结算交易记录（消费扣款）
    // TODO: 余额不足检查和自动冻结卡片

  } catch (err) {
    logger.error(`[webhook:Settlement] 处理结算事件失败:`, err);
  }
}

module.exports = router;
