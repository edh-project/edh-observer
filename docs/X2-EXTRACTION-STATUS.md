# X2 — Observer Extraction Status

Status: **PASS CANDIDATE — clean-checkout proof pending**

Source baseline: `9ad516ef267fa18075ac15cc4abd78d8553c5122`  
Pinned contracts revision: `1ffb6a3f33f04c7e236966fab04164822c6d421f`

## Extracted public surface

- `chrome/**`
- `firefox/**`
- `scripts/run-observer.py`
- `scripts/firefox-smoke-live.mjs`
- `scripts/live-boundary-smoke.mjs`
- public Observer/browser tests
- public Observer boundary/acceptance documentation

Source remains copy-first and intact.

## Shared contract dependency

`contracts.lock.json` pins the local X1 contracts revision.

The standalone test suite verifies:

- exact contracts Git revision;
- required public contract files;
- X1 dashboard fixture envelope;
- actual Observer dashboard-envelope consumer acceptance.

Observer does not import Core source.

## Portability repairs

Removed old checkout/machine assumptions from runtime code:

- `DEFAULT_REPO` now uses `EDH_OBSERVED_REPO` with cwd fallback;
- `DEFAULT_ROOT` uses `EDH_RUNS_ROOT` with owner-local state fallback;
- `DEFAULT_COMMANDS` uses `EDH_COMMANDS_LOG` with owner-local state fallback;
- browser path compaction no longer knows Daniel's old checkout path or username.

CLI `--repo`, `--root`, and `--commands` remain available.

## Extension test split

Source `tests/extension.mjs` contained 121 test blocks.

Public Observer split:

- 116 Observer/browser test blocks retained;
- 5 runtime-owned blocks intentionally excluded because they directly inspect Core/runtime implementation:
  - model-usage implementation via `usage-telemetry.mjs`;
  - live-session wrapper implementation via `observable-session.mjs`;
  - local worker internals via `local-agent.py` (2 blocks);
  - Companion server internals via `server/index.mjs`.

The public split now passes without copying those runtime files.

## Firefox boundary

The old Firefox smoke directly imported `../server/index.mjs`.

The extracted `scripts/firefox-smoke-live.mjs` instead accepts only explicit runtime-boundary inputs:

- `EDH_COMPANION_BASE`
- `EDH_PAIRING_TOKEN`
- optional OAuth/MCP endpoint overrides
- optional packaged Firefox artifact override

A boundary test proves there is no Core import.

Full live Firefox interaction is intentionally not auto-run against production because it performs registration/consent/policy actions. It remains an explicit operator-authorized integration test.

## Live Companion boundary proof

Read-only live smoke against the running Companion succeeded without restart or mutation:

- health version: `0.1.51`
- authenticated dashboard endpoint: PASS
- dashboard schema: `1.0`
- executor policy observed: `AUTO`

The request shape matches the browser adapter, including `?adapter=chrome` and pairing Bearer auth.

## Local acceptance

Current standalone gate:

- `npm ci --ignore-scripts`: PASS
- `npm test`: **125/125 PASS**
- `npm run lint`: PASS, 0 errors / 0 warnings
- `npm run build`: PASS
- Firefox artifact: `dist/execution_delivery_harness_browser_bridge-0.1.51.zip`
- runtime dependency audit (`npm audit --omit=dev`): 0 vulnerabilities
- shipped code/test scan for old source/Core imports: clean
- built Firefox artifact scan for private Core/config material: clean
- source monorepo regression: **208/208 PASS**

The full dev-tool dependency tree currently reports vulnerabilities inherited through development tooling. These are not runtime dependencies and are not shipped in the extension artifact; do not apply a breaking `npm audit fix --force` during transit.

## Qwen adaptive-harness evidence

X2 produced two additional bounded Qwen task classes.

### test-fixture-decoupling

`~/WORK/_edh/_experiments/x2-qwen-test-fixture-v1/`

- 135.56 s
- 5 steps
- model tests 2/2 PASS
- independent verifier PASS

### code-adaptation

`~/WORK/_edh/_experiments/x2-qwen-code-adaptation-v1/`

Attempt 1:

- 4 sequential reads
- 0 writes
- Harness classification: `NO_PROGRESS`
- stopped early by watchdog

Targeted repair:

- compact relevant facts supplied
- bounded replace primitive required
- 4 steps
- 2/2 parser tests PASS
- independent verifier PASS

This is the first evidence-backed `failure -> execution-envelope adaptation -> PASS` cycle in LLM-04.

## OBS-08

`docs/OBS-08-LOCAL-INFERENCE-ACTOR-TRUTH.md` is carried into Observer as an explicit bounded remaining task.

X2 does not claim OBS-08 implementation complete. Its public-side semantics are isolated and acceptance-defined, so it does not block repository independence.

## Remaining gate

One gate remains before X2 can be declared PASS:

**clean-checkout independence proof** using only a clean `edh-observer` checkout plus the pinned `edh-contracts` checkout.

Required clean proof:

1. `npm ci`
2. `npm test`
3. `npm run lint`
4. `npm run build`
5. static Core/source coupling scan
6. contracts pin validation
7. package artifact inspection

No X3 work starts until this proof is recorded.
