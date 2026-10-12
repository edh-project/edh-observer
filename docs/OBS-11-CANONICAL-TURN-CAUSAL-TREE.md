# OBS-11 — Canonical Turn Causal Tree

Status: FUTURE BACKLOG / DESIGN

## Problem

EDH can currently observe and partially correlate:

- browser CHAT turn lifecycle;
- MCP activity;
- RDC calls;
- TERM processes;
- local-agent/OpenCode activity;
- Qwen/llama.cpp activity;
- Run/Task lifecycle;
- verifier evidence.

But these are not yet represented as one canonical turn-scoped causal structure from user request to final answer.

Today some links are:

- authoritative;
- transport observed;
- browser observed;
- browser inferred from a single active turn;
- inherited by process identity;
- unavailable.

That is enough for useful timeline projection, but not enough to say:

> This exact user turn caused these exact tool/model/process actions and this final response.

## Goal

Represent one turn as an evidence-backed causal tree/graph.

Illustrative form:

```text
TURN
├── CHAT request
├── MCP span
│   └── RDC span
│       └── TERM process
├── QWEN request
│   └── LLAMA inference
├── VERIFIER
└── CHAT final
```

The tree must never imply causality merely from temporal overlap.

Every edge requires provenance.

## Canonical turn identity

A turn structure should carry at minimum:

- conversation_id
- turn_id
- started_at
- ended_at
- state
- source quality
- root request identity when observable
- final response boundary when observable

The long-term authoritative turn identity should be allocated before downstream execution when GW-01 is in the path.

Browser-observed turns remain valid evidence but are weaker than Gateway-owned identity.

## Node classes

Potential node types:

- CHAT_REQUEST
- CHAT_RESPONSE
- ACTION
- MCP_CALL
- RDC_INTENT
- RDC_TOOL_CALL
- TERM_PROCESS
- PTY_SESSION
- OPEN_CODE_SESSION
- MODEL_REQUEST
- INFERENCE_WINDOW
- TASK
- RUN
- VERIFIER_GATE
- ARTIFACT

This vocabulary should stay small and evidence-driven.

## Edge classes

Potential relations:

- CAUSED
- DISPATCHED
- CALLED
- SPAWNED
- CHILD_OF
- EXECUTED_BY
- VERIFIED_BY
- PRODUCED
- ATTRIBUTED_TO

Each edge should include:

- evidence source;
- source quality;
- timestamp;
- confidence/authority class if needed;
- reversible pointer to raw event(s).

Do not infer `CAUSED` from adjacency alone.

## Current reconstruction path

Before Gateway is authoritative, Observer may continue to reconstruct turn scope from:

1. browser TURN_START / TURN_ACTIVE / TURN_DONE;
2. one-active-turn temporal attribution;
3. explicit conversation_id / turn_id on Harness/RDC events;
4. process inheritance by process key;
5. model/runtime evidence.

These inferred edges must be labeled as inferred.

## Gateway future state

Once GW-01 owns routine pre-dispatch identity:

```text
CHAT turn
  -> Gateway turn root
      -> action/tool span
          -> executor intent
              -> process/model child spans
      -> verifier
  -> final response
```

At that point the turn tree can become substantially more authoritative.

Gateway does not need to own presentation. Observer renders the graph.

## Turn finalization

A complete turn should have an explicit finalization boundary when observable.

Possible close evidence:

- browser-observed response stabilization;
- Gateway final-response event;
- run/verifier completion plus response emission;
- timeout/stale lease fallback.

The tree must distinguish:

- completed;
- abandoned/stale;
- interrupted;
- response completed while background work continues;
- response unavailable.

## Raw -> grouped -> semantic reversibility

OBS-11 must preserve the existing principle:

```text
Raw events
  -> causal spans/edges
      -> grouped turn tree
          -> semantic summary
```

Any semantic tree node must be expandable back to exact raw evidence.

## UI direction

Possible Observer view:

```text
Turn 5a059439... · DONE · 4m21s

CHAT request
  ├─ MCP · read_file · DONE
  ├─ RDC · start_process
  │    └─ TERM pid=17950 · EXITED · outcome unknown
  ├─ QWEN request
  │    └─ LLAMA inference · DONE
  ├─ verifier · PASS
  └─ CHAT final response
```

Edge provenance should be inspectable:

- authoritative
- transport_observed
- browser_observed
- browser_inferred
- process_inherited

## Relationship to OBS-10

OBS-10 is the aggregate/statistics projection.

OBS-11 is the causal structure beneath it.

OBS-10 should eventually compute its metrics from the canonical turn graph where possible.

## Relationship to OBS-09

Unknown terminal completion must appear in the turn graph as an evidence gap:

`TERM EXITED · outcome unknown`

not as an invented failure.

## Relationship to PTY-01

Managed PTY sessions may become child nodes under TERM/agent execution and expose live terminal-state evidence without changing causal ownership.

## Acceptance

OBS-11 is complete when:

1. one turn can be rendered as an evidence-backed causal tree/graph;
2. every node maps to raw evidence;
3. every edge declares provenance/source quality;
4. temporal overlap alone never creates a causal edge;
5. browser-inferred attribution is visibly weaker than Gateway-owned identity;
6. process/model descendants retain parent provenance;
7. final response boundary is represented when observable;
8. incomplete/unknown outcomes remain explicit;
9. concurrent chats do not cross-link;
10. the tree can drive OBS-10 turn statistics without losing reversibility.

## Related tasks

- OBS-04 causal provenance/correlation
- OBS-06 run progress
- OBS-07 semantic timeline
- OBS-09 terminal completion truth
- OBS-10 current turn statistics
- GW-01 authoritative turn/tool correlation
- PTY-01 managed PTY sessions

## Repository placement after transit

Likely split:

- `edh-contracts`: shared causal node/edge/turn schema only if needed across repos;
- `edh-core`: authoritative turn/span identity and causal events it owns;
- `edh-observer`: graph reconstruction, inferred-edge labeling, projection and navigation.

Do not make Observer authoritative for causality it did not observe.
