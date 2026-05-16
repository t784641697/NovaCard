/**
 * 商户余额同步服务
 * 每30分钟从 vmcardio 拉取余额，更新到数据库
 */

const sdk = require('./vmcardioSDK');
const db = require('../db/database');
const logger = require('../utils/logger');

class MerchantBalanceSync {
  constructor() {
    this.isRunning = false;
    this.lastBalance = null;
    this.lastError = null;
    this.interval = null;
    
    // 余额不足提醒阈值
    this.LOW_BALANCE_THRESHOLD = 100; // $100
  }

  /**
   * 启动同步服务（每30分钟一次）
   */
  start() {
    if (this.isRunning) {
      logger.warn('[MerchantBalanceSync] 服务已经在运行');
      return;
    }

    logger.info('[MerchantBalanceSync] 启动商户余额同步服务（30分钟间隔）');
    this.isRunning = true;

    // 立即执行一次
    this.syncBalance();

    // 设置定时器：每30分钟同步一次
    this.interval = setInterval(() => {
      this.syncBalance();
    }, 1800 * 1000);
  }

  /**
   * 停止同步服务
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    logger.info('[MerchantBalanceSync] 同步服务已停止');
  }

  /**
   * 同步商户余额
   */
  async syncBalance() {
    try {
      logger.debug('[MerchantBalanceSync] 开始同步商户余额...');
      
      // 从 vmcardio 获取余额
      const result = await sdk.getAccountBalance();
      
      if (!result || typeof result.balance !== 'number') {
        throw new Error('vmcardio 返回的余额数据格式异常');
      }

      const merchantBalance = result.balance;
      const walletBalance = result.wallet_balance || 0;
      
      logger.debug(`[MerchantBalanceSync] 余额数据: merchant=${merchantBalance}, wallet=${walletBalance}`);

      // 更新数据库
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO settings (key, value, updated_at) 
        VALUES (?, ?, ?)
      `);
      
      const now = new Date().toISOString();
      
      // 保存商户余额
      stmt.run('merchant_balance', merchantBalance, now);
      
      // 保存钱包余额
      stmt.run('wallet_balance', walletBalance, now);
      
      // 保存最后同步时间
      stmt.run('merchant_balance_last_sync', now, now);

      this.lastBalance = merchantBalance;
      this.lastError = null;

      // 检查余额是否过低
      await this.checkLowBalance(merchantBalance);

      logger.info(`[MerchantBalanceSync] 同步成功: $${merchantBalance.toFixed(2)}`);
      
    } catch (error) {
      this.lastError = error.message;
      logger.error(`[MerchantBalanceSync] 同步失败: ${error.message}`);
      
      // 记录错误但继续运行
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO settings (key, value, updated_at) 
        VALUES (?, ?, ?)
      `);
      stmt.run('merchant_balance_last_error', error.message, new Date().toISOString());
    }
  }

  /**
   * 检查余额是否过低，触发相应操作
   */
  async checkLowBalance(currentBalance) {
    const prevBalance = await this.getCachedBalance();
    
    // 只有余额降到阈值以下时才触发提醒
    if (currentBalance < this.LOW_BALANCE_THRESHOLD) {
      if (!prevBalance || prevBalance >= this.LOW_BALANCE_THRESHOLD) {
        logger.warn(`[MerchantBalanceSync] ⚠️ 商户余额过低: $${currentBalance.toFixed(2)} < $${this.LOW_BALANCE_THRESHOLD}`);
        
        // 记录警告日志
        const stmt = db.prepare(`
          INSERT INTO audit_logs (user_id, action, detail, ip) 
          VALUES (?, ?, ?, ?)
        `);
        stmt.run(
          1, // 系统用户
          'MERCHANT_LOW_BALANCE',
          JSON.stringify({ 
            balance: currentBalance, 
            threshold: this.LOW_BALANCE_THRESHOLD,
            timestamp: new Date().toISOString()
          }),
          '127.0.0.1'
        );
        
        // TODO: 发送通知给管理员（邮件/站内信）
      }
    }

    // 保存当前余额到缓存
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO settings (key, value, updated_at) 
      VALUES (?, ?, ?)
    `);
    stmt.run('merchant_balance_cached', currentBalance, new Date().toISOString());
  }

  /**
   * 获取缓存的余额
   */
  async getCachedBalance() {
    try {
      const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
      const row = stmt.get('merchant_balance_cached');
      return row ? parseFloat(row.value) : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 获取当前商户余额（从缓存）
   */
  getCurrentBalance() {
    return this.lastBalance;
  }

  /**
   * 获取同步状态
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      lastBalance: this.lastBalance,
      lastError: this.lastError,
      lastSyncTime: this.getLastSyncTime(),
    };
  }

  /**
   * 获取最后同步时间
   */
  getLastSyncTime() {
    try {
      const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
      const row = stmt.get('merchant_balance_last_sync');
      return row ? row.value : null;
    } catch (error) {
      return null;
    }
  }
}

// 单例模式
const syncService = new MerchantBalanceSync();

// 开发环境自动启动（生产环境由 PM2 管理）
if (process.env.NODE_ENV !== 'test') {
  // 延迟 5 秒启动，等服务完全启动后再开始同步
  setTimeout(() => {
    syncService.start();
  }, 5000);
}

module.exports = syncService;