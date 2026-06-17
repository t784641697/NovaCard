/**
 * 费率计算服务
 * 支持全局费率 + 用户级自定义费率（用户级优先）
 * 手续费计算：固定费用 + 百分比费率
 */

const db = require('../db');

class FeeCalculator {
  /**
   * 获取费率配置
   * @param {string} feeType - 费用类型
   * @param {number} userId - 用户ID（可选）
   * @returns {object} { fee_rate, fee_fixed, min_amount, max_amount, source } source: 'user' | 'global'
   */
  static getFeeConfig(feeType, userId = null) {
    if (!feeType) throw new Error('feeType 必填');
    
    // 优先查询用户级自定义费率
    if (userId) {
      const userFee = db.prepare(`
        SELECT fee_rate, fee_fixed, min_amount, max_amount
        FROM user_fee_configs
        WHERE user_id = ? AND fee_type = ? AND is_active = 1
      `).get(userId, feeType);
      
      if (userFee && (userFee.fee_rate !== null || userFee.fee_fixed !== null)) {
        return {
          fee_rate: userFee.fee_rate || 0,
          fee_fixed: userFee.fee_fixed || 0,
          min_amount: userFee.min_amount || 0,
          max_amount: userFee.max_amount || 0,
          source: 'user'
        };
      }
    }
    
    // 退回到全局费率
    const globalFee = db.prepare(`
      SELECT fee_rate, fee_fixed, min_amount, max_amount
      FROM fee_configs
      WHERE fee_type = ? AND is_active = 1
    `).get(feeType);
    
    if (!globalFee) {
      throw new Error(`未找到费用类型 "${feeType}" 的配置`);
    }
    
    return {
      fee_rate: globalFee.fee_rate || 0,
      fee_fixed: globalFee.fee_fixed || 0,
      min_amount: globalFee.min_amount || 0,
      max_amount: globalFee.max_amount || 0,
      source: 'global'
    };
  }
  
  /**
   * 计算手续费
   * @param {string} feeType - 费用类型
   * @param {number} amount - 原始金额（正数）
   * @param {number} userId - 用户ID（可选）
   * @returns {object} { fee_amount, fee_rate, fee_fixed, net_amount, config }
   */
  static calculateFee(feeType, amount, userId = null) {
    if (amount < 0) throw new Error('金额必须 >= 0');
    
    const config = this.getFeeConfig(feeType, userId);
    
    let feeAmount = 0;
    
    // 固定费用
    feeAmount += (config.fee_fixed || 0);
    
    // 百分比费用
    if (config.fee_rate > 0) {
      const percentageFee = amount * config.fee_rate;
      feeAmount += percentageFee;
    }
    
    // 金额限制检查
    if (config.min_amount > 0 && amount < config.min_amount) {
      throw new Error(`金额 ${amount} 低于最小限制 ${config.min_amount}`);
    }
    if (config.max_amount > 0 && amount > config.max_amount) {
      throw new Error(`金额 ${amount} 超过最大限制 ${config.max_amount}`);
    }
    
    // 手续费不能超过原始金额（特殊情况除外）
    if (feeAmount > amount && feeType !== 'card_creation') {
      feeAmount = amount; // 最多扣完
    }
    
    const netAmount = amount - feeAmount;
    
    return {
      fee_amount: parseFloat(feeAmount.toFixed(2)),
      fee_rate: config.fee_rate,
      fee_fixed: config.fee_fixed,
      net_amount: parseFloat(netAmount.toFixed(2)),
      config: config
    };
  }
  
  /**
   * 批量计算多种类型费用（如跨境+交易）
   * @param {Array} feeItems - [{ fee_type, amount }]
   * @param {number} userId - 用户ID
   * @returns {object} { total_fee, items: [{ fee_type, amount, fee_amount, net_amount }] }
   */
  static calculateMultipleFees(feeItems, userId = null) {
    let totalFee = 0;
    let totalNet = 0;
    
    const items = feeItems.map(item => {
      const result = this.calculateFee(item.fee_type, item.amount, userId);
      totalFee += result.fee_amount;
      totalNet += result.net_amount;
      
      return {
        fee_type: item.fee_type,
        original_amount: item.amount,
        fee_amount: result.fee_amount,
        fee_rate: result.fee_rate,
        fee_fixed: result.fee_fixed,
        net_amount: result.net_amount,
        config_source: result.config.source
      };
    });
    
    return {
      total_fee: parseFloat(totalFee.toFixed(2)),
      total_net_amount: parseFloat(totalNet.toFixed(2)),
      items: items
    };
  }
  
  /**
   * 为用户设置自定义费率
   * @param {number} userId - 用户ID
   * @param {string} feeType - 费用类型
   * @param {object} config - { fee_rate?, fee_fixed?, min_amount?, max_amount?, notes?, is_active? }
   * @returns {boolean}
   */
  static setUserFeeConfig(userId, feeType, config) {
    const now = new Date().toISOString();
    
    // 检查全局配置是否存在
    const globalExists = db.prepare(`
      SELECT id FROM fee_configs WHERE fee_type = ? AND is_active = 1
    `).get(feeType);
    
    if (!globalExists) {
      throw new Error(`费用类型 "${feeType}" 不存在于全局配置中`);
    }
    
    // 检查用户是否存在
    const userExists = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!userExists) throw new Error(`用户 ${userId} 不存在`);
    
    // 插入或更新
    db.prepare(`
      INSERT OR REPLACE INTO user_fee_configs
        (user_id, fee_type, fee_rate, fee_fixed, min_amount, max_amount, notes, is_active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      feeType,
      config.fee_rate === undefined ? null : config.fee_rate,
      config.fee_fixed === undefined ? null : config.fee_fixed,
      config.min_amount === undefined ? null : config.min_amount,
      config.max_amount === undefined ? null : config.max_amount,
      config.notes || null,
      config.is_active !== undefined ? (config.is_active ? 1 : 0) : 1,
      now
    );
    
    return true;
  }
  
  /**
   * 删除用户自定义费率（恢复到全局配置）
   */
  static deleteUserFeeConfig(userId, feeType) {
    const stmt = db.prepare(`
      DELETE FROM user_fee_configs WHERE user_id = ? AND fee_type = ?
    `);
    const result = stmt.run(userId, feeType);
    return result.changes > 0;
  }
  
  /**
   * 获取用户的所有自定义费率
   */
  static getUserFeeConfigs(userId) {
    return db.prepare(`
      SELECT ufc.*, fc.description 
      FROM user_fee_configs ufc
      LEFT JOIN fee_configs fc ON ufc.fee_type = fc.fee_type
      WHERE ufc.user_id = ? AND ufc.is_active = 1
      ORDER BY fc.sort_order
    `).all(userId);
  }
  
  /**
   * 获取全局所有费率配置
   */
  static getAllFeeConfigs() {
    return db.prepare(`
      SELECT * FROM fee_configs 
      ORDER BY sort_order, fee_type
    `).all();
  }
  
  /**
   * 更新全局费率配置
   */
  static updateGlobalFeeConfig(feeType, updates) {
    const now = new Date().toISOString();
    const setClause = [];
    const params = [];
    
    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'fee_type') {
        setClause.push(`${key} = ?`);
        params.push(value);
      }
    });
    
    if (setClause.length === 0) return false;
    
    setClause.push('updated_at = ?');
    params.push(now);
    params.push(feeType);
    
    const sql = `UPDATE fee_configs SET ${setClause.join(', ')} WHERE fee_type = ?`;
    const result = db.prepare(sql).run(...params);
    return result.changes > 0;
  }
  
  /**
   * 模拟计算示例（用于测试）
   */
  static getExamples() {
    return {
      example1: this.calculateFee('card_creation', 100),
      example2: this.calculateFee('transaction', 500),
      example3: this.calculateFee('refund', 200),
      example4: this.calculateFee('chargeback', 100),
      example5: this.calculateFee('cross_border', 300)
    };
  }
}

module.exports = FeeCalculator;