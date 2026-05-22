---
name: nova-backup
description: NovaCard 项目完整备份到 GitHub 的专用 Skill；当需要对 NovaCard 全量项目做版本快照并推送到 GitHub t784641697/NovaCard 仓库时使用。
---

# Nova Backup

## 概述

将 NovaCard 项目（生产服务器 43.135.26.36）的**全部源码 + 数据库**完整备份到 GitHub 仓库 `t784641697/NovaCard`，作为版本管理手段，出问题时可通过 Git 回滚。

## 何时使用

- 用户说"备份"、"同步到git"、"推到github"、"保存版本"等
- 收到 NovaCard 相关的版本保存指令
- 开发关键功能前/后，打快照

## 工作方式

### 1. 备份范围

- **全部源码**: `src/`、`src/src/`、`vcc-dashboard/`、`config/`、`scripts/`
- **数据库**: `data/vcc.db`、`src/data/vcc.db`
- **配置文件示例**: `.env.example`、`.coze`、`package.json`
- **文档**: `AGENTS.md`、`DESIGN.md`、`README.md`
- **测试脚本**: `test-*.js`、`sync-*.js`、`fix-*.js`

**不包含**（已加入 .gitignore）:
- `node_modules/`（可 pnpm install 恢复）
- `.env`、`.env.backup`、`.env.bak`（敏感凭据）
- `config/*.pem`（RSA 私钥）
- `*.log`、`logs/`（运行时日志）
- `*.db-wal`、`*.db-shm`（SQLite 临时文件）

### 2. 版本命名规则

格式: `NovaCard-YYYY年MM月DD日_HHmmss-V版本号.db`

- 时间: 使用当前北京时间（UTC+8），格式 `YYYY年MM月DD日_HHmmss`
- 版本号: 从 `V1.0.0` 起始，每次递增末位（`V1.0.11` → `V1.0.12`）
- 当前最新版本: **V1.0.11**
- 数据库备份文件单独放在仓库根目录，源码直接 git 管理
- **Commit 标题格式**: `feat: NovaCard-YYYY年MM月DD日_HHmmss-V版本号 - 备份摘要`

### 3. 备份来源

- 生产服务器: `43.135.26.36`（SSH: ubuntu / System.error.9）
- 项目路径: `/opt/vcc-hub/`
- 运行中数据库: `/opt/vcc-hub/src/data/vcc.db`

### 4. 备份目标

- GitHub 仓库: `https://github.com/t784641697/NovaCard`
- 分支: `main`
- 全量项目直接提交到仓库

### 5. 执行步骤

1. 连接生产服务器 SSH（`43.135.26.36`，用户 `ubuntu`，密码 `System.error.9`）
2. 检查 .gitignore 确保敏感文件被排除
3. 全量添加: `git add .`
4. 提交: `git commit -m "feat: NovaCard-$(date +'%Y年%m月%d日_%H%M%S')-V版本号 - 备份摘要"`
5. 设置 remote URL（嵌入 token）
6. 推送: `git push origin main`
7. **重要**: 推送完成后清理 remote URL 中嵌入的 token

### 6. GitHub 认证

- 用户名: `t784641697`
- Token: 从对话上下文获取用户的 Personal Access Token
- 临时设置 remote URL 时嵌入 token，推送完成立即清除

## 注意事项

- **🛑 安全红线**: 推送完成后必须清除 remote URL 中的 token，不得泄露
- 推送前确认 git remote 存在，不存在则先添加
- 版本号从 `V1.0.9` 开始，每次递增末位（`V1.0.10` → `V1.0.11`……）
- 默认分支为 `main`，推送前确认分支名正确
- 如果之前 force push 清空过仓库，本地的 git 历史会与远程不一致，需重新 init 或 force push