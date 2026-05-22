# Project Topology and Call Chains

Solves two problems:
1. Given a report, which project to query first
2. When the current project fails, which downstream to jump to

## Scenario Decision Table

Based on user source and task characteristics, determine the preferred project, full chain, and investigation focus:

| User source | Task characteristics | Preferred project | Full chain | Investigation notes |
|------------|---------------------|-------------------|-----------|-------------------|
| mtv console / app | API request error, slow request, timeout | mtv | mtv(api) → mtv(atomic) → effect/vidflow/vcr/kbase | Start from api-prod, check if atomic-basic responded; if timeout traceable to downstream, jump to that project |
| mtv console / app | Video render failure | mtv | mtv(queue-editor-render) → vcr → effect | queue-editor-render dispatches render tasks; check vcr for render errors |
| mtv console / app | AI agent / AI creation task | mtv | mtv(queue-ai-agent/ai-create) → effect → ai | AI features use effect for TTS/ASR/digital human, then ai for LLM |
| mtv console / app | Dubbing / TTS failure | mtv | mtv(queue-dubbing/tts) → effect | Dubbing and TTS are handled by effect service |
| mtv console / app | Digital human / figure failure | mtv | mtv(queue-figure-*) → effect | Figure-related features delegate to effect |
| mtv console / app | Live stream related | mtv | mtv(queue-live-*) → effect/vidflow | Live stream features span multiple queue workers |
| mtv console / app | Workflow orchestration failure | mtv | mtv(queue-workflow) → mtv(queue-dispatch) → downstream workers | Workflow orchestrates tasks; dispatch fans out to specific queue workers |
| mtv console / app | Media processing (upload/codec) | mtv | mtv(mediaservice) → saas-avinfo | Media upload and format processing; saas-avinfo for metadata/probe |
| mtv console / app | IP image generation | mtv | mtv(queue-ip-image) → effect | IP image generation delegates to effect |
| mtv webhook | Webhook callback failure | mtv | mtv(webhook) → mtv(queue-callback) → upstream service | Webhook receives external callbacks; queue-callback processes them |
| openapi | Open platform API failure | openapi | openapi → vidflow/effect/saas-avinfo | Open platform routes to downstream services directly |
| n8n workflow | Workflow task failure | n8n | n8n → effect → ai / n8n → vidflow → vcr | n8n orchestrates effect and vidflow; check which downstream the workflow targets |
| vidflow | Video mixing failure | vidflow | vidflow → effect/vcr/scenedetect/saas-avinfo | Vidflow mixes video; delegates rendering to vcr, effects to effect |
| vcr | Render/transcode failure | vcr | vcr → effect/saas-avinfo | VCR handles render and transcode; may call effect for post-processing |
| effect | AI effects failure (TTS/ASR/digital human) | effect | effect → ai/saas-avinfo | Effect is the AI effects hub; ai for LLM, saas-avinfo for media analysis |

**When unable to determine task type**: Query the entry-point project based on user source (mtv for most user-facing issues), then determine downstream from task characteristics revealed in logs.

## Service Responsibilities

| Service | One-line responsibility | Downstream |
|---------|------------------------|-----------|
| **mtv** | Main video production platform: API, queue workers, atomic services, media processing | kbase, effect, vidflow, saas-avinfo, vcr |
| **n8n** | Workflow engine: orchestrates multi-step tasks via webhook | effect, vidflow |
| **openapi** | Open platform API: external-facing API gateway | saas-avinfo, vidflow, effect |
| **vidflow** | Video mixing and composition | effect, vcr, scenedetect, saas-avinfo |
| **vcr** | Video render and transcode | effect, saas-avinfo |
| **effect** | AI effects: TTS, ASR, digital human, voice clone, AIGC | ai, saas-avinfo |
| **kbase** | Knowledge base: material management and retrieval | vidflow, vcr |
| **ai** | LLM inference service | — |
| **saas-avinfo** | Media metadata and probe service | — |
| **scenedetect** | Scene detection service | — |

## MTV Internal Layer Model

MTV is a monorepo-style project with many layers sharing one CLS topic set. Understanding the layer hierarchy is critical for investigation:

```
mtv-api-prod          [api]        → request ingress, auth, parameter validation
    ↓ calls
mtv-atomic-basic      [queue-common] → shared DB queries, user/space/order lookups
mtv-atomic-prod       [atomic]     → shared data processing, DB interaction
mtv-atomic-proxy-prod [atomic]     → proxy calls to external services
    ↓ dispatches to
mtv-queue-workflow    [workflow]   → workflow orchestration, multi-step task coordination
mtv-queue-dispatch    [dispatch]   → fan-out to specific queue workers
    ↓ fans out to
mtv-queue-*           [queue]      → individual async task workers (50+ workers)
    ↓ calls downstream projects
effect / vidflow / vcr / kbase / saas-avinfo
    ↓ receives callbacks
mtv-queue-callback    [callback]   → receives downstream completion/failure callbacks
mtv-webhook-prod      [webhook]    → receives external webhook callbacks
```

### Key API entry points

| API service | Purpose |
|------------|---------|
| mtv-api-prod | Main API: all user-facing requests |
| mtv-console-api-prod | Console API: admin/ops operations |
| mtv-api-auth-prod | Auth API: authentication and authorization |
| mtv-api-mktg-prod | Marketing API: marketing-related operations |
| mtv-channel-console-api-prod | Channel console: channel management |
| mtv-channel-admin-console-api-prod | Channel admin console |
| mtv-mediaservice-api-prod | Media service API: upload and media operations |

### Key queue workers by capability

| Capability | Queue workers | Notes |
|-----------|--------------|-------|
| Video editing | queue-editor, queue-editor-render, queue-editor-robot, queue-editor-twice-editing | Editor-related async tasks |
| AI agent | queue-ai-agent, queue-ai-create | AI assistant and AI creation |
| Dubbing/TTS | queue-dubbing, queue-common-dubbing, queue-tts, queue-audio | Dubbing and audio processing |
| Digital human | queue-figure-live, queue-figure-lip-sync-video, queue-head-figure, queue-channel-figure | Figure/digital human processing |
| Live stream | queue-live, queue-live-robot, queue-live-subtitle, queue-live-highlight, queue-live-clip-render | Live stream related |
| Video | queue-video, queue-template-video, queue-intelligent-video, queue-pic-speaks-video | Video generation |
| Document | queue-documents, queue-document-scene, queue-document-theme | Document processing |
| IP image | queue-ip-image, queue-preset-ip-image | IP image generation |
| Workflow | queue-workflow, queue-dispatch | Task orchestration |
| Callback | queue-callback, queue-open-callback | Downstream callback handling |
| Media | mediaservice, mediaservice-worker, mediaservice-api | Media upload and processing |

## Routing Rules

Fallback rules when the decision table doesn't match:

1. Prefer routing via the decision table's full chain
2. Entry-point first: if failure is only visible at the API layer, investigate within the current project before jumping downstream
3. Webhook special handling: after webhook accepts a task, follow downstream identifiers exposed in workflow logs
4. Capability-based routing:
   - API timeout/5xx with no downstream trace → investigate mtv internal (api → atomic-basic)
   - Render/transcode keyword → vcr
   - TTS/ASR/digital human/voice clone → effect
   - Video mixing/composition → vidflow
   - Media probe/metadata/codec → saas-avinfo
   - Scene detection → scenedetect
   - Knowledge base/material → kbase
   - LLM/AI generation → ai
5. When mtv API shows "请求:xxx 超时" → the mentioned internal service (e.g., backend-atomic-basic) is the timeout target; check queue-common logs for that traceId
6. When queue worker logs show downstream error with taskId → use that taskId to query the downstream project
