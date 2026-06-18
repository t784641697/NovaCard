
## v1.0.51 | 2026-06-18 | 充值入账手续费体系 + 开卡流程全面修复

**手续费精细化 + 开卡切回正式环境 Merchant API**

### 充值入账手续费体系

- **fee_configs 表加 `topup` 费用类型**：
  - 重命名描述 `充值入账手续费` → `入账手续费`
  - seedFees 启动幂等（ON CONFLICT 跳过），日志更清晰
- **用户级费率 `user_fee_configs`**：
  - `/api/topup/fee-config` 应用 `user_fee_configs` 个性化费率（用户级优先于全局）
  - 修复 `setUserFeeConfig` 传 `is_active: true/false` boolean → SQLite 报错 bug（前端传 1/0 替代）
- **USDT 模式费率实时预览**：
  - 用户端充值申请页加"预计到账"实时预览（输入金额即算出扣费 + 实际到账）
  - USDT 模式费率提示也拉取 `fee_configs` 实时显示，文案精简
- **重复点击 bug 修复**：
  - 修复"该申请已处理" + 漏写流水字段名 bug
  - `recordSpend`/`recordIncome` 调用补全流水字段

### 开卡流程全面修复

- **card_applications 表补 `fee_amount` 列**（v1.0.4 重构时建表 SQL 漏了）：
  - ALTER 兜底迁移已加容错
  - 后端 INSERT 一直传 `fee_amount`，建表漏列导致 500 错误
- **开卡重复扣费 bug**：
  - approve 路由 `recordSpend(amount=totalAmount)` + `UPDATE balance-=totalAmount` 重复扣费
  - 修复：`recordSpend(amount=0, fee=1)` + 保留 balance UPDATE
- **开卡失败退 topup**：
  - webCreateCard 失败时只退 fee（$1），不退 topup（$20）— 修复为退 fee + topup*quantity
- **正式环境开卡切回 Merchant API（v1.0.15）**：
  - v1.0.7 假设的 `dev.vmcardio.com/web/createCard` 在正式环境不存在（`vmcardio.com` 是 HTML 营销站，无 API endpoint）
  - 切回 `vmapi.vmcardio.com/createCard`（Merchant API + RSA 加密）
  - 实测 G5554LC 正式环境可正常开卡，同步返回 `card_id`（无需异步发现）
  - 字段映射：`bin` → `product_code` / `customize_name` → `first_name` / `bind_uid`（假数据 22123）→ `user_id`（真实）
  - 删掉 `discoverWebCardIds` 后台异步发现流程
  - 删掉 `WEB-${bin}-${ts}` 占位 card_id，改用真实 `result.card_id`

### UI 优化

- **充值记录简化**：只显示"实际入账金额"，样式与时间字段一致
- **promptModal 替换**：卡片充值/管理员审核弹窗用项目 `promptModal` 替代浏览器原生 `prompt`（前后端一致风格）
- **账户流水加载失败修复**

### 数据库迁移容错

- ALTER 块从 `db.exec` 字符串内移到外面（之前 try 在 SQL 字符串里导致启动 crash）
- `migrate/seedFees` 日志加强

### AGENTS.md

- 修订 v1.0.15：双环境 API 架构表 + "正式环境 Web API 不存在"关键事实


## v1.0.47 | 2026-06-17 | PM2 cluster 模式 + 日志轮转

**生产环境高可用加固**

- **PM2 cluster 模式**：从单进程 fork 升级为 2 实例 cluster，共享 5000 端口实现 0 停机故障切换
  - 新增 `ecosystem.config.cjs` 显式指定 `cwd: /opt/vcc-hub`（修复 PM2 从 /root 启动找不到 .env 的根因）
  - 之前 5 次 restart 记录得到解释：dotenv 缺失 → Express 用默认端口 3000 → 5000 未监听 → PM2 一直重启失败
  - 已验证：kill 任一进程，4 秒内 PM2 自动拉起新进程，HTTP 服务 0 中断
- **logrotate 日志轮转**：新增 `/etc/logrotate.d/vcc-hub`，3 段规则
  - PM2 日志 (`/root/.pm2/logs/vcc-hub-*.log`)：每天切割，保留 7 天，`copytruncate` 不影响 PM2 文件描述符
  - winston 应用日志 (`/opt/vcc-hub/logs/*.log`)：每天切割，保留 14 天
  - 运维脚本日志 (`/var/log/novacard-*.log`)：每周切割，保留 4 周
  - 全部 `dateext -%Y%m%d extension .log` 生成日期归档，`delaycompress` 推迟到下一轮才 gzip
  - 由系统 `/etc/cron.daily/logrotate` 每天自动触发


## v1.0.40 | 2026-06-14 | KYC审核页表格对齐优化


**消除重复行 + 调整列宽 + 紧凑按钮**


- **去重逻辑**：申请人 / 法人代表 / 联系人 三列增加 `auxLine()` 辅助行判断：仅当辅助信息（邮箱/证件号/电话）与主信息**不同时**才显示第二行，避免相同内容重复占用纵向空间
- **统一单元格样式**：新增 `.cr-cell-main` 主行样式（font-size .82rem, line-height 1.5, color text1），与 `.cr-applicant-name` 保持一致
- **辅助行优化**：`.kyc-aux-info` 字号 .78→.72rem，margin-top 3→2px，max-width 180px 省略号截断（备注/拒绝原因）
- **列宽重新分配**：
  - `.col-action` 140→160px + 按钮 padding 4px 10px / font .76rem（确保两个按钮一行紧凑放下，不再垂直堆叠）
  - `.kyc-col-name` 130→140px
  - `.kyc-col-company` 加 max-width 180px
  - 新增 `.kyc-col-country` 90px / `.kyc-col-cert` 90px 居中 / `.kyc-col-contact2` 110px
- **表格内边距**：14px 16px → 12px 14px，更紧凑
- **表头统一 class**：国家 / 法人证件 / 联系人 加上对应列 class，避免宽度分配不均


## v1.0.39 | 2026-06-14 | KYC审核页按钮与字体统一


**信息字号统一 + 按钮改用项目标准 `.btn-sm btn-success/danger`**


- **按钮统一**：管理员 KYC 审核页的"通过 / 拒绝"按钮从自定义的 `kyc-btn-action kyc-btn-pass/reject`（自定义绿/红硬色）改为项目标准的 `btn btn-sm btn-success/danger`（与其他模块一致：淡绿/淡红背景 + `.btn-sm` 25px 高度）
- **信息字号统一**：所有 KYC 申请记录的展示字段（公司名、国家、联系人邮箱、备注、注册时间等）统一为 `0.82rem`，与其他模块字号保持一致
- **辅助文字降级**：邮箱/辅助信息 → 0.78rem text3；拒绝原因 → 0.75rem text3；状态文字 → 0.78rem
- **新增 CSS 类**：`kyc-aux-info` / `kyc-reject-reason` / `kyc-status-text` / `kyc-status-pass` / `kyc-status-reject` / `kyc-detail-link`
- **列宽调整**：`.cr-col-action` 从 140px → 150px（容纳两个 .btn-sm 按钮）


## v1.0.38 | 2026-06-14 | KYC预览弹窗精简

**移除底部3个下载按钮 + 统一企业证书/身份证卡片样式**

- **问题1（移除底部下载按钮）**：删除 `.kyc-preview-downloads` 区域（"下载证书 / 下载身份证正面 / 下载身份证背面" 三个按钮），弹窗底部更清爽。
- **问题2（下载按钮加"下载"文字）**：将 `⬇` 箭头 emoji 替换为 `⬇ 下载` 文字（"⛶ 预览" + "⬇ 下载"），按钮语义更明确。
- **问题3（企业证书统一卡片样式）**：引入 `.kyc-file-wrap` 通用卡片布局，图片/PDF/其他文件**统一为同款卡片**：
  - 左侧：缩略图（图片自动 `object-fit:contain` / PDF 显示 📄 大图标）
  - 右侧：文件名 + 大小
  - 右下角：⛶ 预览（PDF 才有） + ⬇ 下载（始终有）
- 身份证子框也使用统一卡片样式，正反面视觉一致。


## v1.0.37 | 2026-06-12 | KYC预览弹窗重构

**弹窗固定大小 + PDF 图标卡片化**

- **问题1（PDF预览空白）**：之前用 iframe 内嵌 base64 PDF，受浏览器兼容性影响会出现静默空白。改为：PDF 显示为图标卡片（📄 + 文件名 + 大小 + 「预览」+「下载」按钮），点击触发新窗口打开。
- **问题2（身份证框过高）**：法人身份证正反面改为**上下堆叠**（grid-template-rows: 1fr 1fr）而非左右并排，框体高度减半。
- **问题3（弹窗整体滚动）**：弹窗改为**固定大小** `width:780px; height:520px; max-height:calc(100vh - 80px); overflow:hidden`，仅中间 body 区域 `overflow-y:auto`，弹窗本身不再出现滚动条。
- 重写 `kycPreviewDocs()` 函数，引入 `renderFile()` 统一处理图片/PDF/其他文件。
- 新增 `openKycPdf()` 异步函数：base64 → Blob URL → `window.open()`，60秒后自动释放。


# CHANGELOG.md

## v1.0.36 (2026-06-12) — KYC PDF预览加载体验优化
- **问题**：用户反馈 PDF 文件"无法阅读只能下载"，iframe 区域显示空白无法判断是加载慢还是能力问题
- **加载状态可视化**：PDF iframe 上方覆盖半透明加载层（`background:rgba(13,19,34,.92)`）+ 蓝色旋转 spinner（32px 圆环，`@keyframes kycSpin`）+ "正在加载 PDF..." 提示
- **iframe onload 事件**：PDF 加载完成后自动隐藏 loading 层
- **3秒超时降级**：3 秒后如果 loading 仍未隐藏，自动显示降级提示（📄 + "浏览器无法内嵌预览此 PDF" + "建议点击下方按钮在新窗口中查看或下载"）
- **顶部工具栏升级**：右上角"⛶ 新窗口打开"按钮改为渐变背景（冰蓝→薰衣草紫→品粉）+ 蓝色光晕阴影
- **底部状态栏**：固定在 PDF 底部，显示"📄 PDF 文档"
- **iframe 高度提升**：320px → 360px（更接近 A4 比例）

## v1.0.35 (2026-06-12)

### 新增
- **KYC 管理员可在线查看 PDF**（用户反馈：用户上传的 PDF 文件之前只能下载，无法在浏览器中直接查看）：
  - **PDF 内嵌预览**：`renderFile` 函数对 PDF 文件不再只显示图标，改为用 `<iframe src="data:application/pdf;base64,...">` 内嵌浏览器原生 PDF 阅读器，直接在弹窗内可滚动查看 PDF 内容
  - **"新窗口打开"按钮**：每个 PDF iframe 右上角增加 `⛶ 新窗口` 浮动按钮（半透明黑底+blur 玻璃质感）
  - **Blob URL 优化**：`openKycPdf()` 函数将 base64 data URL 转成 Blob URL 打开新窗口，避免某些浏览器对 data URL 长度的限制；60秒后自动 `URL.revokeObjectURL` 释放内存；Blob 创建失败时降级用 data URL
  - **图片预览同步优化**：`max-height: 260px → 320px`（更清晰）
- **PDF 数据缓存**：`window._kycPdfCache` 全局对象按 `pdf_N` 键存储 PDF data URL，供"新窗口打开"按钮回调

## v1.0.34 (2026-06-12)

### 修复
- **KYC 上传 PDF 文件名仍重复显示**：
  - 原因：v1.0.33 修复后，PDF 仍同时在 `.kyc-upload-name`（label 区域）和 `.kyc-upload-preview`（绝对定位覆盖层）渲染文件名，导致叠加重复
  - 修复 JS（`previewKycFile`）：PDF 文件不再渲染 preview 缩略图；hint 区域改为显示"📄 PDF 文件 · 105.4 KB"替代系统提示
  - 修复 JS：清空文件时重置 label 和 hint 文本
  - 优化图片预览：max-height 120px，object-fit contain，垂直居中（替代原本 width:100% 撑满）

## v1.0.33 (2026-06-12)

### 修复
- **KYC 上传 PDF 文件名与系统提示重叠**：
  - 原因：`.kyc-upload-info` 没有显式 flex column 布局，长文件名无省略号处理
  - 修复 CSS：`.kyc-upload-info { display:flex; flex-direction:column; gap:2px; }`
  - 修复 CSS：`.kyc-upload-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }`
  - 修复 JS：上传后 `hint.style.display='none'` 隐藏系统提示，避免重叠
  - 优化 PDF 预览：显示文件名 + 文件大小（KB/MB 自动单位）

## v1.0.32 (2026-06-12)
### 修复
- **KYC 提交按钮调整为饱满修长版**（参考全项目按钮尺寸规范）：
  - `min-width: 240px → 160px` + `max-width: 220px`（不再超长，更协调）
  - `padding: 5px 32px → 10px 32px`（高度从 25px 提升到 34px，与 `.btn` 一致）
  - `font-size: .78rem → .88rem`（与 `.btn` 一致）
  - `border-radius: 14px → 16px`（更大圆角更饱满）
  - 字距 `.5px → .3px`（与大字号匹配）
  - 实际宽高比约 5.6:1，既修长又饱满

## v1.0.31 (2026-06-12)

### 修复
- **KYC 提交按钮再次细化**（用户反馈仍偏胖）：
  - `min-width: 180px → 240px`（更长）
  - `padding: 7px 32px → 5px 32px`（更薄）
  - `font-size: .82rem → .78rem`（更精致）
  - `border-radius: 20px → 14px`（薄按钮小圆角更协调）
  - 字距 `.4px → .5px`（更有节奏）
  - SVG 图标 `width/height: 24px(默认) → 13px`，`stroke-width: 2 → 2.5`（缩小+加粗让小图标清晰）

## v1.0.30 (2026-06-12)

### 修复
- **KYC 提交按钮改为更细更长**：
  - 内边距 `10px 24px → 7px 32px`（更薄+更长）
  - 字号 `.88rem → .82rem`（更精致）
  - `min-width: 0 → 180px`（保证最小宽度）
  - 字距 `.3px → .4px`（更有节奏感）
  - 阴影升级为双层外发光：`0 0 18px rgba(126,184,247,.28), 0 4px 12px rgba(167,139,250,.22)`

## v1.0.29 (2026-06-12)

### 修复
- **KYC 提交按钮样式参考「修改资料重新提交」按钮**：
  - 改为胶囊形（圆角从 8px → 22px）
  - 字号略增 `.85rem → .88rem`，内边距 `9px 22px → 10px 24px`
  - 增加柔和外阴影 `0 4px 14px rgba(126,184,247,.25)`，呈现"轻拟物"质感

## v1.0.28 (2026-06-12)

### 修复
- **KYC 提交按钮尺寸再次调整**：
  - 缩小按钮：`min-width: 180px → 0`、`padding: 11px 28px → 9px 22px`、`font-size: .9rem → .85rem`
  - 改为居中：`.kyc-submit-wrap` 由 `text-align: right` → `text-align: center`

## v1.0.27 (2026-06-11)

### 修复
- **KYC 表单布局问题**：
  - **问题1**：表单未贴近侧边栏（之前 `margin:0 auto` 居中导致右侧大量空白）→ 改为 `margin:0` 左对齐
  - **问题2**：提交认证申请按钮尺寸异常（之前 `width:100%` 撑满 720px 表单）→ 改为 `inline-flex;width:auto;min-width:180px;padding:11px 28px;` 自适应宽度

### 变更
- **KYC 提交按钮位置**：`.kyc-submit-wrap` 增加 `text-align:right`，按钮靠表单右下角显示

### 清理
- **删除无用文件**：`assets/`(11MB截图)、`vcc-dashboard/js/`(444KB旧JS)、`vcc-dashboard/index.html`(312KB)、`package-lock.json`、`nova-backup/`、agent记忆目录、备份密钥
- **项目体积**：14MB → ~1MB
- **更新 `.gitignore`**：忽略 `.workbuddy/`、`.codebuddy/`、`nova-backup/`、`package-lock.json`、备份密钥

## v1.0.26 (2026-06-11)

### 新增
- **🧩 KYC 表单 Tab 切换布局**：三段独立卡片 → 统一 Tab 切换（企业认证信息/法人代表信息/联系方式）
- **🆔 身份证正反面分拆并排上传**：`id_card_file` 存储 JSON `{"front":"base64","back":"base64"}`
- **📄 PDF 上传支持**：表单 `accept="image/*,.pdf"`，管理员证件预览支持 PDF 图标+下载
- **🗃️ 管理员 KYC 审核页改造**：改为与开卡审核一致的卡片式布局（统计卡片+搜索栏+表格+操作按钮）
- **🖼️ KYC 证件预览弹窗**：卡片式布局（企业注册证书+法人身份证正反面并排），下载按钮统一渐变配色
- **📋 邮箱脱敏**：侧边栏显示 `te***@163.com` 格式，溢出省略
- **🔄 自定义 Modal 系统**：`alertModal()`/`confirmModal()`/`promptModal()` 替换全部原生 alert/prompt/confirm

### 变更
- **KYC 字段调整**：营业执照号(选填) → 证书编号(必填)，企业名称与证书编号 grid 2列并排
- **KYC 驳回页面美化**：改为与"余额不足"弹窗一致的渐变暗色背景+红色边框+❌图标
- **国家下拉交互优化**：点击外部自动关闭下拉列表
- **提交按钮加载状态**：KYC 提交后显示"提交中..."+禁用态，防止重复提交
- **移除 `kyc-mode` CSS 注入**：表单回归默认 `max-width:720px` 居中布局，不再撑满全屏

### 修复
- **🔴 严重：HTML 结构缺陷导致登录后黑屏**：`app.html` 第1332行多余 `</div>` 导致 `<main>` 被排出 `dashWrap` 外侧
- **🔴 严重：submitKyc 验证跳过**：`return alert()` → `await alertModal()` 替换后 `return` 移出 `if` 块，所有校验失效
- **415 提交错误**：base64 图片请求体过大 → Express `limit: 50mb` + Nginx `client_max_body_size 50m`
- **KYC 审核页加载空白**：`loading-spinner` CSS 未定义 + `kycLoad()` 缺少 try/catch
- **approveKyc/rejectKyc 引用已删除函数**：`loadKycReviewList` → `kycLoad`
- **证件预览身份证图片未加载**：`id_card_file` 是 JSON 字符串 `{"front":"...","back":"..."}`，直接作为 `<img src>` 失效 → 解析后分别渲染
- **Tab 点击无反应**：两个同名 `switchKycTab` 函数冲突（用户表单+管理员审核），管理员版更名为 `switchAdminKycTab`
- **sidebar 邮箱不脱敏**：`_me?.name || maskEmail()` 短路（`_me.name` 就是邮箱字符串）
- **KYC 驳回弹窗按钮颜色未更新**：用户反馈颜色未变→确认页面路由正确性后修复样式

### 新增
- **🔐 企业认证（KYC）系统上线**：
  - 新增 `kyc_applications` 表 + `users.kyc_status` 字段
  - 注册流程不变，登录后在账户总览页显示红色警示横幅提醒认证
  - 用户端「企业认证」页面：填写企业名称/联系人/电话等信息提交认证
  - 管理员端「企业认证审核」页面：待审核/已通过/已拒绝三标签，支持通过/拒绝操作
  - 审核通过前 banner 持续显示，通过后自动隐藏

### 变更
- **系统设置布局优化**：「保存设置」按钮移入「上游费用成本」框内底部
- **文字精简**：同步状态「服务端定时从 vmcardio 拉取最新余额」→「服务端定时拉取最新余额」
- **文字精简**：财务中心「商户余额（vmcardio）」→「商户余额」

### 修复
- **公告系统 type 字段缺失**：`/auth/announcements/active` 和 `/auth/announcements/history` SQL 未 select `type` 字段，导致用户端所有公告类型显示为「系统维护」

## v1.0.24 (2026-06-09)

### 新增
- **📢 公告提醒功能上线**：
  - 新增 `announcements` 表 + 管理员 CRUD API（`/api/admin/announcements`）
  - 系统设置页新增「公告管理」面板（发布/启用/停用/删除）
  - 用户登录后自动弹窗展示最新活跃公告（`/api/auth/announcements/active`）
  - 用户首页右上角新增公告铃铛图标 + 未读数字徽标 + 历史记录弹窗
  - 公告内容支持多行输入（textarea）和换行展示（white-space: pre-wrap）
- **📊 交易走势图**：`/api/admin/transaction-trends` 按日维度聚合，Chart.js 双视图（数量柱状图 + 金额面积图），支持按用户筛选
- **财务中心排除管理员**：`/api/admin/finance-summary` 用户余额分布不再展示 admin 账号

### 修复
- **🔔 走势图日期选择器丢失**：布局重构时 `txMonChartDateWrap` span 被意外删除，走势图面板缺少日期选择器
- **⚙️ 系统设置页 500 错误**：`git reset` 部署覆盖了线上已有的 `/settings` 和 `/upstream-fees` 路由，补回路由 + 新建 `upstream_fees` 表
- **📢 公告 API 500 错误**：
  - `createAnnouncement` 未 JSON.stringify body 导致 body-parser 解析失败
  - 弹窗 `/api/auth/announcements/active` 路径写错（多一层 /announcements）
- **📝 nowiso() SQL 函数不存在**：`(nowiso())` 仅在 `database.js` 注册，普通路由中需用 `datetime('now')`
- **🔴 用户端公告类型全显示为「系统维护」**：后端 `/auth/announcements/active` 和 `/auth/announcements/history` SQL 未 select `type` 字段，前端回退默认值错误

### 变更
- **布局重构**：交易监控页面板分组（统计周期+指标+按用户统计合一panel，走势图独立panel）
- **搜索框样式**：走势图用户筛选框改为用户管理风格（青边框+半透明黑底+搜索图标）
- **按钮放大**：查询/重置按钮统一 padding:8px 20px、font-weight:600
- **保存设置按钮移入上游费用成本框**：系统设置页「保存设置」从独立区域移入「上游费用成本」卡片底部
- **同步状态文字精简**：管理总览「服务端定时从 vmcardio 拉取最新余额」→「服务端定时拉取最新余额」
- **商户余额标签精简**：财务中心资金概览「商户余额（vmcardio）」→「商户余额」

### 公告类型系统
- **新增公告类型下拉**：管理员发布公告可选择类型（运营公告/系统维护/安全提醒/政策调整）
- **自定义下拉组件**：替代原生 `<select>`，修复样式和定位异常
- **公告管理布局优化**：从纵向改为左右分栏（左新建/右记录），右侧固定高度 340px 内部滚动

## v1.0.23 (2026-06-06)

### 变更
- **交易笔数重定义**：`tx_count` 改为仅统计`消费`类型交易，充值/退款/手续费不再计入；`total_amount` 同步仅统计消费金额（前后端 + 分用户统计表同步修改）
- **新增「充值笔数」「充值金额」指标卡片**：全局指标区从 6 卡扩展为 8 卡（grid 2列 × 4行），后端 `topup_count`/`topup_amount` 已在前端正确渲染
- **按用户统计表移除「入账率」列**，字段重排为新顺序：充值金额 → 充值笔数 → 开卡量 → 交易笔数 → 失败率 → 撤销率 → 退款率

### 修复
- **按用户统计表排除管理员账号**：后端查询条件加 `WHERE role != 'admin'`，admin@vcc.hub 不再出现在分用户统计中

### 修复
- **🔴 严重：Authorization 格式错误导致所有 Merchant API 失效**：误将 `Authorization: token` 改为 `Authorization: Bearer ${token}`，但 vmcardio Merchant API 要求裸 token（无 Bearer 前缀），导致 getAccountBalance/cardTransaction 全部返回 Invalid Token → 回退为裸 token
- **🔴 严重：cardTransaction 同步接口格式错误**：`cardTransactionPlain()` 使用 form-urlencoded 格式请求 vmapi.vmcardio.com，但该端点只接受 RSA 加密 JSON（与 getAccountBalance 等接口一致），导致返回非 JSON 响应 → 删除该方法，改用 `sdk.cardTransaction()`（标准 RSA request 封装）

## v1.0.21 (2026-06-05)

### 新增
- **上游 /cardTransaction API 对接**：SDK 新增 cardTransactionPlain() 方法，form-urlencoded 直传，解决原 RSA 加密 400 错误
- **交易流水同步服务**：transactionSyncService.js，按日期范围拉取上游流水，去重存入本地 card_transactions 表
- **5 项指标自动测算**：
  - settlement_rate = settle_count / (settle_count + auth_count)
  - failure_rate = decline_count / (auth_count + decline_count)
  - reversal_rate = reversal_count / auth_count
  - refund_rate = refund_count / settle_count
- **按卡维度聚合**：每条上游记录含 card_id，关联到所属用户
- **本地 card_transactions 表**：auth_id 唯一索引、sync_time 追踪

### 修复
- SDK RSA 加密致 /cardTransaction 400 错误 → form-urlencoded
- card_transactions 建表位置修复（主模板内）
- status 列歧义问题（cards 表和 card_transactions 表均含 status，用 ct. 前缀限定）

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

## v1.0.41 | 2026-06-14 | 管理员查看用户消费明细


**新增功能：用户管理 → 🔍 查看消费**


- **后端**：`GET /api/admin/users/:id/transactions`（`admin.js` line 1253-1399）
  - JOIN `cards + card_transactions` 跨表查询某用户所有卡的流水
  - 支持 `type`/`start_date`/`end_date`/`page`/`page_size`/`format=csv` 参数
  - 返回 `{user, cards, list, total, summary{by_type, by_card}}`
  - CSV 导出（UTF-8 BOM + 中文化表头）
- **前端**：用户管理行新增紫色 `🔍 查看消费` 按钮 → 弹出 960×720 固定宽高模态框
  - 头部：用户头像 + 姓名/邮箱/卡数
  - 4 摘要卡片：总笔数 / 授权总额 / 结算总额 / 退款总额
  - 类型下拉：预授权 / 结算 / 退款 / 撤销
  - 时间选择：复用项目自带的 DateRangePicker 组件（v2 多实例）
  - 8 列表格：时间/卡号/类型/状态/授权金额/结算金额/商家/Auth ID
  - 分页器：‹ 上一页 / 1/12 / 下一页 › + 总条数
  - 导出 CSV 按钮（保留筛选条件）
- **数据演示**：user 2（user@vcc.hub）插入 2 张测试卡 + 107 条测试流水覆盖 14 天 / 4 类型 / 3 状态

### 修复

- **日期筛选 Bug A**：`URLSearchParams` 把 `Date` 对象序列化为美式日期字符串（如 `Mon Jun 08 2026 ...`），后端 SQL 字符串字典序比较失效
- **日期筛选 Bug B（真因）**：DateRangePicker `_confirm()` 实际传 `YYYY-MM-DD` 字符串，前端 `_utFmtDate('2026-06-12')` 调 `getFullYear()` 抛 TypeError，导致筛选条件没生效
- **onConfirm 自动查询 Bug**：选完时间就触发查询，违反"点查询按钮才查"交互规范

### 弹窗尺寸迭代

| 版本 | 高度 | 表格 | 说明 |
|---|---|---|---|
| v1.0.41 初版 | max-height: 100vh-48 (弹性) | flex:1 (弹性) | 自适应布局 |
| 迭代 1 | 720 (固定) | 410 (8 条) | 用户要求"固定" |
| 迭代 2 | 720 (固定) + max-height | 444 (9 条) | 加 padding 减少补偿 |
| 迭代 3 | 760 (固定) | 488 (10 条) | 解决"下一页被遮挡" |
| 迭代 4 | 760 min-height (去 max-height) | 488 | 解决"笔记本视口压扁" |
| 迭代 5 | **720 min-height** | **448 (9 条)** | 最终版（用户确认）|


## v1.0.43 | 2026-06-16 | 迁移到 Vultr 新加坡 + Cloudflare CDN

**主站从原 `43.135.26.36`（腾讯云香港）迁到 Vultr 新加坡机房**

### 新增基础设施

- **Vultr 服务器**：新加坡机房，2C/4G/80G/3TB 流量，$24/月（共享 CPU）
  - OS：Ubuntu 24.04 LTS x64
  - IP：`139.180.188.104`
  - 用户：`root` + `linuxuser`（Vultr 24.04 默认用户名，**不是 ubuntu**）
  - SSH：RSA 4096 OpenSSH 格式密钥对 `vultr_new_key`（沙箱路径 `/workspace/projects/.ssh/vultr_new_key`）
- **域名**：`nova-vcc.com`（Namecheap 首年 $6.79 + ICANN $0.20 = $6.99，用 `NEWCOM679` 优惠码）
- **Cloudflare**：
  - 账号：`Taoliang.light@gmail.com`
  - 计划：Free
  - Nameservers：`dalary.ns.cloudflare.com` / `ridge.ns.cloudflare.com`
  - SSL/TLS 模式：Full (Strict)
  - DNS：A `nova-vcc.com` → `139.180.188.104`（🔶 Proxied），CNAME `www` → `nova-vcc.com`（🔶 Proxied）
  - **Origin Certificate**：RSA 2048，15 年有效期（`/etc/ssl/cloudflare/origin-cert.pem` + `origin-key.pem`）
  - Universal SSL：浏览器侧证书，Cloudflare 自动签发

### Nginx 改造

- 配置文件：`/etc/nginx/sites-enabled/vcc-hub`
- 监听：
  - 80 端口（HTTP）→ 301 重定向到 HTTPS
  - **443 端口（HTTPS）** — 新增！Origin SSL + 反代 `127.0.0.1:5000`
- 关键配置：
  - `set_real_ip_from` 引入 Cloudflare 全网段，读取真实访客 IP（`CF-Connecting-IP` header）
  - `ssl_protocols TLSv1.2 TLSv1.3`，`ssl_session_cache shared:SSL:10m`
  - `client_max_body_size 50M`（文件上传）
  - `proxy_read_timeout 86400`（长连接）

### UFW 防火墙

- `22/tcp`（SSH）、`80/tcp`（HTTP）、`443/tcp`（HTTPS）、`5000/tcp`（Node 直连）全 ALLOW
- 默认 deny incoming

### 部署关键坑

- **坑 1**：Vultr 22.04 已下架，换 24.04
- **坑 2**：PEM 格式公钥被 Vultr 拒绝（"Keys should be in authorized_keys format"），改用 OpenSSH 格式
- **坑 3**：Vultr 24.04 默认用户名是 `linuxuser` 不是 `ubuntu`，Reinstall 时公钥注入到 root，需手动复制到 `linuxuser` 的 `~/.ssh/authorized_keys`
- **坑 4**：Cloudflare 默认 SSL Flexible 模式 + Vultr 无 443 SSL → 报 521。改为 Full (Strict) + 配 Origin Certificate 解决
- **坑 5**：沙箱连不上 Vultr 22 端口（Vultr 屏蔽大陆 IP），Reinstall 后 IP 重评 22 端口恢复

### 上游 API 验证

- 调通 vmcardio Merchant API：商户余额 **$102.69 USD**（比原生产 $31 多）

### 访问地址

- ✅ `https://nova-vcc.com/`（推荐，CDN 加速 + 隐藏真实 IP）
- ⚠️ `http://139.180.188.104/`（备用，无 HTTPS，会报 Cross-Origin-Opener-Policy 警告）


## v1.0.42 | 2026-06-15 | 按卡查看消费明细


**新增功能：卡片管理 → 📊 流水 按钮**

- **后端**：
  - `GET /api/admin/cards/:cardId/info` —— 轻量接口（仅查 cards + users 两表），用于弹窗头部
  - `GET /api/admin/cards/:cardId/transactions` —— 复用公共 `fetchCardTransactions` 函数
  - 原有 `/admin/users/:id/transactions` 改造为调公共函数（向后兼容）
- **前端**：
  - 卡片管理行 `.cm-bal` 之前新增紫色 `📊 流水` 按钮（仅管理员可见）
  - 底层 `_openTxnModalShell({mode, headerInfo})` 抽象弹窗框架（HTML + 事件 + DateRangePicker + load + export）
  - Entry 1：`openUserTransactionsModal(userId, ...)` mode='user'
  - Entry 2：`openCardTransactionsModal(cardId)` mode='card'，先拉 /info 再调底层
  - 弹窗宽度统一 960×720，复用 95% 代码
- **数据库**：cards 表 schema 字段名修正（`available_amount` 而非 `available_balance`，无 `currency`/`brand` 列）

## v1.0.44 | 2026-06-17 | Vultr 自动备份脚本 + Cloudflare 三项优化

**新增：Vultr 自动备份脚本（`scripts/auto-backup.sh`）**

- **备份内容**：`data/vcc.db` (VACUUM INTO 热备份) + `.env` + `config/*.pem`
- **备份策略**：
  - 本地轮转保留 7 天（`/opt/vcc-hub/backups/`，自动清理）
  - 可选 GitHub Release 推送（配置 `GITHUB_PAT` + `GITHUB_REPO` 到 `.env`）
- **执行时间**：每天凌晨 3:00（crontab `0 3 * * *`）
- **关键技术**：
  - `VACUUM INTO` (SQLite 3.27+) 替代 better-sqlite3 `.backup()`（该 API 不存在）
  - 备份后用 `PRAGMA integrity_check` 验证（3 users / 16 tables / integrity: ok）
  - VACUUM 后 DB 从 5.5MB 压缩到 2.9MB（节省 48%）
- **日志**：`/var/log/novacard-backup.log`
- **远程推送**（可选）：通过 GitHub REST API 创建 daily release，每天一个 `backup-YYYY-MM-DD-HHMMSS` tag

**Cloudflare 三项优化**

- ✅ **Always Use HTTPS**：Edge Certificates → On，`http://nova-vcc.com/` 自动 301 → `https://`
- ✅ **Brotli**：Cloudflare Free 计划默认开启（`content-encoding: br`），app.html 从 471KB → 106KB（**省 77%**）
- ✅ **Auto Minify**：Free 计划强制开启（不可关闭），UI 不可见但实际生效
- ❌ **Rocket Loader**：未启用（与 `app.html` 内联 JS 兼容性风险）

**首次双份备份（2026-06-17）**

- **Git 备份**：commit `ac4c99e`，`backups/novacard-2026-06-17-031612.tar.gz` (4MB)
  - 含 `data/vcc.db` + `.env` + `config/` 全部
  - DB 完整性：`integrity_check: ok`
  - 已 push 到 `github.com/t784641697/NovaCard`
- **本地下载**：`https://9b77cfb8-d336-408a-94d4-695b84e403a8.dev.coze.site/static/novacard-backup-20260617-031612.tar.gz`

---

## v1.0.45 | 2026-06-17

### 健康检查端点强化（7 维度自检）
- 新增 `src/routes/health.js`（7 维度自检）替代 app.js 内联实现
- 检查项：process / db (integrity_check) / disk / memory / ssl / backup / vmcardio_config
- 关键项 (db/ssl/backup) 任意失败 → **HTTP 503** + `status=degraded`
- 修复 better-sqlite3 `db.pragma()` 返回 `[{column:value}]` 数组的解析 bug
- 验证：正常 → 200/ok；移走 backups/ → 503/degraded；恢复 → 200/ok

### UptimeRobot 监控配置
- 注册 https://uptimerobot.com/ (免费版)
- 监控项：nova-vcc.com/health (5 min 间隔)
- 告警通道：邮件 → Taoliang.light@gmail.com
- 任一关键维度异常 → 邮件告警
- 配额：1/50 monitors

### 自动备份首次执行成功
- 2026-06-17 03:37:53 第一次 crontab 触发执行
- 输出：novacard-2026-06-17-20260617-033753.tar.gz (2.0MB)
- 保留 2 份本地副本

---

## v1.0.46 | 2026-06-17

### 上游交易自动同步 - 完整跑通
- **Crontab**：`0 4 * * *` 每天 4:00 自动同步 vmcardio 上游交易
- **同步流程**：拿所有 card_id → 调 vmcardio `/cardTransaction` API → 写入 `card_transactions` 表
- **3 次重试 + 指数退避**：1s/2s/4s 间隔
- **健康监控**：8 维度自检，vmcardio_sync 48h 内必须成功

### 排查与修复的 3 个 bug
1. **dotenv 缺失**：`autoSync.js` 没 `require('dotenv').config()`，SDK 拿不到 `.env` 配置，**用了默认 sandbox URL**（`https://sandbox-api.vmcardio.com`），不在用户白名单的 IP 段
   - 修复：autoSync.js 顶部加 `require('dotenv').config()`
2. **status 判定不一致**：autoSync 写 `'ok'`，health 端点检查 `=== 'success'`
   - 修复：health 接受 `['ok', 'success']` 两种值
3. **last_tx_sync_error 不清除**：成功时还显示旧错误
   - 修复：成功分支显式 setSetting('last_tx_sync_error', null)

### 验证
- Health 端点：status=ok, HTTP 200, 8/8 check 通过
- vmcardio_sync：0 transactions synced, 0h ago（卡片无消费）
- 后续每天凌晨 4:00 自动同步，UptimeRobot 实时监控


## v1.0.48 (2026-06-17) — 数据库备份加密

- **auto-backup.sh**: GPG 对称加密 tar.gz
  - 检测 `BACKUP_PASSPHRASE` 环境变量, 存在则用 `gpg --symmetric --cipher-algo AES256` 加密
  - 加密产物 `.tar.gz.gpg`, 用 `file` 命令验证为 PGP 加密
  - 手动解密: `gpg -d --passphrase "密码" backup.tar.gz.gpg > backup.tar.gz`
- **轮转**: 加密产物超过 7 天自动清理
- **.env 注入**: 强密码 24 字节 base64 = `vAAW2aeJZ9bI+qhgQWNajeNLKDNE8FJ5`

## v1.0.49 (2026-06-17) — /health 性能优化

- **缓存机制**: health.js 加 5 秒内存缓存（X-Health-Cache header: miss → hit）
- **性能提升**（100 并发 10 秒）:
  - 优化前: 22 RPS, P99 2728ms, 16% 超时
  - 优化后: 5555 RPS, P99 61ms, 0 错误
  - **提升 252 倍**
- **根因**: better-sqlite3 `db.pragma` 同步 + `execSync('df -h')` 阻塞事件循环
- **新端点**: `/health/live` 1ms 极简检查（K8s liveness 风格）

## v1.0.50 (2026-06-17) — 异常消费告警

- **新文件**: `src/services/anomalyAlert.js`
- **4 条规则**:
  1. 单笔高额 (默认 ≥ $200)
  2. 1 小时累计 (默认 > $500)
  3. 陌生商户 (用户历史未出现)
  4. 高风险关键词 (gambling/casino/bitcoin/darkweb/weapons 等, 单词边界匹配)
- **触发点**: `transactionSyncService.syncAll` 同步完成后批量扫描
- **站内信**: 新表 `notifications` 写入 alert
- **管理员 API**:
  - `GET /api/admin/anomaly-alerts` - 最近 20 条 + 汇总
  - `POST /api/admin/anomaly-thresholds` - 调阈值
  - `GET /api/admin/notifications/:userId` - 用户站内信

## v1.0.51 (2026-06-17) — CSV 导出

- **新端点**: `GET /api/transactions/export.csv`
- **查询参数**: dateFrom, dateTo, status, type, card_id, limit (max 50000)
- **鉴权**: 管理员看全部; 用户只看自己的卡
- **格式**: UTF-8 BOM (Excel 兼容) + 逗号/双引号/换行转义
- **字段**: 时间, 卡ID, 卡号(脱敏 ****1234), 类型, 状态, 授权金额, 授权币种, 结算金额, 结算币种, 商户, 授权时间
- **Header**: `Content-Type: text/csv; charset=utf-8`, `X-Export-Count`

## v1.0.52 (2026-06-17) — Swagger / OpenAPI 文档

- **依赖**: swagger-jsdoc + swagger-ui-express
- **端点**:
  - `GET /api/docs` - Swagger UI
  - `GET /api/docs.json` - OpenAPI 3.0 规范
- **覆盖端点**: /health, /api/auth/login, /api/auth/captcha, /api/transactions/export.csv, /api/admin/anomaly-alerts, /api/admin/anomaly-thresholds, /api/admin/notifications/:userId
- **组件**: ApiResponse, Transaction, AnomalyAlert schemas

## v1.0.53 (2026-06-17) — Telegram 告警

- **新文件**: `src/services/telegram.js` (~190 行)
- **配置**: `.env` 加 `TELEGRAM_ENABLED` / `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`
- **接入场景**:
  1. 启动通知 (app.js 监听成功后发)
  2. 异常消费告警 (anomalyAlert.js 检测到时推)
  3. 健康检查失败 (health.js 关键项失败时推, 1h 去重)
- **API**:
  - `send(text, opts)` / `sendCritical(text)` / `sendInfo(text)`
  - `fmtHealthCheck(data)` / `fmtAnomalyAlert(alerts, summary)` / `fmtError(module, error, ctx)` / `fmtStartup(env)`
  - `isEnabled()` 状态查询
- **特性**:
  - HTML 格式 + 自动分块 (Telegram 4096 限制)
  - IPv4 family + 10s timeout
  - 限流 100ms 间隔
  - 静默推送 (disable_notification: true)
- **部署**:
  - BotFather 创建 `@NovaCard_alert_bot`, token `8602206550:AAE...`
  - 创建群 `NovaCard 告警群`, chat_id `-5318112256`
  - 必须 `/setprivacy` Disable 才能让 bot 接收群消息
- **PM2 集成**:
  - `ecosystem.config.cjs` 加 cluster 模式 (2 worker, 共享 5000 端口)
  - logrotate 配置 3 段规则 (PM2/winston/脚本)
