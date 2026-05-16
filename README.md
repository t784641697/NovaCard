# VCC Hub 后端服务

vmcardio API 网关层，基于 Node.js + Express。

## 目录结构

```
vcc-backend/
├── src/
│   ├── app.js                    # 入口文件
│   ├── routes/
│   │   ├── cards.js              # 卡片 CRUD 路由
│   │   └── transactions.js       # 全局交易记录路由
│   ├── services/
│   │   └── vmcardioSDK.js        # vmcardio SDK（Token + 加密 + 所有接口）
│   ├── middleware/
│   │   ├── auth.js               # JWT 认证中间件
│   │   └── errorHandler.js       # 统一错误处理
│   ├── utils/
│   │   ├── rsaCrypto.js          # RSA 加解密工具
│   │   └── logger.js             # Winston 日志
│   └── webhooks/
│       └── vmcardio.js           # WebHook 事件处理器
├── config/                       # 放 PEM 密钥文件（不提交 git）
├── logs/                         # 生产日志（自动生成）
├── .env.example                  # 环境变量模板
└── package.json
```

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填写 app_id / app_secret / RSA 密钥路径

# 3. 将 vmcardio 提供的 RSA 密钥文件放到 config/ 目录
#    - config/vmcardio_platform_public.pem   （平台公钥，用于加密请求）
#    - config/merchant_private.pem           （商户私钥，用于解密响应）

# 4. 启动（开发模式）
npm run dev

# 5. 启动（生产模式）
npm start
```

## API 接口

### 卡片管理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/cards` | 申请卡片（createCard） |
| GET | `/api/cards/:card_id` | 卡详情（cardDetail） |
| PATCH | `/api/cards/:card_id/freeze` | 冻结/解冻（freezeCard） |
| POST | `/api/cards/:card_id/recharge` | 充值（rechargeCard） |
| DELETE | `/api/cards/:card_id` | 注销卡片（deleteCard） |
| GET | `/api/cards/:card_id/transactions` | 卡片交易记录 |

### 交易记录

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/transactions` | 全局交易记录（支持 card_id/type/status/时间筛选） |

### WebHook

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/webhook/vmcardio` | 接收 vmcardio 实时推送 |

### 其他

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |

## 安全说明

- 所有 `/api/cards` 和 `/api/transactions` 接口需要 JWT 认证（`Authorization: Bearer <token>`）
- 全局限流：100 次/15 分钟；开卡接口额外限流：10 次/分钟
- RSA 密钥文件存放在 `config/`，该目录已加入 `.gitignore`
- 生产环境 CORS 需配置具体域名

## 架构说明

```
前端 Dashboard
      │
      │ JWT 认证
      ▼
Express 路由层（cards / transactions）
      │
      │ 参数校验
      ▼
vmcardio SDK（services/vmcardioSDK.js）
      │ ① 获取/缓存 AccessToken
      │ ② RSA 加密请求体 → content 字段
      ▼
vmcardio 卡商 API
      │
      │ ③ 返回加密 data 字段
      ▼
RSA 解密 → 返回业务数据给前端

vmcardio 实时推送
      │
      ▼
POST /api/webhook/vmcardio
      │ 立即响应 {"code":0,"msg":"ok"}
      │ 异步分发：Authorization / Settlement 事件
      ▼
TODO: 写入数据库 + 推送 WebSocket 给前端
```
