# Contributing

EDH is currently in an architecture/transit phase.

Before proposing a change:

- keep repository boundaries explicit;
- do not introduce new runtime network/service boundaries implicitly;
- do not copy private Core implementation into public repositories;
- put shared interoperability definitions in `edh-contracts`;
- preserve provenance and add focused verification evidence;
- never commit secrets or raw private execution evidence.

Prefer small, reviewable changes with a clear acceptance condition.
