# incident-investigator-generic

Generic production incident investigation skill for Claude Code.

Queries multi-cloud logs (Alibaba Cloud SLS / Tencent Cloud CLS / Volcengine TLS), webhook-based workflow engines, and user identity stores, then feeds normalized results into AI-driven root cause analysis.

## Setup

```bash
cd skills/incident-investigator-generic
npm install
```

### 1. Configure credentials

```bash
cp .env.example .env
# Edit .env with your cloud credentials, webhook URLs, and MongoDB connection.
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

# Look up user ID
npm run fetch-uid -- --userNo 12345 --json
```

## Environment variables

| Variable | Purpose | Required by |
|----------|---------|-------------|
| `SLS_ACCESS_KEY_ID` / `SLS_ACCESS_KEY_SECRET` | Alibaba Cloud SLS | `fetch-logs` (SLS vendor) |
| `CLS_SECRET_ID` / `CLS_SECRET_KEY` | Tencent Cloud CLS | `fetch-logs` (CLS vendor) |
| `TLS_ACCESS_KEY_ID` / `TLS_ACCESS_KEY_SECRET` | Volcengine TLS | `fetch-logs` (TLS vendor) |
| `TLS_SESSION_TOKEN` | Volcengine TLS temp token | `fetch-logs` (optional) |
| `TLS_HOST` | Volcengine TLS endpoint | `fetch-logs` (TLS vendor) |
| `WEBHOOK_API_URL` | Workflow query API endpoint | `fetch-webhook` |
| `WEBHOOK_ERROR_API_URL` | Workflow error detail endpoint | `fetch-webhook` (optional) |
| `WEBHOOK_TOKEN` | Auth token for webhook APIs | `fetch-webhook` |
| `MONGO_URI` | MongoDB connection string | `fetch-uid` |
| `MONGO_DB` | Database name | `fetch-uid` |
| `MONGO_COLLECTION` | Collection name | `fetch-uid` |
| `MONGO_LOOKUP_FIELD` | Field to match against | `fetch-uid` |
| `MONGO_RETURN_FIELDS` | Fields to return (comma-separated) | `fetch-uid` |

## Project configuration

`config/projects.json` defines each project's log sources, cloud vendor, environments, downstream services, and identifier patterns. See `config/projects.example.json` for the full schema.
