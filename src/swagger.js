/**
 * Swagger / OpenAPI 配置
 * 访问: http://localhost:5000/api/docs
 * 暴露全部带 @swagger JSDoc 注释的路由
 */
const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'VCC Hub API',
      version: '1.0.47',
      description: `
虚拟信用卡管理平台 API

**认证方式**: 登录后拿到 token，请求头加 \`Authorization: Bearer <token>\`

**默认账户**:
- 管理员: \`admin@vcc.hub\` / \`Admin@2026\`
- 用户:   \`user@vcc.hub\`   / \`User@20261\`

**通用响应格式**:
\`\`\`json
{ "code": 0, "msg": "ok", "data": { ... } }
\`\`\`
- \`code = 0\`  成功
- \`code != 0\` 失败, msg 是错误描述
      `.trim(),
      contact: { name: 'VCC Hub' },
    },
    servers: [
      { url: 'http://localhost:5000', description: '本地开发' },
      { url: 'https://nova-vcc.com',  description: '生产 (经 Cloudflare)' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        ApiResponse: {
          type: 'object',
          properties: {
            code: { type: 'integer', example: 0 },
            msg:  { type: 'string',  example: 'ok' },
            data: { type: 'object' },
          },
        },
        Transaction: {
          type: 'object',
          properties: {
            card_id:        { type: 'string' },
            type:           { type: 'string', enum: ['Authorization', 'Settlement', 'Refund', 'Reversal'] },
            status:         { type: 'string', enum: ['COMPLETE', 'DECLINED', 'PENDING'] },
            auth_amount:    { type: 'number' },
            settle_amount:  { type: 'number' },
            auth_currency:  { type: 'string', example: 'USD' },
            settle_currency:{ type: 'string', example: 'USD' },
            merchant_name:  { type: 'string' },
            create_time:    { type: 'string' },
            auth_time:      { type: 'string' },
          },
        },
        AnomalyAlert: {
          type: 'object',
          properties: {
            card_id:   { type: 'string' },
            card_no:   { type: 'string', description: '脱敏卡号', example: '****1234' },
            user_id:   { type: 'integer' },
            amount:    { type: 'number' },
            merchant:  { type: 'string' },
            auth_time: { type: 'string' },
            reasons:   { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  // 扫全部路由文件
  apis: [
    path.join(__dirname, 'routes/*.js'),
    path.join(__dirname, 'app.js'),
  ],
};

module.exports = swaggerJsdoc(options);
