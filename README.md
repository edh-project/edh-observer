# EDH Observer

EDH Observer is the public observability and operator-facing product for the Execution Delivery Harness.

## Intended visibility

Public.

## Responsibilities

The repository is intended to contain public observability surfaces and browser-facing integrations such as:

- Observer UI
- Causal and semantic timeline views
- Actor presence
- Provenance presentation
- Diagnostics
- Chrome Side Panel
- Firefox extension/UI
- Browser adapters
- Public event interpretation and projection
- Observer-focused tests and packaging

## Non-responsibilities

EDH Observer does not own authoritative Task, Run, Policy, Dispatch, or Verification state.

It must not become the source of truth for the Run Ledger.

It must not import private EDH Core implementation.

Shared protocol and schema definitions should come from EDH Contracts.

## Migration source

Initial extraction source:

`/Users/dzzk/WORK/_bridge-local-execution`

Current browser and observer code is coupled to runtime endpoints and shared event code. Extraction therefore requires explicit seams rather than directory copying.

## Current status

Repository initialized as a migration target. No public remote has been created yet.
