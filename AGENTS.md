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

### 注意事项
1. **数据库**: SQLite 使用 WAL 模式，数据存储在 `data/vcc.db`。服务启动时自动建表和种子数据。
2. **外部依赖**: vmcardio API (虚拟卡发行商) 为外部服务，需要配置 `.env` 中的 VMCARDIO_* 变量才能使用卡片申请等功能。
3. **腾讯云短信**: 需要配置 TENCENT_SMS_* 环境变量，否则短信功能不可用。
4. **前端**: 单页应用，所有逻辑在 `app.html` 中内联，通过 CDN 加载 Chart.js 和 QRCode.js。

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
| v1.0.11 | 2026-05-22 | 完整项目备份 V1.0.11 - 生产库同步 + 本地服务器垃圾清理 |

### 🔴 重要：双 API 架构说明

| 特性 | Merchant API (`sandbox-api.vmcardio.com`) | Web API (`dev.vmcardio.com/web/`) |
|------|------------------------------------------|-----------------------------------|
| 认证 | `app_id` + `app_secret` → AccessToken | JWT Session Token（localStorage `auth.jwtToken`） |
| 传输 | RSA 加密 `{content: encrypted}` | 明文 JSON |
| 创建卡片 | 参数：`product_code`/`first_name`/`last_name`/`user_id` | 参数：`bin`/`customize_name`/`customize_last_name`/`bind_uid`/`user_name` |
| 卡片列表 | ❌ `/cardList` 404 | ✅ `/web/createCard` 可创建，但 `/web/getCardList` 需另寻 |
| 产品权限 | G5554LC 无开卡权限 | G5554LC 可正常开卡 |
| 当前用途 | 查询（cardDetail/freezeCard/rechargeCard 等） | 创建卡片（webCreateCard） |

> **Token 来源**：登录 sandbox.vmcardio.com → F12 → Application → Local Storage → `auth.jwtToken` → 写入 `.env` `VMCARDIO_WEB_TOKEN`