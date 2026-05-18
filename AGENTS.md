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
# 安装依赖
pnpm install

# 开发模式 (nodemon 热重启)
pnpm run dev

# 生产模式
node src/app.js
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
| `/api/cards` | POST | 提交开卡申请（参数：topup_amount≥$20, quantity） |
| `/api/admin/cards/*` | GET/POST | 卡片管理 |
| `/api/admin/card-applications` | GET | 管理员开卡申请列表（?status=pending/approved/rejected） |
| `/api/admin/card-applications/:id/approve` | POST | 审批通过开卡申请，创建 cards |
| `/api/admin/card-applications/:id/reject` | POST | 拒绝开卡申请 |
| `/api/admin/*` | GET/POST | 管理后台 |
| `/api/topup/*` | POST | 充值 |
| `/api/transactions` | GET | 交易记录 |
| `/api/user/balance` | GET | 余额明细 |

### 代码风格

- CommonJS 模块 (require/module.exports)
- 异步使用 async/await
- 响应格式: `{ code: 0, msg: 'ok', data: {...} }` (成功) / `{ code: xxx, msg: '...' }` (失败)
- 日志使用 winston，通过 logger.info/error/warn 输出

### 注意事项

1. **数据库**: SQLite 使用 WAL 模式，数据存储在 `data/vcc.db`。服务启动时自动建表和种子数据。
2. **外部依赖**: vmcardio API (虚拟卡发行商) 为外部服务，需要配置 `.env` 中的 VMCARDIO_* 变量才能使用卡片申请/交易等功能。
3. **腾讯云短信**: 需要配置 TENCENT_SMS_* 环境变量，否则短信，否则短信功能不可用。
4. **前端**: 单页应用，所有逻辑在 `app.html` 中内联，通过 CDN 加载 Chart.js 和 QRCode.js。

### 📌 已知问题和修复记录

| 版本 | 日期 | 修复内容 |
|------|------|---------|
| v1.0.0 | 2026-05-18 | 初始版本，从 XiuXiu Card 迁移 |
| v1.0.1 | 2026-05-18 | 移除顶部标题栏，品牌名 XiuXiu Card → NovaCard |
| v1.0.2 | 2026-05-18 | **修复卡片管理搜索功能**: `GET /api/admin/cards` 统计查询 SQL 双重 WHERE 语法错误。修复状态标签点击自动搜索 + 冻结状态值修正 |
| v1.0| v1.3 | 2026-05-18 | **卡片数据同步机制**: 上游 vmcardio 沙箱卡片已被删除，实现实时同步机制——管理员查看卡片列表时自动 `&sync=true` 从上游拉取最新状态，DELETED 的卡片本地标记为 `deleted`，保持与上游真实数据一致 |
| v1.0.5 | 2026-05-18 | **开卡申请表单重构**: 移除旧的"初始金额/单笔限额/日限额/月限额"字段，改为"卡内充值金额（≥$20/张）+ 开卡数量"；移除手机号/区号/地址字段；后端增加管理员审批流程API（列表/通过/拒绝） |

### 🐛 常见 Bug

- **搜索功能 SQL 错误**: `GET /api/admin/cards` 中 stats 查询的 WHERE 子句双重拼接。修复: 用独立的 statsQueryConditions 数组代替复用 whereClause，并移除对 users 表的引用依赖。