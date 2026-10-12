# X2 — Observer Extraction Result

Status: **X2 PASS**

## Frozen inputs

Source repository:

`/Users/dzzk/WORK/_bridge-local-execution`

Source commit:

`9ad516ef267fa18075ac15cc4abd78d8553c5122`

Pinned EDH Contracts revision:

`1ffb6a3f33f04c7e236966fab04164822c6d421f`

Observer checkpoint used for clean-checkout proof:

`d5c2d56f50402b62d2fb0b44047c5e16a64915ac`

## Independence result

A clean Observer clone plus the pinned Contracts clone passed:

- install: PASS
- tests: **125/125 PASS**
- Firefox lint: PASS
- Firefox build: PASS
- static Core/source dependency scan: clean
- packaged artifact private/Core scan: clean

The clean proof contained no source monorepo checkout.

Evidence workspace:

`/Users/dzzk/WORK/_edh/_experiments/x2-clean-checkout/`

## Runtime-boundary result

The extracted Observer performed a read-only live integration against the existing production Companion through the same authenticated browser boundary:

- `GET /health`: PASS
- `GET /bridge/dashboard-state?adapter=chrome` with pairing Bearer auth: PASS
- dashboard schema: `1.0`
- running Companion version observed: `0.1.51`

No Companion restart or mutation was performed.

## Contracts result

Observer consumes shared EDH definitions through `contracts.lock.json`.

The test suite validates:

- exact pinned Contracts revision;
- required contract files;
- X1 dashboard fixture;
- the fixture against the actual Observer dashboard-envelope consumer.

No Core source import is used to validate the contract.

## Browser/test split result

The source extension suite had 121 test blocks.

- 116 public Observer/browser blocks moved into the public suite.
- 5 implementation/runtime-owned blocks remain outside Observer because they inspect Core/runtime files directly.

The final standalone Observer test count, including new boundary/contract/portability tests, is 125.

## Firefox result

Firefox public packaging is independent:

- `web-ext lint`: 0 errors / 0 warnings / 0 notices
- `web-ext build`: PASS

The historical smoke's direct `server/index.mjs` import was replaced by an explicit authenticated live runtime boundary.

Full live Firefox OAuth/consent/policy interaction remains an explicit operator-authorized integration test and is not auto-run against production.

## Source regression

Source monorepo:

**208/208 PASS**

Copy-first extraction did not rewrite source runtime behavior.

## Local-model evidence

Two X2 bounded Qwen task classes contributed verified changes:

1. test-fixture-decoupling — PASS;
2. code-adaptation — first attempt stopped as `NO_PROGRESS`, targeted repair then PASS.

The final X2 gate is established by repository tests/verifiers, not by model self-report or quorum.

## Bounded remaining Observer work

`OBS-08 — Local inference actor truth` remains open and explicitly documented.

It does not block X2 because the Observer/Core/Contracts ownership boundary and acceptance semantics are isolated and the repository is independently functional.

## Dependency facts for X3

Core extraction must retain ownership of:

- Companion/server implementation;
- task admission authority;
- executor-policy authority;
- dispatch/process ownership;
- local-agent worker implementation;
- usage telemetry implementation;
- observable-session/runtime lifecycle implementation;
- verifier/PASS authority;
- capability grants and private evidence mutation.

The five runtime-owned source extension tests excluded from Observer are direct X3 test candidates.

Core must consume `edh-contracts` and must not import Observer source.

## Conclusion

**X2 PASS.**

X3 may now be specified from these dependency facts, but is not started by this result.
