/**
 * 费率配置管理路由
 * /admin/fee-configs/*
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const FeeCalculator = require('../services/feeCalculator');

// ── 中间件：仅管理员访问 ─────────────────────────────────────────────────
router.use((req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ code: 403, msg: '仅管理员可访问' });
  }
  next();
});

// ── 获取所有普通用户列表及其费率配置 ─────────────────────────────────────
// GET /admin/fee-configs/users?q=keyword&page=1&limit=20
router.get('/users', (req, res, next) => {
  try {
    const { q = '', page = 1, limit = 20 } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * Math.max(1, parseInt(limit));
    const pageSize = Math.min(100, Math.max(1, parseInt(limit)));

    // 搜索条件：用户名 / 邮箱 / 手机号
    const keyword = `%${q.trim()}%`;
    const users = db.prepare(`
      SELECT id, name, email, phone, status, balance, created_at
      FROM users
      WHERE role = 'user'
        AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(keyword, keyword, keyword, pageSize, offset);

    const total = db.prepare(`
      SELECT COUNT(*) as cnt FROM users
      WHERE role = 'user'
        AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)
    `).get(keyword, keyword, keyword).cnt;

    // 获取所有费用类型
    const feeTypes = db.prepare(`
      SELECT fee_type, description, fee_rate, fee_fixed, is_active
      FROM fee_configs ORDER BY sort_order ASC
    `).all();

    if (users.length === 0) {
      return res.json({ code: 0, msg: 'ok', data: { users: [], fee_types: feeTypes, total, page: parseInt(page), limit: pageSize } });
    }

    // 批量拉取这些用户的自定义费率
    const userIds = users.map(u => u.id);
    const placeholders = userIds.map(() => '?').join(',');
    const userFeeRows = db.prepare(`
      SELECT user_id, fee_type, fee_rate, fee_fixed, is_active
      FROM user_fee_configs
      WHERE user_id IN (${placeholders}) AND is_active = 1
    `).all(...userIds);

    // 构建 userFeeMap: { userId: { fee_type: {fee_rate, fee_fixed} } }
    const userFeeMap = {};
    for (const row of userFeeRows) {
      if (!userFeeMap[row.user_id]) userFeeMap[row.user_id] = {};
      userFeeMap[row.user_id][row.fee_type] = {
        fee_rate: row.fee_rate,
        fee_fixed: row.fee_fixed,
        is_custom: true
      };
    }

    // 为每个用户拼接费率信息
    const usersWithFees = users.map(u => {
      const fees = {};
      for (const ft of feeTypes) {
        const custom = userFeeMap[u.id]?.[ft.fee_type];
        fees[ft.fee_type] = custom
          ? { ...custom }
          : { fee_rate: ft.fee_rate, fee_fixed: ft.fee_fixed, is_custom: false };
      }
      return { ...u, fees };
    });

    res.json({
      code: 0, msg: 'ok',
      data: { users: usersWithFees, fee_types: feeTypes, total, page: parseInt(page), limit: pageSize }
    });
  } catch (err) {
    next(err);
  }
});

// ── 更新/清除指定用户的单项费率 ─────────────────────────────────────────
// PUT /admin/fee-configs/user/:userId/:fee_type
// body: { fee_rate, fee_fixed }  传 null 表示恢复为全局默认
router.put('/user/:userId/:fee_type', (req, res, next) => {
  try {
    const userId = parseInt(req.params.userId);
    const { fee_type } = req.params;
    const { fee_rate, fee_fixed } = req.body;

    if (isNaN(userId)) return res.status(400).json({ code: 400, msg: 'userId 无效' });

    const user = db.prepare('SELECT id, name, email FROM users WHERE id = ? AND role = ?').get(userId, 'user');
    if (!user) return res.status(404).json({ code: 404, msg: '用户不存在或不是普通用户' });

    const feeExists = db.prepare('SELECT id FROM fee_configs WHERE fee_type = ?').get(fee_type);
    if (!feeExists) return res.status(400).json({ code: 400, msg: `费用类型 "${fee_type}" 不存在` });

    const rateVal = (fee_rate === null || fee_rate === undefined || fee_rate === '') ? null : parseFloat(fee_rate);
    const fixedVal = (fee_fixed === null || fee_fixed === undefined || fee_fixed === '') ? null : parseFloat(fee_fixed);

    // 如果两个值都是 null，删除自定义配置（恢复全局默认）
    if (rateVal === null && fixedVal === null) {
      db.prepare('DELETE FROM user_fee_configs WHERE user_id = ? AND fee_type = ?').run(userId, fee_type);
      return res.json({ code: 0, msg: '已恢复为全局默认费率' });
    }

    db.prepare(`
      INSERT INTO user_fee_configs (user_id, fee_type, fee_rate, fee_fixed, is_active, updated_at)
      VALUES (?, ?, ?, ?, 1, datetime('now'))
      ON CONFLICT(user_id, fee_type) DO UPDATE SET
        fee_rate = excluded.fee_rate,
        fee_fixed = excluded.fee_fixed,
        is_active = 1,
        updated_at = excluded.updated_at
    `).run(userId, fee_type, rateVal, fixedVal);

    res.json({ code: 0, msg: '用户费率更新成功', data: { user_id: userId, fee_type, fee_rate: rateVal, fee_fixed: fixedVal } });
  } catch (err) {
    next(err);
  }
});

// ── 获取全局费率配置列表 ─────────────────────────────────────────────────
router.get('/', (req, res, next) => {
  try {
    const configs = FeeCalculator.getAllFeeConfigs();
    res.json({ code: 0, msg: 'ok', data: configs });
  } catch (err) {
    next(err);
  }
});

// ── 更新全局费率配置 ─────────────────────────────────────────────────────
router.put('/:fee_type', (req, res, next) => {
  try {
    const { fee_type } = req.params;
    const updates = req.body;
    
    // 允许更新的字段
    const allowedFields = ['fee_rate', 'fee_fixed', 'min_amount', 'max_amount', 'description', 'is_active', 'sort_order'];
    const filteredUpdates = {};
    
    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        filteredUpdates[field] = updates[field];
      }
    });
    
    if (Object.keys(filteredUpdates).length === 0) {
      return res.status(400).json({ code: 400, msg: '没有提供有效更新字段' });
    }
    
    const success = FeeCalculator.updateGlobalFeeConfig(fee_type, filteredUpdates);
    
    if (!success) {
      return res.status(404).json({ code: 404, msg: '费率配置不存在' });
    }
    
    res.json({ code: 0, msg: '更新成功' });
  } catch (err) {
    next(err);
  }
});

// ── 为用户设置自定义费率 ─────────────────────────────────────────────────
router.post('/user', async (req, res, next) => {
  try {
    const { user_email, fee_type, fee_rate, fee_fixed, notes } = req.body;
    
    if (!user_email || !fee_type) {
      return res.status(400).json({ code: 400, msg: 'user_email 和 fee_type 必填' });
    }
    
    // 查找用户
    const user = db.prepare('SELECT id, email, name FROM users WHERE email = ? AND role = ?').get(user_email, 'user');
    if (!user) {
      return res.status(404).json({ code: 404, msg: '用户不存在或不是普通用户' });
    }
    
    // 验证费率类型是否存在
    const feeExists = db.prepare('SELECT id FROM fee_configs WHERE fee_type = ?').get(fee_type);
    if (!feeExists) {
      return res.status(400).json({ code: 400, msg: `费用类型 "${fee_type}" 不存在` });
    }
    
    // 设置用户自定义费率
    FeeCalculator.setUserFeeConfig(user.id, fee_type, {
      fee_rate: fee_rate !== undefined ? parseFloat(fee_rate) : null,
      fee_fixed: fee_fixed !== undefined ? parseFloat(fee_fixed) : null,
      notes: notes || null
    });
    
    res.json({ 
      code: 0, 
      msg: '用户费率设置成功',
      data: { user_id: user.id, user_email: user.email, fee_type }
    });
  } catch (err) {
    next(err);
  }
});

// ── 获取用户的自定义费率 ─────────────────────────────────────────────────
router.get('/user', (req, res, next) => {
  try {
    const { email } = req.query;
    
    if (!email) {
      return res.status(400).json({ code: 400, msg: 'email 参数必填' });
    }
    
    const user = db.prepare('SELECT id, email, name FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(404).json({ code: 404, msg: '用户不存在' });
    }
    
    const feeConfigs = FeeCalculator.getUserFeeConfigs(user.id);
    
    res.json({ 
      code: 0, 
      msg: 'ok', 
      data: { 
        user: { id: user.id, email: user.email, name: user.name },
        fee_configs: feeConfigs 
      }
    });
  } catch (err) {
    next(err);
  }
});

// ── 删除用户自定义费率 ───────────────────────────────────────────────────
router.delete('/user/:user_id/:fee_type', (req, res, next) => {
  try {
    const { user_id, fee_type } = req.params;
    
    const deleted = FeeCalculator.deleteUserFeeConfig(parseInt(user_id), fee_type);
    
    if (!deleted) {
      return res.status(404).json({ code: 404, msg: '未找到该用户的此费率配置' });
    }
    
    res.json({ code: 0, msg: '删除成功' });
  } catch (err) {
    next(err);
  }
});

// ── 费率计算测试 ─────────────────────────────────────────────────────────
router.get('/test', (req, res, next) => {
  try {
    // 测试各种场景
    const testCases = {
      '开卡费 (默认)': FeeCalculator.calculateFee('card_creation', 0),
      '消费 $500 (3% + $0.30)': FeeCalculator.calculateFee('transaction', 500),
      '退款 $200 (5% + $0.50)': FeeCalculator.calculateFee('refund', 200),
      '拒付手续费 $100 (8% + $2.00)': FeeCalculator.calculateFee('chargeback', 100),
      '跨境交易 $300 (1.5%)': FeeCalculator.calculateFee('cross_border', 300),
    };
    
    res.json({ code: 0, msg: 'ok', data: testCases });
  } catch (err) {
    next(err);
  }
});

// ── 获取费率计算示例（带用户参数） ─────────────────────────────────────────
router.post('/calculate', (req, res, next) => {
  try {
    const { fee_type, amount, user_id } = req.body;
    
    if (!fee_type || amount === undefined) {
      return res.status(400).json({ code: 400, msg: 'fee_type 和 amount 必填' });
    }
    
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt < 0) {
      return res.status(400).json({ code: 400, msg: 'amount 必须为 >= 0 的数字' });
    }
    
    const result = FeeCalculator.calculateFee(fee_type, amt, user_id || null);
    
    res.json({ 
      code: 0, 
      msg: 'ok', 
      data: result 
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;