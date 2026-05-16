-- 上游费用成本数据录入
-- 逐条插入避免引号转义问题

INSERT INTO upstream_fee_costs (fee_type, name, upstream_rate, upstream_fixed, upstream_rules, notes) VALUES
('card_creation', '开卡费', 0, 1.00, '{"charge_timing":"开卡时收取","refund_policy":"删卡不退","card_expiry":"卡失效不退"}', '上游每张卡固定收$1');

INSERT INTO upstream_fee_costs (fee_type, name, upstream_rate, upstream_fixed, upstream_rules, notes) VALUES
('transaction', '交易授权手续费', 0.02, 0, '{"charge_timing":"每笔授权时收取","rate":"2%","settle_zero":"结算为0不收"}', '按授权金额2%收取');

INSERT INTO upstream_fee_costs (fee_type, name, upstream_rate, upstream_fixed, upstream_rules, notes) VALUES
('refund', '消费退款手续费', 0.10, 0, '{"charge_timing":"退款时收取","rate":"10%","risk_control":"退款率过高会冻结卡段开卡权限"}', '按退款金额10%收取');

INSERT INTO upstream_fee_costs (fee_type, name, upstream_rate, upstream_fixed, upstream_rules, notes) VALUES
('chargeback', '拒付手续费', 0, 0.30, '{"charge_timing":"拒付发生时收取","fixed":"$0.30","free_count":4,"rule":"前4笔豁免，第5笔起收取"}', '前4笔免费，第5笔起每笔$0.30');

INSERT INTO upstream_fee_costs (fee_type, name, upstream_rate, upstream_fixed, upstream_rules, notes) VALUES
('auth_reversal', '授权撤销手续费', 0.03, 0, '{"charge_timing":"撤销未结算授权时收取","rate":"结算金额x3%","exempt":"结算为0时豁免"}', '按结算金额3%收取');

INSERT INTO upstream_fee_costs (fee_type, name, upstream_rate, upstream_fixed, upstream_rules, notes) VALUES
('small_transaction', '小额交易手续费', 0, 0.40, '{"charge_timing":"单笔授权金额<1美元时收取","fixed":"$0.40","free_count":4,"threshold":"<$1","rule":"前4笔豁免，第5笔起收取"}', '单笔<$1触发，前4笔免费');

INSERT INTO upstream_fee_costs (fee_type, name, upstream_rate, upstream_fixed, upstream_rules, notes) VALUES
('cross_border', '跨境交易手续费', 0.01, 0.45, '{"charge_timing":"非美国商户或非USD结算时收取","rate":"1%","min":"$0.45","rule":"1%或最低$0.45取高"}', '非USD结算触发');

INSERT INTO upstream_fee_costs (fee_type, name, upstream_rate, upstream_fixed, upstream_rules, notes) VALUES
('card_monthly', '卡月费', 0, 0, '{"charge_timing":"按月收取","fixed":"$0","condition":"有效期内无月费","note":"目前免费，后续可能变动"}', '目前为0，卡有效期内不收');
