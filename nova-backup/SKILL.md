---
name: nova-backup
description: NovaCard 项目数据库备份到 GitHub 的专用 Skill；当需要对 NovaCard 数据库做备份并推送到 GitHub t784641697/NovaCard 仓库时使用。
---

# Nova Backup

## 概述

将 NovaCard 项目（生产服务器 43.135.26.36）的 SQLite 数据库文件备份到 GitHub 仓库 `t784641697/NovaCard`，采用固定命名规则，避免每次都需要重新记忆配置。

## 何时使用

- 用户说"备份"、"同步到git"、"备份到github"、"保存备份"等
- 收到 NovaCard 相关的备份指令
- 要求记录当前版本快照

## 工作方式

### 1. 备份文件命名规则

格式: `NovaCard-YYYY-MM-DD_HHmmss-V版本号.db`

- 时间: 使用当前北京时间（UTC+8），格式 `YYYY-MM-DD_HHmmss`
- 版本号: 从 `V1.0.0` 起始，每次递增为 `V1.0.1`、`V1.0.2`……
- 当前最新版本: **V1.0.9**
- 示例: `NovaCard-2026-05-22_020419-V1.0.9.db`

### 2. 备份来源

- 生产服务器: `43.135.26.36`（SSH: ubuntu / System.error.9）
- 数据库路径: `/opt/vcc-hub/src/data/vcc.db`（运行中的数据库）
- 备份时从运行中的数据库拷贝，不备份 WAL 文件即可

### 3. 备份目标

- GitHub 仓库: `https://github.com/t784641697/NovaCard`
- 分支: `main`
- 备份文件直接放在仓库根目录

### 4. 执行步骤

1. 连接生产服务器 SSH（`43.135.26.36`，用户 `ubuntu`，密码 `System.error.9`）
2. 计算备份文件名: `NovaCard-{北京时间}_{版本号}.db`
3. 拷贝数据库: `cp /opt/vcc-hub/src/data/vcc.db /opt/vcc-hub/{filename}`
4. Git 提交 & 推送:
   ```bash
   cd /opt/vcc-hub
   git add {filename}
   git commit -m "backup: {filename}"
   git push origin main
   ```
5. **重要**: 推送完成后清理 remote URL 中嵌入的 token

### 5. GitHub 认证

- 用户名: `t784641697`
- Token: 从对话上下文获取用户的 Personal Access Token
- 临时设置 remote URL 时嵌入 token，推送完成立即清除

## 注意事项

- **🛑 安全红线**: 推送完成后必须清除 remote URL 中的 token，不得泄露
- 推送前确认 git remote 存在，不存在则先添加
- 版本号从 `V1.0.9` 开始，每次递增末位（V1.0.10 → V1.0.11……）
- 如果仓库之前被清空过（force push），需重新设置 remote
- 默认分支为 `main`，推送前确认分支名正确