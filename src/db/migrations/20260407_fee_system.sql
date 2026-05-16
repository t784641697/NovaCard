-- 费率系统数据库迁移
-- 2026-04-07：支持全局费率 + 用户级自定义费率

-- 1. 全局费率配置表
CREATE TABLE IF NOT EXISTS fee_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fee_type TEXT NOT NULL,              -- 费用类型：card_creation / transaction / refund / dispute / cross_border / withdrawal
  description TEXT NOT NULL,            -- 费用描述
  fee_rate DECIMAL(5,4) DEFAULT 0,     -- 百分比费率，如 0.05=5%
  fee_fixed DECIMAL(10,2) DEFAULT 0,   -- 固定费用（美元）
  min_amount DECIMAL(10,2) DEFAULT 0,  -- 最小金额限制（可选）
  max_amount DECIMAL(10,2) DEFAULT 0,  -- 最大金额限制（可选，0表示无限制）
  currency TEXT DEFAULT 'USD',
  is_active BOOLEAN DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(fee_type)
);

-- 2. 用户级自定义费率表（覆盖全局配置）
CREATE TABLE IF NOT EXISTS user_fee_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  fee_type TEXT NOT NULL,              -- 费用类型，同fee_configs.fee_type
  fee_rate DECIMAL(5,4) DEFAULT NULL,  -- NULL表示沿用全局费率
  fee_fixed DECIMAL(10,2) DEFAULT NULL,
  min_amount DECIMAL(10,2) DEFAULT NULL,
  max_amount DECIMAL(10,2) DEFAULT NULL,
  is_active BOOLEAN DEFAULT 1,
  notes TEXT,                          -- 自定义备注，如“VIP用户折扣”
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, fee_type)
);

-- 3. 用户表新增统计字段
ALTER TABLE users ADD COLUMN initial_balance DECIMAL(10,2) DEFAULT 0;
ALTER TABLE users ADD COLUMN topup_total DECIMAL(10,2) DEFAULT 0;      -- 管理员充值累计
ALTER TABLE users ADD COLUMN total_spend DECIMAL(10,2) DEFAULT 0;      -- 总消费（不含退款/撤销）
ALTER TABLE users ADD COLUMN total_refund DECIMAL(10,2) DEFAULT 0;     -- 总退款返还
ALTER TABLE users ADD COLUMN total_dispute DECIMAL(10,2) DEFAULT 0;    -- 总撤销返还
ALTER TABLE users ADD COLUMN total_fees DECIMAL(10,2) DEFAULT 0;       -- 总手续费
ALTER TABLE users ADD COLUMN last_fee_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- 4. 交易表新增手续费字段
ALTER TABLE transactions ADD COLUMN fee_type TEXT;
ALTER TABLE transactions ADD COLUMN fee_amount DECIMAL(10,2) DEFAULT 0;
ALTER TABLE transactions ADD COLUMN fee_rate DECIMAL(5,4) DEFAULT 0;
ALTER TABLE transactions ADD COLUMN fee_fixed DECIMAL(10,2) DEFAULT 0;
ALTER TABLE transactions ADD COLUMN net_amount DECIMAL(10,2) DEFAULT 0; -- 净变动额：amount - fee_amount
ALTER TABLE transactions ADD COLUMN fee_config_id INTEGER DEFAULT NULL; -- 引用的费率配置ID（便于溯源）

-- 5. 初始化默认费率配置（示例值，需根据实际合同调整）
INSERT OR IGNORE INTO fee_configs (fee_type, description, fee_rate, fee_fixed, min_amount, max_amount, sort_order) VALUES
-- 开卡费
('card_creation', '虚拟卡开卡手续费', 0, 10.00, 0, 0, 10),
-- 消费交易手续费
('transaction', '消费交易手续费', 0.03, 0.30, 0, 0, 20),
-- 退款手续费
('refund', '退款手续费', 0.05, 0.50, 0, 0, 30),
-- 争议/拒付手续费
('dispute', '争议处理手续费', 0.08, 2.00, 0, 0, 40),
-- 跨境手续费
('cross_border', '跨境交易费', 0.015, 0, 0, 0, 50),
-- 提现手续费（预留）
('withdrawal', '余额提现手续费', 0.02, 1.00, 0, 0, 60);

-- 6. 为现有数据设置默认值
UPDATE users SET initial_balance = 0 WHERE initial_balance IS NULL;
UPDATE users SET topup_total = (SELECT SUM(amount) FROM topup_requests WHERE user_id = users.id AND status = 'approved') WHERE role = 'user';

-- 7. 为现有交易数据设置net_amount（假设现有交易fee_amount=0）
UPDATE transactions SET net_amount = amount WHERE net_amount IS NULL;

-- 8. 创建索引提升查询性能
CREATE INDEX IF NOT EXISTS idx_fee_configs_type ON fee_configs(fee_type, is_active);
CREATE INDEX IF NOT EXISTS idx_user_fee_configs ON user_fee_configs(user_id, fee_type, is_active);
CREATE INDEX IF NOT EXISTS idx_transactions_fee ON transactions(user_id, fee_type);
CREATE INDEX IF NOT EXISTS idx_transactions_net ON transactions(user_id, net_amount);

-- 迁移完成