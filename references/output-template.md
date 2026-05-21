# Output Template

> Root cause analysis and attribution validation rules are in `analysis-rules.md`. This file only specifies output format.
> Before output, complete the three attribution checks in `analysis-rules.md` (specificity, evidence strength, downstream jump sufficiency). Output only after all pass.

## Writing Rules

- Fixed order: `一、Conclusion`, `二、Customer Response`, `三、Root Cause Analysis`, `四、Input Information`, separated by `---`.
- When not fully closed, `Conclusion` must state "current best judgment (not fully closed)".
- `Conclusion` should not write exclusion-style preamble (e.g. "not an entry failure", "not a callback anomaly"). Directly answer "where did what fail". The evidence section can include exclusion reasoning.
- `Customer Response` should not contain internal system names, should not assign blame, should not expose internal investigation details. Give actionable suggestions based on failure type (timeout → retry later; review failure → change content and retry; system processing → recorded and processing).
- `Root Cause Analysis` defaults to 2-3 evidence items; expand to 4+ only for cross-project/multi-hop/unclosed chains.
- For review-type failures without clear violation segments, add `Possible risk segment` and note "not confirmed hit, only candidate risk point".
- `Input Information` — omit fields that are not available; truncate long text to 100 chars and note "truncated".

## Output Template

```markdown
### 一、Conclusion

<1-2 sentences summarizing the final root cause. Default structure: Task failed at <project/stage> due to <specific reason>. If not fully closed, add what key information is still missing. Do not write exclusions, do not restate the full chain, do not explain "where it didn't fail" first.>

---

### 二、Customer Response

<1-3 sentences for the customer-facing response, focused on "what the user should do next". Requirements: 1) Avoid technical jargon; 2) Clear actionable steps; 3) If retryable, suggest retry directly; 4) If content/text/audio/video review failed, suggest replacing the relevant content before resubmitting; 5) If only waiting for investigation is possible, state "We have recorded this and are processing it, please try again later".>

---

### 三、Root Cause Analysis

**Evidence 1**:
<List the core evidence that best supports the conclusion, such as specific error codes, error logs, chain hop information.>

**Evidence 2**:
<List supporting evidence, add or remove items as needed>

---

### 四、Input Information

**<User ID>**: <omit if not available>
**<Task ID>**: <omit if not available>
**<Other info>**: <extract input that helps analyze the anomaly, e.g. input image/video/audio URLs; truncate text over 100 chars>

---

Analysis time: <show analysis duration, e.g. 20 seconds, 2 min 05 sec>
```

## Mini Example

### 一、Conclusion

Task failed at the render stage due to an internal dependency timeout; logs confirm the timeout chain, but the specific dependency error was not captured.

---

### 二、Customer Response

This task failed due to a system processing timeout. Please try resubmitting later. If it still fails after multiple retries, please share the task ID for further investigation.

---

### 三、Root Cause Analysis

**Evidence 1**:
2026-03-20 15:24:45 / api: recorded `Task submitted successfully`, confirming entry submission was normal and not an access layer failure.

**Evidence 2**:
2026-03-20 15:26:16 / worker: received downstream failure callback, error code `Task.RenderFailed`.

---

### 四、Input Information

**Task ID**: `69bcf3b830eca0003094f125`

---

Analysis time: 1 min 20 sec
