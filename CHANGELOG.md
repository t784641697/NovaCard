
## v1.0.60-v1.0.69 | 2026-06-20~22 | 申请开卡提醒面板 + 卡段编辑模态框 UI 打磨

### 背景
v1.0.58 卡段管理上线后, 用户开卡页"使用说明"面板和 admin 编辑弹窗仍有 9 处细节问题, 全部用 10 个小 commit 修复打磨, 单独版本号.

### 🎨 用户端 申请开卡 提醒面板 (v1.0.60-67)

| 版本 | 改动 | 细节 |
|------|------|------|
| v1.0.60 | 提醒面板重排 | 卡段使用说明字段顺序调整, 适用平台从 tag 列式改为平铺式 (整行单行, 溢出横向滚动) |
| v1.0.61 | 模态框 label 文字明确化 | "适用平台" 标签去掉 "(用英文逗号分隔,留空=沿用 docx)", "自定义消息" → "管理员备注" |
| v1.0.62 | 模态框 label 括号说明弱化 | 副标题用 `<span style="color: var(--text3); font-weight: 400">` 弱化浅灰小字 |
| v1.0.63 | 删除两段提示文字 | "📋 docx 默认平台: Facebook, Google..." + "建议:Facebook, OpenAI..." 两行整段移除 |
| v1.0.64 | 模态框标题加地区 + 删 BIN 行 | "编辑卡段 · S5395YL" → "编辑卡段 · S5395YL · 🇭🇰 香港", 下方 "BIN: 539502 · 🇭🇰 香港" 行删除 |
| v1.0.65 | 模态框标题字体统一 | "产品 · 别名 · 地区" 三段同一 font-family/font-size/font-weight, 移除 monospace 弱化 |
| v1.0.66 | label 文字用 - 分隔 | "展示在用户申请开卡的适用平台" → "展示在用户-申请开卡-适用平台处" |
| v1.0.67 | 管理员备注行也平铺 | rows 数组加 `inline: true` + render template 抽 `inlineCls` 变量支持 `r.message + r.inline` 共存 |

### 🎨 管理员备注值 UI (v1.0.68-69)

| 版本 | 改动 | 细节 |
|------|------|------|
| v1.0.68 | 去引号 + 橙色 + 字体一致 | 普通用户端管理员备注值去掉外层双引号, 字体/字号与"适用平台"一致, 颜色用橙色 (`#f59e0b`) |
| v1.0.69 | CSS specificity 修复 | `.reminder-msg` 与 `.reminder-value-inline` 都是 (0,1,0) 同级后定义胜出导致不生效, 升级为 `.reminder-value.reminder-msg` (0,2,0) 强压 |

### 🧪 验证
- ✅ 提醒面板: 适用平台 + 管理员备注两行均单行平铺, 溢出横向滚动
- ✅ 管理员备注: 橙色 (#f59e0b) + 无引号 + 字体与适用平台一致
- ✅ 模态框: 标题三段统一字体, 副标题浅灰小字弱化
- ✅ 模态框: 删除 docx 默认平台 + 建议文字 + 下方 BIN 行
- ✅ CSS 优先级: `.reminder-msg` 升级后颜色正常生效

### 📁 涉及文件
- `vcc-dashboard/app.html` — 模态框 + 提醒面板 CSS/HTML/JS (主要改动)
- `CHANGELOG.md` / `UNIFIED.md` — 本次同步

---

## v1.0.77 | 2026-06-22 | 卡片充值弹窗 UX 优化 v2

### 用户反馈 v1.0.76 充值弹窗仍有问题
1. 数字输入框步长 0.01, 用户希望步长 100 (上下键 ±100)
2. 按钮 align 居中而非 flex-end
3. 按钮颜色用 var(--grad) 项目主色 (冰蓝→薰衣草紫→品粉), 而非 v1.0.76 的品红色
4. 弹窗右上角增加 X 关闭按钮

### 修复: promptModal 组件 3 个新参数

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `hideX` | bool | false | 隐藏右上角 X 关闭按钮 (默认显示) |
| `step` | number | 100 | number input 步长, 上下键 ±step |
| `okCenter` | bool | false | 按钮容器居中 (justify-content: center) |

### HTML 改造
- 内部 modal div 加 `position: relative` (X 绝对定位)
- 新增 `<button id="promptModalXBtn" onclick="promptModalCancel()">✕</button>`, top:12px right:12px, 32x32, font-size:1.25rem, color:#a6aabe
- 按钮容器加 ID `promptModalBtnWrap` (支持 okCenter 切换)
- `promptModalNumInput` step 默认改 100

### cmRechargeCard 充值弹窗 v2
```js
promptModal({
  title: '💰 卡片充值',
  desc:  '请输入充值金额，将从您的账户可用余额划转。',
  placeholder: '例：100',
  hideIcon: true,
  inputType: 'number',
  step: 100,                  // 步长 100
  hideCancel: true,
  okText: '立即提交',
  okColor: 'var(--grad)',      // 项目主色 (冰蓝→薰衣草紫→品粉)
  okCenter: true               // 按钮居中
})
// X 关闭按钮: 默认显示, promptModalCancel() 调用
```

### 设计原则
- **与项目其他主按钮色一致**: btn-primary 用 var(--grad), 充值按钮也用 var(--grad)
- **关闭入口多样化**: 已有 overlay 点击外部 + 新增右上角 X 按钮
- **步长适配业务**: 充值场景金额都是 100/200/500 这种整数, 步长 100 比 0.01 实用

### 兼容性
- hideX / step / okCenter 都有合理默认值, 旧调用方式不受影响
- 拒绝企业认证等场景会多出 X 关闭按钮 (合理升级, 不破坏使用)

### 文件
- `vcc-dashboard/app.html` (line 10155-10178 HTML + line 1592-1638 JS + line 4540-4556 cmRechargeCard)

---

## v1.0.76 | 2026-06-22 | 卡片充值弹窗 UX 优化

### 用户反馈
普通用户卡片管理点击"充值"后弹窗有问题:
1. 左上角"X"按钮实际是 ❌ emoji 图标, 容易被误认为 X 关闭按钮
2. 输入框是 textarea, 没限制只能输入数字
3. 按钮有两个(取消 + 确认), 用户希望只保留一个"立即提交", 用品红色
4. 文案需修改: "请输入充值金额（USD），将从您的账户余额扣款。" → "请输入充值金额，将从您的账户可用余额划转。"

### 修复方案: promptModal 组件参数化
不动 promptModal 整体结构(其他场景如拒绝企业认证也在用), 通过新增参数控制行为:

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `hideIcon` | bool | false | 隐藏头部 emoji 图标 |
| `inputType` | 'text'\|'number' | 'text' | 输入框类型 (textarea ↔ input number) |
| `hideCancel` | bool | false | 隐藏取消按钮 (单按钮模式) |
| `okText` | string | '拒绝并通知用户' | 确认按钮文字 |
| `okColor` | string | 蓝绿渐变 | 确认按钮颜色 |
| `cancelText` | string | '取消' | 取消按钮文字 |
| `icon` | string | '❌' | 头部图标 |

### HTML 结构改造
- 图标 div 加 ID `promptModalIcon` (支持 hideIcon)
- 新增 `<input id="promptModalNumInput" type="number">`, 默认 display:none (支持 inputType 切换)
- 取消按钮加 ID `promptModalCancelBtn` (支持 hideCancel)
- 确认按钮加 ID `promptModalOkBtn` (支持 okText + okColor)

### cmRechargeCard 调用
```js
promptModal({
  title: '💰 卡片充值',
  desc:  '请输入充值金额，将从您的账户可用余额划转。',
  placeholder: '例：100',
  hideIcon: true,
  inputType: 'number',
  hideCancel: true,
  okText: '立即提交',
  okColor: 'linear-gradient(135deg,#ec4899,#db2777)'  // 品红
})
```

### 兼容性
- 旧的 promptModal('title') / promptModal({title, desc, placeholder}) 调用方式完全兼容
- 拒绝企业认证等场景不受影响

### 文件
- `vcc-dashboard/app.html` (line 10122-10170 HTML + line 1588-1634 JS + line 4540-4554 cmRechargeCard)

---

## v1.0.75 | 2026-06-22 | 卡段 NEW 标签 (上游新出现卡段识别)

### 背景
上游卡BIN经常变化(移除/新增), admin 拉取卡段时无法快速分辨哪些是"我熟悉的" vs "新出现的"
需求: 滑动窗口追踪 - 拉取过的就标记"已见过", 之后再出现的才标 NEW

### 🏗️ 架构设计

#### 数据模型: 单行配置表
```sql
CREATE TABLE card_product_last_seen (
  id         INTEGER PRIMARY KEY CHECK (id = 1),  -- 单行表
  codes      TEXT NOT NULL DEFAULT '[]',          -- JSON 数组
  updated_at INTEGER NOT NULL                     -- ms 时间戳
);
```
- **单行表**：永远只有 id=1 一行, 维护"上次拉取的上游 product_code 列表"
- **last_seen 是事实数据**, 永远 DB 持久化
- **is_new 是派生数据**, 每次 API response 临时算, **不持久化**

#### 为什么独立表不放在 card_product_overrides?
- `last_seen` 是"系统观察"维度(记录历史)
- `overrides` 是"业务控制"维度(admin 设置)
- 重置 overrides 不应影响 last_seen
- 独立表可单独维护/导出/清理

### 📊 核心 service: src/services/cardProductSeenLog.js

```js
// 5 个 pure functions
getLastSeenCodes()                          // 读 codes 数组
setLastSeenCodes(codes)                     // 写 codes 数组
computeIsNewMap(currentList)                // 计算 {product_code: boolean} 派生 map
syncAndCompute(currentList)                 // 同步 last_seen + 算 is_new + 首次种子化
markAllAsSeen(currentList)                  // 手动 reset 接口
```

#### 首次部署种子化策略
- 首次部署时 `last_seen = []` (空)
- syncAndCompute 内部判断 `lastBefore.length === 0` → 走"首次种子化"分支
- 全部 is_new = false (admin 不会看到 17 个假 NEW 误判)
- 同时 setLastSeenCodes(currentCodes) 把当前 17 个记录下来
- 之后上游真新增的 1 个才会标 NEW

#### 滑动窗口语义
| 时刻 | upstream | last_seen | NEW 标记 |
|------|----------|-----------|----------|
| t1 (首次) | [A,B,C,D,E] | [] → [A,B,C,D,E] | 无 (首次种子化) |
| t2 (无变化) | [A,B,C,D,E] | [A,B,C,D,E] | 无 |
| t3 (上游 +F) | [A,B,C,D,E,F] | [A,B,C,D,E] → [A,B,C,D,E,F] | F 🆕 |
| t4 (无变化) | [A,B,C,D,E,F] | [A,B,C,D,E,F] | 无 (F 已在 last_seen) |

### 🌐 API 端点

| 端点 | 方法 | 鉴权 | 说明 |
|------|------|------|------|
| `/api/cards/meta/products` | GET | 公开 | **新增 is_new 字段**到每个产品, syncAndCompute 同步 last_seen |
| `/api/cards/meta/products?raw=1` | GET | 鉴权 | 只读 computeIsNewMap (不写 last_seen, 避免与主分支重复) |
| `/api/admin/card-products` | GET | admin | 响应增加 `is_new_map` 字段 |
| `/api/admin/card-products/reset-seen-log` | POST | admin | **新增** - 调 sdk.getProductCode 重新拉上游 + markAllAsSeen |

### 🎨 前端 (vcc-dashboard/app.html)

#### 产品列 NEW 徽章
- 绿色渐变 `linear-gradient(135deg, #10b981, #059669)` + 白色文字 + 圆角 4px
- `🆕 NEW` + tooltip "上游新增的卡段"
- 仅当 `p.is_new === true` 时展示

#### 重置基准按钮
- 位置: 搜索框旁 (清除按钮右边)
- 紫色调 `rgba(99,102,241,.15)` 背景 + `#a5b4fc` 文字
- 文本: `🔄 重置 NEW 基准`
- 点击 → confirm → 调 POST /admin/card-products/reset-seen-log → 重新加载

### 🐛 关键 bug 修复记录

#### Bug 1: admin/reset-seen-log 报 'set is not a function'
- 根因: service export 名是 `markAllAsSeen`, admin.js 调 `.set()`
- 修复: admin.js 改用 `markAllAsSeen(apiList)`

#### Bug 2: route 永远 is_new=undefined
- 根因: service 返回 `isNewMap` 数组, route 用 `isNewMap[item.product_code]` 当对象访问 → undefined
- 修复: service 改为返回 `{product_code: boolean}` object, route 用对象属性访问

#### Bug 3: ?raw=1 重复写 last_seen
- 根因: `?raw=1` 和主分支都调 syncAndCompute, 写 2 次
- 修复: `?raw=1` 改调 `computeIsNewMap` 只读不写, 主分支保持 syncAndCompute

### 🧪 端到端验证
- ✅ 17 个产品首次部署 → 0 NEW (首次种子化)
- ✅ 模拟上游新增 1 个 (last_seen 减 1) → `/meta/products` 1 个 NEW (`S5395YL`)
- ✅ 调 reset 接口 → 0 NEW, 17 个重新被记录
- ✅ 前端: 搜索框旁 "重置 NEW 基准" 按钮可见
- ✅ 前端: 产品列表正常显示 NEW 徽章

### 📁 涉及文件
- `src/db/database.js` — 新增 card_product_last_seen 表 DDL
- `src/services/cardProductSeenLog.js` — 新建, 5 个 pure functions
- `src/routes/cards.js` — `/meta/products` 主分支 syncAndCompute, `?raw=1` 改只读
- `src/routes/admin.js` — `/admin/card-products` 加 is_new_map, 新增 reset-seen-log
- `vcc-dashboard/app.html` — 产品列 NEW 徽章 + 搜索框旁重置按钮 + resetCardProductsSeenLog 函数
- `CHANGELOG.md` / `UNIFIED.md` / `AGENTS.md` — 本次同步

---

## v1.0.74 | 2026-06-22 | 申请开卡页 "可用卡段" 标题移除

### 改动
- 移除 `vcc-dashboard/app.html` 行 2811 处的 `<div style="font-weight:700">可用卡段</div>` 标题
- 同步把外层 `flex items-center justify-between mb-4` 简化为 `flex gap-2 flex-wrap mb-4`（删掉一个嵌套 div）
- 按钮区（全部/VISA/Mastercard/场景/国家）保持不变，仍在原位置单行排列

### 🧪 验证
- ✅ 标题文字已移除（生产页面 grep "可用卡段" 返回 0 匹配）
- ✅ 按钮区 3 个分类按钮 + 场景/国家动态按钮仍在
- ✅ 视觉上更简洁，按钮区贴左显示

### 📁 涉及文件
- `vcc-dashboard/app.html` — 移除 1 行标题 + 简化 1 个 div 嵌套

---

## v1.0.70-v1.0.73 | 2026-06-22 | 卡段场景配置 (新功能)

### 背景
申请开卡页场景搜索按钮(社交媒体/电商/AI订阅)原本是硬编码, 上游卡BIN变化时无法及时跟进, 管理员想新增场景(如"游戏"/"流媒体")也无法扩展.
v1.0.70 重构为 **平台-场景映射表 + 派生机制**: 管理员在线配置场景, 用户端按卡BIN的 `applicable_platforms` 字段派生匹配, 无需改代码.

### 🏗️ 架构 (v1.0.70)

#### 数据模型: 单表 JSON
```sql
CREATE TABLE scenario_mappings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_name   TEXT    NOT NULL UNIQUE,
  scenario_icon   TEXT    NOT NULL DEFAULT '',  -- emoji/图标
  sort_order      INTEGER NOT NULL DEFAULT 0,    -- 小的在前
  platforms       TEXT    NOT NULL DEFAULT '[]', -- JSON 字符串数组
  enabled         INTEGER NOT NULL DEFAULT 1,    -- 0/1
  updated_at      INTEGER NOT NULL,              -- ms 时间戳
  updated_by      TEXT    DEFAULT NULL
);
```

#### 匹配规则: 精确 + 大小写不敏感 (B 规则)
```js
// src/utils/scenarioMatcher.js
function matches(platform, keyword) {
  return String(platform).trim().toLowerCase() === String(keyword).trim().toLowerCase();
}
```

#### 派生逻辑
```js
// 后端 /api/cards/meta/products 调用 deriveScenariosForProduct(p, scenarios)
// 输入: product.applicable_platforms = ["Facebook", "OpenAI", "Amazon", "ChatGPT"]
// 输出: p.derived_scenarios = [
//   { id: 1, scenario_name: "社交媒体", scenario_icon: "🌐" },  // Facebook 命中
//   { id: 2, scenario_name: "电商", scenario_icon: "🛒" },      // Amazon 命中
//   { id: 3, scenario_name: "AI 订阅", scenario_icon: "🤖" },    // OpenAI/ChatGPT 命中
// ]
// 没匹配到任何场景: 派生结果空数组 → 前端用静态"待分配场景"灰标签展示
```

#### 数据流
```
管理员在卡段管理 → 编辑卡段 → 适用平台输入框 (复用 v1.0.58)
   ↓ 保存
card_product_overrides.applicable_platforms (DB)
   ↓ 读
/api/cards/meta/products 返回 p.applicable_platforms
   ↓ 派生
p.derived_scenarios = deriveScenariosForProduct(p, scenarios)
   ↓ 前端
用户端申请开卡场景按钮 + 派生结果联动过滤
```

#### 种子数据 (3 条)
| id | scenario_name | icon | sort_order | platforms |
|----|---------------|------|-----------|-----------|
| 1 | 社交媒体 | 🌐 | 1 | ["Facebook", "Twitter", "TikTok", "Telegram", "Discord", "Instagram"] |
| 2 | 电商 | 🛒 | 2 | ["Amazon", "AliExpress", "Shopify", "Walmart", "Alibaba", "eBay"] |
| 3 | AI 订阅 | 🤖 | 3 | ["OpenAI", "ChatGPT", "Claude", "Gemini", "Midjourney", "Anthropic"] |

#### API
| 端点 | 方法 | 鉴权 | 说明 |
|------|------|------|------|
| `/api/cards/meta/scenarios` | GET | 公开 | 列出 enabled=1 的场景, 返回基础字段 (id, scenario_name, scenario_icon, sort_order) |
| `/api/admin/scenarios` | GET | admin | 列出全部场景 (含 disabled + platforms) |
| `/api/admin/scenarios` | POST | admin | 新增场景 |
| `/api/admin/scenarios/:id` | PUT | admin | 更新场景 |
| `/api/admin/scenarios/:id` | DELETE | admin | 删除场景 |
| `/api/admin/scenarios/:id/toggle` | POST | admin | 启用/禁用 |

#### 前端
- **申请开卡页**: 场景按钮列表从硬编码 → 动态从 `/api/cards/meta/scenarios` 拉取, 配 icon + sort_order 展示
- **卡段管理页**: 新增 "场景配置" tab, 列出全部场景, 每个场景卡片: 名称 + 图标 + 关键词 + 开关 + 编辑/删除按钮
- **场景编辑弹窗**: 名称 (唯一) + 图标 (emoji) + 排序 + 关键词 (逗号分隔, 与卡段 applicable_platforms 完全匹配)
- **"待分配场景"标签**: 派生结果为空的卡段, 前端展示静态灰标签 "⚪ 待分配场景"

### 🐛 v1.0.71-73 关键 bug 修复

#### Bug 1: 场景筛选不生效 (v1.0.71)
- **症状**: 用户端点击"社交媒体"按钮, 没有匹配的卡BIN出现
- **根因**: `deriveScenariosForProduct` 返回字符串数组 `["社交媒体", "电商"]`, 但前端 `filterBin` 期望对象数组用 `s.id === sid` 比较
- **修复**: 改为返回 `[{ id, scenario_name, scenario_icon }, ...]` 对象数组

#### Bug 2: 管理员场景配置 tab 报 "api is not defined" (v1.0.71)
- **症状**: 卡段管理 → 场景配置 tab 加载失败
- **根因**: 5 处用了 `api()` 函数, 但项目里实际叫 `apiFetch(path, { method, body })`
- **修复**: 全部改用 `apiFetch`

#### Bug 3: "list.map is not a function" (v1.0.72)
- **症状**: 卡段管理 → 场景配置 tab 列表加载失败
- **根因**: 后端返回 `{ code, msg, data: { list: [...] } }` 嵌套结构, 但前端写 `resp.data || []` 拿到的是对象不是数组
- **修复**: 改为 `(resp.data && resp.data.list) || []`

#### Bug 4: DB override 后场景仍筛不到 (v1.0.73)
- **症状**: 管理员给 G5554LC 配置 `applicable_platforms = ["测试"]`, 启用 "测试" 场景, 用户端点 "测试" 按钮仍筛不到 G5554LC
- **根因**: `/api/cards/meta/products?raw=1` 分支在合并 DB override 时只覆盖 `applicable_platforms` 字段, 没有立即重算 `derived_scenarios`, 前端拿到的派生结果还是基于 docx metadata (错的空数组)
- **修复**: `listWithOverride.map` 内, 覆盖 `applicable_platforms` 后立即调用 `deriveScenariosForProduct(merged, scenarios)` 重算派生

### 🧪 端到端验证
- ✅ 3 个种子场景: 社交媒体🌐 / 电商🛒 / AI 订阅🤖, 按钮按 sort_order 排序展示
- ✅ 16/17 卡段正确派生场景, 1 个未分配 (G55184T) 显示 "⚪ 待分配场景"
- ✅ 管理员新增 "测试🎯" 场景 + 关键词 "测试" + G5554LC.applicable_platforms = ["测试"] → 用户端 "🎯 测试" 按钮可筛到 G5554LC
- ✅ 4 个 bug 全部修复: 场景按钮可点、配置 tab 可加载、嵌套 list 可解析、override 后派生正确

### 📁 涉及文件
- `src/db/database.js` — scenario_mappings 表 DDL + 3 条种子
- `src/utils/scenarioMatcher.js` — 4 个 pure functions (matches/deriveScenariosForProduct/deriveScenariosBatch/getMatchedScenarioNames)
- `src/routes/cards.js` — `loadScenarios()` + `/meta/scenarios` 公开接口 + `/meta/products` 派生逻辑
- `src/routes/admin.js` — `/api/admin/scenarios` CRUD API
- `vcc-dashboard/app.html` — 申请开卡页场景按钮动态化 + 卡段管理页 "场景配置" tab + 编辑弹窗
- `CHANGELOG.md` / `UNIFIED.md` — 本次同步

---

## v1.0.58 | 2026-06-19 | 卡段管理后台（管理员控制可用状态 + 适用平台编辑）

### 背景
- 之前卡段元数据（适用平台/限额/卡级别）只能通过 `assets/11111123.docx` 离线录入，管理员无法在线调整
- 管理员无法在不停服务的情况下临时关闭某个卡段（比如上游问题/风控）

### 新增能力
1. **可用开关** — 管理员可在线关掉某个卡段，普通用户开卡页对应卡片置灰 + "⏸ 暂不可用"遮罩 + selectBin 前置 alert
2. **适用平台编辑** — 管理员可覆盖 docx 默认平台列表（最多 50 个），普通用户开卡页 tag 实时展示
3. **自定义消息** — 管理员可对单个卡段加文案（如 "AI/Agent 专用"），普通用户开卡页看到

### 数据架构
- **新表 `card_product_overrides`**（自动建表，service 启动时）
  - `product_code PRIMARY KEY` / `available` (0/1) / `applicable_platforms` (JSON text) / `custom_message` / `updated_at` / `updated_by`
- **新 service `src/services/cardProductOverrideService.js`**
  - `get(pc)` / `listAll()` / `listAllWithMeta(apiList)` / `upsert(pc, patch, updatedBy)` / `remove(pc)` / `invalidate()`
  - **关键设计**: 每次都直查 DB（去掉内存 cache），因为 PM2 cluster 2 worker 进程间 cache 不共享会导致状态不一致
- **优先级链**（`src/routes/cards.js` 合并逻辑）
  ```
  DB override > HARDCODED business > docx metadata (from data/card_metadata.json) > upstream API
  ```
  - `?raw=1` 分支: 跳过 HARDCODED，但仍附加 docx metadata + DB override
  - 正常分支: 走完整 4 层链式合并，priority 降序排序

### API 端点
- `GET  /api/admin/card-products` — 列 17 个卡段 + docx 元数据 + DB override
  - 返回字段: `product_code/bin/network/media/issuing_area(标准化 code/name/flag)/remaining_open_card_num/docx_platforms/card_level/single_limit/daily_limit/available/applicable_platforms/custom_message/updated_at/updated_by`
  - **admin 端默认 `available=true`**（无 override 时）— 方便管理员看原始可写状态
- `PUT  /api/admin/card-products/:productCode` — 更新单个卡段 override
  - body: `{ available?: 0|1|true|false, applicable_platforms?: string[]|null, custom_message?: string|null }`
  - 校验: available 必须是 0/1/true/false / platforms 必须是数组元素非空且 ≤ 50 个 / custom_message 必须是字符串且 ≤ 500 字符
  - 返回更新后的 override 记录
- `DELETE /api/admin/card-products/:productCode/override` — 重置单卡段 override（恢复 HARDCODED/docx 默认）

### 前端 UI（`vcc-dashboard/app.html`）
- **侧边栏新增 "卡段管理"** 入口（emoji 🎴）— admin 角色才能看到
  - 位置: 在 "开卡审核" 之后
  - id: `nav-admin-card-products` / page: `admin-card-products`
- **管理页面** `renderCardProductsPage()`
  - 顶部说明卡片（绿色高亮：能力/优先级/影响范围）
  - 表格: 卡段 | BIN | 国家 | 状态（开关 toggle）| 平台预览 | 操作
  - 开关 toggle: 实时 PUT 调接口，失败回滚
  - 编辑弹窗 `openCardProductEdit(pc)`: 适用平台 textarea（逗号分隔）+ 自定义消息 textarea
  - 重置按钮 `resetCardProduct(pc)`: 仅在有 override 时显示，confirm 后 DELETE
- **用户端卡段卡片** `renderBins` 改造
  - 显示适用平台 tag (`.bin-platform-tag`)，最多 3 个 + "+N" 省略
  - 不可用时加 `.bin-card-disabled` class + `.bin-card-mask` "⏸ 暂不可用" 居中遮罩
- **用户端 selectBin 前置校验**
  - `if (p.available === false) { alert('该卡段已暂停开卡'); return; }`
  - 即使前端被绕过，**后端 POST /api/cards 也会重新检查 override**（cards.js 走完整合并链）

### 关键 Bug 修复（部署后才发现）
- **Bug 1**: admin.js 调 `cardProductOverrideService.getAll()`，但 service 导出的是 `listAll()` → 500
  - 修复: 改用 `listAll()` + `new Map(...map(...))` 构建索引
- **Bug 2**: PM2 cluster 2 workers 进程内 cache 不共享 → DELETE 后另一个 worker 仍命中 30s TTL 旧 cache，返回已删除的 override
  - 修复: **去掉 cache，每次直查 DB**（17 行配置性能可忽略）

### 影响范围
- ✅ **新申请**: 管理员设置即时生效（关掉后用户开卡页置灰不可点击）
- ✅ **已开卡**: 已开卡的 cards 表数据不受影响（override 只影响 /meta/products 返回的卡段列表）
- ✅ **历史数据**: docx 录入的 17 个卡段元数据继续作为 fallback（DB override 优先）

### 端到端验证
- ✅ GET 17/17 覆盖率（含 docx 元数据 16/17，G5554LC 缺数据）
- ✅ PUT 关掉 G5449LJ + 改平台 → user 端 3 次查询全部生效
- ✅ DELETE 重置 → user 端 5 次查询全部回到 HARDCODED/docx 默认
- ✅ 4 种校验 (available 非法/platforms 非数组/platforms 含空/msg 超 500 字符) 全部返回 HTTP 400

---

## v1.0.59 | 2026-06-20 | 卡段管理页打磨 + 关键 bug 修复（v1.0.58 后迭代）

### 背景
v1.0.58 上线后用户测试发现 3 个高优先级 bug + 8 处 UI 体验问题，本版本全部修复并上线。

### 🔴 关键 bug 修复
1. **登录转圈圈** (commit `2f680e6` / `87a9ab5`)
   - 孤立 `async` 关键字抛 `ReferenceError: async is not defined`
   - JS 引擎中断整个 `<script>` 块执行 → 登录响应处理函数未注册 → UI 永远不更新
   - **根因**：v1.0.58 早期改 `app.html` 时多写了一行 `async` 后面只跟注释
2. **"卡段管理"页点击空白** (commit `0df3d2c` / `40e2236`)
   - `renderCardProductsPage` 误用 `_mainContent.innerHTML` 但全局变量是 `contentArea`
   - 抛出 `ReferenceError` → 页面 DOM 未写入 → 用户看到空白
3. **PUT `/admin/card-products/:pc` 误清空 platforms/custom_message** (commit `655b89c`)
   - **根因**：admin.js 把没传的字段填成 `null` 传给 upsert，upsert 看到 `patch.applicable_platforms !== undefined` (是 `null` 不是 `undefined`) 就走"写入"分支，把 DB 旧值清空
   - **影响**：每次管理员点一下开关，用户之前在"适用平台/管理员备注"输入的内容就被清空
   - **修复**：admin.js 改为只把前端实际传的字段放进 patch，缺省字段不进 patch → upsert 走"保留原值"分支
4. **`</html>` 之后 JS 源码裸露** (commit `7078d24` / `2cb4091`)
   - 上一轮加 `gotoCardProductsPage` 时直接 `content.rstrip() + "..."` 拼到文件末尾
   - 浏览器把 `</html>` 之后的文本当 HTML 渲染 → 页面底部直接看到 `function gotoCardProductsPage(...)` 源码
   - **修复**：移到最后一个 `<script>` 块的 `</script>` 之前

### 🎨 UI/UX 收敛
1. **BIN 统一前 6 位** (commit `516ba40`)
   - 管理员"卡段管理"BIN 列 + 用户端"申请开卡"卡片 BIN 段都只显示前 6 位
   - 删掉 v1.0.19 的 12 位 `555671 / 544015` 拆双 BIN 显示
2. **列名中英化** (commit `82295b3`) — "Product Code"→"产品", "BIN"→"卡段"
3. **顶部说明精简** (commit `6cab2b0` / `c6bf803`) — 只保留"开关关闭"那一条
4. **移除"重置"按钮** (commit `1a82451`) — 开关本身就能重置
5. **用户端置灰 + 无 alert** (commit `1a82451`)
   - `.bin-card-disabled` 加 `pointer-events:none` 阻断点击
   - `selectBin` 删掉 `alert('该卡段已暂停开卡')`
   - 移除"⏸"图标
6. **编辑弹窗底色修复** (commit `c2dbc79`) — `var(--bg-card)` → `var(--bg3)` (项目内未定义 `--bg-card`，会 fallback 继承父元素 → 透明)
7. **Step 2 提醒面板加 2 行** (commit `a44e530`)
   - "适用平台"行（数据源 `p.applicable_platforms || p.docx_platforms`）
   - "管理员备注"行（数据源 `p.custom_message`）

### ✨ 新增能力
1. **卡段管理页搜索 + 分页 (10 条/页)** (commit `f28d013` / `e498dbf`)
   - 顶部加搜索框 + 清除按钮
   - 实时模糊匹配 产品代码 / 卡段(前6位) / 地区
   - 翻页器: «首页 / ‹上一页 / 第N/M页 / 下一页› / 末页»
   - 边界自动 disabled，搜索后自动回第 1 页
   - 总数 ≤ 10 时只显示「第 1 / 1 页」
   - 搜索无匹配时表格内显示"没有匹配的卡段 · 清除搜索"
2. **"适用平台"列固定 240px + 截断 + tooltip** (commit `5140ded`)
   - 表格加 `table-layout: fixed` 强制列宽生效
   - 每个 cell 最多显示前 3 个 tag + `+N more` 提示
   - 单个 tag `max-width: 120px; text-overflow: ellipsis` 防长名撑破
   - 容器 `display: flex; flex-wrap: nowrap; overflow: hidden`
   - `+N more` 用 `flex-shrink: 0` 保证不被裁
   - 鼠标悬浮 → 浏览器原生 `title` 显示完整列表
   - 三种 title 状态：①有 platforms ②沿用 docx ③未设置
3. **用户端开卡卡段卡片 hover tooltip** (commit `9095186`)
   - 同样的原生 `title` 体验
   - title 做了 `& " < >` 4 字符 HTML 转义防 XSS
   - 不可用卡段仍显示"该卡段已暂停开卡"（不冲突）

### 🧪 端到端验证
- ✅ 登录转圈圈 → 修复后 admin/user 都能正常登录
- ✅ 卡段管理页 → 17 个卡段正常显示 + 搜索 + 翻页
- ✅ 开关切换保留 platforms + message（线上 e2e：G55832SI 测 3 步全过）
- ✅ 标签悬浮 → 浏览器原生 tooltip 立即显示
- ✅ 不可用卡段 → 鼠标点击无反应，CSS `pointer-events:none` 生效
- ✅ `</html>` 之后无任何多余内容（`sed -n '/</html>/,$p'` 验证）

### 📁 涉及文件
- `vcc-dashboard/app.html` — 卡段管理页 + 用户开卡卡片 (主要改动)
- `src/routes/admin.js` — PUT 缺省字段不传 fix
- `CHANGELOG.md` / `UNIFIED.md` — 本次同步

---

## v1.0.57 | 2026-06-19 | 地区筛选项动态化（自动适配上游国家列表）

### 问题
- 之前"可用卡段"页面的国家筛选项是 4 个硬编码按钮（HK/UK/SG/US），上游新增国家时前端需要手动改代码

### 改动
- **HTML 容器替换**（`vcc-dashboard/app.html` line 2798-2802）
  - 移除 4 个硬编码 `<button id="countryHK/UK/SG/US">`
  - 改为 `<span id="binCountryFilters" class="flex gap-2 flex-wrap">` 动态容器
- **新增 `_extractCountries(list)`**（app.html line 2868）
  - 从 apiList 提取去重国家：`{code, name, flag}`
  - 用后端 normalizer 字段 `issuing_area_code/name/flag`
  - 按中文名 `localeCompare(zh-CN)` 排序
- **新增 `_renderCountryFilters()`**（app.html line 2883）
  - 动态渲染 button：`<button class="bin-country-btn" data-country="${c.code}" onclick="filterBin('country:${code}')">${flag} ${name}</button>`
- **`filterBin` 重构**（line 2892-2913）
  - 移除 `['HK','UK','SG','US'].forEach(...)` 硬编码
  - 改用 `document.querySelectorAll('.bin-country-btn').forEach(...)` 类选择器
  - 高亮逻辑改用 `querySelector('.bin-country-btn[data-country="..."]')` 属性匹配
- **`renderBins` 国家筛选简化**（line 2937-2941）
  - 移除 `{hk:'HK',uk:'GB',sg:'SG',us:'US'}` 映射表
  - 直接用 `p.issuing_area_code` 与 filter 中的 ISO 码匹配
- **`loadBins` 加调用**（line 2918-2929）
  - 拿到 `_productList` 后调用 `_extractCountries()` + `_renderCountryFilters()`
  - 取消缓存分支（每次都重新提取，简化逻辑）

### 验证
- 线上 `https://nova-vcc.com/api/cards/meta/products?raw=1` 返回 17/17 卡段
- 提取去重 4 个国家：🇸🇬 SG 新加坡 / 🇺🇸 US 美国 / 🇬🇧 GB 英国 / 🇭🇰 HK 香港
- 部署 commit `354e5e4`

### 扩展性
- 上游新增任意国家 → 前端**无需改代码**，自动出现在国家筛选项
- 命名用后端 normalizer 统一处理（中文名+emoji 国旗）

---

## v1.0.56 | 2026-06-19 | 卡段国家显示扩展性改造（country normalizer）

### 问题
- 之前前端硬编码 `COUNTRY_MAP` / `COUNTRY_FLAGS` 只覆盖 4 个全称（Hong Kong SAR / United States / United Kingdom / Singapore）
- 上游返回 "UK" / "USA" / "Hong Kong" 等缩写/自由文本时 → fall back 到原始字符串（出现"UK"和"香港"混用）
- 用户反馈：万一以后上游又出现其他不在映射表的国家怎么办，不够具备扩展性

### 后端方案（核心）
- **新建 `src/utils/country.js`**
  - `normalizeCountry(raw)` 函数输入上游任意字符串，输出 `{code, name, flag}` 标准字段
  - **第一步：ALIAS 兜底表**（只覆盖非 ISO 自由文本）：UK / USA / U.S. / Hong Kong SAR / Macao SAR / Taiwan / PRC / Great Britain / Singapore 等
  - **第二步：`Intl.DisplayNames(['zh-CN'], {type:'region', style:'short'})`** → 250+ ISO 国家自动短中文名
  - **第三步：ISO 字母偏移算法生成 emoji 国旗**（无需 emoji 映射表）
    ```js
    String.fromCodePoint(
      0x1F1E6 + code.charCodeAt(0) - 65,  // regional indicator A
      0x1F1E6 + code.charCodeAt(1) - 65   // regional indicator B
    )
    ```
- **`src/routes/cards.js` 集成**
  - `/meta/products` 正常分支：合并 HARDCODED 后用 `normalizeCountry` 包装
  - **`/meta/products?raw=1` 分支**：补加 `apiList.map(p => normalizeCountry(p.issuing_area))`
  - 顶部 require `const { normalizeCountry } = require('../utils/country');`

### 前端
- `app.html` `renderBins` 国家渲染
  - 移除硬编码 `COUNTRY_MAP` / `COUNTRY_FLAGS`
  - 改用后端标准化字段：`p.issuing_area_name || p.issuing_area || ''` + `p.issuing_area_flag || '🏳️'`

### Bug 修复
- **漏改 `?raw=1` 分支**：v1.0.56 第一次部署时只改了正常分支，前端调的是 `?raw=1` 所以用户看不到中文+国旗
- 用户反馈"无痕模式也一样"才定位到此 bug → 补改后重新部署

### 验证
- 19/19 单元测试通过（"UK"→"英国"🇬🇧 / "JP"→"日本"🇯🇵 / "US"→"美国"🇺🇸 等）
- 线上 `/meta/products?raw=1` 17/17 卡段都返回 `issuing_area_code/name/flag`
- 部署 commit `8ac2960`

### 扩展性
- 上游返回任何国家字符串 → 后端 normalizer 自动处理
- ALIAS 表只维护"非 ISO 自由文本"（UK/USA/Hong Kong 等），ISO 3166-1 全部由 `Intl.DisplayNames` 兜底

---

## v1.0.55 | 2026-06-18 | HARDCODED 精简为业务控制层（API 优先 + 业务覆盖架构）

### 🔴 重大架构调整
- **v1.0.19 误判修复**：上游 API 真实 product_code 仍是 G5554LC（不是 VC102），VC102 是上游后台界面改过名
  - admin.js 审批时传 'VC102' 给 API 会被拒绝（API 只认 G5554LC）
  - 改回 G5554LC 作为业务名，用 display_name=VC102 作为前端友好别名
- **HARDCODED_PRODUCTS 精简**：从 60+ 字段的「数据补全」改为「业务控制层」，只保留 4 个维度
  - `business.available`: 用户可申请（true=可选，false=灰显）
  - `business.featured`: 推荐标记（前端加 ⭐ 徽章）
  - `business.priority`: 排序权重
  - `business.custom_message`: 自定义文案
  - `display_name`: 友好别名（前端展示用）
- **数据来源分层**：
  - **基础数据层**（bin/network/type/media/issuing_area/remaining_open_card_num）→ 100% 来自上游 API
  - **业务控制层**（available/featured/priority/custom_message）→ HARDCODED 覆盖
  - 合并策略：API 优先 + HARDCODED 业务覆盖
- **新增调试接口**：
  - `?raw=1`: 跳过 HARDCODED 合并，返回上游 API 原始数据
  - `/api/cards/meta/products/upstream`: 永远返回上游原始数据
- **fallback 调整**：上游 API 失败时返回 503（不再用残缺的 HARDCODED 作为 fallback）

### 🐛 Bug 修复
- **admin.js approve 兼容性**：v1.0.19 误改名为 VC102 会导致开卡失败，改回 G5554LC
- **CDN/浏览器缓存**：之前 Vultr Nginx `Cache-Control: no-store` 已生效；前端 HARD refresh (Ctrl+Shift+R) 即可

### 📝 文档同步
- AGENTS.md v1.0.21 修复记录
- UNIFIED.md §21.7 卡段命名规则更新：业务名=G5554LC，显示名=VC102
- app.html 新增 PRODUCT_DISPLAY_NAMES 映射表（4 处展示用）


### 背景
- **G5554LC 是 sandbox 时期旧名**，正式环境上游后台 + API 已升级为 `VC102`（同名同 BIN 同功能）
- 上游 `getProductCode` API 仍返回 `G5554LC`，但上游管理后台显示产品编码为 `VC102`（更短更规范）
- G5554LC 的 `bin` 字段是 12 位 `555671544015`（**2 个 6 位 BIN 拼接**：555671 + 544015），其他 16 个卡段都是 6-8 位
- 上游明确标注："两个卡 BIN 随机分配（无法指定）"——taoliang 拿到的是 555671 段

### 改动（全栈联动）
- **`src/routes/cards.js` HARDCODED_PRODUCTS**：`product_code: 'G5554LC'` → `'VC102'`，新增 `legacy_product_code: 'G5554LC'`（保留旧名兼容）
- **`.map` 透传字段**：bins + legacy_product_code（之前 .map 白名单只 12 个字段，把拓展字段吞了）
- **`src/routes/admin.js` createCard 调用**：`app.product_code` 取自数据库（card_applications 表），用 VC102 即可（数据库里 1 条 VC113，无 G5554LC 实际数据）
- **`scripts/test_create_app.js`**：测试 product_code 改 VC102
- **`vcc-dashboard/app.html` 注释 + 品牌缩写**：G5554LC 引用全部更新为 VC102

### 前端显示优化
- **卡段列表 BIN 显示**：`formatBin()` 函数 — 12 位自动拆成 `555671 / 544015` 显示，加 `/` 分隔符
- **hover tooltip**：`BIN 段：555671（6位）` + `/（2 个 BIN 随机分配（无法指定））`
- **CSS** `.bin-code`：`font-size .7rem` + `letter-spacing -.3px` + `min-width 60px` + 居中 → 12 位不再视觉突兀
- **卡段详情 label**："卡段号" → "BIN 段（2 个 6 位，随机分配）"

### 数据库迁移
- **不需要**：当前 cards 表为空，card_applications 表只有 1 条 VC113（pending），无 G5554LC 实际数据

## v1.0.53 | 2026-06-18 | 卡片详情字段补全（限额单位修复 + 账单地址 + 持卡人）

### 修复
- `vmcardioSDK.cardDetail`：**拍平**上游嵌套结构 → 顶层字段
  - `limit.{single,day,month,total,remaining_*}_limit` → 顶层 `single_limit / day_limit / month_limit` 等
  - `card_address.{address_line_*, city, state, country, post_code}` → 顶层 6 个字段
  - 解决 admin.js line 1174-1176 读 `detail.single_limit` 始终 undefined 的 bug
- `cards.js GET /api/cards/:card_id`：合并 `localCard`（product_code / user_name / user_email）+ `detail`（实时），排除 `detail.user_name`（持卡人英文名）覆盖 `localCard.user_name`（用户真名）
- `cards.js GET /api/cards` 列表：SELECT 加 `single_limit, day_limit, month_limit`
- `admin.js approve`：审批时存 `single_limit / day_limit / month_limit`
- 前端 `fmtAmt`：限额单位**分→美元**（上游原始单位是分，UI 显示要 /100）；余额保持美元

### 行为变更
- **持卡人显示**：前端优先 `first_name + last_name` → 显示"tao liang"（这是**卡的**持卡人英文名，不是用户的真名）
- **账单地址**：上游 card_address 申请时**未要求填**，所有字段空 → 显示 `—`（需前端申请表单加账单地址字段才能解决）
- **一键复制账单地址**：账单地址是空字符串，复制了空（根因同上）

## v1.0.52 | 2026-06-18 | 卡片详情/流水全员可见 + 卡号/CVV/有效期补全

### 后端
- `vmcardioSDK.cardDetail()`：上游 `expire="MM/YY"` 字符串解析为 `expiry_month=MM, expiry_year=20YY` 数字
- `admin.approve`：审批通过后立即调 `cardDetail` 拉取真实卡号/CVV/有效期写入 `cards` 表（之前只存 `card_id`，用户看到 `**** **** **** ****` + 有效期 `—`）
- 兼容性兜底：cardDetail 失败不阻塞审批（仅记 warn log，admin 可后续单独同步）

### 前端
- 卡号显示：fallback 从 `**** **** **** ****`（4 段全掩码）改为 `**** **** **** 7240`（用 `card_id.slice(-4)` 后四位）
- "详情" / "流水" 按钮：从仅 admin 开放给所有用户
- 有效期渲染：优先用 `c.expire` 字符串（如上游同步过来），fallback `expiry_month/year` 拼成 `MM/YY`

### 数据修复
- taoliang 名下卡 `XR2067511181878833152`（v1.0.15 之前创建，cards 表里 `card_number/cvv/expiry` 全 0）→ 用新 SDK 重跑 `cardDetail` 补全：`card_number=5556710542357240, cvv=938, expiry_month=5, expiry_year=2029`

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
