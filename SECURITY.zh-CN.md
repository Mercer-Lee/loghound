# 安全策略

[English](SECURITY.md)

## 凭据管理

本工具连接云日志服务（阿里云 SLS、腾讯云 CLS、火山引擎 TLS）和可选的 MongoDB。**所有凭据必须存储在 `.env` 文件中**，该文件已通过 `.gitignore` 排除在版本控制之外。

### 最佳实践

- **绝不提交** `.env` 或 `config/projects.json` 到版本控制
- 使用**只读 API 密钥**，仅授予最低必要权限（如仅 `logs:GetLogs`）
- MongoDB 应使用**专用只读账号**并配置 IP 白名单，不要使用管理员账号
- 云厂商支持时，将 CLS/SLS API 密钥限制到**特定日志主题/项目**
- 生产环境建议使用密钥管理工具（Vault、AWS Secrets Manager 等）代替 `.env` 文件

## 报告漏洞

如果你发现本项目的安全漏洞，请通过 GitHub Issue 并标记 `security` 标签来报告。漏洞修复前请勿公开披露。

## 凭据泄露应急处理

1. **立即轮换**所有暴露的 API 密钥、Token 和密码
2. 检查云厂商访问日志，确认泄露窗口期内是否有未授权使用
3. 使用 `git filter-branch` 或 [BFG Repo-Cleaner](https://rtyley.github.io/bfg-repo-cleaner/) 清除 git 历史中的敏感数据
4. 开启分支保护规则，防止后续 `.env` 被提交
