# EDH Observer Boundaries

## Role

Observer consumes evidence and runtime state and produces human-usable views, diagnostics, and projections.

It may detect inconsistencies and surface uncertainty.

It must not authorize execution, assign capabilities, establish verifier PASS, or become authoritative runtime state.

## Dependency direction

Allowed:

- `edh-observer -> edh-contracts`
- browser adapters -> public Observer interfaces
- Observer -> authenticated local Runtime API

Avoid:

- `edh-observer -> edh-core source`
- private configuration in public builds
- private credentials or machine-local state in repository history
- transport changes introduced only to match repository boundaries

## Product scope

Chrome and Firefox implementations may coexist here while they share one observability product and contract.

A future Desktop, TUI, Mobile, or Web UI should become a separate repository only when a real product, release, dependency, or trust boundary justifies it.
