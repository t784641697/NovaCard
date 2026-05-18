/**
 * vmcardio API SDK
 * 封装：Token 管理、请求加密、响应解密、统一错误处理
 */

const axios   = require('axios');
const rsa     = require('../utils/rsaCrypto');
const logger  = require('../utils/logger');

class VmcardioSDK {
  constructor() {
    this._token     = null;
    this._tokenExp  = 0;
    this._baseURL   = process.env.VMCARDIO_BASE_URL || 'https://sandbox-api.vmcardio.com';
    this._appId     = process.env.VMCARDIO_APP_ID;
    this._appSecret = process.env.VMCARDIO_APP_SECRET;
  }

  async _getToken() {
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
    this._tokenExp = body.data.expired_time * 1000;
    logger.info(`[vmcardio] Token 已刷新，有效至 ${new Date(this._tokenExp).toISOString()}`);
    return this._token;
  }

  async request(apiPath, payload = {}) {
    const token   = await this._getToken();
    const content = rsa.encrypt(payload);
    logger.info(`[vmcardio] -> POST ${apiPath}`, { keys: Object.keys(payload) });
    const resp = await axios.post(
      `${this._baseURL}${apiPath}`,
      { content },
      {
        headers: { 'Authorization': token, 'Content-Type': 'application/json' },
        timeout: 45_000,
      }
    );
    const body = resp.data;
    if (body.code !== 0) {
      logger.error(`[vmcardio] API Error ${apiPath}:`, body);
      const err  = new Error(body.msg || '卡商接口异常');
      err.vmCode = body.code;
      err.vmMsg  = body.msg;
      throw err;
    }
    const result = rsa.decrypt(body.data);
    logger.info(`[vmcardio] <- ${apiPath} OK`);
    return result;
  }

  async getProductCode() {
    return this.request('/getProductCode');
  }

  async createCard(params) {
    return this.request('/createCard', params);
  }

  async cardDetail(card_id) {
    return this.request('/cardDetail', { card_id });
  }

  /** 查询上游全量卡片列表 */
  async cardList(params) {
    return this.request('/cardList', params);
  }

  async freezeCard(card_id, status) {
    const s = String(status).toUpperCase();
    if (!['CANCELLED', 'ACTIVE'].includes(s)) {
      throw new Error('freezeCard status must be CANCELLED or ACTIVE');
    }
    return this.request('/freezeCard', { card_id, status: s });
  }

  async rechargeCard(card_id, amount) {
    if (!amount || amount <= 0) throw new Error('充值金额必须 > 0');
    return this.request('/rechargeCard', { card_id, amount });
  }

  async refundCard(card_id, amount) {
    if (!amount || amount <= 0) throw new Error('退款金额必须 > 0');
    return this.request('/refundCard', { card_id, amount });
  }

  async deleteCard(card_id) {
    return this.request('/deleteCard', { card_id });
  }

  async cardTransaction(params = {}) {
    return this.request('/cardTransaction', params);
  }

  async getAccountBalance() {
    return this.request('/getAccountBalance');
  }
}

module.exports = new VmcardioSDK();