/**
 * vmcardio API SDK
 * 封装：Token 管理、请求加密、响应解密、统一错误处理
 */

const axios   = require('axios');
const https   = require('https');
const rsa     = require('../utils/rsaCrypto');
const logger  = require('../utils/logger');

/** 强制 IPv4，避免上游未白名单 IPv6 导致请求被拒 */
const _agent = new https.Agent({ family: 4 });

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
      httpsAgent: _agent,
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
        httpsAgent: _agent,
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

  /**
   * 使用 Web API (dev.vmcardio.com/web/createCard) 创建卡片
   * 与 Merchant API 不同，Web API：
   *   - 使用 JWT Session Token 认证（非 API Token）
   *   - 接收明文 JSON（无需 RSA 加密）
   *   - 参数名不同：bin / customize_name / customize_last_name /customize_last_name / bind_uid 等
   *   - 返回 code=200 表示提交成功，卡片异步创建（~10-20秒）
   *
   * @param {object} params
   * @param {string} params.bin              - 产品 Code（对应 Merchant API 的 product_code）
   * @param {number} params.amount           - 充值金额（USD）
   * @param {number} params.create_num       - 创建数量（默认 1）
   * @param {string} params.customize_name   - 持卡人名字（对应 first_name）
   * @param {string} params.customize_last_name - 持卡人姓氏（对应 last_name）
   * @param {number} params.bind_uid         - 用户 ID（localStorage auth.userInfo）
   * @param {string} params.user_name        - 用户邮箱
   * @returns {Promise<{code: number, message: string, data: array}>}
   */
  async webCreateCard(params) {
    const token = process.env.VMCARDIO_WEB_TOKEN;
    if (!token) {
      throw new Error('VMCARDIO_WEB_TOKEN 未配置，请在 .env 中添加');
    }

    const webApiUrl  = process.env.VMCARDIO_WEB_API_URL || 'https://dev.vmcardio.com/web/createCard';
    const originHost = process.env.VMCARDIO_WEB_ORIGIN  || 'https://sandbox.vmcardio.com';

    const payload = {
      bin:                  params.bin,
      amount:               params.amount,
      alias:                params.alias || '',
      create_num:           params.create_num || 1,
      customize_name:       params.customize_name || 'User',
      customize_last_name:  params.customize_last_name || 'Card',
      is_on_default_name:   params.is_on_default_name ?? 0,
      is_on_default_address: params.is_on_default_address ?? 1,
      checked:              params.checked ?? 1,
      user_name:            params.user_name,
      batchOpen:            false,
      expire_time:          params.expire_time || 12,
      card_type:            params.card_type || 'save',
      bind_uid:             params.bind_uid,
      is_mcc:               params.is_mcc ?? 0,
    };

    logger.info('[vmcardio] -> POST /web/createCard (Web API)', { bin: params.bin, amount: params.amount, create_num: payload.create_num });

    const resp = await axios.post(
      webApiUrl,
      payload,
      {
        headers: {
          'token':          token,
          'Content-Type':   'application/json',
          'Origin':         originHost,
        },
        timeout: 60_000,
        validateStatus: s => true,
      }
    );

    const body = resp.data;
    if (body.code !== 200) {
      logger.error('[vmcardio] Web API Error:', body);
      const err = new Error(body.message || 'Web API 开卡接口异常');
      err.vmCode = body.code;
      err.vmMsg  = body.message;
      throw err;
    }

    logger.info(`[vmcardio] <- /web/createCard OK: ${body.message}`);
    return body;
  }

  async cardDetail(card_id) {
    const r = await this.request('/cardDetail', { card_id });
    // 上游 expire="05/29" → 解析为 expiry_month=5, expiry_year=2029
    if (r.expire && r.expiry_month == null) {
      const m = String(r.expire).match(/^(\d{2})\/(\d{2})$/);
      if (m) {
        r.expiry_month = parseInt(m[1], 10);
        r.expiry_year = 2000 + parseInt(m[2], 10);
      }
    }
    // 上游 limit={single_limit, day_limit, month_limit, total_limit, remaining_*}
    // → 拍平到顶层（数据库列 & 前端都按顶层字段读取）
    if (r.limit && typeof r.limit === 'object') {
      const f = r.limit;
      r.single_limit  = f.single_limit  ?? r.single_limit  ?? 0;
      r.day_limit     = f.day_limit     ?? r.day_limit     ?? 0;
      r.month_limit   = f.month_limit   ?? r.month_limit   ?? 0;
      r.total_limit   = f.total_limit   ?? r.total_limit   ?? 0;
      r.remaining_day_limit   = f.remaining_day_limit   ?? r.remaining_day_limit   ?? 0;
      r.remaining_month_limit = f.remaining_month_limit ?? r.remaining_month_limit ?? 0;
    }
    // 上游 card_address={address_line_one, address_line_two, city, state, country, post_code}
    // → 拍平到顶层（前端 / 一键复制按顶层字段读）
    if (r.card_address && typeof r.card_address === 'object') {
      const a = r.card_address;
      r.address_line_one = a.address_line_one ?? r.address_line_one ?? '';
      r.address_line_two = a.address_line_two ?? r.address_line_two ?? '';
      r.city             = a.city             ?? r.city             ?? '';
      r.state            = a.state            ?? r.state            ?? '';
      r.country          = a.country          ?? r.country          ?? '';
      r.post_code        = a.post_code        ?? r.post_code        ?? '';
    }
    return r;
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

  /**
   * 卡片充值（仅适用储值卡）
   * v1.0.84 异步确认: vmcardio 上游对 rechargeCard 有个 bug —
   *   1 秒内返回 700011 服务器异常，但内部实际已成功扣款并更新卡余额（5 秒后完成）。
   *   用户刷新页面后能看到余额已变。修复: 收到 700011 时等 5 秒调 cardDetail 验证,
   *   验证成功(返回 200 + 包含新卡信息)则把 cardDetail 当作成功结果返回。
   *   业务路由 /:card_id/recharge 拿到新详情后由前端渲染新余额, 避免报错后用户手动刷新。
   * @param {string} card_id
   * @param {number} amount
   * @returns {Promise<object>} 成功返回 cardDetail (含 available_amount 等)
   */
  async rechargeCard(card_id, amount) {
    if (!amount || amount <= 0) throw new Error('充值金额必须 > 0');
    logger.info('[rechargeCard] 调用参数:', { card_id, amount, card_id_type: typeof card_id, amount_type: typeof amount, amount_value: amount });
    try {
      return await this.request('/rechargeCard', { card_id, amount });
    } catch (e) {
      // 仅对 700011 (vmcardio 上游已知异步 bug) 触发自动确认
      if (e.vmCode === 700011) {
        logger.warn(`[rechargeCard] ${card_id} 收到 700011, 触发异步确认(等 5 秒查 cardDetail)`);
        await new Promise(r => setTimeout(r, 5000));
        const detail = await this.cardDetail(card_id);
        if (detail && detail.card_id) {
          logger.info(`[rechargeCard] ${card_id} 异步确认成功, 新余额=${detail.available_amount}`);
          return { ...detail, _async_success: true, _note: 'vmcardio 700011 异步确认' };
        }
        // 兜底: cardDetail 没返回有效数据, 原始错误继续抛
        logger.error(`[rechargeCard] ${card_id} 异步确认失败, cardDetail 返回异常`);
      }
      throw e;
    }
  }

  async refundCard(card_id, amount) {
    if (!amount || amount <= 0) throw new Error('退款金额必须 > 0');
    return this.request('/refundCard', { card_id, amount });
  }

  async deleteCard(card_id) {
    return this.request('/deleteCard', { card_id });
  }

  async cardTransaction(params = {}) {
    // page/page_size must be numbers, not strings
    if (params.page !== undefined) params.page = Number(params.page);
    if (params.page_size !== undefined) params.page_size = Number(params.page_size);
    return this.request('/cardTransaction', params);
  }

  async getAccountBalance() {
    return this.request('/getAccountBalance');
  }
}

module.exports = new VmcardioSDK();