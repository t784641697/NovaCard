# AGENTS.md

## 项目概览

VCC Hub - 虚拟信用卡管理平台，提供卡片申请、管理、充值、交易记录等功能。

### 技术栈
- **后端**: Node.js + Express.js + SQLite (better-sqlite3)
- **前端**: 原生 JavaScript SPA (单页应用，无框架)
- **语言**: JavaScript (CommonJS)
- **认证**: JWT + bcryptjs
- **数据库**: SQLite (WAL 模式)

### 项目结构
```
/workspace/projects/
├── .coze                  # Coze 部署配置
├── .env                   # 环境变量
├── package.json           # 后端依赖
├── src/
│   ├── app.js             # Express 入口 (端口 5000)
│   ├── db/
│   │   ├── database.js    # SQLite 初始化 & 种子数据
│   │   └── index.js       # DB 导出
│   ├── routes/
│   │   ├── auth.js        # 认证 (登录/注册/验证码)
│   │   ├── cards.js       # 卡片管理
│   │   ├── transactions.js # 交易记录
│   │   ├── admin.js       # 管理后台
│   │   ├── topup.js       # 充值
│   │   ├── userBalance.js # 用户余额
│   │   └── feeConfig.js   # 费率配置
│   ├── services/
│   │   ├── vmcardioSDK.js  # vmcardio API 集成
│   │   ├── balanceService.js
│   │   ├── feeCalculator.js
│   │   ├── merchantBalanceSync.js
│   │   └── ...
│   ├── middleware/
│   │   ├── auth.js         # JWT 鉴权
│   │   ├── errorHandler.js
│   │   ├── replayProtection.js
│   │   └── loginRateLimiter.js
│   ├── validators/
│   │   └── auth.js
│   ├── utils/
│   │   ├── logger.js       # 日志 (winston)
│   │   └── rsaCrypto.js
│   └── webhooks/
│       └── vmcardio.js     # WebHook 接收
├── vcc-dashboard/
│   ├── app.html            # 前端 SPA 入口
│   ├── index.html          # 登录/首页
│   └── js/
│       ├── app.js          # 主应用逻辑
│       ├── main.js
│       ├── pages/          # 各页面模块
│       ├── services/api.js # API 调用
│       └── utils/config.js # 配置 & 状态
├── data/
│   ├── vcc.db              # SQLite 数据库文件
│   └── *.bak               # 备份文件
└── config/
    ├── *.pem               # RSA 密钥文件
```

### 关键端口
- 服务端口: **5000** (单一端口，HTTP + 静态资源)
- 前端通过 `/static` 路径提供静态资源

### 构建 & 运行
```bash
pnpm install
pnpm run dev    # 开发模式 (nodemon 热重启)
node src/app.js # 生产模式
```

### 默认账户
| 角色 | 邮箱 | 密码 |
|------|------|------|
| 管理员 | admin@vcc.hub | Admin@2026 |
| 用户 | user@vcc.hub | User@20261 |

### API 路由
| 路径 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/api/auth/login` | POST | 登录 |
| `/api/auth/register` | POST | 注册 |
| `/api/auth/captcha` | GET | 验证码 |
| `/api/cards` | POST | 提交开卡申请（topup_amount≥$20, quantity） |
| `/api/admin/cards/*` | GET/POST | 卡片管理 |
| `/api/admin/card-applications` | GET | 管理员开卡申请列表（?status=pending/approved/rejected） |
| `/api/admin/card-applications/:id/approve` | POST | 审批通过开卡申请，创建 cards |
| `/api/admin/card-applications/:id/reject` | POST | 拒绝开卡申请 |

### 代码风格
- CommonJS 模块 (require/module.exports)
- 异步使用 async/await
- 响应格式: `{ code: 0, msg: 'ok', data: {...} }` (成功) / `{ code: xxx, msg: '...' }` (失败)
- 日志使用 winston，通过 logger.info/error/warn 输出

#6. **上游交易流水**：`card_transactions` 表存储 `/cardTransaction` 同步结果，含 auth_id 唯一索引、type(Authorization/Settlement/Refund/Reversal)、status(COMPLETE/DECLINED/PENDING)、auth_amount/settle_amount、merchant_name、create_time
7. **指标自动测算**：入账率 = settle/(settle+auth)，失败率 = decline/(auth+decline)，撤销率 = reversal/auth，退款率 = refund/settle
8. **同步时机**：管理员访问交易监控页时自动触发（带日期范围），同步前先根据 cards 表获取 card_id 列表
9. **API 调用方式**：cardTransaction 使用 `sdk.cardTransaction()`（RSA 加密 JSON 请求体），与 getAccountBalance 等 Merchant API 调用方式一致，**不要使用 form-urlencoded 格式**
10. **Authorization 格式：vmcardio Merchant API 使用裸 token（无 Bearer 前缀）**

## 注意事项
1. **数据库**: SQLite 使用 WAL 模式，数据存储在 `data/vcc.db`。服务启动时自动建表和种子数据。
2. **外部依赖**: vmcardio API (虚拟卡发行商) 为外部服务，需要配置 `.env` 中的 VMCARDIO_* 变量才能使用卡片申请等功能。
3. **腾讯云短信**: 需要配置 TENCENT_SMS_* 环境变量，否则短信功能不可用。
4. **前端**: 单页应用，所有逻辑在 `app.html` 中内联，通过 CDN 加载 Chart.js 和 QRCode.js。

### 🔧 生产服务器

> **⚠️ 注意**：AGENTS.md 历史版本写的是 **旧腾讯云服务器 `43.135.26.36`**，该服务器已于 2026-05 弃用。新部署请使用下方 Vultr 新加坡服务器。

#### 当前生产（Vultr 新加坡 + Cloudflare CDN）

| 项目 | 信息 |
|------|------|
| 对外域名 | **`https://nova-vcc.com/`**（Cloudflare Proxied，自动 HTTPS） |
| 真实 IP | `139.180.188.104`（仅源站，访客看不到） |
| SSH 账号 | `root`（RSA 私钥 `/workspace/projects/.ssh/vultr_new_key`） |
| SSH 备用 | `linuxuser@139.180.188.104`（无 sudo 免密，权限受限） |
| 镜像 | Vultr Ubuntu 24.04（默认用户 `linuxuser`，UID 1000） |
| 项目目录 | `/opt/vcc-hub`（root:root 拥有） |
| 入口文件 | `/opt/vcc-hub/src/app.js` |
| 进程管理 | PM2（进程名: `vcc-hub`，模式: `cluster`，2 workers） |
| 环境配置 | `/opt/vcc-hub/.env`（PORT=5000） |
| 前端目录 | `/opt/vcc-hub/vcc-dashboard` |
| 反向代理 | Nginx 80/443 → 后端 127.0.0.1:5000 |
| DNS | Namecheap：A `nova-vcc.com` → `139.180.188.104` (🔶 Proxied) |
| Git 仓库 | `origin/main` → `github.com/t784641697/NovaCard` |

**部署命令：**
```bash
# SSH 登录（root 有完整权限，推荐）
ssh -i /workspace/projects/.ssh/vultr_new_key root@139.180.188.104

# 拉取最新代码 + 重启服务
cd /opt/vcc-hub && \
  git fetch origin && \
  git reset --hard origin/main && \
  pm2 reload vcc-hub --update-env

# 查看状态
pm2 list
pm2 logs vcc-hub --lines 50

# 重启 Nginx
sudo systemctl restart nginx
```

#### 旧生产（已弃用，仅作备份保留）

| 项目 | 信息 |
|------|------|
| 地址 | `http://43.135.26.36`（腾讯云香港，**已停止对外服务**） |
| SSH 账号 | `ubuntu` / 密码 `System.error.9` |
| 数据 | `/opt/vcc-hub/data/vcc.db` 作为备份保留 |
| 用途 | 仅供参考，**不要部署到这台** |

### 📌 已知问题和修复记录
| 版本 | 日期 | 修复内容 |
|------|------|---------|
| v1.0.0 | 2026-05-18 | 初始版本，从 XiuXiu Card 迁移 |
| v1.0.1 | 2026-05-18 | 移除顶部标题栏，品牌名 XiuXiu Card → NovaCard |
| v1.0.2 | 2026-05-18 | 修复卡片管理搜索功能 SQL 双重 WHERE 语法错误；状态标签点击自动搜索 + 冻结状态值修正 |
| v1.0.3 | 2026-05-18 | 卡片数据同步机制：管理员查看卡片列表时自动 &sync=true 从上游拉取最新状态 |
| v1.0.4 | 2026-05-18 | 开卡申请表单重构：改为卡内充值金额(≥$20/张)+开卡数量；新增管理员审批流程 |
| v1.0.5 | 2026-05-18 | 移除邮箱字段 |
| v1.0.6 | 2026-05-18 | 修复开卡审批传参：(1) product_code 优先于 card_bin；(2) 补充 user_id: '20098106' 参数；(3) 持卡人姓名自动去除数字；(4) 前端三端同步添加姓名数字校验 |
| v1.0.7 | 2026-05-18 | **全面迁移到 Web API 开卡**：Merchant API 产品权限不足（G5554LC 返回"卡片 bin 不存在"），切换至 dev.vmcardio.com/web/createCard（Web API）+ JWT Session Token 认证；使用 bin/customize_name/customize_last_name/bind_uid 等 Web 参数名；卡片异步处理（~10-20秒），审批后管理员可手动同步获取 card_id |
| v1.0.8 | 2026-05-18 | **新增 VC113 卡段**：BIN 537872（Mastercard，美国，AI/Agent工具付费），该卡段只在 Web API 可用、Merchant API 不返回，后端 `/meta/products` 加了硬编码兜底列表，审批时自动用 Web API 开卡 |
| v1.0.9 | 2026-05-22 | 完整项目备份到 GitHub，清理本地+生产服务器无用文件（assets截图、bak备份、嵌套目录、旧同步脚本等） |
| v1.0.10 | 2026-05-22 | 卡段页面优化：可用/暂不可用区分展示（10可用+7不可用，置灰+暂不可用标签） |
| v1.0.12 | 2026-06-02 | 卡段使用说明展示：后端 HARDCODED_PRODUCTS 扩充为全部10个可用卡段，增加 metadata（适用平台、验证类型、限额、禁止事项）；前端开卡 Step2 新增卡段提醒信息面板 |
| v1.0.13 | 2026-06-04 | **RSA 密钥修复**：重新生成 merchant 密钥对（2048-bit），用户上传公钥到 vmcardio 后恢复正常解密；修复 `/api/admin/merchant-balance` 解析上游返回格式错误（result.balance → result.data.balance） |
| v1.0.14 | 2026-06-17 | **AGENTS.md 生产服务器信息纠正**：之前误把已弃用的腾讯云 `43.135.26.36` 标为生产，实际生产是 Vultr 新加坡 `139.180.188.104` + Cloudflare + `nova-vcc.com`；同日修复"卡交易/卡结算金额配色按'卡'语义"（消费/清算红、退款/撤销绿）+ `Cache-Control: no-store` 防止 CDN/浏览器缓存旧 HTML |
| v1.0.15 | 2026-06-18 | **正式环境开卡切回 Merchant API**：v1.0.7 假设的 Web API（dev.vmcardio.com/web/createCard）在正式环境不存在 — 正式环境 `vmcardio.com` 是 HTML 营销站，无 API endpoint。沙盒/Web API 仅 dev.vmcardio.com 有。改用正式环境 `vmapi.vmcardio.com/createCard`（Merchant API + RSA 加密），实测 VC102（原 sandbox 名 G5554LC）正式环境可正常开卡，同步返回 `card_id`（无需异步发现）。删掉 `discoverWebCardIds` 流程。正式环境不再需要 `VMCARDIO_WEB_*` 配置 |
| v1.0.19 | 2026-06-18 | **G5554LC 改名为 VC102（对齐上游）**：sandbox 时期旧名 `G5554LC` 在正式环境上游后台 + API 已升级为 `VC102`（同名同 BIN），全栈联动改名（HARDCODED_PRODUCTS、admin.js、app.html、scripts/test_create_app.js）；卡段列表前端 `formatBin()` 把 12 位 `bin` 拆成 2 个 6 位 `555671 / 544015` 显示 + tooltip 说明"2 个 BIN 随机分配（无法指定）" |

### 🔴 重要：双环境 API 架构说明（v1.0.15 修订）

| 特性 | 沙盒 Merchant API (`sandbox-api.vmcardio.com`) | 沙盒 Web API (`dev.vmcardio.com/web/`) | 正式环境 Merchant API (`vmapi.vmcardio.com`) | 正式环境 Web API |
|------|------------------------------------------|-----------------------------------|--------------------------------------|-----------------|
| 认证 | `app_id`+`app_secret` → AccessToken | JWT Session Token | `app_id`+`app_secret` → AccessToken | ❌ **不存在** |
| 传输 | RSA 加密 `{content: encrypted}` | 明文 JSON | RSA 加密 `{content: encrypted}` | — |
| 创建卡片参数 | `product_code`/`first_name`/`last_name`/`user_id` | `bin`/`customize_name`/`customize_last_name`/`bind_uid` | `product_code`/`first_name`/`last_name`/`user_id` | — |
| 当前用途 | 沙盒测试 | 沙盒测试 | **正式环境开卡+查询（v1.0.15+）** | — |

> **关键事实**：`vmcardio.com`（生产域名）是 HTML 营销站（OpenResty + Cloudflare），**无任何 API endpoint**。任何 `/web/...` 路径都返回 301/404/405。
> 正式环境所有 API 都在 `vmapi.vmcardio.com`（Merchant API，RSA 加密）。
> 完整接口列表见 Apifox 文档 `https://vmcardio.com/apidocuments/6664456m0`。

### 🔴 重要：RSA 密钥管理

vmcardio 使用 RSA 加密传输，两对密钥：

| 文件 | 角色 | 说明 |
|------|------|------|
| `config/vmcardio_platform_public.pem` | 平台公钥 | vmcardio 提供的公钥，用于加密请求（VM公钥） |
| `config/merchant_private.pem` | 商户私钥 | 自己生成的私钥，用于解密响应 |
| `config/merchant_public.pem` | 商户公钥 | 自己生成的公钥，需上传到 vmcardio 后台 |

**流程**：
1. 请求时：用 `vmcardio_platform_public.pem` RSA加密请求体 → vmcardio 用自己的私钥解密
2. 响应时：vmcardio 用 `merchant_public.pem` RSA加密响应体 → 我们用 `merchant_private.pem` 解密

**密钥更新步骤**（当 `merchant_private.pem` 丢失/不匹配时）：
```bash
# 1. 生成新密钥对
openssl genpkey -algorithm RSA -out config/merchant_private.pem -pkeyopt rsa_keygen_bits:2048
openssl rsa -pubout -in config/merchant_private.pem -out config/merchant_public.pem

# 2. 登录 sandbox.vmcardio.com → API Key → 商户公钥 → 更新
#    粘贴 config/merchant_public.pem 的内容保存

# 3. 等待 5-10 分钟同步后，重启服务
```

**历史问题**：`merchant_private.pem` 在 git 历史中从未被正确保存（一直存的是公钥或错误的私钥）。2026-06-04 重新生成密钥对后才修复。
## v1.0.21 修复记录（2026-06-18）

### 🔴 关键修复
- **G5554LC 误改名 bug**：v1.0.19 误以为上游 API product_code 是 VC102，实际 API 仍叫 G5554LC（VC102 只是后台界面改名）
  - admin.js 审批时传 'VC102' 给 API 会被拒绝（API 只认 G5554LC），开卡 100% 失败
  - **修正**：HARDCODED 改回 G5554LC + display_name=VC102 别名

### 🏗️ 架构调整
- **HARDCODED 精简为业务控制层**（v1.0.19 的 metadata 模板 + description/applicable_platforms 等 60+ 字段已废弃）
- **数据来源分层**：
  - 基础数据（bin/network/type/media/issuing_area/remaining_open_card_num）→ 100% 来自上游 API
  - 业务控制（available/featured/priority/custom_message）→ HARDCODED 覆盖
- **新增调试接口**：
  - `GET /api/cards/meta/products?raw=1` → 上游 API 原始数据
  - `GET /api/cards/meta/products/upstream` → 永远上游原始数据
- **fallback 调整**：上游 API 失败时返回 503（不再用残缺的 HARDCODED 作为 fallback）

### 📝 代码位置
- HARDCODED_PRODUCTS: `src/routes/cards.js` line 510-538
- 合并逻辑: `src/routes/cards.js` line 540-572
- fallback: `src/routes/cards.js` line 580-585
- 前端 PRODUCT_DISPLAY_NAMES: `vcc-dashboard/app.html` line 1655-1660
