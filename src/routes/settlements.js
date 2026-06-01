const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const sdk = require('../services/vmcardioSDK');

/**
 * GET /api/settlements - 获取结算记录（从上游拉取 transaction_type=Settlement）
 * Query: page, page_size, card_id, status, start_time, end_time
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const params = {
      transaction_type: 'Settlement',
      page: Number(req.query.page) || 1,
      page_size: Number(req.query.page_size) || 50,
    };

    if (req.query.card_id) params.card_id = req.query.card_id;
    if (req.query.status) params.status = req.query.status;
    if (req.query.start_time) params.start_time = req.query.start_time;
    if (req.query.end_time) params.end_time = req.query.end_time;

    const result = await sdk.cardTransaction(params);
    res.json({ code: 0, msg: 'ok', data: result });
  } catch (err) {
    logger.error(`[settlements] 获取结算记录失败: ${err.message}`);
    res.status(500).json({ code: 500, msg: `获取结算记录失败: ${err.message}` });
  }
});

module.exports = router;