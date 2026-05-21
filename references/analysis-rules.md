# Analysis Rules

Read this file after log query is complete. Contains reasoning methods, root cause validation, stop conditions, and identifier strategies.

## 1. Core principles

- Querying logs is evidence collection, not a conclusion
- Do not equate "matched logs" with "found root cause"
- Distinguish facts from judgments:
  - Facts = log lines, timestamps, identifiers, status, layer, error message, downstream call records
  - Judgments = possible responsible party, possible failure stage, next hop, current best hypothesis
- Prefer clear evidence over plausible speculation
- State honestly when evidence is insufficient

## 2. Root cause criteria

Use the following terminology:

- **symptom**: What the user or upstream service sees (e.g. `task failed`, `callback error`, `Service.Error`)
- **ownership**: Which service boundary appears responsible
- **direct cause**: The immediately failing task or stage at the current hop
- **final root cause**: The first specific hard failure point that explains the entire chain end-to-end

### Hard failure signals (finding these means root cause is identified)

| Layer | Signal |
|-------|--------|
| Network/dependency | timeout, connection refused/reset, ECONNREFUSED/ECONNRESET/ETIMEDOUT, HTTP 5xx, DNS lookup failure |
| Business logic | Explicit errorCode (e.g. `Task.RenderFailed`, `ResultReview.NotPass`), error returned by downstream and recorded/propagated by this layer |
| Media processing | ffmpeg stderr/exit code 1, codec error, file not found, URL 403/404, invalid media format |
| Parameters/data | invalid parameter, validation failed, type mismatch, JSON parse error, malformed request |
| Resource layer | OOM, disk full, quota exceeded, rate limit exceeded, too many open files |
| Review/safety | `ResultReview.NotPass`, content violation flags, safety check failures |

### Non-root-cause signals (seeing these means continue drilling)

- Pure business status: `import failed`, `creation failed`, `processing failed`
- Upstream attribution: `call to xx failed`
- Pure ownership statement: `problem is in service X`, `downstream failed`
- Stage label only: `callback stage failed`, `render stage failed`

### Closure triad

The conclusion must answer all three:
1. **What**: The specific failure point
2. **Why**: Why it causes the user-visible problem (complete chain from failure to user perception)
3. **Where**: In which project/module/stage (with clear log evidence)

If any element is missing, must label as "current best judgment (not fully closed)".

## 3. Attribution validation checklist

### Check 1: Specificity

**Reject pseudo-root-cause statements**:
- "Downstream failed", "Call to xx failed", "Service error"
- "Import failed", "Creation failed", "Processing failed" (pure business status)
- "Problem is in service X" (pure ownership statement)
- "Callback stage failed", "Submit stage failed" (stage label only)

**Valid root cause must include**:
- Specific technical error (timeout/code:xxx/ffmpeg error/connection refused/parse failure)
- Clear failure object (which interface/which code/which file)
- Explainable propagation chain (why the user sees A when it actually happened at B)

### Check 2: Evidence strength grading

| Level | Type | Example |
|-------|------|---------|
| **Level A** (hard failure) | Clear ERROR + specific error message, status code/error code, resource layer failure | `HTTP 502`, `ECONNREFUSED`, `ffmpeg exited with code 1` |
| **Level B** (chain attribution) | Downstream failure callback, state transition record, cross-project identifier association | `Task.RenderFailed` callback, running→failed |
| **Level C** (supporting info) | Entry submission success, normal intermediate state, timeline evidence | `Task submitted successfully` |

Conclusion requires: at least 1 Level A evidence, or 2 Level B evidence corroborating each other. Only Level C evidence must not produce a definitive conclusion.

### Check 3: Downstream jump sufficiency

**Must continue tracking**:
- Current project only has "call to xx failed" without xx's specific error
- Error message is transparent from downstream (e.g. "reqServiceX | responseError | ...")
- Status is "downstream returned failure" rather than local failure

**Can stop**:
- Current project has clear local failure (timeout config, parameter validation, resource shortage)
- Downstream returned success but current project failed to process (callback handling, result parsing)
- Specific technical error found and chain is complete

## 4. Reasoning method

### Default workflow

1. Confirm starting project, identifier, symptoms, query string, time range
2. Read normalized hits in chronological order
3. Determine if current project has direct failure evidence
4. If not, extract the strongest next-hop clue and continue tracking
5. Only stop when closed loop or no stronger clues

### Responsibility attribution

**Current project is more likely responsible** (when multiple signals align):
- Core execution layer has clear local error
- Own queue/workflow/render/data stage has clear failure status
- Repeated retry or stuck state before confirmed downstream jump
- Logs stop within a critical stage of the current project

**Do not over-attribute**:
- Current project only transparently passes downstream failure text
- Error text explicitly references another system
- Only normal dispatch logs, no local failure
- Only WARN level noise

### Next hop selection (by priority)

1. Downstream service explicitly mentioned in logs
2. New identifier generated for downstream task
3. Known topology and decision matrix in `references/call-graph.md`
4. Capability-specific clues in reference files

### Stop conditions

**Can stop**:
- Final root cause confirmed: specific stage + specific mechanism + propagation path all clear
- Last confirmed stage is known, but no more clues
- Evidence too weak, need more data
- No new identifiers, no clear downstream jump, no stronger local failure signal

### Bad stop patterns (do NOT stop here)

- `Problem is in service X`
- `Callback failed`
- `Downstream failed`
- `Failed after stage Y`

These are stages or ownership judgments, not final root causes, unless the specific mechanism is also confirmed.

## 5. Identifier strategy

### Cross-service identifier mutation patterns

**traceId**:
- Within same service: unchanged
- Cross-service call: downstream generates new traceId
- Callback: may use new traceId
- Association method: find via uid + time range, or via taskId association

**taskId format recognition**:
- Configured per project in `config/projects.json` under `taskPatterns`
- Use these patterns to determine which project a taskId belongs to

**Prefer traceId**: cross-project traceId usually retains more complete context.

### Identifier exhaustion troubleshooting

**Scenario 1: identifier has no downstream records**
→ Extract sub-task identifiers and continue → Query by uid for concurrent failures → Determine downstream by task characteristics

**Scenario 2: Multiple traceIds that cannot be correlated**
→ Use timestamp as anchor to find all concurrent traceIds → Associate via uid + time range → Focus on callback events

## 6. Common attribution traps

| Trap | Description | Correct approach |
|------|-------------|-----------------|
| **Timeout = root cause** | Timeout is only a symptom | Determine if it's network/downstream load/timeout misconfiguration? Did downstream actually succeed? |
| **Transparent error = root cause** | "Downstream returned xxx error" ≠ root cause | Query downstream for real failure reason; confirm if it's genuine downstream failure or calling parameter issue |
| **Latest ERROR = root cause** | Most recent ≠ root cause | Sort complete chain by timeline; distinguish "primary failure" from "secondary failure/retry failure" |
| **Success status contradiction** | Logs show success but user says failure | Confirm identifier is correct; consider async callback delay/client cache; do not blindly trust either side |

### Common misreadings

- Matching an error string does not mean the current project is responsible
- Only matching API layer logs does not mean the task actually executed
- A data source having no logs might mean wrong time range, wrong environment, or need to jump to downstream
- Callback failure may occur after the core task has already succeeded
- A downstream service name appearing in logs is only a clue, not evidence — must actually query the downstream project
- If you can only say which service or stage failed but cannot say what specifically failed, closure is incomplete

## 7. Symptom credibility verification

When querying by user-provided identifier yields no hits or status contradictions:

1. Extract uid (via `npm run fetch-uid -- --userNo <id> --json`)
2. Query that uid's ERROR/WARN level logs in the last 24 hours
3. Identify the user's most recent actual failed task and failure reason
4. Confirm with user: is this the task they're reporting about?

## 8. Reference file routing

| Trigger condition | Load file |
|------------------|-----------|
| Need downstream jump rules or project context | `references/call-graph.md` (read in step 2, reference directly) |
| URL download failure/403/404, codec error, unsupported format, render failure suspected parameter issue, audio/video material anomaly | `references/analysis-media.md` |

## 9. Output conventions

When responding to user, follow `references/output-template.md`. Ensure coverage of:

- Whether final root cause is confirmed, or only current best judgment
- Current possible responsible party
- Current failure stage or last confirmed stage
- Strongest evidence
- If closure is incomplete, what clues to search next
- Customer-facing response text, telling the end user what to do next

### When closure is impossible

Do not force a definitive conclusion. State:
- What has been confirmed
- What has not been confirmed
- Where the chain currently stops
- What clues to search next
