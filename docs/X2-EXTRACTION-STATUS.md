# X2 — Observer Extraction Status

Status: **X2 PASS**

Source baseline: `9ad516ef267fa18075ac15cc4abd78d8553c5122`  
Pinned contracts revision: `1ffb6a3f33f04c7e236966fab04164822c6d421f`

## Result

EDH Observer is now independently buildable/testable from a clean checkout using only:

- `edh-observer`;
- the pinned `edh-contracts` checkout;
- normal Node/Python/Firefox build dependencies.

No source monorepo checkout and no private Core source are required.

## Extracted public surface

- `chrome/**`
- `firefox/**`
- portable `scripts/run-observer.py`
- `scripts/firefox-smoke-live.mjs`
- `scripts/live-boundary-smoke.mjs`
- public Observer/browser tests
- Observer boundary/acceptance documentation

Source remains copy-first and intact.

## Shared contract dependency

`contracts.lock.json` pins:

`1ffb6a3f33f04c7e236966fab04164822c6d421f`

Tests prove:

- exact contracts Git revision;
- required public contract files;
- X1 dashboard fixture envelope;
- actual Observer dashboard consumer accepts the recorded X1 fixture and rejects incompatible/missing envelopes.

Dependency direction remains:

`edh-observer -> edh-contracts`

No `edh-observer -> edh-core source` dependency exists.

## Portability

Historical machine/source assumptions were removed from shipped Observer code.

Portable inputs:

- `EDH_OBSERVED_REPO`
- `EDH_RUNS_ROOT`
- `EDH_COMMANDS_LOG`

CLI overrides remain available.

Browser path presentation no longer contains the historical checkout or owner username.

## Test-suite split

The source `tests/extension.mjs` contained 121 test blocks.

X2 retained 116 public Observer/browser blocks and deliberately excluded 5 runtime-owned tests that directly inspect:

- `usage-telemetry.mjs`
- `observable-session.mjs`
- `local-agent.py`
- `server/index.mjs`

Those tests belong with Core/runtime extraction rather than being satisfied by copying private implementation into Observer.

## Firefox runtime boundary

The historical smoke imported `../server/index.mjs`.

The extracted live smoke crosses only an explicitly supplied authenticated runtime boundary:

- `EDH_COMPANION_BASE`
- `EDH_PAIRING_TOKEN`
- optional OAuth/MCP endpoint overrides
- optional built add-on path

A static boundary test proves there is no Core source import.

The full live Firefox interaction is intentionally operator-authorized because it performs real OAuth/consent/policy actions. It is not auto-run against production during transit.

## Live Companion proof

Read-only live integration against the running Companion passed without restart or mutation.

Observed:

- Companion health: PASS
- running version: `0.1.51`
- authenticated `GET /bridge/dashboard-state?adapter=chrome`: PASS
- dashboard schema: `1.0`
- executor policy observed: `AUTO`

This proves the extracted Observer can consume the existing authenticated runtime interface without the Core source checkout.

## Local acceptance

Canonical Observer before clean-clone proof:

- `npm ci --ignore-scripts`: PASS
- `npm test`: **125/125 PASS**
- `npm run lint`: PASS, 0 errors / 0 warnings / 0 notices
- `npm run build`: PASS
- Firefox artifact: `dist/execution_delivery_harness_browser_bridge-0.1.51.zip`
- `npm audit --omit=dev`: 0 runtime vulnerabilities
- static Core/source coupling scan: clean
- built artifact private/Core material scan: clean
- source monorepo regression: **208/208 PASS**

The development-tool dependency tree reports 5 audit findings inherited through dev tooling. These are not runtime dependencies and are not shipped in the extension artifact. No breaking `npm audit fix --force` is authorized during transit.

## Clean-checkout independence proof

Proof workspace:

`/Users/dzzk/WORK/_edh/_experiments/x2-clean-checkout/`

Fresh local clones:

- Observer: `d5c2d56f50402b62d2fb0b44047c5e16a64915ac`
- Contracts: `1ffb6a3f33f04c7e236966fab04164822c6d421f`

The proof workspace contains no `_bridge-local-execution` source checkout.

Results:

- `npm ci --ignore-scripts`: PASS
- `npm test`: **125/125 PASS**
- `npm run lint`: PASS
- `npm run build`: PASS
- static Core/source coupling scan: empty
- packaged artifact suspicious/private path scan: empty

This satisfies the X2 clean-checkout independence gate.

## Qwen adaptive-harness evidence

### test-fixture-decoupling

`~/WORK/_edh/_experiments/x2-qwen-test-fixture-v1/`

- 135.56 s
- 5 steps
- 2/2 model tests PASS
- independent verifier PASS

### code-adaptation

`~/WORK/_edh/_experiments/x2-qwen-code-adaptation-v1/`

Attempt 1:

- 4 sequential reads
- 0 writes
- Harness classification: `NO_PROGRESS`
- watchdog stopped the run early

Targeted repair:

- compact relevant facts supplied;
- bounded replace primitive required;
- 4 steps;
- 2/2 parser tests PASS;
- independent verifier PASS.

This is the first recorded `structured failure -> execution-envelope adaptation -> PASS` loop in LLM-04.

## OBS-08

`docs/OBS-08-LOCAL-INFERENCE-ACTOR-TRUTH.md` remains an explicit bounded Observer follow-up.

X2 does not claim OBS-08 implementation complete. Its public-side semantics and acceptance are isolated, documented, and no longer a repository-independence blocker.

## X2 conclusion

**PASS**

The public Observer repository is independently buildable/testable/packageable, consumes a pinned public contract revision, reaches the existing Companion through authenticated runtime interfaces, contains no Core source dependency, and preserves source behavior through regression evidence.

Do not start X3 automatically.
