---
name: incident-investigator-generic
description: Generic production incident investigation skill. When customer support or internal colleagues report a production issue, automatically query logs, trace identifiers across services, identify root cause, and generate customer-facing response. Requires taskId, traceId, requestId, uid, userId, or workflow taskId as a starting point. Not for broad queries without concrete identifiers or local debugging.
---

# Incident Investigator (Generic)

Use this skill for production incident investigation. The work is split into two layers:

- **script layer**: fetch and normalize evidence
- **analysis layer**: determine responsibility, failure stage, next hop, and the deepest specific failure point

## Default workflow

### 0. Problem definition and classification (must run first)

Before extracting identifiers, **determine user intent and problem type**:

| Problem type | Characteristics | Action |
|-------------|----------------|--------|
| **Fault investigation** | Explicit error code / failure status / user complaint | Enter standard investigation flow |
| **Quality issue** | Task completed but quality is abnormal (e.g. output not as expected) | Standard flow, but prioritize the service responsible for output quality |
| **Status query** | "Check...", "What's the status of...", "Confirm if completed" | Query and return status summary; do NOT generate customer response template |
| **Vague feedback** | "Something's wrong", "Not normal", "Help me check" with no specific symptoms | Ask for specific symptoms first |
| **Batch issue** | Multiple task IDs, "many users report" | Confirm if it's a common issue; if so, query the project's overall ERROR trend |
| **Audit query** | "When was this deleted", "Who operated", "Audit trail" | Query audit logs, not error logs |

**Only continue to standard analysis for fault investigation or quality issue types.**

### 1. Extract and normalize identifiers

**Identifier priority**: `traceId`/`requestId` > `taskId` > `uid`/`userId` > user-facing ID

**Identifier normalization**:
- **User-facing IDs** (e.g. account numbers): convert to internal uid first via `npm run fetch-uid -- --userNo <id> --json`
- **Workflow task IDs**: If format is `task_xxx`, strip `task_` prefix before querying
- **Webhook query limitation**: Webhook queries only support taskId, not uid. If the task characteristics point to a webhook-based project but no taskId is provided, ask for it

### 2. Read project topology to determine query path

**Must read `references/call-graph.md`** to understand service responsibilities, downstream relationships, typical call chains, and routing rules.

> **Note**: At this point the task type may still be unknown. Read the topology for the full picture first; task type is determined after seeing logs.

### 3. Query and trace

#### 3.1 First query

Use the primary identifier provided by the user and the preferred project determined in step 2. Filter: `<identifier> AND (ERROR OR WARN)`.

**Preferred project selection rules** (based on `call-graph.md` routing):
- Match task characteristics to the project responsible for that capability
- If unable to determine, query the entry-point project based on user source

#### 3.2 Environment parameters (globally applicable)

- Default `--env prod`
- User explicitly reports test environment issue → `--env test`
- Webhook-based projects do not need `--env` (no environment distinction)

#### 3.3 Fallback (uid reverse lookup)

**Trigger conditions** (any one):
- Query returns 0 hits
- Only INFO level logs, no ERROR/WARN
- User-described symptoms contradict log status

**Execution steps**:
1. Confirm uid (obtained via fetch-uid)
2. Time window: default 24 hours, expandable to 48 hours
3. Determine entry-point project based on user source
4. Query downstream projects in parallel
5. Filter: `<uid> AND (ERROR OR WARN OR FAIL)`
6. Take the most recent failure record as analysis starting point

#### 3.4 Downstream iterative tracing (auto-loop)

If current project logs show failure originated from downstream (e.g. "call to xx failed", "downstream returned error"):

1. Extract downstream identifier from current logs (taskId/traceId/requestId)
2. Determine next-hop project from `call-graph.md`
3. Query with new identifier
4. Repeat until stop condition is met:
   - Found specific hard failure point (concrete technical error + clear failure object)
   - No stronger clues and must stop at current best analysis
   - Downstream has no records and no association can be established

### 4. Analysis and attribution validation

- Read `references/analysis-rules.md` for reasoning methods and attribution validation
- Only read `references/analysis-media.md` when file-related anomalies appear (trigger: URL download failure/403/404, codec error, unsupported format, render failure suspected parameter issue)
- Determine if current project has direct failure evidence
- Distinguish symptom, ownership, direct cause, and final root cause
- If visible failure is only business summary or downstream attribution, keep tracing
- Only stop at the first specific hard failure point, or when no stronger clues exist
- Use `references/output-template.md` for response format

## Query strategy

### Basic query rules

- Default first query: `<identifier> AND (ERROR OR WARN)`
- Fallback when no valid hits: `<identifier>` (remove level filter)
- Use identifiers that work across projects: `taskId`, `traceId`, `requestId`, `uid`, `userId`
- Only add narrower conditions (layer, source, event, business keyword) after broad identifier search is insufficient
- Default query window: 7 days (168 hours); uid reverse lookup uses 24-48 hours

### Result processing priority

1. ERROR records with clear error messages (e.g. `Invalid character`, `codec error`)
2. Records with failure status (e.g. `Task.Failed`, `processing failed`)
3. WARN level retry/exception records
4. INFO level normal flow records (ignore)

## Query entry point

Use `scripts/fetch-logs.js`.

## Reference files

**Required reading** (in order):
1. `references/call-graph.md` — project topology (user-configured)
2. `references/analysis-rules.md` — analysis rules
3. `references/output-template.md` — output format

**Read as needed**:
- `references/analysis-media.md` — file/media failure rules

## Examples

```bash
cd skills/incident-investigator-generic
npm run fetch-logs -- --project my-service --query 'someTaskId AND ERROR' --env prod --json
npm run fetch-webhook -- --taskId xxx --json
npm run fetch-uid -- --userNo 12345 --json
```

## Constraints

- Querying logs is evidence collection, not a conclusion
- Do not treat script output as the final root cause conclusion — it is input for AI analysis
- Keep user-visible output consistent with `references/output-template.md`
