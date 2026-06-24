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
│   ├── app.html            # 前端 SPA 入口 (单文件内联所有 JS, ~540KB)
│   ├── backups/            # 完整项目备份 tar.gz
│   └── node_modules
├── data/
│   ├── vcc.db              # SQLite 数据库文件
│   ├── card_metadata.json  # 卡段静态元数据 (v1.0.23 从 docx 提取)
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
| v1.0.56 | 2026-06-19 | 卡段国家显示扩展性改造（country normalizer）：`src/utils/country.js` 统一处理 `issuing_area` 字符串 → `{code, name, flag}`（Intl.DisplayNames + ALIAS 表 + 字母偏移国旗算法），`/meta/products` 正常 + `?raw=1` 两分支均接入 |
| v1.0.57 | 2026-06-19 | 地区筛选项动态化：移除 `app.html` 4 个硬编码国家按钮（HK/UK/SG/US），改用 `_extractCountries(apiList)` + `_renderCountryFilters()` 动态生成，filterBin 用类选择器 `.bin-country-btn[data-country]` |
| v1.0.58 | 2026-06-19 | **卡段管理后台**：管理员侧边栏新增 "卡段管理" 模块，可在线控制每个卡段 `available` 开关 / 编辑 `applicable_platforms` / 设置 `custom_message`，新表 `card_product_overrides` 持久化（优先级最高），用户端开卡页对应卡段置灰 + "⏸ 暂不可用" 遮罩 + 显示适用平台 tag；**关键 bug 修复**: PM2 cluster 2 workers 进程内 cache 共享导致 DELETE 后另一 worker 仍命中旧 cache → 改为每次直查 DB |
| v1.0.60-v1.0.69 | 2026-06-20~22 | 申请开卡提醒面板 + 卡段编辑模态框 UI 打磨（10 个小修合并） |
| v1.0.70 | 2026-06-22 | **卡段场景配置（新功能）**：`scenario_mappings` 表 + 3 个种子场景（社交媒体🌐/电商🛒/AI 订阅🤖），`src/utils/scenarioMatcher.js` 派生工具（B 规则：精确+大小写不敏感），`/api/cards/meta/products` 加 `derived_scenarios` 字段，`/api/cards/meta/scenarios` 公开接口，`/api/admin/scenarios` CRUD API；前端申请开卡页场景按钮动态化 + 卡段管理页 "场景配置" tab + 编辑弹窗 |
| v1.0.71 | 2026-06-22 | 场景筛选 + 场景配置 2 个 bug 修复：(1) `deriveScenariosForProduct` 改返回对象数组 `[{id, scenario_name, scenario_icon}]` 让前端 `s.id === sid` 能匹配；(2) 5 处 `api()` 改 `apiFetch(path, {method, body})`（项目里实际叫 apiFetch） |
| v1.0.72 | 2026-06-22 | `loadScenarios` 解析响应结构修复：后端返回 `{data: {list: [...]}}` 嵌套结构，前端改用 `(resp.data && resp.data.list) \|\| []` |
| v1.0.73 | 2026-06-22 | `/api/cards/meta/products?raw=1` 分支在合并 DB override 后必须重算 `derived_scenarios` |
| v1.0.74 | 2026-06-22 | 申请开卡页 "可用卡段" 标题移除，简化外层 flex 嵌套 |
| v1.0.80 | 2026-06-22 | **充值按钮 loading + 700011 翻译**: errorHandler.js 加 700011"卡商服务器暂时异常"翻译规则; cmRechargeCard 提交时 setLoading(true) 锁定按钮 + 文字改"处理中…" + disable X/取消, 成功立即关弹窗 + toast + renderCardManage, 失败恢复按钮 + toast 错误 |
| v1.0.79 | 2026-06-22 | **充值接口 URL 缺 card_id bug**: 前端 cmRechargeCard 调 POST /api/cards/recharge (URL 没 card_id), 后端路由是 /:card_id/recharge, 报"接口不存在"; 修复把 card_id 拼到 URL 路径上 (/cards/{cardId}/recharge), body 只剩 { amount } |
| v1.0.78 | 2026-06-22 | **充值弹窗禁止负值**: promptModal number 模式加 3 层防护 (HTML5 min=0 默认值 / oninput 实时拦截负号 / promptModalOk 兜底过滤), 充值场景显式传 min: 0 表明意图 |
| v1.0.77 | 2026-06-22 | **充值弹窗 UX v2**: promptModal 加 3 参数 (hideX 右上角 X / step 步长 100 / okCenter 按钮居中), 按钮颜色改 var(--grad) 项目主色 (冰蓝→薰衣草紫→品粉), 步长 100 适配整数金额业务, X 关闭按钮默认显示; 拒绝企业认证等场景会多出 X 关闭按钮 (合理升级) |
| v1.0.76 | 2026-06-22 | **卡片充值弹窗 UX**: promptModal 组件参数化 (hideIcon/inputType='number'/hideCancel/okText/okColor), 充值弹窗改数字输入框 + 单按钮"立即提交"(品红 #ec4899→#db2777) + 文案改"账户可用余额划转"; HTML 加 4 个 ID + 新增 number input 元素, 旧调用方式完全兼容 |\n| v1.0.75 | 2026-06-22 | **卡段 NEW 标签 (滑动窗口追踪)**: 新表 `card_product_last_seen` (id=1, codes JSON), 新建 service `src/services/cardProductSeenLog.js` (5 个 pure functions), `/api/cards/meta/products` 加 `is_new` 派生 + 同步 last_seen, `/api/admin/card-products` 加 `is_new_map`, 新增 `POST /api/admin/card-products/reset-seen-log` 手动重置接口; 前端产品列加绿色 `🆕 NEW` 徽章 + 搜索框旁"重置 NEW 基准"按钮; 首次部署自动种子化 (admin 看不到假 NEW); 3 个 bug 修复: isNewMap 数组→object, ?raw=1 只读不写, reset 接口方法名 set→markAllAsSeen |，否则前端拿到的派生结果是基于 docx metadata（错的空数组）。修复：listWithOverride.map 内 `merged.derived_scenarios = deriveScenariosForProduct(merged, scenarios)` 立即重算 |

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
| v1.0.84 | 2026-06-22 | **SDK 充值异步确认**: vmcardio 上游 `rechargeCard` 收 `700011` 后内部等待 5 秒调 `cardDetail` 验证余额, 验证成功视为充值成功, 用户无需手动刷新. 验证: `XR2069080018155819008` 充 \$10 → 7 秒内返回 `available_amount: 30` (原 20) |
| v1.0.85 | 2026-06-22 | **卡信息同步写回 DB**: `GET /:card_id` 和 `POST /:card_id/recharge` 调完上游 `cardDetail` 后用 `persistCardDetailToDb()` 工具写回 `available_amount` / `status` / `cvv` / `expiry_*` / `last_verified` / `verified_status`; 写回失败 logger.warn 不影响主流程 |
| v1.0.86 | 2026-06-22 | **移除 v1.0.84 700011 异步确认**: 实测 700011 是 vmcardio 上游真失败 (5 秒后 cardDetail 拿到的还是原余额, 没真扣款). 移除 SDK 的 700011 自动确认, 错误码原样抛给前端让用户看到真实错误 |
| v1.0.87 | 2026-06-23 | vmcardio 充值功能待用户与上游沟通 700011 错误 |
| v1.0.88 | 2026-06-23 | 死代码清理 sed 误删 `<script>` 标签 → 恢复 |
| v1.0.89 | 2026-06-23 | 精准删 v1.0.88 残留死代码 (HTML 弹窗 line 1489-1501 + 死函数 line 2743-2772) |
| v1.0.90 | 2026-06-23 | 全面清理无用数据 (assets/ 11.4MB + 死代码 + 空目录 + 重复文档) |
| v1.0.91 | 2026-06-23 | 修复管理员"查看消费"接口 URL 重复 /api |
| v1.0.92 | 2026-06-23 | 修复普通用户"账户流水"表头重复 (panel + wrap 双重渲染) + admin `/users/:id/transactions` 路由补充查 transactions 表 |
| v1.0.93 | 2026-06-23 | 修复资金概览"资金验证异常/分配验证异常"误报 (`balanceOk = d.merchant_balance >= 100` 风控阈值被误用) → 改用 `Math.abs(vmcardio - (users_total + system_reserved)) < 0.01` 真正守恒判断 |
| v1.0.94 | 2026-06-23 | **资金安全 4 bug 一次修**：(1) 申请时充值冻结没写流水 → 改用 `BalanceService.recordSpend` 合并写 `type='消费'` 流水；(2) 拒绝/失败退还没写流水 → 改用 `BalanceService.recordRefund` 写 `type='退款'`；(3) v1.0.92 漏了 `cardIds` 变量定义导致 `/api/admin/users/:id/transactions` 500 → 补定义；(4) 申请时无事务锁并发可绕过余额检查 → 整段包进 `db.transaction().immediate()` SQLite 写锁串行化；新增 `scripts/migrate_v1.0.94_backfill_transactions.js` 历史数据 migration 工具 |
| v1.0.95 | 2026-06-23 | 修复普通用户"账户总览"活跃卡片显示"—"（r.data 当数组调用 TypeError）+ 改用 DB 实际字段 expiry_month/expiry_year 判断过期 |
| v1.0.96 | 2026-06-24 | 修复卡详情"单笔/日/月限额"显示错位 100 倍（前端 fmtUsd 误标"分单位"+100 → G5554LC $30K/$100K/$500K 商务卡限额正确显示）|
| v1.0.97 | 2026-06-24 | 修复卡详情"账单地址"空（cards 表加 6 个地址列 + persistCardDetailToDb 写地址 + /api/cards 读地址 + admin.js INSERT 加地址 + migration 用 .env VMCARDIO_DEFAULT_BILLING_ADDRESS 回填现有卡）|
| v1.0.98 | 2026-06-25 | **申请开卡 `txResult is not a function` 修复**: better-sqlite3@^12.8.0 的 `db.transaction(fn).immediate()` 是**同步触发器**立即执行完返回 `undefined`; 我们误用 `const tx = db.transaction(...).immediate(); tx();` 导致第二行调 undefined → TypeError. 修复 3 处: `src/routes/cards.js:130-183` (申请开卡) / `src/routes/admin.js:1881-1885` (拒绝申请退款) / `src/routes/admin.js:1915-1932` (拒绝申请). 部署: commit `036c0db` → 生产 git reset --hard + pm2 reload. 副产物澄清: Merchant API `card_address` 字段 = **KYC 商户地址** (不是卡的真实账单地址); 卡的真实账单地址仅上游后台可见, API 拿不到; 决策: 保持现状不动 |
| v1.0.99 | 2026-06-25 | **卡片管理加删卡功能 (用户 + 管理员)**: 后端 `DELETE /api/cards/:card_id` 改软删 + 4 层校验 (状态701001/余额>0 701002/pending 701003/上游失败 701004) + 审计日志; 前端 `renderCardManage` 加 `🗑 删卡` 按钮 + promptModal 二次确认 + balance>0 disabled; 8/8 冒烟测试全过 (admin+user 视角); 200 成功路径需生产真卡验证; 设计决策: 软删(保留历史)/禁止非 0 余额/禁止 pending/写审计日志. 部署: commit `2453d0b` → push origin/main → 生产 git reset --hard + pm2 reload. Bug 修复: `card.user_email` 列不存在 → 改为 JOIN users 表拿 email |
| v1.0.99.1 | 2026-06-25 | **删卡余额逻辑修正**: 业务规则确认 vmcardio 上游 `deleteCard` **自动退卡内余额到用户账户** (不需要用户先手动退款). 原 v1.0.99 设计的"余额>0 拒绝 + 按钮 disabled" 过度保守, 修正为"余额>0 也可删, 弹窗告知用户余额将退回". 改动: (1) 后端 cards.js:597-605 删除 701002 检查 + 新增 `balanceBeforeDelete` 记录 + 审计日志加 `balance_at_delete` 字段; (2) 前端 app.html:4470-4479 余额前置校验删除 + 按钮统一可点 + 弹窗 desc 加 `balanceLine` 提示"余额将退回"; (3) 测试 scripts/v1.0.99_delete_card_test.js:132-134 3.1 用例 701002 → 701004 (不再被前端拒绝). 8/8 冒烟测试全过 (100% 覆盖) |
| v1.0.99.3 | 2026-06-24 | **删卡 701004 文案重复 + 上游错误码透传**：(1) 文案重复 bug → 后端 cards.js:626 加 "上游删卡失败:" 前缀 + 前端 app.html:4695 又加一次 → toast 重复；(2) **业务规则推翻** v1.0.99.1: 实测生产 logs/app.log 用户真卡 XR2067511181878833152 删卡失败, 上游错误码 700013 "第三方获取数据失败" — 实际上游**不允许带余额 active 卡删除**, 不存在"自动退余额"; 修复后端 701004 catch 加 `data: { vmCode, vmMsg }` 透传上游错误码; 前端 toast 去掉重复前缀 + 展示 [上游错误码 N] + vmCode=700013 时附友好提示; 测试 scripts/v1.0.99_delete_card_test.js 3.4a 验证 data.vmCode 字段; 9/9 冒烟测试全过; 部署 commit `2f38356` + pm2 reload; 备份 NovaCard-20260624_032731-V1.0.99.3.tar.gz (386K) |
| v1.0.99.4 | 2026-06-24 | **700013 提示去甩锅余额**: v1.0.99.3 的"上游不允许带余额"假设**被推翻** (实测 S5258LL 卡 2069455464522190849 带 $20 余额 **成功删除** 03:56:51, G5554LC 卡 XR2067511181878833152 带 $20 余额 **失败** 03:57:19, 30 秒内同 IP 同 API 唯一差异=product_code); 修复前端 app.html:4703-4705 700013 提示从"余额限制"改为"G5554LC/VC102 卡段上游 deleteCard 端限制", 引导用户联系 vmcardio 客服 (提供 card_id + 错误码 700013), 不再误引导消耗余额; 部署 commit `308f1a0` + pm2 reload; 不重新备份 (v1.0.99.3 386K 已包含) |
| v1.0.99.5 | 2026-06-24 | **删卡余额自动退给用户账户** (上游 deleteCard 退到我们 vmcardio 平台账户→我们主动调 BalanceService.recordRefund 退给用户) + recordRefund 加 refId 参数 + 手工追回 5258 卡 \$20 (user_id=3 账户 \$36.40→\$56.40); 业务规则三阶段澄清 (v1.0.99.1 用户口述"自动退"错 / v1.0.99.3 我猜"不允许带余额"错 / v1.0.99.5 真相"上游退到平台账户") |
| v1.0.99.6 | 2026-06-24 | **账户流水加"关联卡号"列**: 后端 `/api/ledger` SQL `LEFT JOIN cards ON cards.card_id = transactions.ref_id` 返回 `card_number`/`product_code`/`label` (修 where 列加 `t.` 前缀避免 JOIN 后 user_id 歧义, COUNT 子查询同步加 `t` 别名); admin `/users/:id/transactions` walletRows 同步改; 前端用户端账户流水表加"关联卡号"列 `**** **** **** 3750` + 卡号点击调 `window.showCardDetail` 弹模态框; admin 端用户流水表同步升级 masked + 可点击; CSV 导出加"关联卡号"列; 12/12 冒烟测试全过 + v1.0.99 删卡回归测试 12/12 也过; 部署 commit `a07c8ca` + push origin/main; 备份 NovaCard-20260624_140938-V1.0.99.6.tar.gz (10.8MB) |
| v1.0.99.7 | 2026-06-24 | **关联卡号 fallback 解析 (description 提取卡段)**: 数据真实性保证 — 16 位卡号走 cards JOIN (ref_id 关联, 仅新流水), 卡段名从 `transactions.description` 真实字符串提取 (S5258LL/G5554LC/VC113/VC102 上游固定代号), 充值类无卡关联继续显示 `—` 不伪造; 实现 `_extractProductCodeFromDescription` (4 个 KNOWN_CODES 顺序匹配) + `formatLedgerCardCell` (三态判断) + 用户端/admin 端 renderLedgerList 同步升级; CSS `.ledger-card-link` (可点击 + hover --cyan 高亮) + `.ledger-card-tag` (badge 样式); 测试 5 行真实生产数据全过 (#22 退款/3750 跳详情 / #21 S5258LL / #20 G5554LC / #19 VC113 / #13 充值 —); 部署 commit `a46dce9` + push origin/main + pm2 reload (↺113/100); 备份 vcc-hub-V1.0.99.6-20260624063828..tar.gz (4.4MB) |
| v1.0.99.8 | 2026-06-24 | **申请驳回流水显示"未开卡成功"**: 后端 backfill 脚本 `scripts/v1.0.99.8_backfill_ledger_ref_id.js` 扩展同时匹配 approved + rejected 申请; rejected 申请写 `ref_id = 'app_rejected:${app_id}:${product_code}'` 约定式标识; 前端 `formatLedgerCardCell` 新增 path 1.5：正则 `/^app_rejected:\d+:[A-Z0-9]+$/` 命中 → "未开卡成功" + 黄/橙 badge + pulse 动效; CSS `.ledger-card-rejected` 样式; 生产 apply 3 条 (id=16/18/19 → app_rejected:4:VC113); 部署 commit `e1c57ca` + push origin/main |
| v1.0.99.9 | 2026-06-24 | **移除账户流水页标题区**: 删除 `vcc-dashboard/app.html` line 4750-4752 `<div class="page-header">` 块（"账户流水"标题 + "账户余额变动历史记录"副标题）; 用户视觉上更紧凑; 部署 commit `755e04e` + push origin/main |
| v1.0.99.10 | 2026-06-24 | **充值后异步同步余额到 DB**: v1.0.85 同步逻辑用 `result?.available_amount ?? null` 兜底, 但 `rechargeCard` API 返回的不是 cardDetail 格式 (无 available_amount 字段), 导致同步代码直接跳过, DB 永远停留在充值前余额; 修复: res.json 后 fire-and-forget `setTimeout 1500ms` 调 `cardDetail` 拉新余额写回 (读路径不触发 700011 写问题); SDK 走 IPv4 强制 (commit `15cb5c5` 2026-06-01 已加 `https.Agent({ family: 4 })`), 上游不支持 IPv6 白名单; **手动同步** XR2067511181878833152 DB 20→30 (07:16 救急); 部署 commit `49a1b49` + push origin/main + pm2 reload; **需要用户再充一次 $1 验证 1.5s 自动同步** |
| v1.0.99.11 | 2026-06-24 | **充值弹窗动态展示余额**: `vcc-dashboard/app.html` `cmRechargeCard` 改 async + `window._cmCards` 缓存 + 弹窗 desc 动态显示 "卡内当前余额 $XX，账户可用 $YY (充后卡内 $XX+amount)"; commit `b5ce116` |
| v1.0.99.12 | 2026-06-25 | **🔴 资金安全 bug 修复**：`/api/cards/:card_id/recharge` 路由只调 `sdk.rechargeCard` 不扣用户账户（v1.0.99 之前漏的）→ 修复加 `BalanceService.recordSpend` 先扣 + SDK 失败 catch `recordRefund` 回滚 + 写流水 type='消费'/'退款'；事故链 user 3 凭空 +30 美元（充值 10×3 没扣账户 + 删卡退 50）；测试 `scripts/v1.0.99.12_recharge_deduct_test.js` 5/5 全过；commit `17ed0ae` |
| v1.0.99.13 | 2026-06-25 | **删卡退款流水补 ref_id (卡号列正确显示)**：v1.0.99.99 `DELETE /api/cards/:card_id` 调 `recordRefund` 漏传第 6 个参数 refId → user 3 id=23 删卡退款 ref_id=空 → 前端 `formatLedgerCardCell` 走 Path 3 fallback 匹配 "G5554LC" 显示产品名而非卡号；3 件套修复：(1) 后端 `src/routes/cards.js:687` recordRefund 补传 `card_id`；(2) 前端 `formatLedgerCardCell` 加 Path 3.5 desc 含 `****XXXX` 时显示 `**** **** **** XXXX` masked；(3) 历史回滚 `scripts/v1.0.99.13_backfill_ref_id.js` 扫所有 ref_id 空流水 → 生产回滚 1 条 id=23 → ref_id=XR2067511181878833152；commit `af7f07e` + push + pm2 reload |
| v1.0.99.14 | 2026-06-25 | **账户流水筛选 + 导出 CSV 修复**：(1) 前端"管理员充值"→实际 type='充值' (line 4772 修正)；(2) 后端 `created_at >= 'YYYY-MM-DD HH:MM:SS'` 字符串比较错乱（'T' > ' ' ASCII）→ 改用 `date(created_at) >= ?` (ledger.js line 111-112)；(3) 两个重复 /export.csv 路由（老用户版先注册覆盖新 admin 版）→ 删老用户版 (line 96-158)；(4) 普通用户卡号没 masked → 加 maskCard() (ledger.js)；commit `d7ff81f` → `23dc070` |
| v1.0.99.15 | 2026-06-25 | **开卡 user_id 参数错误修复**：admin.js line 1819 `user_id: String(app.user_id)` 传的是我们系统的 user_id (3)，但 vmcardio 某些卡段（G5450SU/G5237OH）严格要求 `user_id='20098106'`（固定商户 ID）→ 700006 参数错误；S5331GL 不校验 user_id 所以之前能成功；修复改回固定值 `'20098106'`（v1.0.6 已修过，v1.0.15 切回 Merchant API 时漏改回去）；commit `e75729c` + push + pm2 reload |
