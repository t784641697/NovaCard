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

## 7. 响应格式

所有 API 响应遵循统一格式：
```json
// 成功
{ "code": 0, "msg": "ok", "data": { ... } }

// 失败
{ "code": xxx, "msg": "错误描述" }
```

---

---

## 9. 数据库维护

### 9.1 技术栈
- **数据库**：SQLite（better-sqlite3），**DELETE 模式**
- **数据文件**：`data/vcc.db`
- **建表与种子**：`src/db/database.js`（启动时自动执行）
- **索引兜底**：启动时末尾自动 `REINDEX`，重建所有索引

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