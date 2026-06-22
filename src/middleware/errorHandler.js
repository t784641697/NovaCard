/**
 * 统一错误处理中间件
 * 放在所有路由注册之后，捕获未处理的错误
 */

const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  // vmcardio SDK 抛出的业务错误
  if (err.vmCode !== undefined) {
    logger.warn(`[vmcardio业务错误] code=${err.vmCode} msg=${err.vmMsg}`);
    var vmMsg = err.vmMsg || '';
    var userMsg = '卡商接口返回错误';
    // 翻译常见 vmcardio 错误
    if (vmMsg.includes('status does not support') || vmMsg.includes('700010')) userMsg = '卡片当前状态不支持此操作';
    else if (vmMsg.includes('Invalid CardId') || vmMsg.includes('Card not found')) userMsg = '卡片不存在或已被删除';
    else if (vmMsg.includes('Insufficient') || vmMsg.includes('Balance Is Not Enough') || vmMsg.includes('700004')) userMsg = '平台账户余额不足，请联系管理员充值';
    else if (vmMsg.includes('limit') || vmMsg.includes('Limit')) userMsg = '已达到限额限制';
    else if (vmMsg.includes('Unauthorized') || vmMsg.includes('Authentication')) userMsg = '接口认证失败';
    else if (vmMsg.includes('Timeout') || vmMsg.includes('timeout')) userMsg = '卡商接口响应超时，请稍后重试';
    else if (vmMsg.includes('服务器异常') || vmMsg.includes('700011')) userMsg = '卡商服务器暂时异常，请稍后重试';
    return res.status(422).json({
      code: err.vmCode,
      msg: userMsg,
    });
  }

  // 参数校验错误
  if (err.name === 'ValidationError') {
    return res.status(400).json({ code: 400, msg: err.message });
  }

  // JWT 错误（理论上已在中间件拦截，这里兜底）
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ code: 401, msg: 'Token 无效或已过期' });
  }

  // 未预期的服务器错误
  logger.error('[未处理错误]', err);
  res.status(500).json({
    code: 500,
    msg:  process.env.NODE_ENV === 'production' ? '服务器内部错误' : err.message,
  });
}

module.exports = errorHandler;
