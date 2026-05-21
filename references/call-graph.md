# Project Topology and Call Chains

Solves two problems:
1. Given a report, which project to query first
2. When the current project fails, which downstream to jump to

**This file is user-configured.** Replace the examples below with your actual service topology.

## Scenario Decision Table

Based on user source and task characteristics, determine the preferred project, full chain, and investigation focus:

| User source | Task characteristics | Preferred project | Full chain | Investigation notes |
|------------|---------------------|-------------------|-----------|-------------------|
| (source A) | (characteristic 1) | (project X) | A → X → Y → Z | (notes) |
| (source A) | (characteristic 2) | (project Y) | A → Y | (notes) |
| (source B) | (characteristic 1) | (project X) | B → X → Y | (notes) |

**When unable to determine task type**: Query the entry-point project based on user source, then determine downstream from task characteristics revealed in logs.

## Service Responsibilities

| Service | One-line responsibility | Downstream |
|---------|------------------------|-----------|
| (service name) | (description) | (downstream list) |

## Routing Rules

Fallback rules when the decision table doesn't match:

1. Prefer routing via the decision table's full chain
2. Entry-point first: if failure is only visible at the API layer, investigate within the current project before jumping downstream
3. Webhook special handling: after webhook accepts a task, follow downstream identifiers exposed in workflow logs
4. Capability-based routing:
   - (capability pattern) → (target project)
   - (capability pattern) → (target project)
