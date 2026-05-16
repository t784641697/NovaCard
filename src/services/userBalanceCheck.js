/**
 * 用户余额检查与自动冻结服务
 * 
 * 当用户余额 ≤ 0 时，自动冻结其所有卡片
 * 当用户余额 > 0 时，自动解冻所有被系统冻结的卡片
 */

const db = require('../db/database');
const sdk = require('./vmcardioSDK');
const logger = require('../utils/logger');

/**
 * 检查单个用户的余额状态，必要时冻结/解冻卡片
 * @param {number} userId - 用户ID
 * @returns {object} 检查结果
 */
async function checkUserBalance(userId) {
  try {
    // 1. 获取用户信息
    const user = db.prepare('SELECT id, email, balance FROM users WHERE id = ?').get(userId);
    if (!user) {
      return { success: false, error: '用户不存在' };
    }

    // 2. 获取用户所有卡片
    const cards = db.prepare('SELECT id, card_id, status FROM cards WHERE user_id = ?').all(userId);
    
    if (cards.length === 0) {
      return { success: true, action: 'none', reason: '用户无卡片' };
    }

    // 3. 获取用户当前卡片余额总和（vmcardio 真实余额）
    let cardBalanceSum = 0;
    const cardDetails = [];
    
    for (const card of cards) {
      try {
        const detail = await sdk.cardDetail(card.card_id);
        cardDetails.push({ card_id: card.card_id, detail });
        
        // 累加可用余额
        if (detail.available_amount) {
          cardBalanceSum += parseFloat(detail.available_amount);
        }
      } catch (err) {
        logger.warn(`[余额检查] 无法获取卡 ${card.card_id} 详情:`, err.message);
      }
    }

    // 4. 决策逻辑
    const hasPositiveBalance = user.balance > 0 || cardBalanceSum > 0;
    const systemFrozenCards = cards.filter(card => card.status === 'CANCELLED');
    const activeCards = cards.filter(card => card.status === 'ACTIVE');
    
    let result = {
      userId,
      userBalance: user.balance,
      cardBalanceSum,
      totalCards: cards.length,
      activeCards: activeCards.length,
      frozenCards: systemFrozenCards.length,
      action: 'none',
      reason: '',
      processedCards: []
    };

    // 情况1：用户余额 ≤ 0 且卡内余额 ≤ 0 → 冻结所有卡
    if (user.balance <= 0 && cardBalanceSum <= 0) {
      if (activeCards.length > 0) {
        logger.info(`[余额检查] 用户 ${user.email} 余额为 0，冻结 ${activeCards.length} 张卡`);
        
        for (const card of activeCards) {
          try {
            await sdk.freezeCard(card.card_id, 'CANCELLED');
            
            // 更新数据库
            db.prepare('UPDATE cards SET status = ?, updated_at = datetime("now") WHERE card_id = ?')
              .run('CANCELLED', card.card_id);
            
            result.processedCards.push({
              card_id: card.card_id,
              action: 'frozen',
              reason: '用户余额为0'
            });
          } catch (err) {
            logger.error(`[余额检查] 冻结卡 ${card.card_id} 失败:`, err.message);
            result.processedCards.push({
              card_id: card.card_id,
              action: 'failed',
              error: err.message
            });
          }
        }
        
        result.action = 'frozen';
        result.reason = '用户余额为0';
      }
    }
    // 情况2：用户余额 > 0 → 解冻所有被系统冻结的卡
    else if (hasPositiveBalance && systemFrozenCards.length > 0) {
      logger.info(`[余额检查] 用户 ${user.email} 余额充足，解冻 ${systemFrozenCards.length} 张卡`);
      
      for (const card of systemFrozenCards) {
        try {
          await sdk.freezeCard(card.card_id, 'ACTIVE');
          
          // 更新数据库
          db.prepare('UPDATE cards SET status = ?, updated_at = datetime("now") WHERE card_id = ?')
            .run('ACTIVE', card.card_id);
          
          result.processedCards.push({
            card_id: card.card_id,
            action: 'unfrozen',
            reason: '用户余额恢复'
          });
        } catch (err) {
          logger.error(`[余额检查] 解冻卡 ${card.card_id} 失败:`, err.message);
          result.processedCards.push({
            card_id: card.card_id,
            action: 'failed',
            error: err.message
          });
        }
      }
      
      result.action = 'unfrozen';
      result.reason = '用户余额恢复';
    }

    logger.info(`[余额检查] 用户 ${user.email} 检查完成:`, result);
    return result;
    
  } catch (err) {
    logger.error(`[余额检查] 检查用户 ${userId} 余额失败:`, err);
    return { success: false, error: err.message };
  }
}

/**
 * 检查所有用户的余额状态
 */
async function checkAllUsersBalance() {
  try {
    const users = db.prepare('SELECT id FROM users WHERE role = ?').all('user');
    const results = [];
    
    logger.info(`[余额检查] 开始检查 ${users.length} 个用户`);
    
    for (const user of users) {
      try {
        const result = await checkUserBalance(user.id);
        results.push(result);
      } catch (err) {
        logger.error(`[余额检查] 用户 ${user.id} 检查失败:`, err);
        results.push({ userId: user.id, success: false, error: err.message });
      }
    }
    
    const summary = {
      totalUsers: users.length,
      checkedUsers: results.length,
      frozenActions: results.filter(r => r.action === 'frozen').length,
      unfrozenActions: results.filter(r => r.action === 'unfrozen').length,
      errors: results.filter(r => r.success === false).length
    };
    
    logger.info(`[余额检查] 批量检查完成:`, summary);
    return { summary, details: results };
    
  } catch (err) {
    logger.error(`[余额检查] 批量检查失败:`, err);
    return { success: false, error: err.message };
  }
}

/**
 * 交易后立即检查用户余额
 * @param {number} userId - 用户ID
 * @param {number} amount - 交易金额
 * @param {string} transactionType - 交易类型
 */
async function checkAfterTransaction(userId, amount, transactionType) {
  try {
    // 1. 更新用户余额（如果是扣费）
    const isDebit = ['消费', '开卡费', '手续费'].includes(transactionType);
    if (isDebit && amount > 0) {
      const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
      if (user) {
        const newBalance = Math.max(0, user.balance - amount);
        db.prepare('UPDATE users SET balance = ?, updated_at = datetime("now") WHERE id = ?')
          .run(newBalance.toFixed(2), userId);
        
        logger.info(`[交易后检查] 用户 ${userId} 余额更新: ${user.balance} -> ${newBalance}`);
        
        // 2. 余额更新后立即检查是否需要冻结卡片
        if (newBalance <= 0) {
          return await checkUserBalance(userId);
        }
      }
    }
    
    return { success: true, action: 'none', reason: '余额充足或非扣费交易' };
    
  } catch (err) {
    logger.error(`[交易后检查] 检查失败:`, err);
    return { success: false, error: err.message };
  }
}

/**
 * 启动定时余额检查（每10分钟检查一次）
 */
function startPeriodicCheck() {
  const CHECK_INTERVAL = 10 * 60 * 1000; // 10分钟
  
  logger.info(`[余额检查] 启动定时检查，间隔 ${CHECK_INTERVAL / 60000} 分钟`);
  
  setInterval(async () => {
    try {
      logger.info(`[余额检查] 开始定时检查`);
      const result = await checkAllUsersBalance();
      logger.info(`[余额检查] 定时检查完成: ${result.summary.checkedUsers} 用户`);
    } catch (err) {
      logger.error(`[余额检查] 定时检查失败:`, err);
    }
  }, CHECK_INTERVAL);
}

module.exports = {
  checkUserBalance,
  checkAllUsersBalance,
  checkAfterTransaction,
  startPeriodicCheck
};