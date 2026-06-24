/**
 * 余额服务
 * 统一管理用户余额计算公式：
 * balance = initial_balance + topup_total - net_spend - total_fees
 * 
 * 所有余额变动必须通过此服务，保证数据一致性
 */

const db = require('../db');

class BalanceService {
  /**
   * 获取用户余额详情
   * @param {number} userId 
   * @returns {object} { balance, initial_balance, topup_total, total_net_spend, total_fees, breakdown }
   */
  static getUserBalanceDetails(userId) {
    const user = db.prepare(`
      SELECT 
        id, email, name, role,
        balance,
        initial_balance,
        topup_total,
        total_spend,
        total_refund,
        total_chargeback,
        total_fees,
        created_at
      FROM users WHERE id = ?
    `).get(userId);
    
    if (!user) throw new Error(`用户 ${userId} 不存在`);
    
    // 计算净消费 = 总消费 - 退款 - 拒付返还
    const totalNetSpend = Math.max(0, user.total_spend - user.total_refund - user.total_chargeback);
    
    // 验证余额公式一致性
    const calculatedBalance = 
      user.initial_balance + 
      user.topup_total - 
      totalNetSpend - 
      user.total_fees;
    
    // 如果数据库余额与计算值不一致，记录警告（不自动修复）
    const discrepancy = Math.abs(user.balance - calculatedBalance);
    const isConsistent = discrepancy < 0.01; // 允许1美分误差
    
    return {
      user_id: userId,
      user_name: user.name,
      user_email: user.email,
      balance: parseFloat(user.balance.toFixed(2)),
      initial_balance: parseFloat(user.initial_balance.toFixed(2)),
      topup_total: parseFloat(user.topup_total.toFixed(2)),
      total_spend: parseFloat(user.total_spend.toFixed(2)),
      total_refund: parseFloat(user.total_refund.toFixed(2)),
      total_chargeback: parseFloat(user.total_chargeback.toFixed(2)),
      total_fees: parseFloat(user.total_fees.toFixed(2)),
      total_net_spend: parseFloat(totalNetSpend.toFixed(2)),
      calculated_balance: parseFloat(calculatedBalance.toFixed(2)),
      is_consistent: isConsistent,
      discrepancy: parseFloat(discrepancy.toFixed(2)),
      // 收支构成
      income: {
        initial: parseFloat(user.initial_balance.toFixed(2)),
        topup: parseFloat(user.topup_total.toFixed(2)),
        refund: parseFloat(user.total_refund.toFixed(2)),
        chargeback: parseFloat(user.total_chargeback.toFixed(2))
      },
      outcome: {
        spend: parseFloat(user.total_spend.toFixed(2)),
        fees: parseFloat(user.total_fees.toFixed(2))
      }
    };
  }
  
  /**
   * 记录消费（正向支出）
   * @param {number} userId 
   * @param {number} amount - 消费金额（正数）
   * @param {string} feeType - 费用类型（如 transaction, cross_border）
   * @param {number} feeAmount - 手续费（正数）
   * @param {string} description - 交易描述
   * @returns {object} { success, new_balance, transaction_id }
   */
  static recordSpend(userId, amount, feeType, feeAmount, description) {
    const netAmount = amount + feeAmount; // 总支出 = 消费金额 + 手续费
    
    // 检查余额是否足够
    const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
    if (user.balance < netAmount) {
      throw new Error(`余额不足，需要 $${netAmount.toFixed(2)}，当前余额 $${user.balance.toFixed(2)}`);
    }
    
    return db.transaction(() => {
      // 更新余额
      const newBalance = parseFloat((user.balance - netAmount).toFixed(2));
      db.prepare("UPDATE users SET balance = ?, updated_at = nowiso() WHERE id = ?")
        .run(newBalance, userId);
      
      // 更新统计字段
      db.prepare(`
        UPDATE users 
        SET total_spend = total_spend + ?,
            total_fees = total_fees + ?,
            last_fee_update = nowiso()
        WHERE id = ?
      `).run(amount, feeAmount, userId);
      
      // 记录交易流水
      const txnResult = db.prepare(`
        INSERT INTO transactions
          (user_id, type, amount, fee_type, fee_amount, net_amount, description, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, nowiso())
      `).run(
        userId,
        '消费',
        -netAmount, // 总支出为负数
        feeType,
        feeAmount,
        -netAmount,
        description
      );
      
      return {
        success: true,
        user_id: userId,
        transaction_id: txnResult.lastInsertRowid,
        spend_amount: amount,
        fee_amount: feeAmount,
        total_amount: netAmount,
        old_balance: user.balance,
        new_balance: newBalance
      };
    })();
  }
  
  /**
   * 记录退款（部分返还）
   * @param {number} userId 
   * @param {number} amount - 退款金额（正数）
   * @param {string} feeType - 退款手续费类型
   * @param {number} feeAmount - 退款手续费（正数）
   * @param {string} description 
   * @param {string} [refId] - 业务关联ID（如card_id），v1.0.99.5+ 可选
   * @returns {object}
   */
  static recordRefund(userId, amount, feeType, feeAmount, description, refId = '') {
    const netReturn = amount - feeAmount; // 净返还 = 退款金额 - 手续费
    
    return db.transaction(() => {
      const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
      const newBalance = parseFloat((user.balance + netReturn).toFixed(2));
      
      // 更新余额
      db.prepare("UPDATE users SET balance = ?, updated_at = nowiso() WHERE id = ?")
        .run(newBalance, userId);
      
      // 更新统计字段（退款增加total_refund）
      db.prepare(`
        UPDATE users 
        SET total_refund = total_refund + ?,
            total_fees = total_fees + ?,
            last_fee_update = nowiso()
        WHERE id = ?
      `).run(amount, feeAmount, userId);
      
      // 记录交易流水（v1.0.99.5 增 ref_id 字段, 业务方传 card_id 等关联ID）
      const txnResult = db.prepare(`
        INSERT INTO transactions
          (user_id, type, amount, fee_type, fee_amount, net_amount, description, ref_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, nowiso())
      `).run(
        userId,
        '退款',
        netReturn, // 净返还为正数
        feeType,
        feeAmount,
        netReturn,
        description,
        refId
      );
      
      return {
        success: true,
        user_id: userId,
        transaction_id: txnResult.lastInsertRowid,
        refund_amount: amount,
        fee_amount: feeAmount,
        net_return: netReturn,
        old_balance: user.balance,
        new_balance: newBalance
      };
    })();
  }
  
  /**
   * 记录拒付（部分返还）
   */
  static recordChargeback(userId, amount, feeType, feeAmount, description) {
    const netReturn = amount - feeAmount;
    
    return db.transaction(() => {
      const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
      const newBalance = parseFloat((user.balance + netReturn).toFixed(2));
      
      db.prepare("UPDATE users SET balance = ?, updated_at = nowiso() WHERE id = ?")
        .run(newBalance, userId);
      
      db.prepare(`
        UPDATE users 
        SET total_chargeback = total_chargeback + ?,
            total_fees = total_fees + ?,
            last_fee_update = nowiso()
        WHERE id = ?
      `).run(amount, feeAmount, userId);
      
      const txnResult = db.prepare(`
        INSERT INTO transactions
        (user_id, type, amount, fee_type, fee_amount, net_amount, description, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, nowiso())
      `).run(
        userId,
        '拒付',
        netReturn,
        feeType,
        feeAmount,
        netReturn,
        description
      );
      
      return {
        success: true,
        user_id: userId,
        transaction_id: txnResult.lastInsertRowid,
        chargeback_amount: amount,
        fee_amount: feeAmount,
        net_return: netReturn,
        old_balance: user.balance,
        new_balance: newBalance
      };
    })();
  }
  
  /**
   * 记录纯手续费（不含消费金额）
   * 用于小额授权费、跨境交易费等场景：上游直接从余额扣了，我们同步扣用户余额
   * @param {number} userId
   * @param {string} feeType - 费用类型（small_transaction / cross_border）
   * @param {number} feeAmount - 手续费（正数）
   * @param {string} description - 描述
   * @param {string} refId - 外部引用ID（如 auth_id）
   * @returns {object} { success, new_balance, transaction_id }
   */
  static recordFeeOnly(userId, feeType, feeAmount, description, refId = '') {
    return db.transaction(() => {
      const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
      if (!user) throw new Error(`用户 ${userId} 不存在`);

      const newBalance = parseFloat((user.balance - feeAmount).toFixed(2));
      db.prepare("UPDATE users SET balance = ?, updated_at = nowiso() WHERE id = ?")
        .run(newBalance, userId);

      // 更新 total_fees
      db.prepare(`
        UPDATE users 
        SET total_fees = total_fees + ?,
            last_fee_update = nowiso()
        WHERE id = ?
      `).run(feeAmount, userId);

      // 记录交易流水
      const txnResult = db.prepare(`
        INSERT INTO transactions
          (user_id, type, amount, fee_type, fee_amount, net_amount, description, ref_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, nowiso())
      `).run(
        userId,
        '手续费',
        -feeAmount,
        feeType,
        feeAmount,
        -feeAmount,
        description,
        refId
      );

      return {
        success: true,
        user_id: userId,
        transaction_id: txnResult.lastInsertRowid,
        fee_amount: feeAmount,
        old_balance: user.balance,
        new_balance: newBalance
      };
    })();
  }

  /**
   * 管理员扣款（直接减少用户余额）
   * 用于场外原因需要扣除用户余额的场景（风控、违约金、误充值清理等）
   * - 不允许扣成负数（余额不足 → 拒绝）
   * - 强制要求 reason（审计要求）
   * - 扣款记入 total_spend（语义上算"非消费支出"）
   * - 写 transactions 流水的 type='管理员扣款'（用户后台可看到）
   * - 写 audit_logs 审计（带管理员 ID、IP、UA、扣款前后余额）
   * @param {number} adminId   操作用户（管理员）ID
   * @param {number} userId    被扣款用户 ID
   * @param {number} amount    扣款金额（正数）
   * @param {string} reason    扣款原因（必填，1-200 字）
   * @param {string} [ip]      管理员 IP
   * @param {string} [ua]      管理员 UA
   * @returns {object} { success, user_id, deduction, old_balance, new_balance, transaction_id, user_name }
   */
  static adminDeduct(adminId, userId, amount, reason, ip = '', ua = '') {
    // 1) 参数校验
    amount = Number(amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('扣款金额必须是正数');
    }
    if (!reason || !String(reason).trim()) {
      throw new Error('扣款原因不能为空');
    }
    if (String(reason).length > 200) {
      throw new Error('扣款原因不能超过 200 字');
    }
    if (adminId === userId) {
      throw new Error('管理员不能扣除自己的余额');
    }

    return db.transaction(() => {
      // 2) 锁定用户当前余额
      const user = db.prepare('SELECT id, email, name, balance FROM users WHERE id = ?').get(userId);
      if (!user) throw new Error('用户不存在');

      // 3) 余额校验（不允许扣成负数）
      if (user.balance < amount) {
        throw new Error(`余额不足，需扣除 $${amount.toFixed(2)}，当前余额仅 $${user.balance.toFixed(2)}`);
      }

      // 4) 更新余额
      const newBalance = parseFloat((user.balance - amount).toFixed(2));
      db.prepare("UPDATE users SET balance = ?, updated_at = nowiso() WHERE id = ?")
        .run(newBalance, userId);

      // 5) 更新统计字段（扣款记入 total_spend）
      db.prepare(`
        UPDATE users
        SET total_spend = total_spend + ?
        WHERE id = ?
      `).run(amount, userId);

      // 6) 写流水（type='管理员扣款'，用户后台能直接看到）
      const txnResult = db.prepare(`
        INSERT INTO transactions
          (user_id, type, amount, net_amount, description, created_at)
        VALUES (?, ?, ?, ?, ?, nowiso())
      `).run(
        userId,
        '管理员扣款',
        -amount,
        -amount,
        `管理员扣款：${String(reason).trim()}`
      );

      // 7) 写审计日志
      db.prepare(`
        INSERT INTO audit_logs
          (user_id, action, detail, ip, ua, created_at)
        VALUES (?, 'admin_deduct', ?, ?, ?, nowiso())
      `).run(
        userId,
        JSON.stringify({
          admin_id: adminId,
          old_balance: user.balance,
          new_balance: newBalance,
          deduction: amount,
          reason: String(reason).trim()
        }),
        ip || '',
        ua || ''
      );

      return {
        success: true,
        user_id: userId,
        user_name: user.name,
        user_email: user.email,
        deduction: amount,
        old_balance: user.balance,
        new_balance: newBalance,
        transaction_id: txnResult.lastInsertRowid
      };
    })();
  }

  /**
   * 管理员充值（直接增加余额）
   */
  static adminTopup(userId, amount, note = '') {
    return db.transaction(() => {
      const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
      const newBalance = parseFloat((user.balance + amount).toFixed(2));
      
      db.prepare("UPDATE users SET balance = ?, updated_at = nowiso() WHERE id = ?")
        .run(newBalance, userId);
      
      // 更新充值总额
      db.prepare(`
        UPDATE users 
        SET topup_total = topup_total + ?
        WHERE id = ?
      `).run(amount, userId);
      
      // 记录交易流水（充值收入，无手续费）
      const txnResult = db.prepare(`
        INSERT INTO transactions
          (user_id, type, amount, net_amount, description, created_at)
        VALUES (?, ?, ?, ?, ?, nowiso())
      `).run(
        userId,
        '管理员充值',
        amount,
        amount,
        note || '管理员手动充值'
      );
      
      return {
        success: true,
        user_id: userId,
        transaction_id: txnResult.lastInsertRowid,
        topup_amount: amount,
        old_balance: user.balance,
        new_balance: newBalance
      };
    })();
  }
  
  /**
   * 手动修正余额（仅管理员使用）
   */
  static adjustBalance(userId, newBalance, reason) {
    return db.transaction(() => {
      const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
      const adjustment = newBalance - user.balance;
      
      db.prepare("UPDATE users SET balance = ?, updated_at = nowiso() WHERE id = ?")
        .run(newBalance, userId);
      
      // 根据调整方向更新对应统计字段
      if (adjustment > 0) {
        // 增加视为充值
        db.prepare('UPDATE users SET topup_total = topup_total + ? WHERE id = ?')
          .run(adjustment, userId);
      } else if (adjustment < 0) {
        // 减少视为费用（暂记入其他费用）
        db.prepare('UPDATE users SET total_fees = total_fees + ? WHERE id = ?')
          .run(-adjustment, userId);
      }
      
      // 记录审计日志
      db.prepare(`
        INSERT INTO audit_logs
          (user_id, action, detail, ip, ua, created_at)
        VALUES (?, 'balance_adjust', ?, ?, ?, nowiso())
      `).run(
        userId,
        JSON.stringify({
          old_balance: user.balance,
          new_balance: newBalance,
          adjustment: adjustment,
          reason: reason || ''
        }),
        '127.0.0.1',
        'System'
      );
      
      return {
        success: true,
        user_id: userId,
        old_balance: user.balance,
        new_balance: newBalance,
        adjustment: adjustment
      };
    })();
  }
  
  /**
   * 修复余额一致性（当发现不一致时手动调用）
   */
  static fixBalanceConsistency(userId) {
    const details = this.getUserBalanceDetails(userId);
    
    if (details.is_consistent) {
      return { success: true, message: '余额已一致', details };
    }
    
    // 用计算值更新数据库余额
    return db.transaction(() => {
      db.prepare('UPDATE users SET balance = ? WHERE id = ?')
        .run(details.calculated_balance, userId);
      
      // 记录修复日志
      db.prepare(`
        INSERT INTO audit_logs
          (user_id, action, detail, ip, ua, created_at)
        VALUES (?, 'balance_fix', ?, ?, ?, nowiso())
      `).run(
        userId,
        JSON.stringify({
          old_balance: details.balance,
          new_balance: details.calculated_balance,
          discrepancy: details.discrepancy,
          formula: 'initial_balance + topup_total - total_net_spend - total_fees'
        }),
        '127.0.0.1',
        'System'
      );
      
      return {
        success: true,
        user_id: userId,
        old_balance: details.balance,
        new_balance: details.calculated_balance,
        discrepancy_fixed: details.discrepancy,
        message: '余额已修复为计算值'
      };
    })();
  }
  
  /**
   * 批量检查所有用户余额一致性
   */
  static checkAllUsersConsistency() {
    const users = db.prepare(`
      SELECT id, email, name FROM users WHERE role = 'user'
    `).all();
    
    const results = users.map(user => {
      const details = this.getUserBalanceDetails(user.id);
      return {
        user_id: user.id,
        user_email: user.email,
        user_name: user.name,
        balance: details.balance,
        calculated_balance: details.calculated_balance,
        is_consistent: details.is_consistent,
        discrepancy: details.discrepancy
      };
    });
    
    const inconsistent = results.filter(r => !r.is_consistent);
    
    return {
      total_users: users.length,
      consistent: users.length - inconsistent.length,
      inconsistent: inconsistent.length,
      details: results,
      inconsistent_users: inconsistent
    };
  }
}

module.exports = BalanceService;