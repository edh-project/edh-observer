# EDH Observer

EDH Observer is the public observability and operator-facing product for the Execution Delivery Harness.

## Repository role

Intended visibility: **PUBLIC**.

Observer owns:

- Chrome Side Panel and browser-facing integrations;
- Firefox extension/UI;
- causal, grouped and semantic timeline projections;
- actor activity/presence presentation;
- provenance and diagnostics;
- public event interpretation;
- Observer-focused tests and packaging.

Observer does **not** own authoritative Task, Run, Policy, Dispatch, Capability, or Verifier state.

Dependency direction:

`edh-observer -> edh-contracts`

Forbidden dependency:

`edh-observer -> edh-core source`

Repository boundary is not a new process/trust/network boundary. During transit, the browser continues to use the existing authenticated local Companion interfaces.

## Pinned contracts

The exact shared contract revision is recorded in:

`contracts.lock.json`

Current pin:

`1ffb6a3f33f04c7e236966fab04164822c6d421f`

For local development the default expected checkout is the sibling repository:

`../edh-contracts`

Override with:

`EDH_CONTRACTS_DIR=/path/to/edh-contracts`

## Standalone setup

Requirements:

- Node.js >= 22
- Python 3
- Git
- Firefox tooling only when running Firefox build/live smoke

Install:

`npm ci --ignore-scripts`

Validate:

`npm test`

Firefox package validation:

`npm run lint`
`npm run build`

The build artifact is produced under `dist/`.

## Portable Observer inputs

`scripts/run-observer.py` does not depend on the historical source checkout.

Optional environment defaults:

- `EDH_OBSERVED_REPO` — repository whose project/history state is projected;
- `EDH_RUNS_ROOT` — local run/evidence root;
- `EDH_COMMANDS_LOG` — command history source.

CLI `--repo`, `--root`, and `--commands` remain available.

## Live Companion boundary smoke

A read-only runtime integration check is available:

`npm run test:companion:live`

Inputs:

- `EDH_COMPANION_BASE` — defaults to `http://127.0.0.1:43119`;
- `EDH_PAIRING_TOKEN` — required.

The smoke reads `/health` and the authenticated revisioned `/bridge/dashboard-state?adapter=chrome` envelope. It does not restart or mutate the Companion.

## Firefox live integration smoke

`npm run test:firefox:live`

This is intentionally separate from normal standalone tests because it performs real browser/OAuth/consent/policy interaction.

Required:

- `EDH_PAIRING_TOKEN`
- a running Companion
- Firefox/geckodriver as appropriate
- a built extension artifact

Optional:

- `EDH_COMPANION_BASE`
- `EDH_OAUTH_ISSUER`
- `EDH_MCP_RESOURCE`
- `EDH_FIREFOX_ADDON`
- `FIREFOX_BIN`
- `GECKODRIVER_BIN`

Do not auto-run this against a production Companion without explicit operator authorization.

## Current transit status

See:

`docs/X2-EXTRACTION-STATUS.md`

Current local acceptance includes:

- standalone Observer tests;
- pinned contracts verification;
- recorded X1 dashboard fixture consumer validation;
- Firefox lint/build;
- static Core/source dependency scan;
- read-only live Companion boundary smoke;
- source monorepo regression.

OBS-08 remains an explicit bounded Observer follow-up:

`docs/OBS-08-LOCAL-INFERENCE-ACTOR-TRUTH.md`

## Migration provenance

`provenance.json` maps extracted/adapted units back to source commit:

`9ad516ef267fa18075ac15cc4abd78d8553c5122`

No public remote has been created yet.
