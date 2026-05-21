# incident-investigator-generic

[English](README.md)

Claude Code 通用生产事故排查技能。

支持多云日志查询（阿里云 SLS / 腾讯云 CLS / 火山引擎 TLS）、Webhook 工作流引擎、用户身份查询，将标准化结果交给 AI 驱动的根因分析。

## 安装

```bash
cd skills/incident-investigator-generic
npm install
```

### 1. 配置凭据

```bash
cp .env.example .env
# 编辑 .env，填入云服务凭据、Webhook 地址和 MongoDB 连接信息
```

### 2. 定义项目

```bash
cp config/projects.example.json config/projects.json
# 编辑 config/projects.json，描述你的服务、日志存储和拓扑关系
```

每个项目的关键字段：
- `vendor` / `queryBackend`：使用哪种云日志服务（`sls`、`cls`、`tls`、`webhook`）
- `envs.<env>.sources`：要查询的日志存储 / Topic，包含架构层级和用途
- `downstream`：该项目调用了哪些其他项目（用于自动链路追踪）
- `keywords`：标识该项目的关键词，用于跨项目日志关联
- `taskPatterns`：`{type, regex}` 格式的 taskId 匹配规则
- `multiEnvs`：设置后，单次 `--env` 查询会扩展到多个环境配置（如多地域生产环境）

### 3. 配置拓扑

编辑 `references/call-graph.md`，描述你的服务拓扑、路由规则和升级路径。

## 脚本

```bash
# 查询云日志
npm run fetch-logs -- --project my-service --env prod --query "someTaskId AND ERROR" --hours 24

# 查询 Webhook 工作流引擎
npm run fetch-webhook -- --taskId xxx --json

# 查询用户 ID
npm run fetch-uid -- --userNo 12345 --json
```

## 架构

```
用户反馈（ID + 症状）
  │
  ▼
┌─────────────────────────────────────────────┐
│  脚本层                                      │
│  fetch-logs / fetch-webhook / fetch-uid      │
│  ├─ 并行查询日志源                            │
│  ├─ 标准化为统一格式                          │
│  ├─ 提取信号（硬故障、错误）                   │
│  ├─ 聚类去重日志                              │
│  └─ 生成分析提示                              │
└─────────────────────────────────────────────┘
  │ JSON 输出
  ▼
┌─────────────────────────────────────────────┐
│  分析层（Claude / AI）                        │
│  SKILL.md 工作流                              │
│  ├─ 分类问题类型                              │
│  ├─ 跨服务追踪标识符                          │
│  ├─ 迭代追踪下游直到定位根因                   │
│  └─ 生成面向客户的回复话术                     │
└─────────────────────────────────────────────┘
```

## 环境变量

| 变量 | 用途 | 使用者 |
|------|------|--------|
| `SLS_ACCESS_KEY_ID` / `SLS_ACCESS_KEY_SECRET` | 阿里云 SLS | `fetch-logs`（SLS） |
| `CLS_SECRET_ID` / `CLS_SECRET_KEY` | 腾讯云 CLS | `fetch-logs`（CLS） |
| `TLS_ACCESS_KEY_ID` / `TLS_ACCESS_KEY_SECRET` | 火山引擎 TLS | `fetch-logs`（TLS） |
| `TLS_SESSION_TOKEN` | 火山引擎 TLS 临时 Token | `fetch-logs`（可选） |
| `TLS_HOST` | 火山引擎 TLS 端点 | `fetch-logs`（TLS） |
| `WEBHOOK_API_URL` | 工作流查询 API 地址 | `fetch-webhook` |
| `WEBHOOK_ERROR_API_URL` | 工作流错误详情 API 地址 | `fetch-webhook`（可选） |
| `WEBHOOK_TOKEN` | Webhook API 鉴权 Token | `fetch-webhook` |
| `MONGO_URI` | MongoDB 连接串 | `fetch-uid` |
| `MONGO_DB` | 数据库名 | `fetch-uid` |
| `MONGO_COLLECTION` | 集合名 | `fetch-uid` |
| `MONGO_LOOKUP_FIELD` | 匹配字段 | `fetch-uid` |
| `MONGO_RETURN_FIELDS` | 返回字段（逗号分隔） | `fetch-uid` |

## 项目配置

`config/projects.json` 定义每个项目的日志源、云厂商、环境、下游服务和标识符模式。完整 Schema 参见 `config/projects.example.json`。

## 许可证

[MIT](LICENSE)
