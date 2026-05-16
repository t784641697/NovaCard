/**
 * vmcardio API SDK
 * 封装：Token 管理、请求加密、响应解密、统一错误处理
 */

const axios   = require('axios');
const rsa     = require('../utils/rsaCrypto');
const logger  = require('../utils/logger');

class VmcardioSDK {
  constructor() {
    this._token     = null;   // 当前 accessToken
    this._tokenExp  = 0;      // 过期时间戳（ms）
    this._baseURL   = process.env.VMCARDIO_BASE_URL || 'https://sandbox-api.vmcardio.com';
    this._appId     = process.env.VMCARDIO_APP_ID;
    this._appSecret = process.env.VMCARDIO_APP_SECRET;
  }

  // ── Token 管理（自动刷新）──────────────────────────────────────────────
  async _getToken() {
    // 提前 60s 刷新，避免边界情况
    if (this._token && Date.now() < this._tokenExp - 60_000) {
      return this._token;
    }

    logger.info('[vmcardio] 获取新 AccessToken...');
    const resp = await axios.get(`${this._baseURL}/getAccessToken`, {
      params: { app_id: this._appId, app_secret: this._appSecret },
      timeout: 10_000,
    });

    const body = resp.data;
    if (body.code !== 0) {
      throw new Error(`getAccessToken 失败：code=${body.code} msg=${body.msg}`);
    }

    this._token    = body.data.token;
    // expired_time 是秒级时间戳
    this._tokenExp = body.data.expired_time * 1000;
    logger.info(`[vmcardio] Token 已刷新，有效至 ${new Date(this._tokenExp).toISOString()}`);
    return this._token;
  }

  // ── 统一请求方法 ────────────────────────────────────────────────────────
  /**
   * @param {string} path      - 接口路径，如 /createCard
   * @param {object} payload   - 原始业务参数（未加密）
   * @returns {object}         - 解密后的业务数据（data 字段内容）
   */
  async request(apiPath, payload = {}) {
    const token   = await this._getToken();
    const content = rsa.encrypt(payload);   // 加密请求体

    logger.info(`[vmcardio] → POST ${apiPath}`, { keys: Object.keys(payload) });

    const resp = await axios.post(
      `${this._baseURL}${apiPath}`,
      { content },
      {
        headers: {
          'Authorization': token,   // vmcardio 不用 Bearer 前缀，直接传 token
          'Content-Type':  'application/json',
        },
        timeout: 45_000,  // 45秒，vmcardio沙盒API响应不稳定，冻结/解冻等操作偶发超时
      }
    );

    const body = resp.data;
    if (body.code !== 0) {
      logger.error(`[vmcardio] 接口错误 ${apiPath}：`, body);
      const err     = new Error(body.msg || '卡商接口异常');
      err.vmCode    = body.code;
      err.vmMsg     = body.msg;
      throw err;
    }

    // 解密响应 data
    const result = rsa.decrypt(body.data);
    logger.info(`[vmcardio] ← ${apiPath} OK`);
    return result;
  }

  // ── 业务接口封装 ────────────────────────────────────────────────────────

  /** 获取可用卡产品码列表 */
  async getProductCode() {
    return this.request('/getProductCode');
  }

  /** 申请卡片 */
  async createCard(params) {
    // card_address 字段说明：
    //   address_line_one (必填), address_line_two, city, state, country, post_code
    // 储值卡用 amount；额度卡用 single_limit / day_limit / month_limit
    return this.request('/createCard', params);
  }

  /** 查询卡详情 */
  async cardDetail(card_id) {
    return this.request('/cardDetail', { card_id });
  }

  /** 冻结 / 解冻卡片
   * 文档写 freeze/unfreeze，但实测无效（400003）
   * 实际有效值：CANCELLED（冻结）/ ACTIVE（解冻）—— 经沙盒验证 2026-03-27
   */
  async freezeCard(card_id, status) {
    const s = String(status).toUpperCase();
    if (!['CANCELLED', 'ACTIVE'].includes(s)) {
      throw new Error('freezeCard status 必须为 "CANCELLED"（冻结）或 "ACTIVE"（解冻）');
    }
    return this.request('/freezeCard', { card_id, status: s });
  }

  /** 充值（储值卡） */
  async rechargeCard(card_id, amount) {
    if (!amount || amount <= 0) throw new Error('充值金额必须 > 0');
    return this.request('/rechargeCard', { card_id, amount });
  }

  /** 退款 */
  async refundCard(card_id, amount) {
    if (!amount || amount <= 0) throw new Error('退款金额必须 > 0');
    return this.request('/refundCard', { card_id, amount });
  }

  /** 注销卡片 */
  async deleteCard(card_id) {
    return this.request('/deleteCard', { card_id });
  }

  /**
   * 查询交易记录
   * @param {object} params - { card_id?, transaction_type?, status?, start_time?, end_time?, page?, page_size? }
   */
  async cardTransaction(params = {}) {
    return this.request('/cardTransaction', params);
  }

  /**
   * 获取商户账户余额
   * @returns {object} { balance: number, wallet_balance: number }
   */
  async getAccountBalance() {
    return this.request('/getAccountBalance');
  }
}

// 单例
module.exports = new VmcardioSDK();
