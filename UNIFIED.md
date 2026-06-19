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

### 5.1 数据来源
产品列表由两部分合并：
- **上游 API**（vmcardio `getProductCode()`）：动态产品
- **本地 HARDCODED_PRODUCTS**（`src/routes/cards.js`）：硬编码产品（10可用 + 7暂不可用）

### 5.2 合并规则
- **必须按 `BIN` 字段合并**（不能用 `product_code`，因为 API 和硬编码的 code 不同）
- API 返回但不在 HARDCODED 中的产品 → 标记 `available: false`
- 新增卡段时同时更新 `HARDCODED_PRODUCTS` 和 `metadata`

### 5.3 卡段管理后台规范 (v1.0.58+)
- **三段式布局**：顶部说明卡片 + 搜索栏 + 表格 + 翻页器
- **顶部说明卡片**：只描述"开关关闭的影响"等业务规则，不展示"DB override > HARDCODED > docx"等技术细节
- **搜索栏**：实时模糊匹配 `product_code` / `bin` (前6位) / `issuing_area_name`，不区分大小写
- **翻页器**：默认 10 条/页，控件 = `«首页 / ‹上一页 / 第N/M页 / 下一页› / 末页»`
  - 边界自动 disabled
  - 总数 ≤ 页大小时只显示「第 1 / 1 页」
  - 搜索后自动回第 1 页
  - 重新加载数据后自动回第 1 页
- **"适用平台"列**：固定 240px (见 §4.6)，最多前 3 个 tag + `+N more`，hover 显示完整列表
- **BIN 显示**：统一只显示前 6 位（v1.0.19 的 12 位拆双 BIN 显示已废弃）
- **前端全局状态变量**：
  - `_cardProductsList` — 全量 17 条
  - `_cardProductsKeyword` — 当前搜索词
  - `_cardProductsPage` — 当前页 (1-based)
  - `_CARD_PRODUCTS_PAGE_SIZE` — 10

### 5.4 卡段管理 PUT 接口行为约束 (v1.0.59 fix)
- **缺省字段必须不进 patch**，不能填成 `null` 后传给 `upsert`
- **根因 (v1.0.58 bug)**：admin.js 把 `applicable_platforms: applicable_platforms === undefined ? null : applicable_platforms` 传给 upsert
  - `null !== undefined` → upsert 走"写入"分支 → 把 DB 旧值清成 `NULL`
  - 表现：管理员每点一次开关，之前保存的"适用平台/管理员备注"就被清空
- **正确做法**：
  ```js
  const patch = {};
  if (applicable_platforms !== undefined) patch.applicable_platforms = Array.isArray(applicable_platforms) ? applicable_platforms : null;
  // 不传时完全不放进 patch → upsert 自动保留旧值
  if (custom_message !== undefined) patch.custom_message = custom_message || null;
  // available 是特殊 case, 新建时无 existing 必须给默认值
  if (available !== undefined) patch.available = available ? 1 : 0;
  else patch.available = 1; // 首次插入时
  cardProductOverrideService.upsert(pc, patch, userEmail);
  ```
- **upsert 行为定义**（service 层）：
  - `patch.xxx === undefined` → 保留 `existing.xxx`
  - `patch.xxx === null` → 写入 `null`（显式清空）
  - `patch.xxx === []` → 写入 `[]`（空数组）
  - `patch.xxx === "value"` → 写入新值

### 5.5 用户端卡段卡片规范 (v1.0.58+)
- **不可用卡段**：CSS `pointer-events: none` 阻断点击，遮罩显示"暂不可用"
  - ❌ 禁止用 JS `alert()` 提示（v1.0.58 之前用 alert，已废弃）
  - ❌ 禁止"⏸"图标前缀（v1.0.58 后移除）
- **平台 tag 显示**：最多 3 个 + `+N`，hover 显示完整列表
- **hover title 三种状态**：
  1. 有 `applicable_platforms` → `适用平台: Facebook, Google, ...`
  2. 沿用 docx → `适用平台 (docx 默认): Facebook, ...`
  3. 未设置 → `管理员未设置适用平台`
- **title 转义**：必须 escape `& " < >` 4 个字符（防 XSS / 破坏属性）

---

## 5. vmcardio 双 API 架构

| 特性 | Merchant API (`vmapi.vmcardio.com`) | Web API (`dev.vmcardio.com/web/`) |
|------|--------------------------------------|-----------------------------------|
| 认证 | `app_id` + `app_secret` → AccessToken | JWT Session Token |
| 传输 | RSA 加密 `{content: encrypted}` | 明文 JSON |
| 创建卡片 | ✅ 全部 17 个 product_code 均可（含 VC102/原 G5554LC） | ❌ 正式环境无此端点 |
| 卡片查询 | ✅ `cardDetail`/`cardTransaction` | ❌ `/getCardList` 404 |
| 当前用途 | 查询（余额/卡片详情/交易） | 创建卡片 |

### 5.6 RSA 密钥管理
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

> **⚠️ 重要**：本节描述的是**已弃用**的旧腾讯云服务器（`43.135.26.36`）。当前生产环境见 §13。

| 项目 | 信息 |
|------|------|
| 地址（已停用）| `43.135.26.36` |
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


---

## 12. 按卡查看消费明细

> 卡片管理每行新增 `📊 流水` 按钮，从卡的维度查看该卡所有刷卡流水，复用用户维度弹窗。

### 12.1 触发入口
- **位置**：卡片管理页（`renderAdminCards`）`.cm-card-right` 内 `.cm-bal` 之前
- **按钮**：紫色 `📊 流水` 按钮（`background: rgba(139,92,246,.12); color: #a78bfa;`）
- **调用**：`openCardTransactionsModal(cardId)`

### 12.2 后端接口

| 项 | 值 |
|---|---|
| 路径 | `GET /api/admin/cards/:cardId/info` |
| 用途 | 拉取卡片头部信息（轻量、仅查本地 DB）|
| 返回 | `{card_id, card_number, product_code, label, brand, status, available_balance, currency, owner: {id, email, name}}` |
| 路径 | `GET /api/admin/cards/:cardId/transactions` |
| 用途 | 拉取该卡的刷卡流水（复用公共 `fetchCardTransactions`）|
| 支持参数 | `type, start_date, end_date, page, page_size, format=csv` |
| 返回 | `{card, owner, list, total, summary{by_type, by_card, total_count, total_auth, total_settle, total_refund}}` |

### 12.3 前端弹窗复用模式

- **底层**：`_openTxnModalShell({mode, headerInfo})` 负责弹窗 HTML + 事件 + DateRangePicker + load
- **Entry 1**：`openUserTransactionsModal(userId, userName, userEmail, cardCount)` 调底层，mode='user'
- **Entry 2**：`openCardTransactionsModal(cardId)` 拉 `/info` 后调底层，mode='card'

### 12.4 ⚠️ cards 表 schema 注意

| 字段 | 数据库列名 | 备注 |
|---|---|---|
| 余额 | `available_amount`（不是 `available_balance`）| SQL 千万别写错 |
| 币种 | 无列 | 固定 `USD` |
| 品牌 | 无列 | 用 `product_code` 推断（VC102/VC113/G5xx/G54xx/S2xx/S5xx=Mastercard）|

### 12.5 双入口触发矩阵

| 入口 | mode | 头部显示 | 默认范围 | 数据范围 |
|---|---|---|---|---|
| 用户管理 → 🔍 查看消费 | user | 头像 + 姓名/邮箱/卡数 | 本月 1 日—今天 | 该用户所有卡的所有流水 |
| 卡片管理 → 📊 流水 | card | 品牌徽章 + 卡号 + 余额 + 状态 | 本月 1 日—今天 | 该卡的流水 |


## 13. Vultr 新加坡生产服务器 + Cloudflare CDN

### 13.1 整体架构（双层）

```
用户浏览器
   │  HTTPS
   ▼
Cloudflare Free（CDN/SSL/防 DDoS/隐藏 IP）
   │  HTTPS 443 (Origin Certificate)
   ▼
Vultr 新加坡服务器 (139.180.188.104)
   │  Nginx 80/443 反代
   ▼
Node.js Express :5000
   │
   ▼
SQLite (data/vcc.db) + vmcardio API
```

**关键优势**：
- **隐藏真实 IP**：访客只看到 Cloudflare IP，Vultr `139.180.188.104` 不暴露
- **DDoS 防护**：Cloudflare 免费基础防护
- **SSL 卸载**：用户↔Cloudflare 是 Universal SSL，Cloudflare↔源站是 Origin SSL
- **全球 CDN 加速**：Cloudflare 边缘节点缓存静态资源

### 13.2 Vultr 服务器规范

| 项 | 值 |
|---|---|
| 机房 | Singapore（新加坡）|
| 配置 | 2C/4G/80G SSD/3TB 流量（共享 CPU）|
| 价格 | $24/月 |
| OS | Ubuntu 24.04 LTS x64 |
| 默认用户 | `linuxuser`（**不是 ubuntu**）|
| SSH | RSA 4096 OpenSSH 格式密钥对 |
| 内核 | Linux 6.8（Ubuntu 24.04 默认）|

**注意**：Vultr Ubuntu 24.04 镜像的默认用户名是 `linuxuser`（UID 1000），不是历史默认的 `ubuntu`。Reinstall 时 Vultr 注入的 SSH 公钥在 `root` 用户，需要手动 `cp /root/.ssh/authorized_keys /home/linuxuser/.ssh/`。

### 13.3 域名管理（Namecheap）

| 域名 | 注册商 | 价格 | 续费 |
|---|---|---|---|
| `nova-vcc.com` | Namecheap | $6.99 首年（NEWCOM679 优惠码 + ICANN $0.20）| $14.98/年（原价）|

**WhoisGuard**：免费自动开启（保护域名所有者信息）  
**Auto-Renew**：✅ 开启（避免忘记续费丢失）  
**Email Forwarding**：✅ 开启（Namecheap 免费邮件转发到 `Taoliang.light@gmail.com`）

### 13.4 Cloudflare 配置规范

#### DNS 记录（必须开启 Proxied）

| Type | Name | Content | Proxy | 备注 |
|---|---|---|---|---|
| A | `nova-vcc.com` | `139.180.188.104` | 🔶 **Proxied** | 根域名 |
| CNAME | `www` | `nova-vcc.com` | 🔶 **Proxied** | www 二级 |
| MX | `nova-vcc.com` | `eforward[1-5].registrar-servers.com` | ⚫ DNS only | Namecheap 邮件转发 |
| TXT | `nova-vcc.com` | `v=spf1 include:spf.eforward....` | ⚫ DNS only | SPF 记录 |

**⚠️ 重要**：根域名 A 记录和 www CNAME **必须**开启 🔶 橙色云朵（Proxied），否则 Cloudflare CDN/SSL 不生效，真实 IP 暴露。

#### SSL/TLS 模式

| 模式 | 用途 | 推荐度 |
|---|---|---|
| Flexible | 用户↔CF 是 HTTPS，CF↔源站是 HTTP | ⭐⭐ 不推荐 |
| Full | 双向 HTTPS，接受自签名 | ⭐⭐⭐ |
| **Full (Strict)** | 双向 HTTPS，验证源站证书 | ⭐⭐⭐⭐ **当前使用** |

**当前使用**：Full (Strict) + Cloudflare Origin Certificate（CA 信任的专用证书）

#### Origin Certificate

| 字段 | 值 |
|---|---|
| 类型 | RSA 2048 |
| 有效期 | 15 年（2026-06-16 → 2041-06-12）|
| 覆盖域名 | `nova-vcc.com` + `*.nova-vcc.com` |
| 私钥路径 | `/etc/ssl/cloudflare/origin-key.pem`（chmod 600）|
| 证书路径 | `/etc/ssl/cloudflare/origin-cert.pem`（chmod 644）|
| **⚠️ 警告** | 私钥只在创建时显示一次，**必须立即保存** |

### 13.5 Nginx 配置规范

**文件**：`/etc/nginx/sites-enabled/vcc-hub`

**关键点**：
- **必须**在 server 块前加 `set_real_ip_from` 引入 Cloudflare IP 段 + `real_ip_header CF-Connecting-IP;`，否则日志/限流拿不到访客真实 IP
- **必须**监听 443 并配 SSL（Full (Strict) 模式要求）
- 80 端口 301 重定向到 HTTPS（保持兼容性 + 防止 HTTP 访问）
- `proxy_set_header X-Forwarded-Proto $scheme`（让 Express 知道真实协议）
- `client_max_body_size 50M`（文件上传）
- `proxy_read_timeout 86400`（24 小时，防长连接被切）

**Cloudflare IP 段**（2026-06 最新，详见 [Cloudflare IPs](https://www.cloudflare.com/ips/)）：
```
103.21.244.0/22, 103.22.200.0/22, 103.31.4.0/22
104.16.0.0/13, 104.24.0.0/14
108.162.192.0/18, 131.0.72.0/22
141.101.64.0/18, 162.158.0.0/15
172.64.0.0/13, 173.245.48.0/20
188.114.96.0/20, 190.93.240.0/20
197.234.240.0/22, 198.41.128.0/17
IPv6: 2400:cb00::/32, 2606:4700::/32, 2803:f800::/32
      2405:b500::/32, 2405:8100::/32, 2a06:98c0::/29, 2c0f:f248::/32
```

### 13.6 UFW 防火墙规范

```bash
ufw default deny incoming
ufw allow 22/tcp      # SSH
ufw allow 80/tcp      # HTTP（Cloudflare 兜底）
ufw allow 443/tcp     # HTTPS
ufw allow 5000/tcp    # Node.js 直连（运维用，生产应禁外网）
ufw enable
```

**生产环境 5000 端口建议**：仅 `127.0.0.1` 监听，外部通过 Nginx 443 访问。

### 13.7 部署/部署命令

```bash
# SSH 登录
ssh -i /workspace/projects/.ssh/vultr_new_key linuxuser@139.180.188.104

# 拉取最新代码
cd /opt/vcc-hub && git fetch origin && git reset --hard origin/main

# 重启服务（PM2）
pm2 restart vcc-hub
# 或
pm2 delete vcc-hub && pm2 start src/app.js --name vcc-hub --update-env && pm2 save

# 重启 Nginx
sudo systemctl restart nginx

# 查看日志
pm2 logs vcc-hub
sudo tail -f /var/log/nginx/vcc-hub-access.log
```

### 13.8 旧生产服务器（已弃用）

| 项 | 值 |
|---|---|
| 地址 | `http://43.135.26.36` |
| 定位 | 腾讯云香港（**已停止对外服务**）|
| 数据 | 保留在 `/opt/vcc-hub/data/vcc.db` 作为备份 |
| 切换原则 | 新用户走 nova-vcc.com，老用户逐步迁移 |

### 13.9 故障排查速查

| 现象 | 根因 | 解决 |
|---|---|---|
| Cloudflare 521 | SSL 模式 = Full/Strict 但源站无 443 SSL | 改 Flexible，或给源站加 Origin Certificate |
| Cloudflare 525 | SSL 握手失败 | 检查证书/私钥是否匹配 |
| Cloudflare 502/504 | 源站 Node.js 挂了 | `pm2 status` + `pm2 restart vcc-hub` |
| 浏览器显示"不安全" | Universal SSL 未签发完成 | 等 15-20 分钟，Cloudflare 自动签发 |
| ERR_CONNECTION_TIMED_OUT | DNS 还没传播 | https://dnschecker.org/ 检查全球解析 |
| `linuxuser` SSH 失败 | 公钥只注入到 root | `cp /root/.ssh/authorized_keys /home/linuxuser/.ssh/` |

## 14. Vultr 自动备份脚本

### 14.1 部署信息

| 项 | 值 |
|---|---|
| 脚本路径 | `/opt/vcc-hub/scripts/auto-backup.sh`（同时存在沙箱 `/workspace/projects/scripts/auto-backup.sh`） |
| 配置示例 | `/workspace/projects/scripts/auto-backup.env.example` |
| 执行时间 | `0 3 * * *`（每天凌晨 3:00） |
| crontab 状态 | `systemctl is-active cron` = `active` |
| 日志 | `/var/log/novacard-backup.log` |
| 本地备份目录 | `/opt/vcc-hub/backups/`（保留 7 天，自动轮转） |

### 14.2 备份流程

```
[1/4] SQLite 热备份 (VACUUM INTO)
       ↓
[2/4] 打包 tar.gz (data/ + .env + config/)
       ↓
[3/4] 验证备份 (integrity_check + tar list)
       ↓
[4a/4] 本地轮转 (保留 7 天)
       ↓
[4b/4] 可选 GitHub Release 推送 (需 GITHUB_PAT)
```

### 14.3 关键技术细节

- **SQLite 备份**：用 `VACUUM INTO` (SQLite 3.27+) 而非 `cp`，原因：
  - `cp` 在 WAL 模式下可能丢失未 checkpoint 的数据
  - `VACUUM INTO` 输出是**已 checkpoint + 已压缩**的干净文件
  - 副作用：源 DB 不被修改（VACUUM INTO 是输出到新文件）
  - 实际效果：5.5MB → 2.9MB（节省 48%）

- **管道 SIGPIPE 修复**：`set -o pipefail` + `grep -q` 会因为 grep 提前退出导致 tar 收到 SIGPIPE，整个 pipeline 失败。改用临时文件：
  ```bash
  tar tzf "$BACKUP_PATH" > "$TAR_LIST" 2>/dev/null
  grep -q "^data/vcc.db$" "$TAR_LIST" || err "备份中无 data/vcc.db"
  rm -f "$TAR_LIST"
  ```

- **better-sqlite3 `.backup()` 不可用**：该 API 来自 node-sqlite3，better-sqlite3 不实现。改用 `VACUUM INTO` 替代。

### 14.4 启用 GitHub Release 推送（可选）

```bash
# 1. 创建 GitHub PAT: https://github.com/settings/tokens/new
#    勾选 "public_repo" 或 "repo" 权限

# 2. 追加到 /opt/vcc-hub/.env
echo "GITHUB_PAT=ghp_xxxxxxxxxxxxxxxxxxxx" >> /opt/vcc-hub/.env
echo "GITHUB_REPO=t784641697/NovaCard" >> /opt/vcc-hub/.env

# 3. 重启 cron (其实不需要,下次跑就生效)
# crontab 每天 3:00 自动跑
```

推送后会在 GitHub 看到：
- 每天一个 Release tag: `backup-2026-06-17-033737`
- Release 标题: `NovaCard Backup 2026-06-17`
- Asset: `novacard-2026-06-17-033737.tar.gz` (~2MB)

### 14.5 手动触发备份

```bash
ssh root@139.180.188.104 '/opt/vcc-hub/scripts/auto-backup.sh'
```

### 14.6 验证备份完整性

```bash
# 1. 在 Vultr 验证
ssh root@139.180.188.104 'cd /opt/vcc-hub/backups && for f in *.tar.gz; do
  echo "=== $f ==="
  tar tzf "$f" | head -10
  echo "大小: $(du -h $f | cut -f1)"
done'

# 2. 在沙箱验证
cd /workspace/projects/backups
for f in *.tar.gz; do
  tar xzf "$f" -C /tmp/test-restore
  node -e "const D=require('better-sqlite3'); \
    const db=new D('/tmp/test-restore/data/vcc.db',{readonly:true}); \
    console.log('$f:', db.pragma('integrity_check')); \
    console.log('  users:', db.prepare('SELECT count(*) c FROM users').get().c);"
  rm -rf /tmp/test-restore
done
```

## 15. Cloudflare 三项优化

### 15.1 Always Use HTTPS（强制 HTTPS）

| 项 | 值 |
|---|---|
| 路径 | Cloudflare Dashboard → nova-vcc.com → **SSL/TLS → Edge Certificates** |
| 开关 | Always Use HTTPS → **On** |
| 效果 | `http://nova-vcc.com/` → `301` → `https://nova-vcc.com/` |
| 验证 | `curl -sI http://nova-vcc.com/` 返回 `Location: https://nova-vcc.com/` |
| 计划要求 | **Free** 计划支持 |

### 15.2 Brotli 压缩

| 项 | 值 |
|---|---|
| 路径 | 无需手动开，Cloudflare Free 计划**默认启用** |
| 验证 | `curl -sI -H "Accept-Encoding: br" https://nova-vcc.com/static/app.html` |
| 响应头 | `content-encoding: br` |
| 实际效果 | `app.html` 从 **471KB → 106KB**（省 77%） |
| 计划要求 | **Free** 计划支持 |

### 15.3 Auto Minify（HTML/CSS/JS 压缩）

| 项 | 值 |
|---|---|
| 路径 | Speed → Settings → Content Optimization |
| 状态 | **Free 计划 UI 不显示开关**（强制启用不可关闭） |
| 计划要求 | **Free** 计划强制启用 |
| 验证 | 看 Source 视图，HTML/CSS/JS 已被去除空白和注释 |

### 15.4 未启用的优化

| 优化 | 状态 | 原因 |
|---|---|---|
| Rocket Loader | ❌ Off | `app.html` 有大量内联 JS，开启会导致初始化竞态 |
| HTTP/3 (QUIC) | ⚠️ 默认开 | 一般不需要调整 |
| Early Hints | ⚠️ 默认开 | 一般不需要调整 |

### 15.5 综合性能影响

| 资源 | 原始 | Brotli 后 | 节省 |
|---|---|---|---|
| `app.html` (482KB) | 482,650 B | 109,076 B | **77%** |
| API JSON 响应 | ~10-50KB | ~3-15KB | 70%+ |
| 第三方资源 (CDN) | 不变 | 不变 | 0% (Cloudflare 不压缩跨域) |

## 16. 首次双份备份记录（2026-06-17）

### 16.1 备份快照

| 项 | 值 |
|---|---|
| 时间 | 2026-06-17 03:16 UTC |
| 备份文件 | `novacard-backup-20260617-031612.tar.gz` |
| 大小 | 4,085,951 bytes (4 MB) |
| 包含 | `data/vcc.db` (5.5MB → 2.9MB VACUUM 后) + `.env` + `config/*.pem` + `card-products-data.json` |
| DB 完整性 | `integrity_check: ok` |
| 数据量 | 3 users / 16 tables / 9 fee_configs / 8 upstream_fees / 1 kyc_application / 10 audit_logs |

### 16.2 备份目的地

| 目的地 | 路径 | 状态 |
|---|---|---|
| **本地下载** | `https://9b77cfb8-d336-408a-94d4-695b84e403a8.dev.coze.site/static/novacard-backup-20260617-031612.tar.gz` | ✅ 可用 |
| **GitHub 仓库** | `github.com/t784641697/NovaCard` / `backups/` 目录 / commit `ac4c99e` | ✅ 已 push |
| **沙箱本地** | `/workspace/projects/backups/novacard-backup-20260617-031612.tar.gz` | ✅ 存在 |
| **Vultr 服务器** | 备份时在 `/tmp/`，已删除（不浪费磁盘） | ✅ 已删除 |

### 16.3 备份恢复演练

```bash
# 1. 从沙箱下载
wget https://9b77cfb8-d336-408a-94d4-695b84e403a8.dev.coze.site/static/novacard-backup-20260617-031612.tar.gz

# 2. 解压
tar xzf novacard-backup-20260617-031612.tar.gz -C /opt/vcc-hub/

# 3. 重启服务
pm2 restart vcc-hub

# 4. 验证
curl -s http://139.180.188.104:5000/health
```

### 16.4 沙箱 SSH 客户端丢失事件

- **现象**：沙箱中 `ssh` 命令突然消失（30 分钟内从可用变为 `command not found`）
- **修复**：`apt-get install -y openssh-client`（9.6p1）
- **教训**：沙箱是非持久化环境，关键工具（ssh/git/curl/wget）需在使用前确认
- **预防**：未来操作前先 `which ssh git curl wget` 一次性检查


---

## 17. 健康监控与告警

### 17.1 架构
- **健康端点**：`GET /health` 返回 7 维度 JSON
- **外部监控**：UptimeRobot 免费版，每 5 分钟 ping
- **告警通道**：邮件（Taoliang.light@gmail.com）
- **响应时间**：异常 → 5 分钟内收到邮件

### 17.2 7 维度检查项
| 维度 | 检查内容 | 阈值 | 失败时返回 |
|------|---------|------|------------|
| process | uptime, pid, Node 版本 | - | 非关键 |
| db | PRAGMA integrity_check + 大小 + 表数 | - | 关键 → 503 |
| disk | df -h /opt/vcc-hub 使用率 | warn 85% / fail 95% | 非关键 |
| memory | process.memoryUsage() rss | warn 512MB | 非关键 |
| ssl | Cloudflare Origin 证书剩余天数 | warn 30d / fail 7d | 关键 → 503 |
| backup | /opt/vcc-hub/backups 最新文件 | warn 36h / fail 72h | 关键 → 503 |
| vmcardio_config | RSA 密钥存在性 | - | 非关键 |

### 17.3 关键/非关键项区分
- **关键**（3 个）：db / ssl / backup
  - 这些出问题 = 系统不能正常工作
  - 任一失败 → HTTP 503 → UptimeRobot DOWN → 邮件告警
- **非关键**（4 个）：process / disk / memory / vmcardio_config
  - 这些出问题 = 性能下降但系统仍工作
  - HTTP 200 + status="warning"

### 17.4 故障排查顺序
1. 看 UptimeRobot 邮件（5 分钟内必到）
2. curl https://nova-vcc.com/health 看哪个 check 失败
3. ssh root@139.180.188.104 验证
4. pm2 logs vcc-hub 看错误

---

## 18. 上游交易自动同步 (autoSync)

### 18.1 触发方式
- **Crontab**：`0 4 * * * cd /opt/vcc-hub && /usr/bin/node src/services/autoSync.js`
- **手动触发**：`cd /opt/vcc-hub && node src/services/autoSync.js`
- **手动页面触发**：管理员访问交易监控页（已有逻辑）

### 18.2 同步流程
```
启动 → 拿所有 cards.card_id (SELECT card_id FROM cards)
     → 对每个 card_id 调 sdk.cardTransaction({card_id, page, page_size, start_time, end_time})
     → 解析返回的 transaction_list 数组
     → 按 auth_id UPSERT 到 card_transactions
     → 写 last_tx_sync_* 到 settings 表
```

### 18.3 重试策略
- 单次 API 调用：3 次重试，指数退避 1s/2s/4s
- 单次失败：记入日志，不中断整个同步

### 18.4 关键文件
- `src/services/autoSync.js` - cron 入口
- `src/services/transactionSyncService.js` - 核心同步逻辑
- `src/services/vmcardioSDK.js` - vmcardio API 客户端

### 18.5 常见 bug 与修复
1. **dotenv 缺失** → SDK 拿不到 .env → 用默认 sandbox URL → IP 白名单不匹配
2. **status 判定不一致** → 写 'ok' 但检查 'success'
3. **错误字段不清除** → 成功时还显示旧错误

## 19. PM2 cluster 模式 + 日志轮转（2026-06-17）

### 19.1 PM2 cluster 配置

| 项目 | 值 |
|------|-----|
| 配置文件 | `/opt/vcc-hub/ecosystem.config.cjs` |
| 模式 | `cluster` |
| 实例数 | 2（共享 5000 端口）|
| 启动命令 | `pm2 start ecosystem.config.cjs` |
| 持久化 | `pm2 save`（开机自启）|

**关键配置**：
```js
{
  name: "vcc-hub",
  script: "./src/app.js",
  cwd: "/opt/vcc-hub",        // ← 关键! PM2 默认从 /root 启动
  instances: 2,
  exec_mode: "cluster",
  autorestart: true,
  max_memory_restart: "512M",
  env: { NODE_ENV: "production" }
}
```

**历史问题**：之前 PM2 跑了 5 次 restart。根因是 `cwd` 默认 /root，找不到 `/opt/vcc-hub/.env` → `process.env.PORT` 是 undefined → Express 用默认 3000 端口 → 5000 未监听 → 外部请求 502 → PM2 不断重启。

### 19.2 故障切换验证

```bash
# kill 主进程
kill -9 30772
# PM2 4 秒内拉起新进程 30891
# 端口 5000 持续在线（剩余进程 30779 接管）
# /health 仍返回 ok

# kill 副进程同样自动拉起
# 0 停机切换
```

### 19.3 logrotate 规则

| 路径 | 周期 | 保留 | 压缩 |
|------|------|------|------|
| `/root/.pm2/logs/vcc-hub-*.log` | daily | 7 天 | delaycompress |
| `/opt/vcc-hub/logs/*.log` | daily | 14 天 | delaycompress |
| `/var/log/novacard-*.log` | weekly | 4 周 | delaycompress |

**配置位置**：`/etc/logrotate.d/vcc-hub`
**触发方式**：系统 `/etc/cron.daily/logrotate`（每天自动跑）
**关键指令**：`copytruncate`（不发送信号，PM2 持有的文件描述符继续往清空后的文件写）
**命名格式**：`*.log-20260617`（`dateext -%Y%m%d extension .log`）

### 19.4 部署检查清单

- [x] `ecosystem.config.cjs` 在沙箱 + 部署到 Vultr
- [x] PM2 启动 2 进程 online
- [x] /health 8 维度全 ok
- [x] kill 进程后 4s 内自动拉起
- [x] logrotate 强制运行成功，生成日期归档
- [x] `pm2 save` 持久化

## 20. 异常消费告警 + CSV 导出 + API 文档（2026-06-17）

### 20.1 异常消费告警

| 维度 | 实现 |
|------|------|
| 触发点 | `transactionSyncService.syncAll` 完成后批量扫描新交易 |
| 规则 | 单笔高额 / 1 小时累计 / 陌生商户 / 高风险关键词 |
| 默认阈值 | 单笔 $200 / 小时 $500 / 24 小时 $2000 |
| 推送渠道 | 站内信 (`notifications` 表) + 管理员 API 拉取 |
| 关键词 | 单词边界匹配, 避免 "Store" 误中 "tor" |
| 阈值调整 | `POST /api/admin/anomaly-thresholds` |

### 20.2 CSV 导出

| 维度 | 实现 |
|------|------|
| 端点 | `GET /api/transactions/export.csv` |
| 鉴权 | JWT 必需; 管理员看全部, 用户看自己的卡 |
| 查询参数 | dateFrom, dateTo, status, type, card_id, limit (max 50000) |
| 格式 | UTF-8 BOM + 逗号/双引号/换行转义 |
| 字段 | 11 个 (时间, 卡ID, 卡号(脱敏), 类型, 状态, 授权/结算 金额+币种, 商户, 授权时间) |

### 20.3 Swagger 文档

| 维度 | 实现 |
|------|------|
| 路径 | `GET /api/docs` (UI) + `GET /api/docs.json` (规范) |
| 规范 | OpenAPI 3.0.3 |
| 扫描源 | `src/routes/*.js` + `src/app.js` |
| 已注释端点 | 5 个最关键 (health, login, captcha, export.csv, anomaly-*, notifications) |
| 扩展方式 | 在 routes/*.js 路由上方加 JSDoc `/** @swagger ... */` 即可被自动收录 |

### 20.4 数据库备份加密 (GPG)

| 维度 | 实现 |
|------|------|
| 触发 | crontab 每天 3:00 |
| 算法 | AES-256 (gpg --cipher-algo AES256 --symmetric) |
| 密码来源 | .env `BACKUP_PASSPHRASE` (不存在则明文备份) |
| 当前密码 | `vAAW2aeJZ9bI+qhgQWNajeNLKDNE8FJ5` (24 字节 base64) |
| 解密命令 | `gpg -d --passphrase "密码" backup.tar.gz.gpg > backup.tar.gz` |

### 20.5 Telegram 告警

| 维度 | 实现 |
|------|------|
| 库 | Telegram Bot API (原生 fetch) |
| 配置 | .env: TELEGRAM_ENABLED / TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID |
| 触发 | 启动通知 / 异常消费 / 健康检查失败 |
| 格式 | HTML 模式 + 自动分块 (Telegram 4096 限制) |
| 限流 | 100ms 间隔, IPv4 family, 10s timeout |
| Bot | @NovaCard_alert_bot (token: 8602206550:AAE...) |
| Chat | NovaCard 告警群 (chat_id: -5318112256) |
| 关键 | Group Privacy 必须 Disable (否则 bot 收不到群消息) |
| 文档 | `src/services/telegram.js` 头部 + JSDoc |

### 20.6 PM2 cluster + logrotate

| 维度 | 实现 |
|------|------|
| 模式 | cluster, 2 instances, 共享 5000 端口 |
| 配置 | `ecosystem.config.cjs` (显式 cwd, 避免 .env 找不到) |
| 重启 | `pm2 reload vcc-hub --update-env` (--update-env 强制重读 .env) |
| 日志 | logrotate 3 段: PM2 (7d) / winston (14d) / 脚本 (4w) |
| 零停机 | kill 任一 worker, 4 秒内自动恢复 |

### 20.7 Swagger / OpenAPI

| 维度 | 实现 |
|------|------|
| 库 | swagger-jsdoc + swagger-ui-express |
| 端点 | GET /api/docs (UI) + GET /api/docs.json (raw) |
| 规范 | OpenAPI 3.0 |
| 注释 | JSDoc `@swagger` 块, 6 个端点已覆盖 |
| 组件 | ApiResponse, Transaction, AnomalyAlert schemas |

## 21. 充值入账手续费体系 + 开卡流程全面修复（2026-06-18）

### 21.1 fee_configs 费用类型

| fee_type | description | 备注 |
|----------|-------------|------|
| `topup` | 入账手续费 | 充值入账扣费（v1.0.48 新增；曾用名"充值入账手续费"） |
| `card_creation` | 开卡费 | 审批时扣 |
| `transaction` | 交易手续费 | 消费入账扣 |
| `refund` | 退款手续费 | |
| `chargeback` | 拒付手续费 | |
| `cross_border` | 跨境交易费 | |
| `small_transaction` | 小额授权费 | |
| `withdrawal` | 提现手续费 | |
| `auth_reversal` | 撤销手续费 | |
| `management` | 管理费 | |

- seedFees 启动幂等（ON CONFLICT 跳过），日志更清晰
- 新增 fee_type 时：① 插入 `fee_configs` ② 同步 `feeTypeMap`（前端）+ `app.html` ③ 更新本文档表

### 21.2 用户级费率 user_fee_configs

| 维度 | 实现 |
|------|------|
| 优先级 | 用户级 (user_fee_configs) > 全局 (fee_configs) |
| 端点 | `GET /api/topup/fee-config` 返回当前用户生效费率（自动 fall back） |
| 写入 | `setUserFeeConfig` 前端传 `is_active: 1/0`（**禁止 boolean**，SQLite 报错） |
| 缓存 | 不缓存，每次申请实时查询（费率可能动态调整） |

### 21.3 开卡流程 schema 与事务

- `card_applications` 表必含列：`id, user_id, product_code, card_bin, first_name, last_name, topup_amount, quantity, fee_amount, status, reject_reason, card_id, created_at, updated_at`
- `fee_amount` 列是 v1.0.4 重构时建表 SQL **漏列**，导致申请 500；v1.0.48 加 ALTER 兜底迁移
- 申请扣费顺序（禁止重复扣）：① 申请时 `recordSpend(user_id, 0, fee_amount, '开卡费')` ② 申请时 `UPDATE balance -= fee_amount`；③ 审批扣 topup `UPDATE balance -= topup_amount * quantity`（**不要**再调 recordSpend，否则重复扣）
- 开卡失败退款：fee + topup*quantity 一次性回滚到 balance（v1.0.48 修复只退 fee 的 bug）

### 21.4 正式环境 vmcardio 架构（v1.0.15）

| 维度 | 值 |
|------|-----|
| 域名 | `https://vmapi.vmcardio.com` |
| 认证 | `app_id`+`app_secret` → `getAccessToken`（裸 token，**无 Bearer 前缀**） |
| 传输 | RSA 加密 `{content: encrypted}`（**不是 Apifox 文档 cURL 示例的明文 JSON**） |
| createCard 字段 | `product_code` / `amount` / `first_name` / `last_name` / `user_id` |
| IP 白名单 | Vultr 真实 IPv4 `139.180.188.104`（SDK 强制 IPv4 避免 IPv6 误中） |
| 错误码 | `400005 = Ip Invalid` / `400 = field X is not set` / `700002 = Invalid Product Code` |

- **沙盒 vs 正式**：dev.vmcardio.com = 沙盒（有 Web API）；vmcardio.com = 正式（**无 Web API**，HTML 营销站）
- **关键事实**：不要被 Apifox 文档 cURL 示例误导，**正式环境也是 RSA 加密**
- SDK `_getToken()` 缓存 60s 提前量，AccessToken 复用避免每次重拿
- RSA 密钥：请求用 `vmcardio_platform_public.pem` 加密；响应用 `merchant_private.pem` 解密
- 缺失或密钥不匹配时：响应 `700002 Invalid Product Code`（实际是解密失败，但服务端不区分错误）

### 21.5 前端 promptModal 规范

- ❌ **禁止**使用浏览器原生 `prompt()` / `confirm()`（样式丑、与项目不统一、有"取消时弹错误"bug）
- ✅ **必须**用 `vcc-dashboard/app.html` 中的项目 `promptModal`
- 适用场景：卡片充值金额输入、admin 审核备注、admin 拒绝原因等需要用户输入的弹窗
- 关键：取消按钮**不**触发"操作失败"错误，仅在用户输入有效值并确认后才校验

### 21.6 充值入账流水字段

- `transactions` 表的 `type='充值'` 记录必须含完整字段：`fee`, `net_amount`, `fee_type='topup'`
- 重复提交防护：`recordTopup` 用 `request_id` 唯一索引去重
- 重复点击同申请 → 第二次返回"该申请已处理"（不再重复扣费 + 写流水）

### 21.7 卡段 product_code 命名规则（v1.0.19 修正）

| 旧名 (sandbox) | 新名 (上游正式环境后台/API) | 备注 |
|---|---|---|
| `G5554LC` | **`VC102`** | v1.0.19 改名为 VC102，全栈联动 |
| `G5321KC` 等 G 前缀 | 仍为 G 前缀 | 上游没改名，沿用 |
| `S5395YL` 等 S 前缀 | 仍为 S 前缀 | 上游没改名，沿用 |

- **业务名**用 `product_code`（如 `VC102`）
- **兼容旧名**用 `legacy_product_code`（如 `G5554LC`），前端可选展示
- **BIN 拆分字段**：上游 `bin` 字段是 12 位（`555671544015`），代表 2 个 6 位 BIN 拼接（`555671` + `544015`）随机分配
- HARDCODED_PRODUCTS 数组必须保留 `bins: ['555671', '544015']` 字段，前端 `formatBin()` 自动识别 12 位并拆分为 `555671 / 544015` 显示
- **G5554LC 历史数据**：v1.0.19 改名时本地 DB 无 G5554LC 实际卡数据（cards 表空），无需迁移

### 21.8 HARDCODED 业务控制层架构（v1.0.21）

#### 背景
- v1.0.18 之前 HARDCODED_PRODUCTS 是「数据补全」：60+ 字段（含 description、applicable_platforms 等 metadata），导致 HARDCODED 几乎成了上游 API 的影子
- v1.0.19 误以为上游 API 返回了 `product_code=VC102`，把 HARDCODED 里的 G5554LC 改名 VC102
- **实际**：上游 API 真实 product_code 仍是 G5554LC（VC102 只是后台界面改名），admin.js 审批时传 'VC102' 给 API 会被拒绝

#### 调整后架构
| 层级 | 数据来源 | 字段 |
|------|---------|------|
| 基础数据层 | 上游 API 100% | `bin` / `product_code` / `type` / `network` / `media` / `issuing_area` / `remaining_open_card_num` |
| 业务控制层 | HARDCODED 覆盖 | `available` / `featured` / `priority` / `custom_message` |
| 友好别名 | HARDCODED 透传 | `display_name`（前端展示用） |

#### HARDCODED 17 项精简结构
```js
{ product_code: 'G5554LC',  // 业务名=API 真实名
  business: {
    available: true,        // 用户可申请
    featured: true,         // 推荐
    priority: 1000,         // 排序权重
    custom_message: '🌟 AI/Agent 工具付费首选'  // 自定义文案
  },
  display_name: 'VC102'     // 友好别名（前端展示）
}
```

#### 路由合并策略（`src/routes/cards.js` line 540-572）
- API 为基础数据层 + HARDCODED.business 为业务控制层
- 按 priority 降序排序
- `?raw=1` 跳过合并返回原始 API
- `/meta/products/upstream` 永远返回上游原始数据
- API 失败时返回 503（不再用残缺 HARDCODED 兜底）

#### 前端 PRODUCT_DISPLAY_NAMES 映射
- 位置：`vcc-dashboard/app.html` line 1655-1665
- 4 处展示：交易流水、申请列表、卡片详情、管理员审批
- **不替换位置**：selectBin 提交时存 product_code（必须 API 真实名）
- **不替换位置**：管理员审批搜索 `product.toLowerCase()`（用 API 真实名匹配）

#### ⚠️ 命名铁律
- **业务名/存储值** = `product_code`（API 真实名，如 G5554LC）→ createCard/数据库/搜索匹配
- **展示值** = `display_name`（友好别名，如 VC102）→ 4 个 UI 显示位置
- **禁止**把业务名直接展示给用户（必须走 PRODUCT_DISPLAY_NAMES 映射）


## 22. 卡段国家显示扩展性（v1.0.56 — 2026-06-19）

### 22.1 设计原则
- **后端统一标准化**：上游返回的国家字符串（"UK" / "USA" / "Hong Kong SAR" / 自由文本等）**必须**经过 `normalizeCountry()` 处理后再返回前端
- **前端不维护国家映射表**：所有国家相关渲染（卡片国家、筛选项、国旗 emoji）**只**用后端标准化的 3 个字段
  - `issuing_area_code` — ISO 3166-1 alpha-2 码（如 `HK` / `US` / `GB`）
  - `issuing_area_name` — 短中文名（如 `香港` / `美国` / `英国`）
  - `issuing_area_flag` — emoji 国旗（如 `🇭🇰` / `🇺🇸` / `🇬🇧`）

### 22.2 后端 normalizer 架构

| 步骤 | 处理 | 说明 |
|------|------|------|
| 1. ALIAS 兜底 | 查 `COUNTRY_ALIAS` 表 | 只覆盖非 ISO 自由文本：`UK` / `USA` / `U.S.` / `Hong Kong SAR` / `Macao SAR` / `Taiwan` / `PRC` / `Great Britain` / `Singapore` 等 |
| 2. ISO 标准化 | `Intl.DisplayNames(['zh-CN'], {type:'region', style:'short'})` | 250+ ISO 国家自动短中文名（Node 18+ 内置，无需 polyfill） |
| 3. 国旗生成 | ISO 字母偏移算法 | `String.fromCodePoint(0x1F1E6 + charCodeAt(i) - 65)` 无需 emoji 映射表 |

### 22.3 集成位置
- **正常分支**：`/api/cards/meta/products` 在合并 HARDCODED 后用 `apiList.map(p => ({...p, ...normalizeCountry(p.issuing_area)}))`
- **`?raw=1` 分支**：同样需要包装（v1.0.56 第一次部署漏改，前端调的是 `?raw=1` 导致用户看不到中文+国旗）
- **fallback**：上游 API 失败返回 503（不再用残缺 HARDCODED 兜底）

### 22.4 添加新国家支持
- ISO 国家（如 `JP` / `DE` / `FR` / `KR`）：**无需改代码**，`Intl.DisplayNames` 自动支持
- 非 ISO 自由文本（如 `Mainland China` / `UAE`）：在 `COUNTRY_ALIAS` 加一行 `{from: 'Mainland China', code: 'CN'}`

### 22.5 ❌ 反例
- ❌ 前端硬编码 `COUNTRY_MAP = {'UK':'英国', 'USA':'美国', ...}` —— 不可扩展
- ❌ 前端用 emoji 映射表 `COUNTRY_FLAGS = {'UK':'🇬🇧', ...}` —— 维护成本高
- ❌ 单独在正常分支加 normalizer 但漏改 `?raw=1` 分支 —— 前端调 raw 时看不到效果

---

## 23. 地区筛选项动态化（v1.0.57 — 2026-06-19）

### 23.1 设计原则
- **筛选项来源**：必须是基于 apiList 实际返回的国家动态提取，**禁止**硬编码国家按钮
- **HTML 容器**：所有动态筛选项放在 `id="binCountryFilters"` 容器内，由 JS 填充
- **类选择器统一**：所有动态生成的筛选项 button 必带 `class="bin-country-btn"` + `data-country="<ISO>"` 属性

### 23.2 必含 JS 函数（`vcc-dashboard/app.html`）

#### `_availableCountries`
```js
let _availableCountries = [];  // 全局: [{code, name, flag}, ...]
```

#### `_extractCountries(list)`
- 从 `list` 提取去重国家
- 用后端标准化字段 `issuing_area_code/name/flag`
- 按中文名 `localeCompare(zh-CN)` 排序

```js
function _extractCountries(list) {
  const map = {};
  list.forEach(p => {
    const code = p.issuing_area_code;
    if (code && !map[code]) {
      map[code] = { code, name: p.issuing_area_name || code, flag: p.issuing_area_flag || '🏳️' };
    }
  });
  return Object.values(map).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}
```

#### `_renderCountryFilters()`
- 渲染到 `#binCountryFilters` 容器
- 每个 button 含 `class="bin-country-btn"` + `data-country="${c.code}"` + `onclick="filterBin('country:${c.code}')"`
- 显示 `${c.flag} ${c.name}`

### 23.3 `loadBins` 必含调用
```js
async function loadBins() {
  const res = await apiFetch('/cards/meta/products?raw=1');
  _productList = res.data?.list || [];
  // 1.21: 动态提取国家列表并渲染筛选项
  _availableCountries = _extractCountries(_productList);
  _renderCountryFilters();
  renderBins(_productList, _binFilter);
}
```

### 23.4 `filterBin` 国家筛选规范

| 操作 | 实现 |
|------|------|
| 重置所有国家按钮 | `document.querySelectorAll('.bin-country-btn').forEach(b => { ... })` |
| 高亮选中按钮 | `document.querySelector('.bin-country-btn[data-country="${code}"]')?.classList.replace('btn-outline','btn-primary')` |

#### ❌ 反例
- ❌ `['HK','UK','SG','US'].forEach(n => document.getElementById('country'+n)...)` — 硬编码国家列表
- ❌ `{hk:'HK',uk:'GB',sg:'SG',us:'US'}[filter.split(':')[1]]` — 短代码映射表
- ❌ 用 button 的 `id` 找元素（动态生成的元素没有静态 id）

### 23.5 `renderBins` 国家筛选规范

```js
// 国家筛选（动态：filterBin 传 'country:HK'/'country:GB' 等 ISO 码,直接匹配后端 normalizer 字段）
if (filter && filter.startsWith('country:')) {
  const code = filter.split(':')[1].toUpperCase();
  filtered = filtered.filter(p => p.issuing_area_code === code);
}
```

- **禁止**再用 `{hk:'HK',uk:'GB',sg:'SG',us:'US'}` 短代码映射
- **必须**用 `p.issuing_area_code`（后端 normalizer 字段）与 filter 中的 ISO 码直接匹配

### 23.6 添加新国家支持
- 前提：上游 API 返回的国家字符串能被 §22 的 `normalizeCountry` 正确处理
- 前端**无需改代码**：新增国家自动出现在筛选项 + 卡片渲染

---


## 24. 卡段管理后台（v1.0.58 — 2026-06-19）

### 24.1 设计原则
- **业务配置持久化**：管理员在线调整卡段状态/平台/文案 → 写 DB → 用户端实时生效
- **优先级链清晰**：`DB override > HARDCODED business > docx metadata > upstream API`
- **多 worker 一致**：PM2 cluster 模式多 worker **禁止**使用进程内 cache（会导致状态不一致），直查 DB
- **影响隔离**：override 只影响 `/meta/products` 返回的列表（开卡申请的新数据），**已开卡的 cards 表记录不受影响**

### 24.2 数据库表 `card_product_overrides`

```sql
CREATE TABLE card_product_overrides (
  product_code          TEXT PRIMARY KEY,
  available             INTEGER NOT NULL DEFAULT 1,    -- 0/1
  applicable_platforms  TEXT DEFAULT NULL,             -- JSON 数组字符串
  custom_message        TEXT DEFAULT NULL,             -- 用户端展示文案
  updated_at            INTEGER NOT NULL,              -- ms 时间戳
  updated_by            TEXT DEFAULT NULL              -- 管理员邮箱
);
```

- **建表时机**：service 首次 `loadAll()` 时 lazy check（不写在 `database.js` 启动迁移里，避免模块加载顺序耦合）
- **无 override 时**：服务返回 `null`，由上游链路使用 HARDCODED/docx 默认值

### 24.3 Service 接口

```js
const svc = require('../services/cardProductOverrideService');

// 查单个
const ov = svc.get('G5449LJ');  // OverrideRecord | null
//  { product_code, available, applicable_platforms, custom_message, updated_at, updated_by }

// 查全部（数组）
const list = svc.listAll();  // OverrideRecord[]

// upsert（admin 端 PUT 调用）
svc.upsert('G5449LJ', {
  available: 0,
  applicable_platforms: ['Facebook','OpenAI'],
  custom_message: 'AI/Agent 专用',
}, 'admin@vcc.hub');

// 重置（admin 端 DELETE 调用）
svc.remove('G5449LJ');
```

### 24.4 API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/admin/card-products` | GET | 列出 17 个卡段 + docx 元数据 + override |
| `/api/admin/card-products/:pc` | PUT | 更新单卡段 override（partial update） |
| `/api/admin/card-products/:pc/override` | DELETE | 重置单卡段 override（回 HARDCODED/docx） |

#### GET 响应字段

```json
{
  "code": 0, "msg": "ok",
  "data": {
    "count": 17,
    "list": [{
      "product_code": "G5449LJ",
      "bin": "54492360",
      "network": "MasterCard",
      "issuing_area": "Hong Kong SAR",
      "issuing_area_code": "HK", "issuing_area_name": "香港", "issuing_area_flag": "🇭🇰",
      "docx_platforms": ["Facebook", "Google", ...],     // docx 默认
      "card_level": "Business Credit",
      "single_limit": 50000, "daily_limit": 100000,
      "available": true,                                 // admin 端默认 true（无 override 时）
      "applicable_platforms": null,                      // null=沿用 docx
      "custom_message": null,
      "updated_at": null, "updated_by": null
    }]
  }
}
```

#### PUT 校验规则

| 字段 | 校验 |
|------|------|
| `available` | 必须是 `0` / `1` / `true` / `false` |
| `applicable_platforms` | 必须是数组，元素必须是非空字符串，最多 50 个 |
| `custom_message` | 必须是字符串（可 null），最长 500 字符 |

### 24.5 cards.js 合并逻辑（用户端 `/api/cards/meta/products`）

```js
const merged = apiList
  .map(p => {
    // 第 1 层: upstream API 原始数据
    // 第 2 层: docx metadata (CARD_METADATA / META_BY_BIN_PREFIX6)
    // 第 3 层: HARDCODED 业务控制 (available/featured/priority/custom_message)
    return { ...p, ...docxMeta, ...hardcodedBiz };
  })
  // 第 4 层 (最高): DB override
  .map(item => {
    const ov = svc.get(item.product_code);
    if (!ov) return item;
    return {
      ...item,
      available:              ov.available,
      applicable_platforms:   ov.applicable_platforms !== undefined ? ov.applicable_platforms : item.applicable_platforms,
      custom_message:         ov.custom_message !== undefined ? ov.custom_message : item.custom_message,
    };
  })
  .sort((a, b) => (b.priority || 0) - (a.priority || 0));
```

### 24.6 前端 UI 规范

#### 侧边栏入口
- admin 角色才能看到，位置在 "开卡审核" 之后
- 菜单 id: `nav-admin-card-products` / page key: `admin-card-products`
- emoji: 🎴

#### 管理页表格列

| 列 | 内容 |
|----|------|
| 卡段 | product_code（等宽字体）+ 可选 display_name 别名 |
| BIN | formatBin(p.bin) 处理 6/8/12 位显示 |
| 国家 | flag + name（后端标准化字段） |
| 状态 | `<input type="checkbox" class="bin-toggle" onchange="toggleCardProduct(...)">` |
| 平台预览 | 最多 3 个 tag + "+N" 省略（与用户端一致） |
| 操作 | 编辑按钮 + 重置按钮（仅 has_override=true 时显示） |

#### 关键函数

| 函数 | 行号 | 职责 |
|------|------|------|
| `renderCardProductsPage()` | app.html ~8966 | 渲染管理页骨架 + 调用 loadCardProducts |
| `loadCardProducts()` | ~9007 | 调 GET /api/admin/card-products，写入 `_cardProductsList` 全局 |
| `renderCardProductsRows()` | ~9028 | 渲染表格行 |
| `toggleCardProduct(pc, available)` | — | 开关 toggle，PUT 接口 + 失败回滚 |
| `openCardProductEdit(pc)` | ~9085 | 弹窗编辑适用平台 + 自定义消息 |
| `resetCardProduct(pc)` | ~9140 | confirm 后 DELETE |

#### 用户端卡段卡片（`renderBins` 改造）

```html
<div class="bin-card {isAvail?'':' bin-card-disabled'}"
     onclick="selectBin({...})"
     title="{isAvail?'':'该卡段已暂停开卡'}">
  ...
  <div class="bin-platforms">
    {platforms.slice(0,3).map(p => `<span class="bin-platform-tag">${p}</span>`).join('')}
    {platforms.length>3 ? `<span class="bin-platform-tag">+${platforms.length-3}</span>` : ''}
  </div>
  {isAvail ? '' : '<div class="bin-card-mask">⏸ 暂不可用</div>'}
</div>
```

#### selectBin 前置校验
```js
function selectBin(p) {
  if (p.available === false) {
    alert('该卡段已暂停开卡');
    return;
  }
  // ...继续走原开卡流程
}
```

### 24.7 ❌ 反例

- ❌ **进程内 cache 缓存 override**: PM2 cluster 多 worker 进程间 cache 不共享，DELETE 后其他 worker 仍命中旧 cache → 必须每次直查 DB
- ❌ **admin 端默认 `available: false`**: 应该默认 `true`（无 override 时），方便管理员看原始可写状态，不要从 HARDCODED 继承
- ❌ **override 用前端 localStorage 存储**: 管理员换设备/换浏览器失效，**必须** DB 持久化
- ❌ **修改 HARDCODED 业务层"临时"关卡段**: HARDCODED 改完要发版，不能在线调整 → 用 override
- ❌ **POST /api/cards 端不重新检查 override**: 前端可绕过 selectBin 校验 → 后端 cards.js 合并链路已含 DB override，开卡审批时自动用最新值
- ❌ **`applicable_platforms` 用逗号字符串**: 必须存 JSON 数组，docx 也是数组；自定义消息 textarea 用逗号分隔再 split 是前端 UX 优化
