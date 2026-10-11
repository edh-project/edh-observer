# X2 — Observer Extraction Status

Status: **X2 ACTIVE / PARTIAL**

Source code baseline: `9ad516ef267fa18075ac15cc4abd78d8553c5122`  
Pinned contracts revision: `1ffb6a3f33f04c7e236966fab04164822c6d421f`

## First extracted slice

Copied:

- `chrome/**`
- `firefox/**`
- `scripts/run-observer.py`
- `tests/observer-dom.mjs`
- `tests/observer-parser.mjs`

The source tree remains intact.

## Standalone test result

`node --test tests/observer-dom.mjs tests/observer-parser.mjs`

Result after fixture decoupling:

- 3 tests
- 3 PASS
- 0 FAIL

## Qwen experiment

Experiment:

`~/WORK/_edh/_experiments/x2-qwen-test-fixture-v1/`

Task class: `test-fixture-decoupling`

The initial standalone parser test exposed a hidden monorepo dependency: it called `project_trajectory(Path('.'))` and assumed the current repository already had Git history.

Qwen3.8 under the bounded adaptive harness replaced that assumption with a deterministic temporary Git fixture.

Result:

- runtime: 135.56 s
- 5 model/tool steps
- model-authored test run: 2/2 PASS
- independent verifier: PASS
- strong `commit_count >= 1` assertion preserved
- isolated `git init` + committed `TODO.md` fixture created
- no change to `run-observer.py`
- no second repair loop

The verified patch was then applied to this repository.

## Boundary findings

### Extension test suite is mixed

The source `tests/extension.mjs` is not safe for blind copying because it directly reads:

- `scripts/run-observer.py`
- `scripts/local-agent.py`
- `scripts/observable-session.mjs`
- `scripts/usage-telemetry.mjs`

Some of those are runtime/executor concerns. X2 must split Observer assertions from Core/runtime assertions rather than copy private implementation to satisfy tests.

### Firefox smoke is coupled to Core implementation

Source `scripts/firefox-smoke.mjs` imports:

`../server/index.mjs`

That is a direct Core-source dependency and cannot enter standalone Observer unchanged. The smoke harness must be rewritten against an authenticated runtime/fixture boundary.

### Source-specific path defaults remain

Current extracted Observer code still contains source-machine assumptions:

- `scripts/run-observer.py` has a hard-coded `DEFAULT_REPO` pointing at the old monorepo;
- `chrome/observer.js` contains source-path compaction for the old checkout.

These are X2 extraction seams, not reasons to copy Core.

The `local-agent.py` text occurrence in `run-observer.py` is currently process classification evidence, not a source import.

## Next bounded X2 seam

1. replace source-specific path defaults with explicit/configurable Observer inputs;
2. split `tests/extension.mjs` into public Observer tests vs runtime/Core tests;
3. replace Firefox smoke's `server/index.mjs` import with a fixture or authenticated runtime boundary;
4. add the pinned `edh-contracts` dependency/fixture validation;
5. rerun standalone package tests and static dependency scan.

X2 remains PARTIAL until clean-checkout independence is proven.
