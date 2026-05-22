# loghound

[中文文档](README.zh-CN.md)

Production incident investigation tool — multi-cloud log aggregation, signal extraction, and AI-driven root cause analysis.

Queries Alibaba Cloud SLS, Tencent Cloud CLS, Volcengine TLS, webhook-based workflow engines, and databases (MongoDB, SQL), then feeds normalized results into AI-driven root cause analysis.

## Setup

```bash
npm install
```

### 1. Configure credentials

```bash
cp .env.example .env
# Edit .env with your cloud credentials, webhook URLs, and database connections.
```

### 2. Define your projects

```bash
cp config/projects.example.json config/projects.json
# Edit config/projects.json to describe your services, log stores, and topology.
```

Key fields per project:
- `vendor` / `queryBackend`: Which cloud log service to use (`sls`, `cls`, `tls`, `webhook`)
- `envs.<env>.sources`: Log stores / topics to query, with architectural layer and purpose
- `downstream`: Which other projects this one calls (used for automated chain traversal)
- `keywords`: Words that identify this project in cross-project log mentions
- `taskPatterns`: `{type, regex}` pairs for taskId format recognition
- `multiEnvs`: If set, a single `--env` query expands across multiple env configs (e.g. multi-region prod)

### 3. Configure topology

Edit `references/call-graph.md` to describe your service topology, routing rules, and escalation paths.

## Scripts

```bash
# Query cloud logs
npm run fetch-logs -- --project my-service --env prod --query "someTaskId AND ERROR" --hours 24

# Query webhook-based workflow engine
npm run fetch-webhook -- --taskId xxx --json

# Look up record from MongoDB
npm run fetch-mongo -- --query 12345 --collection myCollection --lookup-field userNo --json

# Look up record from MongoDB (test environment)
npm run fetch-mongo -- --query 12345 --env test --json

# Look up record from SQL database
npm run fetch-sql -- --query someValue --json
```

## Architecture

```
User report (ID + symptoms)
  │
  ▼
┌─────────────────────────────────────────────┐
│  Script Layer                                │
│  fetch-logs / fetch-webhook / fetch-mongo      │
│  ├─ Query log sources in parallel            │
│  ├─ Normalize to unified schema              │
│  ├─ Extract signals (hard failures, errors)  │
│  ├─ Cluster & deduplicate logs               │
│  └─ Generate analysis hints                  │
└─────────────────────────────────────────────┘
  │ JSON output
  ▼
┌─────────────────────────────────────────────┐
│  Analysis Layer (AI)                         │
│  SKILL.md workflow                           │
│  ├─ Classify problem type                    │
│  ├─ Trace identifiers across services        │
│  ├─ Iterate downstream until root cause      │
│  └─ Generate customer-facing response        │
└─────────────────────────────────────────────┘
```

## Environment variables

### Cloud log services

| Variable | Purpose | Required by |
|----------|---------|-------------|
| `SLS_ACCESS_KEY_ID` / `SLS_ACCESS_KEY_SECRET` | Alibaba Cloud SLS | `fetch-logs` (SLS vendor) |
| `CLS_SECRET_ID` / `CLS_SECRET_KEY` | Tencent Cloud CLS | `fetch-logs` (CLS vendor) |
| `TLS_ACCESS_KEY_ID` / `TLS_ACCESS_KEY_SECRET` | Volcengine TLS | `fetch-logs` (TLS vendor) |
| `TLS_SESSION_TOKEN` | Volcengine TLS temp token | `fetch-logs` (optional) |
| `TLS_HOST` | Volcengine TLS endpoint | `fetch-logs` (TLS vendor) |

### Webhook

| Variable | Purpose | Required by |
|----------|---------|-------------|
| `WEBHOOK_API_URL` | Workflow query API endpoint | `fetch-webhook` |
| `WEBHOOK_ERROR_API_URL` | Workflow error detail endpoint | `fetch-webhook` (optional) |
| `WEBHOOK_TOKEN` | Auth token for webhook APIs | `fetch-webhook` |

### MongoDB

`fetch-mongo` connects via env vars; collection, lookup field, and return fields are passed per query via CLI flags.

| Variable | Purpose |
|----------|---------|
| `MONGO_URI` | Production MongoDB connection string |
| `MONGO_DB` | Production database name |
| `TEST_MONGO_URI` | Test environment MongoDB connection string |
| `TEST_MONGO_DB` | Test environment database name |

### SQL

`fetch-sql` connects via env vars; table, lookup field, and return fields are passed per query via CLI flags.

| Variable | Purpose |
|----------|---------|
| `SQL_HOST` / `TEST_SQL_HOST` | Database host |
| `SQL_PORT` / `TEST_SQL_PORT` | Database port |
| `SQL_USER` / `TEST_SQL_USER` | Database user |
| `SQL_PASSWORD` / `TEST_SQL_PASSWORD` | Database password |
| `SQL_DATABASE` / `TEST_SQL_DATABASE` | Database name |
| `SQL_DIALECT` / `TEST_SQL_DIALECT` | Database dialect (e.g. `mysql`, `postgres`) |

## Project configuration

`config/projects.json` defines each project's log sources, cloud vendor, environments, downstream services, and identifier patterns. See `config/projects.example.json` for the full schema.

## License

[MIT](LICENSE)
