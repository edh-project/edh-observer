# OBS-10 — Current Turn Statistics and Turn Window Summary

Status: FUTURE BACKLOG / DESIGN

## Problem

EDH currently exposes several useful but separate views:

- browser-observed CHAT turn lifecycle;
- local-agent progress and budgets;
- Run / Task lifecycle;
- Unified Timeline;
- attribution health over a recent 2-minute work-event window.

These are not the same thing as a compact summary of the current ChatGPT turn.

The label:

`Attribution coverage · healthy · 100% · 19/19`

only means that recent work events have conversation attribution. It does not represent:

- current turn progress;
- current turn tool-call count;
- completed vs running work;
- model calls;
- terminal processes;
- verifier progress;
- elapsed turn time;
- turn outcome.

The operator needs a first-class view answering:

> What has happened inside this turn, how much work has happened, what is still running, and what evidence is incomplete?

## Goal

Add a current-turn statistics object and Observer presentation that summarizes work from turn start through the current moment or final response.

Illustrative summary:

```text
Turn
02:51:42 -> 03:02:17
elapsed 10m35s

CHAT      2 events
MCP      31 calls
RDC      27 calls
TERM     14 processes
OC        1 session
QWEN      2 requests
LLAMA     2 inference windows

DONE      39
RUNNING    1
ERROR      0
UNKNOWN    2

Attribution 100%
Verifier 4/6 gates
```

## Current evidence sources

Today the data is fragmented across:

- `~/.local/state/execution-delivery-harness/browser-turn-state.json`
- append-only Observer event ledger
- RDC tool history
- local-agent state
- Run/Task lifecycle state
- prepared/detached execution state
- model/runtime observations

OBS-10 should aggregate these into one derived turn summary without replacing the raw evidence.

## Required metrics

Minimum useful dimensions:

- turn_id
- conversation_id
- started_at
- last_seen_at / ended_at
- elapsed_seconds
- turn state: ACTIVE / WAITING / DONE / STALE / UNKNOWN

Counts by actor/source:

- CHAT
- MCP
- RDC
- TERM
- ACTION
- OC
- QWEN
- LLAMA
- VERIFIER when available

Counts by outcome:

- STARTED
- RUNNING
- WAITING
- DONE
- ERROR
- CANCELED
- UNKNOWN

Optional when trustworthy:

- tool calls
- unique processes
- model requests
- inference windows
- verifier gates completed / total
- agent step budget used / max
- elapsed / deadline / remaining
- input/output token observations where actually available

## Semantics

Turn statistics are a projection, not authority.

Every metric must carry or inherit evidence quality:

- authoritative
- transport_observed
- browser_observed
- browser_inferred
- runtime_observed
- unavailable

Do not invent totals for hidden ChatGPT reasoning, hidden server-side tool calls, or unavailable billing/token usage.

Unknown must remain unknown.

## Relation to attribution health

Keep these distinct:

### Attribution health

Question:

> Of recent work events, how many can be scoped to a conversation/turn?

### Turn statistics

Question:

> Within this turn, what work has occurred and what is its current state?

A turn may have:

- 100% attribution coverage;
- incomplete terminal outcomes;
- unknown model usage;
- unfinished verifier work.

These must be visible simultaneously.

## UI direction

Possible Side Panel block:

```text
Current turn · ACTIVE · 04:12

Tools     18
Processes  6
Model req  1
Done      21
Running    2
Unknown    1

Attribution 100%
Completion evidence 95%
```

Expandable detail can show per-actor counts and exact evidence.

## Acceptance

OBS-10 is complete when:

1. current turn summary is computed from one bounded turn window;
2. counts are scoped to the correct turn_id;
3. attribution health is not mislabeled as task/turn progress;
4. running/done/error/unknown are distinct;
5. terminal unknown-completion rows contribute to UNKNOWN, not ERROR;
6. stale browser turn leases do not contaminate the current turn;
7. historical completed turns can be summarized using the same projection;
8. every aggregate can drill down to raw supporting events;
9. hidden/unavailable usage is shown as unavailable rather than estimated without labeling;
10. tests cover overlapping chats, stale leases, unscoped events and incomplete terminal completion.

## Related tasks

- OBS-04 causal provenance
- OBS-05 structured failures
- OBS-06 run progress
- OBS-07 semantic timeline
- OBS-09 terminal completion truth
- GW-01 authoritative pre-dispatch identity
- OBS-11 canonical turn causal tree

## Repository placement after transit

Likely Observer-owned projection with shared neutral summary schema only if another component consumes it.

Do not make the summary authoritative Core state.
