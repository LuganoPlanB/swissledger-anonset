# Dependency security policy

Production dependencies are installed exclusively from `package-lock.json` with
`npm ci`. The Semaphore JavaScript packages and contract package are pinned as a
single `4.14.3` set. `make dependency-integrity` rejects version drift and runs
`npm audit --omit=dev`; a high or critical production finding fails the gate.

## Reviewed transitive mitigations

The production proof API uses `snarkjs@0.7.5`. However,
`@zk-kit/artifacts@2.0.1` also declares `circomkit`, whose artifact-generation
CLI pulls the vulnerable `snarkjs@0.5.0` through `circom_tester`. The application
does not invoke that CLI, but the package is part of a production install. The
root override to `snarkjs@0.7.5` removes the vulnerable implementation while
keeping the public Semaphore proof API unchanged. The client proof-generation
and verification tests exercise the resulting dependency graph.

The `ws` and `underscore` overrides similarly select patched releases across
all transitive paths:

| Package | Pinned override | Reason |
|---|---:|---|
| `snarkjs` | `0.7.5` | Excludes the double-spend flaw affecting `<=0.6.11` ([GHSA-xp5g-jhg3-3rg2](https://github.com/advisories/GHSA-xp5g-jhg3-3rg2)). |
| `ws` | `8.21.3` | Excludes the affected ranges for memory disclosure and fragmentation-based exhaustion ([GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx), [GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p)). |
| `underscore` | `1.13.8` | Excludes the recursion-based denial-of-service range inherited through `jsonpath`/`bfj` ([GHSA-qpx9-hpmf-5gmw](https://github.com/advisories/GHSA-qpx9-hpmf-5gmw)). |

Repository maintainers own these overrides. Any upgrade to Semaphore,
`@zk-kit/artifacts`, or an overridden package must remove an override when
upstream no longer needs it, or update it only after the full client proof suite
and `make dependency-integrity` pass.

## Release evidence

`make dependency-evidence` writes a CycloneDX production SBOM and deterministic
license inventory under ignored `artifacts/`. The license inventory is evidence,
not a legal approval; maintainers must review copyleft licenses before external
binary redistribution.
