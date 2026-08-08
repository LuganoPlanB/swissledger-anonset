<!--
SPDX-FileCopyrightText: 2026 PlanB foundation

SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Script catalog

These scripts back the Make targets, CI workflows, release gate, and local
operator checks. Prefer the documented `make` or `npm` target when one exists;
invoke a script directly when its synopsis below explicitly describes an
operator-facing interface. Generated `artifacts/`, `out/`, and local key files
are ignored unless a workflow deliberately packages and secret-scans them.

| Script | Synopsis |
|---|---|
| `build-solc [version]` | Manual escape hatch that clones and builds a selected Solidity compiler under `solidity/`; normal builds use pinned Solc 0.8.30 through SwissLedger Foundry. |
| `check-artifact-compatibility.mjs` | Inspects the four deployment artifacts for executed Istanbul-incompatible opcodes, bytecode/initcode limits, code-deposit gas, and linked-library identity; used by `make artifact-compatibility`. |
| `check-coverage.mjs <forge-coverage-report>` | Parses a Forge coverage report and rejects registry coverage below 95% lines or 85% branches; used by `make coverage`. |
| `check-dependency-integrity.mjs` | Verifies exact Semaphore v4 pins and security overrides in both package manifests; used by `make dependency-integrity`. |
| `e2e-smoke` | Starts a dynamic-port local Anvil, deploys the linked stack, exercises reusable/protected proofs, removal, progressive checkpoint/reorg behavior, and cleans up temporary state. Set `ANONSET_ROTATION_SCENARIO=1` only through `make test-rotation` for the 65-member rotation/recovery scenario. |
| `generate-build-info.mjs [--check]` | Atomically derives `src/generated/BuildInfo.sol` from `package.json`; `--check` rejects drift without writing. Test-only source/target overrides use `BUILD_INFO_PACKAGE` and `BUILD_INFO_TARGET`. |
| `generate-license-report.mjs [--output <path>]` | Emits a sorted JSON license inventory for production npm packages to stdout or the requested file; used by dependency evidence and release packaging. |
| `install-deps` | Convenience setup wrapper that installs the checksummed project-local SwissLedger Foundry toolchain, verifies it, and runs `npm ci`. |
| `install-swissledger-toolchain` | Downloads checksummed SwissLedger Foundry v1.11.0 `forge`, `cast`, and `anvil` binaries into `bin/` (or `SWISSLEDGER_BIN_DIR`); supports reviewed Linux x86-64 and macOS arm64 assets only. |
| `keygen` | Generates a local EVM keypair with pinned `cast`, writing `evm-private-key.txt` and `evm-address.txt`; local testing only—protect and delete the private-key file when finished. |
| `release-bundle.mjs <evidence-dir> <output-dir> [source-dir]` | Rebuilds the deterministic GitHub release directory from exact testnet evidence, compiled artifacts, sources, dependency evidence, gas/test reports, checksums, and a secret scan. |
| `release-gate.mjs <evidence-dir> <expected-commit>` | Validates that downloaded chain-222 evidence, artifact hashes, dependencies, and secret scan all describe the exact release commit. |
| `rpc-proxy.py [--listen host:port] [--target url]` | Local CI adapter that injects the mandatory empty JSON-RPC `params` field before forwarding to the explicitly configured SwissLedger endpoint; not a production deploy proxy. |
| `run-node-tests.mjs [--phase=all\|unit\|proof]` | Runs finite isolated client test phases with timeout and real-proof-count guards; `NODE_TEST_PHASE_TIMEOUT_MS` configures the per-phase limit. |
| `testnet-deploy <output.json>` | Protected chain-222 deployer: validates environment configuration and signer, deploys PoseidonT3, verifier, Semaphore, and registry with legacy transactions, validates receipts/code/wiring, and writes a secret-free deployment manifest. |
| `testnet-evidence.mjs <deployment.json> <smoke.json> <output-dir>` | Validates deployment/smoke schemas and measurements, rejects secret-shaped data, copies exact artifacts/SBOM/licenses, and writes the downloadable evidence manifest. |
| `testnet-zk-smoke <deployment.json> <output.json>` | Runs the real chain-222 proof lifecycle against a fresh deployment and writes non-secret receipts, reconstruction/checkpoint descriptors, gas, duration, replay/tamper rejection, and removal evidence. |
| `verify-reproducibility.mjs` | Performs two clean pinned builds, normalizes the four deployment artifacts, rejects hash drift, and prints the reproducible SHA-256 identities. |

## Common entry points

```bash
make toolchain-install       # install checksummed binaries
make artifact-compatibility # scan deployment bytecode
make coverage               # Forge report plus thresholds
make test-smoke             # one local protocol smoke
make test-rotation          # one expensive 65-member rotation smoke
make dependency-evidence    # ignored SBOM and license reports
make reproducible-build     # two clean artifact builds
make test                   # complete local/CI contract
```

The chain-222 scripts require organization-scoped configuration supplied by the
protected workflow: `SWISSLEDGER_TESTNET_RPC` and
`SWISSLEDGER_TESTNET_ADDRESS` are public variables, while
`SWISSLEDGER_TESTNET_DEPLOY` is the private signing key. Never place the latter
in argv, documentation, fixtures, logs, or artifacts.
