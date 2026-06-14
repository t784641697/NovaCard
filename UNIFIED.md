# UNIFIED.md — VCC Hub 项目规范

> 本项目所有开发和维护**必须**遵循以下规则。读此文件即视为知情，违反规则导致的 bug 由修改者负责。

---

## 1. 交易类型 (Transaction Type)

### 1.1 数据库存储值
`transactions.type` 字段必须使用**中文**值：

| 存储值 | 含义 | 颜色标签 |
|--------|------|---------|
| `充值` | Topup / Deposit | 绿色 |
| `消费` | Card Spend | 蓝色 |
| `手续费` | Fee / Charge | 红色 |
| `退款` | Refund | 绿色 |

❌ **禁止**使用英文值（`topup`、`spend`、`fee`、`refund` 等）

### 1.2 前端映射
前端 `typeMap` 和后端 `feeTypeMap` 必须包含**所有**已知类型，新增类型时同时更新映射。

---

## 2. 费用类型 (Fee Type)

### 2.1 数据库配置
`fee_configs` 表维护费用类型名称，目前有9种：

| fee_type | description |
|----------|------------|
| `card_creation` | 开卡费 |
| `transaction` | 交易手续费 |
| `refund` | 退款手续费 |
| `chargeback` | 拒付手续费 |
| `cross_border` | 跨境交易费 |
| `small_transaction` | 小额授权费 |
| `withdrawal` | 提现手续费 |
| `auth_reversal` | 撤销手续费 |
| `management` | 管理费 |

### 2.2 前端映射同步
`vcc-dashboard/app.html` 中的 `feeTypeMap` **必须**与 `fee_configs` 表保持同步。新增费用类型时：
1. 在 `fee_configs` 中插入记录
2. 在 `feeTypeMap` 中添加映射

---

## 3. 数据库操作规范

### 3.1 WAL 模式
- 数据库使用 WAL 模式
- **任何写入操作完成后，必须显式调用** `wal_checkpoint(TRUNCATE)` 确保持久化
- 多进程访问时需注意 WAL 文件冲突，必要时先停服务再操作

### 3.2 数据修复
- ❌ **禁止**直接 `db.prepare("UPDATE users SET balance = ?")` 硬编码修改余额
- ✅ **必须**通过 `BalanceService.adjustBalance()` 方法，该方法会：
  - 更新 `balance` 字段
  - 同步更新 `topup_total` 或 `total_fees`
  - 写入审计日志（`audit_logs` 表）

### 3.3 DB 损坏修复
SQLite 生产库偶发索引损坏（`database disk image is malformed`），修复步骤：
1. 停止应用（`pm2 stop vcc-hub`）
2. 删除 WAL 文件（`vcc.db-shm`、`vcc.db-wal`）
3. `VACUUM` 重建数据库
4. 如 VACUUM 失败，导出全部表数据到新库

---

## 4. 页面样式规范 (UI Styling)

### 4.1 管理后台页面风格统一
所有管理后台页面**必须**与开卡审核（`renderCardReviewPage`）保持一致的卡片式布局风格：

| 要素 | 规范 |
|------|------|
| 外层容器 | `<div class="XX-container" style="padding: 0px 4px 28px; max-width: 1400px; margin: 0 auto;">` |
| 标题区域 | 左标题+副标题，右操作按钮 |
| 统计卡片 | 使用 `XX-stats` flex 布局，每个统计为 `XX-stat-card`（深色背景+圆角+悬停微动效） |
| 操作栏 | 使用 `XX-toolbar`（独立卡片）+ `XX-tabs`（内联标签按钮组） |
| 数据表格 | 使用 `XX-table-wrap` + `XX-table` 包裹，表头大写+字母间距，行悬停高亮 |
| 状态标签 | 使用 `XX-tag` + `XX-tag-pending/approved/rejected` 等类名 |
| 空状态 | 使用 `XX-empty` + `XX-empty-icon` + `XX-empty-text` |

> 所有 `XX` 前缀应为页面简称（如 `cr-` 开卡审核、`tr-` 充值审核），CSS 通过 `<style>` 标签内联在页面渲染函数中。

### 4.2 禁止内联 style
- ❌ 禁止在 HTML 模板中大量使用 `style="background:...color:...padding:..."` 等内联样式
- ✅ **必须**提取为 CSS 类名，通过 `className` 或 `class` 引用
- 例外：JavaScript 动态计算的值（如循环中的颜色变量）可保留内联

### 4.3 充值审核页面 (tr-* 前缀)
当前已实现的 `tr-*` 类名规范：
- `.tr-container` / `.tr-header` / `.tr-header-left` — 页面容器和标题
- `.tr-stats` / `.tr-stat-card` / `.tr-stat-num` / `.tr-stat-label` — 统计卡片
- `.tr-toolbar` / `.tr-toolbar-row` / `.tr-tabs` / `.tr-tab` — 操作栏
- `.tr-table-wrap` / `.tr-table` / `.col-*` — 数据表格
- `.tr-tag` / `.tr-tag-pending/approved/rejected` — 状态标签
- `.tr-amount` / `.tr-network` / `.tr-txhash` / `.tr-time` — 单元格内容
- `.tr-user-name` / `.tr-user-email` — 用户信息
- `.tr-btn` / `.tr-btn-pass` / `.tr-btn-reject` — 操作按钮
- `.tr-empty` / `.tr-empty-icon` / `.tr-empty-text` — 空状态
- `.tr-remark-cell` — 备注省略

### 4.4 充值审核页面布局规范
- **容器宽度**：`.tr-container` 使用 `max-width: 1400px`，确保大屏下充分利用横向空间
- **统计卡片**：使用 `gap-4` 间距，内边距 `p-4`，避免拥挤
- **TxHash 交互**：
  - 单元格用 `.tr-txhash` 类（短文本显示 + 右侧复制图标）
  - 悬浮显示完整哈希（通过 `title` 属性或 `data-hash`）
  - 点击复制到剪贴板（首选 `navigator.clipboard`，降级 `execCommand`）
  - 复制成功后蓝色闪烁反馈 + toast 提示
- **状态标签**：使用 `white-space: nowrap` 防止中文标签（如"已通过"）换行折断

### 4.5 Modal 弹窗规范（重要）
- **CSS 控制机制**：`.modal-overlay` 使用 `visibility: hidden; opacity: 0` 隐藏，`classList.add('show')`（`.modal-overlay.show` 设为 `visibility: visible; opacity: 1`）显示
- **所有弹窗必须用 `classList.add/remove('show')`**，禁止用 `style.display = 'flex/none'` 直接操作
- 当前全局 Modal：
  - `confirmModal(id="confirmModalOverlay")` — 确认弹窗（通过操作）
  - `promptModal(id="promptModalOverlay")` — 输入弹窗（驳回原因）

---

## 5. 卡片产品 (Card Products)

### 4.1 数据来源
产品列表由两部分合并：
- **上游 API**（vmcardio `getProductCode()`）：动态产品
- **本地 HARDCODED_PRODUCTS**（`src/routes/cards.js`）：硬编码产品（10可用 + 7暂不可用）

### 4.2 合并规则
- **必须按 `BIN` 字段合并**（不能用 `product_code`，因为 API 和硬编码的 code 不同）
- API 返回但不在 HARDCODED 中的产品 → 标记 `available: false`
- 新增卡段时同时更新 `HARDCODED_PRODUCTS` 和 `metadata`

---

## 5. vmcardio 双 API 架构

| 特性 | Merchant API (`vmapi.vmcardio.com`) | Web API (`dev.vmcardio.com/web/`) |
|------|--------------------------------------|-----------------------------------|
| 认证 | `app_id` + `app_secret` → AccessToken | JWT Session Token |
| 传输 | RSA 加密 `{content: encrypted}` | 明文 JSON |
| 创建卡片 | ❌ G5554LC 无权限 | ✅ 可用 |
| 卡片查询 | ✅ `cardDetail`/`cardTransaction` | ❌ `/getCardList` 404 |
| 当前用途 | 查询（余额/卡片详情/交易） | 创建卡片 |

### 5.1 RSA 密钥管理
- **请求加密**：用 `vmcardio_platform_public.pem`（VM公钥，2048-bit）
- **响应解密**：用 `merchant_private.pem`（商户私钥，2048-bit）
- VM公钥从 sandbox.vmcardio.com → 设置页面获取
- 商户公钥需要上传到 vmcardio 后台

**密钥文件路径**：`config/*.pem`

**密钥更新步骤**：
```bash
# 1. 生成新密钥对
openssl genpkey -algorithm RSA -out config/merchant_private.pem -pkeyopt rsa_keygen_bits:2048
openssl rsa -pubout -in config/merchant_private.pem -out config/merchant_public.pem

# 2. 登录 sandbox.vmcardio.com → API Key → 更新商户公钥
# 3. 等待 5-10 分钟同步
# 4. 重启服务
```

---

## 6. 生产服务器

| 项目 | 信息 |
|------|------|
| 地址 | `43.135.26.36` |
| SSH | `ubuntu` / `System.error.9` |
| 项目路径 | `/opt/vcc-hub` |
| 进程管理 | PM2（进程名: `vcc-hub`） |
| 入口 | `src/app.js`（端口 5000） |
| 反向代理 | Nginx 80 → 5000 |
| Git | `origin/main` → `github.com/t784641697/NovaCard` |

**部署命令**：
```bash
# 拉取最新代码
cd /opt/vcc-hub && git fetch origin && git reset --hard origin/main

# 重启服务
cd /opt/vcc-hub && pm2 stop vcc-hub && pm2 start src/app.js --name vcc-hub --update-env && pm2 save
```

**数据库文件**：`/opt/vcc-hub/data/vcc.db`

---

## 7. 时间戳规范

### 7.1 唯一标准：ISO 8601 UTC

所有时间戳**必须**使用 ISO 8601 UTC 格式（`YYYY-MM-DDTHH:MM:SS.mmmZ`），通过 `nowiso()` SQL 自定义函数生成。

### 7.2 nowiso() 函数

在 `src/db/database.js` 中注册：
```js
db.function('nowiso', () => new Date().toISOString());
```

❌ **禁止**使用 `datetime('now')` — 输出 `YYYY-MM-DD HH:MM:SS` 无时区格式，与 ISO 格式混排时字符串比较会出错（`T`(ASCII 84) > 空格(ASCII 32)）

✅ ORM/应用层也用 `new Date().toISOString()` 生成时间戳，确保 JS ↔ SQLite 一致

### 7.3 排序规范
❌ 禁止 `ORDER BY created_at DESC`（日期格式不统一时排序不准）
✅ **必须用 `ORDER BY id DESC`**，id 自增天然代表时间顺序，不受格式影响

---

## 8. 交易监控页面规范

### 8.1 总体结构
交易监控页面（`renderAdminTxMonitor` / `loadTxMonitor`）采用三层数据视图：

| 层级 | 内容 | 容器 ID |
|------|------|---------|
| 指标卡片 | 8 个核心指标（开卡量/交易笔数/充值笔数/充值金额/失败率/撤销率/退款率） | `#txMonStats` |
| 按用户统计 | 每用户的 7 指标表格（充值金额→充值笔数→开卡量→交易笔数→失败率→撤销率→退款率） | `#txMonUserWrap` |
| 交易明细 | 每笔交易的用户/类型/金额/状态/时间 | `#txMonListWrap` |

### 8.2 页面生命周期
1. `renderAdminTxMonitor()` — 渲染页面骨架 + 初始化 DateRangePicker + 触发 `loadTxMonitor()`
2. `loadTxMonitor()` — 并行请求 `/admin/transaction-stats` 和 `/admin/transactions`，填充数据
3. `txMonReset()` — 重置日期筛选为当月1日至当日并刷新

### 8.3 指标定义

| 指标 | 数据来源 | 说明 |
|------|---------|------|
| 开卡量 | `metrics.card_issued` | cards 表计数（按日期筛选） |
| 交易笔数 | `metrics.tx_count` | **仅统计`消费`类型**，充值不计 |
| 充值笔数 | `metrics.topup_count` | transactions 表 `type='充值'` 计数 |
| 充值金额 | `metrics.topup_amount` | transactions 表 `type='充值'` 金额合计 |
| 入账率 | 本地公式 | `(充值金额 - 消费金额) / 充值金额`（充值资金留存率） |
| 失败率/撤销率/退款率 | 上游 `card_transactions` 表 | 需上游 Auth/清算数据 |

> **入账率计算**：`(topup_amount - spend_amount) / topup_amount`，反映用户充值资金中还有多少未被消费消耗。当上游无卡片清算数据时，失败率/撤销率/退款率显示 `—`。

### 8.4 按用户统计表字段顺序

| 序号 | 列名 | 数据字段 | 颜色 |
|------|------|---------|------|
| 1 | 充值金额 | `u.topup_total` | 绿色 |
| 2 | 充值笔数 | `u.topup_count` | 绿色 |
| 3 | 开卡量 | `u.card_count` | 青色 |
| 4 | 交易笔数 | `u.tx_count`（仅消费） | 白色 |
| 5 | 失败率 | `u.fail_rate`（上游） | 灰色 |
| 6 | 撤销率 | `u.reversal_rate`（上游） | 灰色 |
| 7 | 退款率 | `u.refund_rate`（上游） | 灰色 |

> 排除管理员账号（`role != 'admin'`），admin@vcc.hub 不会出现在统计表中。

### 8.5 日期筛选
- 打开页面时**默认当月1日至当日**（如6月5日展示6月1日~6月5日）
- 用户可通过 DateRangePicker 自定义周期
- 后端 `start_date`/`end_date` 参数作用于 `created_at` 字段（ISO 格式字符串比较）

### 8.6 交易走势图

走势图面板独立于统计周期，自带日期选择器 + 用户筛选：

**数据接口**：`GET /api/admin/transaction-trends`
- 参数：`start_date`, `end_date`, `user_id`（可选）
- 返回：`{ dates: [...], datasets: { card_issued, tx_count, settle_count, topup_count, topup_amount, reversal_count, refund_count } }`
- 数据来源：cards 表（开卡量）+ transactions 表（消费充值）+ card_transactions 表（清算/撤销/退款）
- `tx_count` = 仅「消费」类型交易笔数

**前端渲染**（Chart.js 4.4.0 CDN）：
- 双视图切换：数量走势（柱状图）/ 金额走势（面积图）
- Y 轴步长：数量用整数（`precision:0`），金额用 `$` 前缀
- 绘图区域由 `layout.padding` + `border` 配置限定边界
- 内容区域 `overflow-y: auto` 确保完整可滚动

### 8.7 API 依赖
| API | 参数 | 返回 |
|-----|------|------|
| `GET /api/admin/transaction-stats` | `start_date`, `end_date` | `{ metrics: {...}, per_user: [...] }` |
| `GET /api/admin/transactions` | `start_date`, `end_date`, `page_size`, `page` | `{ list: [...], total: N }` |
| `GET /api/admin/transaction-trends` | `start_date`, `end_date`, `user_id` | 日维度走势数据 |

---

## 9. 公告提醒系统

### 9.1 数据库
`announcements` 表（`src/db/database.js`）：
| 列名 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER PK | 自增主键 |
| `title` | TEXT NOT NULL | 公告标题 |
| `content` | TEXT NOT NULL | 公告内容（支持多行文本） |
| `type` | TEXT DEFAULT '运营公告' | 公告类型（运营公告/系统维护/安全提醒/政策调整） |
| `is_active` | INTEGER DEFAULT 1 | 启用状态（1=启用，0=停用） |
| `created_at` | TEXT DEFAULT nowiso() | 创建时间 |
| `updated_at` | TEXT DEFAULT nowiso() | 更新时间 |

### 9.2 API
| 路径 | 方法 | 角色 | 说明 |
|------|------|------|------|
| `/api/admin/announcements` | GET | admin | 获取全部公告列表 |
| `/api/admin/announcements` | POST | admin | 创建公告 `{title, content, type}` |
| `/api/admin/announcements/:id` | PUT | admin | 更新公告 |
| `/api/admin/announcements/:id` | DELETE | admin | 删除公告 |
| `/api/admin/announcements/:id/toggle` | PATCH | admin | 切换启用/停用 |
| `/api/auth/announcements/active` | GET | 公开 | 获取所有活跃公告（`id, title, content, type, created_at`） |
| `/api/auth/announcements/history` | GET | 公开 | 获取全部公告（含已过期，`id, title, content, type, is_active, created_at`） |

### 9.3 前端交互流程
1. **管理员**：系统设置 → 公告管理面板 → 选择类型 → 输入标题/内容 → 发布（默认启用）
2. **管理员布局**：左右分栏设计，左侧新建（标题+类型下拉+内容+发布按钮），右侧发布记录（固定高度340px内部滚动）
3. **公告类型下拉**：纯 div 实现的自定义下拉组件（`toggleCstSel`/`pickCstSel`），替代原生 `<select>`，深色主题样式
4. **用户登录**：`gotoPage()` 自动调用 `/api/auth/announcements/active` 检测
5. **有未读公告** → 弹出 `showAnnouncementModal()` 模态框 → 点「我知道了」关闭
6. **通知铃铛**：首页右上角显示 🔔 + 未读数字徽标 → 点击弹出历史记录面板（按时间倒序，展示类型标签）

### 9.4 展现规范
- 活跃公告在历史列表中标题青色高亮（`color: var(--primary)`）
- 已过期公告标记「已过期」灰色标签
- 公告内容使用 `white-space: pre-wrap` 保留换行格式
- 输入框使用 `<textarea>` 支持多行编辑，`resize:none` 固定尺寸
- 公告类型显示彩色标签（`.ann-type-badge`），与类型选项图标配色一致
- 管理员发布记录列表显示 → 操作按钮（启用/停用/删除）

### 9.5 已知问题
- ~~后端 `/auth/announcements/active` 和 `/auth/announcements/history` SQL 未 select `type` 字段，导致用户端全显示为「系统维护」→ 已修复（v1.0.24）~~

---

## 10. 响应格式

所有 API 响应遵循统一格式：
```json
// 成功
{ "code": 0, "msg": "ok", "data": { ... } }

// 失败
{ "code": xxx, "msg": "错误描述" }
```

---

---

## 10. 数据库维护

### 9.1 技术栈
- **数据库**：SQLite（better-sqlite3），**DELETE 模式**
- **数据文件**：`data/vcc.db`
- **建表与种子**：`src/db/database.js`（启动时自动执行）
- **索引兜底**：启动时末尾自动 `REINDEX`，重建所有索引
- **upstream_fees 表**：存储上游费用成本（fee_type/upstream_rate/upstream_fixed/rules），通过 `/api/admin/upstream-fees` 管理，与 `fee_configs`（用户费率）独立

### 9.2 历史说明：WAL → DELETE 切换
- **v1.0.16 之前**：使用 `journal_mode = WAL`，PM2 重启时 WAL 文件未落盘导致 `SQLITE_CORRUPT`
- **v1.0.16 起**：改为 `journal_mode = DELETE`，不存在 WAL 文件，重启零问题
- **WAL 的 checkpoint 规范已废弃**，DELETE 模式下每次写入直写主文件

### 9.3 数据库损坏修复流程
当出现 `SQLITE_CORRUPT` / "database disk image is malformed" 时：

**方案 A — 删除 WAL 文件（最优先，90% 情况可解决）**
```bash
pm2 stop vcc-hub
rm -f data/vcc.db-wal data/vcc.db-shm
pm2 start vcc-hub
```

**方案 B — 删库重建（当方案 A 失败时）**
```bash
pm2 stop vcc-hub
rm -f data/vcc.db data/vcc.db-wal data/vcc.db-shm
pm2 start vcc-hub   # database.js 自动建表+迁移+种子
```

> **关键原则**：删库重建后，`database.js` 的 `CREATE TABLE` + 迁移 + 种子数据会自动执行，无需手动处理 schema。重建后丢失的历史数据（交易流水、充值申请等）需要用 `scripts/fix_data_prod.js` 补录。

### 9.4 数据补录规范
- 用户余额调整：**必须使用 `db.prepare('UPDATE users SET balance = ?, topup_total = ? WHERE id = ?').run(...)`**
- 交易流水：`type` 字段用中文值（`'充值'`/`'消费'`/`'手续费'`/`'退款'`）
- 交易流水必须同时设 `amount` 和 `net_amount`（前端取 `net_amount`）
- 充值申请：`topup_requests` 表，`status='approved'` 时表示已审核通过
- 每次数据写入后执行 `db.pragma('wal_checkpoint(TRUNCATE)')`

### 9.5 建表备份脚本
- `scripts/rebuild_final.js` — 全量建表脚本（含所有列，与生产代码 schema 对齐）
- `scripts/fix_data_prod.js` — 生产数据补录脚本（余额 + 充值申请 + 交易流水）
- `scripts/rebuild_db_prod.js` — 旧版重建脚本（仅供历史参考）

---

## 10. KYC 企业认证规范

### 10.1 KYC 表单（用户端）
- **单容器 Tab 布局**：三个 Tab（企业认证信息/法人代表信息/联系方式）共享一个表单容器
- **企业名称 & 证书编号**：同一水平线 grid 2 列布局
- **证书编号为必填项**（前端校验 + 后端校验）
- **身份证上传**：拆为正面/反面两个并排上传区域（`id_card_front` / `id_card_back`），分别对应 `id_card_file JSON {"front":"...","back":"..."}` 
- **文件格式**：`accept="image/*,.pdf"`，支持图片和 PDF
- **法人代表信息区**：法人姓名在上，身份证号在下（垂直排列）
- **表单左对齐**（贴近侧边栏）：`.kyc-page { max-width: 720px; margin: 0; }`
- **提交按钮自适应宽度+居中+胶囊形(超细长版)**：
  - `.kyc-submit-btn { display: inline-flex; width: auto; min-width: 240px; padding: 5px 32px; font-size: .78rem; border-radius: 14px; letter-spacing: .5px; box-shadow: 0 0 18px rgba(126,184,247,.28), 0 4px 12px rgba(167,139,250,.22); }`
  - SVG 图标固定 `width="13" height="13" stroke-width="2.5"`（缩小+加粗避免小图标模糊）
  ### 10.1 KYC 企业认证表单
- 页面布局：表单 `max-width:720px;margin:0;`（左对齐，贴近侧边栏）
- 提交按钮 `.kyc-submit-btn` 规范（v1.0.32）：
  - `padding: 10px 32px`（高度 34px）
  - `font-size: .88rem; font-weight: 700`
  - `min-width: 160px; max-width: 220px; width: auto`（不再撑满，饱满修长）
  - `border-radius: 16px`（胶囊形）
  - `box-shadow: 0 0 18px rgba(126,184,247,.28), 0 4px 12px rgba(167,139,250,.22)`（双层彩色外发光）
  - 背景 `var(--grad)`（冰蓝→薰衣草紫→品粉）
  - SVG 图标：`width:13px; height:13px; stroke-width:2.5`（避免过大）
  - 按钮在 `.kyc-submit-wrap { text-align: center; }` 中**居中对齐**
  - 视觉参考「修改资料重新提交」按钮（胶囊形 + 渐变 + 柔和外发光）
  - 实际宽高比约 5.6:1，既修长又饱满

### 10.2 自定义弹窗系统（已替换所有原生弹窗）
- **`alertModal(msg)`** — 替换原生 `alert()`，渐变暗色背景+半透明遮罩，max-width:780px（用于证件预览）/420px（普通提示）
- **`confirmModal(msg)`** — 替换原生 `confirm()`，支持确定/取消回调
- **`promptModal(msg, defaultVal)`** — 替换原生 `prompt()`，带输入框
- 所有弹窗统一风格：深色渐变背景 `#0d1322→#13192a`，边框 `rgba(0,242,254,.2)`，圆角 16px

### 10.3 KYC 审核页面（管理员端）
- 与开卡审核同款布局（`cr-container` → `cr-stats` → `cr-toolbar` → `cr-table-wrap`）
- 顶部统计卡片：待审核/已通过/已拒绝/共计
- 工具栏：搜索框（支持企业名称/联系人/邮箱）+ Tab（待审核/已通过/已拒绝）+ 搜索/重置按钮
- 表格列：申请人 | 企业名称 | 国家 | 法人代表 | 法人证件 | 联系人 | 状态 | 提交时间 | 操作
- 证件预览按钮（📎 查看证件）打开大弹窗

### 10.4 证件预览弹窗
- **大框套小框布局**：同等大小的两个大卡片框
  - 框1：企业注册证书（单图+下载按钮）
  - 框2：法人身份证（内分正面/背面两个子框并排）
- **下载按钮**：三个下载按钮（证书/正面/背面）统一放置在两个大框下方同一水平线
- **按钮配色**：`linear-gradient(135deg,#7eb8f7,#a78bfa,#e879f9)`（冰蓝→薰衣草紫→品粉）
- **PDF 支持**：文件为 PDF 时显示文件图标+下载按钮，而非 img 预览

### 10.5 侧边栏邮箱脱敏
- 用户邮箱侧边栏显示规则：`test123@163.com` → `te***@163.com`
- 溢出省略：`text-overflow: ellipsis; overflow: hidden; white-space: nowrap;`

### 10.6 KYC 状态页
- **待审核**：⏳ 图标 + "审核中，请耐心等待"
- **已通过**：✅ 图标 + "已通过企业认证"
- **已拒绝**：❌ 图标 + 拒绝原因 + "修改资料重新提交"按钮（点击渲染表单）
- 状态卡片样式：`.kyc-status-card { max-width: 420px; margin: 40px auto; }`

### 10.2 管理员证件预览弹窗

**功能**：管理员审核 KYC 申请时，点击"查看附件"弹出预览弹窗，可直接查看图片和 PDF 文档。

**布局结构**（卡片式三层嵌套）：
```
外层大框（max-width 780px）
  ├── 内框1：企业注册证书
  │     └── 图片/iframe预览 + 底部"下载证书"按钮
  └── 内框2：法人身份证
        ├── 子框2.1：身份证正面
        │     └── 图片/iframe预览 + "下载身份证正面"按钮
        └── 子框2.2：身份证背面
              └── 图片/iframe预览 + "下载身份证背面"按钮
```
3个下载按钮统一在外层大框下方，水平排列。

**PDF 预览机制**：
- **内嵌预览**：使用 `<iframe src="data:application/pdf;base64,...">` 在弹窗内直接渲染 PDF，无需下载
- **新窗口打开**：iframe 右上角浮动按钮 `⛶ 新窗口`，调用 `openKycPdf(id)` 函数：
  - 将 base64 data URL 转为 Blob URL（`URL.createObjectURL`）
  - `window.open(blobUrl, '_blank')` 打开新窗口
  - 60秒后 `URL.revokeObjectURL` 释放内存
  - Blob 创建失败时降级使用 data URL
- **PDF 数据缓存**：`window._kycPdfCache['pdf_1']` 等键存储 data URL，按钮回调时读取

**统一按钮样式**：渐变 `linear-gradient(135deg, #7eb8f7, #a78bfa, #e879f9)` + 白色文字 + hover 阴影提升


---

## 11. 管理员查看用户消费明细

> 应对用户投诉"消费金额不对"，管理员可一键查看某用户**所有卡的所有刷卡流水**。

### 11.1 触发入口
- **位置**：用户管理页（`renderAdminUsers`）行操作列
- **按钮**：紫色 `🔍 查看消费` 按钮（`background: rgba(139,92,246,.12); color: #a78bfa;`）
- **调用**：`openUserTransactionsModal(userId, userName, userEmail, cardCount)`

### 11.2 后端接口

| 项 | 值 |
|---|---|
| 路径 | `GET /api/admin/users/:id/transactions` |
| 鉴权 | `adminMiddleware`（仅管理员）|
| SQL | `SELECT ct.*, c.card_id FROM card_transactions ct JOIN cards c ON ct.card_id = c.card_id WHERE c.user_id = ? AND c.card_id IN (?,?,...) AND ...` |
| 必传 | `userId`（路径参数）|
| 可选 | `type`(Authorization/Settlement/Refund/Reversal), `start_date`, `end_date`, `page`, `page_size`, `format=csv` |
| 返回 | `{user, cards, list, total, summary{by_type, by_card}}` |

**返回结构**：
```js
{
  user: { id, name, email },
  cards: [{card_id, status}],
  list: [{auth_id, card_id, type, status, auth_amount, settle_amount, merchant_name, create_time, ...}],
  total: 107,
  page: 1,
  pageSize: 50,
  summary: {
    by_type: { Authorization: {count, sum_auth}, Settlement: {...}, Refund: {...}, Reversal: {...} },
    by_card: [{card_id, count, sum_settle}]
  }
}
```

**CSV 导出**：`?format=csv` 返回 `Content-Type: text/csv` + `Content-Disposition: attachment`，UTF-8 BOM + 中文化表头（`时间, 卡号, 类型, 状态, 授权金额, 结算金额, 商家, Auth ID`）

### 11.3 前端弹窗规范

**固定尺寸**（**绝对禁止**再用 `flex:1` 自适应）：

| 部位 | 尺寸 | 说明 |
|---|---|---|
| 弹窗 | `width:960px; min-height:720px; max-width:calc(100vw - 48px)` | **不要**加 `max-height:calc(100vh - 48px)`（会把弹窗压扁导致分页器被裁）|
| overlay | `position:fixed; inset:0; display:flex; align-items:flex-start; padding:24px; overflow-y:auto; overflow-x:hidden;` | 弹窗溢出视口时整体可滚 |
| 头 | padding 14px 24px | 头像 46×46 + 用户名/邮箱/卡数 + 关闭按钮 |
| 筛选区 | padding 12px 24px | `background: rgba(255,255,255,.015)` |
| 摘要区 | padding 12px 24px | `grid-template-columns: repeat(4, 1fr)` 4 摘要卡 |
| 表格区 | `flex:0 0 448px; flex-shrink:0; overflow-y:auto; min-height:0; padding:0 24px;` | 装 9 条（行高 44px）+ 滚动条 |
| 分页器 | padding 16px 24px 18px 24px | `border-top: 1px solid rgba(255,255,255,.12); background: rgba(0,0,0,.2);` |

**全状态文件**：`window._utState = { userId, page: 1, pageSize: 50, type: '', startDate: '', endDate: '' }`

**关键函数**：
- `openUserTransactionsModal(userId, userName, userEmail, cardCount)` — 打开弹窗 + 注入 DOM
- `loadUserTransactions()` — 异步拉取 + 渲染表格 + 分页
- `exportUserTransactionsCSV()` — 调 API 拿 CSV blob + `<a download>` 下载

### 11.4 中文化映射

| 数据库值 | 中文显示 |
|---|---|
| `Authorization` | 预授权 |
| `Settlement` | 结算 |
| `Refund` | 退款 |
| `Reversal` | 撤销 |
| `COMPLETE` | 已完成 |
| `DECLINED` | 失败 |
| `PENDING` | 清算中 |

**CSS 标签颜色**（`.ut-tag-*`）：
- Authorization: 青色 `#00f2fe`
- Settlement: 绿色 `#00c758`
- Refund: 橙色 `#ffaa00`
- Reversal: 红色 `#f87171`

### 11.5 ⚠️ 日期筛选避坑指南

**Bug A — Date 对象序列化**：
- ❌ `URLSearchParams` 默认会调 `String(date)` 输出 `Mon Jun 08 2026 ...`
- ✅ **必须** `date.toISOString().slice(0, 10)` 转 `YYYY-MM-DD` 再传

**Bug B — DateRangePicker 回调类型不一致**：
- DateRangePicker `_confirm()` 实际传 `YYYY-MM-DD` **字符串**（不是 Date 对象）
- 如果前端 `_utFmtDate()` 写的是 `d.getFullYear()`，**字符串会抛 TypeError**
- ✅ **必须**做类型判断：`if (typeof d === 'string') return d.slice(0, 10); return d.toISOString().slice(0, 10);`

**Bug C — onConfirm 自动触发查询**：
- DateRangePicker 的 `onConfirm` 回调**不要**在内部调 `loadUserTransactions()`
- ✅ 由用户**点"查询"按钮**才触发（与项目其他筛选区交互一致）

### 11.6 演示数据规范

为了演示和测试，user 2（`user@vcc.hub`）账号下保留：
- 2 张测试卡：`card_demo_001`, `card_demo_002`
- 107 条测试流水（覆盖 14 天 / 4 类型 / 3 状态 / 8 商家）

**生产环境不要保留演示数据**。
