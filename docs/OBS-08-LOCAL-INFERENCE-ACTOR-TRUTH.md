# OBS-08 — Local Inference Actor Truth

Status: OPEN
Workstream: Observer
Introduced from: X1 contracts A/B experiment and owner-supplied Side Panel screenshots

## Problem

The Side Panel can currently show contradictory local-inference state:

- `LLAMA BUSY` from llama.cpp `/slots` (`is_processing=true`);
- a gray LLAMA actor dot because `actor_activity.LLAMA=false`;
- tooltip text such as `known idle`.

Root cause: runtime activity and Harness-attributed activity are collapsed into one boolean actor-activity path.

Current implementation evidence:

- `llama_state()` reads `http://127.0.0.1:8080/slots` and reports slot BUSY/idle;
- `actor_activity.LLAMA` and `actor_activity.QWEN` depend on Harness spans or fresh `local-agent.json` with `model_busy=true`;
- direct bounded llama.cpp/Qwen execution paths can therefore be active while their actor dots remain gray.

Observed activity must not be erased merely because it is not attributed to an admitted Harness Run/Task.

## Required semantic separation

Represent these dimensions separately:

1. Runtime presence/reachability.
2. Positive observed runtime/model/agent activity.
3. Attribution/ownership to Run, Task, correlation, or agent chain.

Absence of attribution must not negate positive activity evidence.

## Actor truth rules

### LLAMA

Fresh llama.cpp `/slots` evidence with any `is_processing=true` slot is sufficient positive LLAMA runtime-activity evidence.

Required UI:
- LLAMA dot green while that evidence is fresh;
- status/tooltip says runtime activity is observed;
- when no Run/Task binding exists, say `unscoped` or `unattributed`, never idle.

### QWEN

QWEN lights only from fresh model-specific evidence, such as a current request/slot identifying `qwen3.8-27b` or a fresh QWEN span/event.

Do not infer QWEN solely because llama.cpp is busy if the active model is unknown.

### OC

OC lights only from actual OpenCode participation: live process/session, fresh OC span/event, or OpenCode-owned worker state.

A direct Python/other runner invoking Qwen/llama.cpp must not light OC.

## Implementation tasks

### OBS-08.1 — Split activity truth from attribution

Replace the overloaded actor boolean semantics with state sufficient to represent presence, activity, attribution scope/quality, evidence source, and freshness.

### OBS-08.2 — LLAMA runtime probe truth

Use llama.cpp slot processing state as direct positive LLAMA activity evidence. Do not require local-agent state or Harness correlation.

### OBS-08.3 — Model-specific QWEN evidence

Publish or derive fresh active-model identity. QWEN lights only when model-specific evidence exists.

### OBS-08.4 — OC participation truth

Use actual OpenCode process/session/span evidence. Preserve OC gray when inference bypasses OpenCode.

### OBS-08.5 — Tooltip/state wording

Eliminate contradictions such as `LLAMA BUSY · known idle`.

Expected forms include:
- `runtime active · attribution unscoped`
- `runtime active · Run <id>`
- `reachable · idle`
- `activity stale/unavailable`

### OBS-08.6 — Unified Timeline evidence

Local inference activity must appear as first-class timeline evidence independently of RDC polling noise. Preserve raw runtime/model source and timestamp; do not invent attribution.

### OBS-08.7 — Tests

Deterministic coverage must include:

1. llama BUSY + no local-agent state -> LLAMA active, attribution unscoped;
2. llama idle -> LLAMA inactive;
3. llama BUSY + known Qwen request -> LLAMA and QWEN active;
4. direct Qwen runner without OpenCode -> OC inactive;
5. real OpenCode/Qwen/llama chain -> OC/QWEN/LLAMA active with correct provenance;
6. stale evidence expires;
7. UI never combines BUSY with `known idle`;
8. missing attribution never suppresses fresh runtime activity.

## Acceptance

OBS-08 passes only when live acceptance proves:

- `/slots` `is_processing=true` makes LLAMA visibly active;
- identified Qwen inference makes QWEN visibly active;
- direct non-OpenCode Qwen execution leaves OC inactive;
- actor inspector exposes evidence source and attribution scope;
- Unified Timeline contains reversible raw local-inference evidence;
- no fresh BUSY evidence is rendered as `known idle`.

## Evidence

- `evidence/obs-08-x1-local-inference-visibility-20261012.md` — X1 A/B reproduction, actor-strip contradiction, runtime-vs-attribution analysis, and experiment artifact references.

## Repository transit

This task belongs primarily to future public `edh-observer`.

Any shared activity/provenance state shape consumed across repositories belongs in `edh-contracts`.

Authoritative Run/Task ownership remains in private `edh-core`; Observer must not manufacture it.