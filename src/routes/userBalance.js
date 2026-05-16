/**
 * 用户余额明细路由
 * /user/balance/*
 */

const express = require('express');
const router = express.Router();
const BalanceService = require('../services/balanceService');

// ── 获取用户余额详情（收支构成） ─────────────────────────────────────────────
router.get('/details', (req, res, next) => {
  try {
    const details = BalanceService.getUserBalanceDetails(req.user.id);
    res.json({ code: 0, msg: 'ok', data: details });
  } catch (err) {
    next(err);
  }
});

// ── 获取用户的交易分类统计 ─────────────────────────────────────────────────
router.get('/category-stats', (req, res, next) => {
  try {
    const db = require('../db');
    
    // 按类型统计交易金额
    const stats = db.prepare(`
      SELECT 
        type,
        COUNT(*) as count,
        SUM(amount) as total_amount,
        SUM(fee_amount) as total_fee,
        SUM(net_amount) as total_net
      FROM transactions
      WHERE user_id = ?
      GROUP BY type
      ORDER BY COUNT(*) DESC
    `).all(req.user.id);
    
    // 按费用类型统计
    const feeStats = db.prepare(`
      SELECT 
        fee_type,
        COUNT(*) as count,
        SUM(fee_amount) as total_fee
      FROM transactions
      WHERE user_id = ? AND fee_type IS NOT NULL AND fee_type != ''
      GROUP BY fee_type
      ORDER BY SUM(fee_amount) DESC
    `).all(req.user.id);
    
    res.json({ 
      code: 0, 
      msg: 'ok', 
      data: {
        transaction_stats: stats,
        fee_stats: feeStats,
        summary: {
          total_transactions: stats.reduce((sum, s) => sum + s.count, 0),
          total_amount: stats.reduce((sum, s) => sum + s.total_amount, 0),
          total_fees: stats.reduce((sum, s) => sum + s.total_fee, 0),
          distinct_fee_types: feeStats.length
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

// ── 获取最近交易记录（带手续费明细） ────────────────────────────────────────
router.get('/recent-transactions', (req, res, next) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    
    const db = require('../db');
    const transactions = db.prepare(`
      SELECT 
        id, type, amount, fee_type, fee_amount, fee_rate, fee_fixed, net_amount,
        description, created_at
      FROM transactions
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(req.user.id, parseInt(limit), parseInt(offset));
    
    const total = db.prepare('SELECT COUNT(*) as total FROM transactions WHERE user_id = ?').get(req.user.id).total;
    
    res.json({
      code: 0,
      msg: 'ok',
      data: {
        transactions,
        total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (err) {
    next(err);
  }
});

// ── 获取余额变化趋势（最近30天） ────────────────────────────────────────────
router.get('/balance-trend', (req, res, next) => {
  try {
    const db = require('../db');
    
    // 查询最近30天的每日余额变化
    const trend = db.prepare(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as transaction_count,
        SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as income,
        SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) as expense,
        SUM(amount) as net_change,
        SUM(fee_amount) as fees
      FROM transactions
      WHERE user_id = ? AND created_at >= date('now', '-30 days')
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `).all(req.user.id);
    
    // 计算累计余额变化
    let runningBalance = 0;
    const trendWithBalance = trend.map(day => {
      runningBalance += day.net_change;
      return {
        ...day,
        cumulative_balance: parseFloat(runningBalance.toFixed(2))
      };
    });
    
    res.json({
      code: 0,
      msg: 'ok',
      data: trendWithBalance
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;