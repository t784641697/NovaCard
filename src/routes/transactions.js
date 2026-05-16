/**
 * 全局交易记录路由
 * GET /api/transactions — 查询所有卡的交易记录（带筛选）
 */

const express = require('express');
const router  = express.Router();
const sdk     = require('../services/vmcardioSDK');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// GET /api/transactions?card_id=&transaction_type=&status=&start_time=&end_time=&page=&page_size=
router.get('/', async (req, res, next) => {
  try {
    const params = {
      card_id:          req.query.card_id          || undefined,
      transaction_type: req.query.transaction_type || undefined,
      status:           req.query.status           || undefined,
      start_time:       req.query.start_time       || undefined,
      end_time:         req.query.end_time         || undefined,
      page:             parseInt(req.query.page)      || 1,
      page_size:        parseInt(req.query.page_size) || 20,
    };
    const result = await sdk.cardTransaction(params);
    res.json({ code: 0, msg: 'ok', data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
