# CHANGELOG.md

## v1.0.20 (2026-06-04)
### 新增
- **📊 交易监控页面改造 — 拒卡消费数据统计仪表盘**：三层数据视图（总体6指标卡片 / 按用户统计表 / 交易明细）+ 日期范围筛选 + 默认近7天 + 费率未接入时显示「需上游数据」
- **🆕 后端 API**：`/api/admin/transaction-stats`（总体+分用户统计、支持日期筛选）、`/api/admin/transactions`（交易明细分页）
- **⏰ 时间戳全局统一**：注册 `nowiso()` SQL 自定义函数（输出 ISO 8601 UTC 带 Z），批量替换全部 70+ 处 `datetime('now')`，消除格式混排导致的排序/解析问题

### 修复
- **🔄 交易监控 500 错误**：`transaction-stats` 分用户 SQL 中 `AND WHERE` 语法错误（WHERE 被拼入 JOIN ON 子句）→ 移除复杂 JOIN 查询改用逐用户查询
- **🔧 管理员卡片管理 500**：`cards` 表缺少 `card_type`/`single_limit`/`day_limit`/`month_limit`/`last_verified`/`verified_status`/`verification_error` 7 列，ALTER TABLE 迁移修复
- **🏦 财务中心加载失败**：`/api/admin/finance-summary` 路由不存在 → 新建聚合接口（商户余额 + 用户余额分布 + 系统预留 + 充值/费用统计）
- **💰 系统预留为 0**：原逻辑 `SUM(手续费)` 库里无手续费交易 → 改为 `系统预留 = 商户余额 - 用户余额合计`
- **🔢 用户充值数据 undefined**：`finance-summary` 缺子查询 → 补充 `topup_total`/`total_spend`/`total_fees` 三个子查询
- **📅 充值记录排序倒置**：数据库日期格式不统一（ISO vs SQL datetime），`ORDER BY created_at DESC` 字符串比较时 `T` > 空格 → 改用 `ORDER BY id DESC`
- **💬 确认弹窗显示 HTML 标签原文**：`textContent` → `innerHTML`，支持 `<b>$1.00</b>` 等标签渲染
- **🐛 驳回弹窗不显示**：`style.display='flex'` 与 CSS `visibility/opacity` 机制不匹配 → 改用 `classList.add/remove('show')`
- **❌ 弹窗移除内部 ID**：`'确认通过充值申请 #' + id` → `'确认通过该充值申请'`

### 优化
- **📐 用户余额分布布局（4轮迭代）**：卡片 → 网格 → 行式 → 三列网格 → 最终标准 HTML 表格

## v1.0.19 (2026-06-04)
### 修复
- **💬 确认弹窗显示 HTML 标签原文**：`confirmModal()` 使用 `textContent` 设置提示文字，导致 `<b>$1.00</b>` 标签原文暴露不解析 → 改用 `innerHTML` 正确渲染加粗

## v1.0.18 (2026-06-04)
### 修复
- **📋 充值记录排序倒置**：数据库日期格式不统一（ISO vs SQL datetime），`ORDER BY created_at DESC` 字符串比较时 `T` > 空格，导致最旧记录反排最前 → 改用 `ORDER BY id DESC`，ID 自增天然代表时间顺序，不受格式影响

## v1.0.17 (2026-06-04)
### 修复
- **🐛 驳回弹窗不显示（驳回点不了）**：`promptModal()` 使用 `style.display = 'flex'` 控制显隐，但 `.modal-overlay` CSS 使用 `visibility: hidden; opacity: 0` 而非 `display: none`，导致弹窗从不渲染 → 改用 `classList.add/remove('show')` 与 `confirmModal` 保持一致
- **➕ 补充 `.tr-btn` 基础 CSS**：按钮使用 `class="tr-btn tr-btn-reject"` 但 `.tr-btn` 从未定义，导致按钮缺少 `cursor: pointer`、`inline-flex`、`width/height` 等基础样式

## v1.0.16 (2026-06-04)
### 修复
- **🧨 根除数据库 WAL 损坏**：`journal_mode` 从 `WAL` 改为 `DELETE`，PM2 重启不再有 WAL 文件落盘不及时的问题
- **✨ REINDEX 兜底**：`database.js` 末尾添加 `REINDEX`，每次启动时自动重建所有索引，彻底杜绝索引不一致
- **操作列按钮改版**：emoji 按钮 `✅ 通过` `❌ 拒绝` → 纯图标小圆按钮（绿色 ✓ / 红色 ✕），`inline-flex` 水平居中，列宽 120px→200px
- **清除所有历史备份文件**：生产环境 `data/vcc.db.bak*` 全部删除，排除干扰
- **`database.js` 新增 REINDEX 兜底**：启动时重建所有索引
- **`scripts/fix_card_type.js`** `fix_data_prod.js` 同步改为 DELETE 模式

## v1.0.15 (2026-06-04)
### 优化
- **充值审核页面容器加宽**：全局容器 `max-width` 从 1100px → 1400px，统计卡片间距 `gap-3`→`gap-4`、内边距 `p-3`→`p-4`，表格列宽同步调大
- **TxHash 交互增强**：悬浮显示完整哈希（`title`）、点击复制到剪贴板（`navigator.clipboard` + `execCommand` 降级）、蓝色闪烁反馈 + toast 提示
- **状态标签防换行**：`.tr-tag-status` 添加 `white-space: nowrap`，"已通过"不再折断错行

## v1.0.14 (2026-06-04)
### 修复
- **充值审核页面样式重写**：完全移除内联 style，使用 `tr-*` CSS 类名，与开卡审核页面保持一致的卡片式布局风格（统计卡片 + 操作栏 + 悬停表格）
- **数据库完全重建（第3次）**：删库后让 `database.js` 的 `CREATE TABLE` + 迁移 + 种子自动重建，彻底解决 schema 不匹配导致的 SQLITE_CORRUPT
- **数据补录**：重建后补录用户余额 $30、充值申请 1 条、交易流水 1 条（含 net_amount 字段）
- **`scripts/rebuild_final.js`**：全量建表脚本，补充所有列（`card_id`/`locked_until`/`login_fail_cnt` 等）
- **`scripts/fix_data_prod.js`**：生产数据补录脚本

### 规范
- **UNIFIED.md 新增页面样式规范**：管理后台页面必须使用 CSS 类名 + 卡片式布局，禁止内联 style
- **UNIFIED.md 新增数据库维护规范**：损坏修复流程、WAL checkpoint、数据补录规范

## v1.0.13 (2026-06-04)
### 修复
- **RSA 密钥修复**：重新生成 2048-bit 商户密钥对，用户上传公钥到 vmcardio 后恢复正常解密和加签；修复 `/api/admin/merchant-balance` 解析上游返回格式错误（`result.balance` → `result.data.balance`）
- **总手续费字段异常修复**：`users.total_fees` 字段被错误写入日期字符串 `"2026-05-18 10:24:12"`，导致余额公式计算错误；已重置为 0 并重算余额
- **新增 total_chargeback 列迁移**：代码引用 `total_chargeback` 但 DB 列名为 `total_dispute`，已添加缺失列并同步数据
- **userBalance 路由添加 auth 中间件**：`/api/user/balance/details` 缺少鉴权导致 500
- **卡片列表去重**：后端合并 API + HARDCODED 产品时从按 `product_code` 改为按 `BIN` 合并，API-only 产品标记 `available: false`；前端 24 张卡 → 17 张
- **前端中文文案修复**：商户余额刷新后 `"Wallet:"` → `"额度钱包："`
- **费用类型映射补全**：`feeTypeMap` 从 5 种扩展为 11 种（补充 `transaction`/`chargeback`/`withdrawal`/`auth_reversal`/`management`/`card_monthly`）
- **暂不可用卡段地区名翻译**：`issuing_area` 英文名映射为中文（`Hong Kong SAR` → `香港` 等）
- **数据库损坏修复**：生产库 SQLite 索引损坏（`database disk image is malformed`），通过 VACUUM + 导出重建修复
- **余额修正**：用户 `user@vcc.hub` 从 $1,223 修正为 $30（只有一笔 $30 充值记录），通过 `BalanceService.adjustBalance()` 正规方法走审计链路

## v1.0.12 (2026-06-02)
### 新增
- **卡段使用说明展示**：后端 `HARDCODED_PRODUCTS` 扩充为 10 个可用卡段，增加 `metadata`（适用平台、验证类型、限额、禁止事项）
- **前端开卡 Step2**：新增卡段提醒信息面板

## v1.0.11 (2026-05-22)
### 新增
- **账户流水页面**：新增交易类型列（带颜色标签）和费用类型列
- **交易流水 API**：新增 `/api/ledger` 路由

### 修复
- 管理员审批充值时同步写入交易流水

## v1.0.10 (2026-05-22)
### 新增
- **卡段页面优化**：可用/暂不可用区分展示（10 可用 + 7 不可用），置灰 + 「暂不可用」标签

## v1.0.9 (2026-05-22)
### 维护
- **完整项目备份到 GitHub**：清理无用文件（assets 截图、bak 备份、嵌套目录、旧同步脚本等）

## v1.0.8 (2026-05-18)
### 新增
- **VC113 卡段**：BIN 537872（Mastercard 美国，AI/Agent 工具付费），仅 Web API 可用
- 后端 `/meta/products` 增加硬编码兜底列表

## v1.0.7 (2026-05-18)
### 架构变更
- **全面迁移到 Web API 开卡**：Merchant API 产品权限不足，切换至 `dev.vmcardio.com/web/createCard` + JWT Session Token
- 使用 `bin`/`customize_name`/`customize_last_name`/`bind_uid` 等 Web 参数名
- 卡片异步处理（~10-20秒），审批后管理员可手动同步获取 `card_id`

## v1.0.6 (2026-05-18)
### 修复
- 开卡审批传参：`product_code` 优先于 `card_bin`，补充 `user_id: '20098106'`
- 持卡人姓名自动去除数字

## v1.0.5 (2026-05-18)
### 变更
- 移除开卡表单的邮箱字段

## v1.0.4 (2026-05-18)
### 新增
- 开卡申请表单重构：改为卡内充值金额（≥$20/张）+ 开卡数量
- 新增管理员审批流程

## v1.0.3 (2026-05-18)
### 新增
- 卡片数据同步机制：管理员查看卡片列表时自动 `&sync=true` 从上游拉取最新状态

## v1.0.2 (2026-05-18)
### 修复
- 卡片管理搜索功能 SQL 双重 WHERE 语法错误
- 状态标签点击自动搜索 + 冻结状态值修正

## v1.0.1 (2026-05-18)
### 变更
- 移除顶部标题栏
- 品牌名 XiuXiu Card → NovaCard

## v1.0.0 (2026-05-18)
### 初始版本
- 从 XiuXiu Card 迁移
- 基础卡片管理平台功能