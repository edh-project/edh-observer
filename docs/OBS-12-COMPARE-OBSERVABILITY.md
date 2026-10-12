# OBS-12 — COMPARE Observability

Status: POST-X4 / DESIGN

## Goal

Make execution policy and comparison evidence first-class in the Side Panel.

## Persistent operator control

Execution policy must be visible outside Ready handoff:

- AUTO — choose from versioned routing policy;
- EDH — force EDH local path;
- RDC — force intent-backed RDC path;
- COMPARE — create one symmetric paired experiment.

The control applies only to future eligible executions.

## Comparison summary

Compact card:

```text
COMPARE · cmp:123 · COMPLETE
EDH/Qwen PASS · 183s
RDC      PASS · 91s
Verifier PASS / PASS
Winner   none
[Inspect]
```

## Inspector

Two-column view for one comparison:

- result;
- elapsed;
- tools/actions;
- reads/writes;
- repairs;
- human/supervisor interventions;
- verifier;
- scope;
- context/token usage and evidence quality;
- changed paths/artifacts;
- failure/repair history.

Drill-down must reach both run bundles, verifier evidence, artifacts and raw events.

## History

Show durable comparison records and task-class grouping without inventing routing conclusions.

## Acceptance

1. policy selector always discoverable;
2. current/last comparison summary visible;
3. expanded inspector renders normalized record;
4. unavailable != 0;
5. every metric exposes provenance/quality;
6. raw evidence is reachable;
7. history can filter by task class/executor/result;
8. no routing recommendation is shown without ROUTE-01 evidence.
