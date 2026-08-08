<!--
SPDX-FileCopyrightText: 2026 PlanB foundation

SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Swissledger AnonSet — LLM usage contract

This document is the concise operational reference for coding agents and other
automated maintainers. Read `AGENTS.md` for architecture and repository-local
instructions, then use this file to select commands and preserve invariants.
Human-facing context belongs in `README.md`; detailed deployment and incident
procedures live under `docs/`.

## Current verified state

- Source baseline `f0258ce` passed `make test` and protected workflow
  `31228455338` on 8 August 2026.
- The workflow tested PR merge commit
  `e6b25df317d1f3f54ad05bcdd09135790c64d2e1` and validated its downloaded
  chain-222 evidence artifact.
- The stack is vendored `PoseidonT3 → SemaphoreVerifier → Semaphore →
  MerkleRootRegistryZK`; `PoseidonT6` is not interchangeable with `PoseidonT3`.
- Local and chain-222 release evidence is green. Canonical chain-110 promotion
  still requires an external Solidity/ZK audit, production multisig/key
  governance, and an authorized manual change.

Treat the workflow artifact, rather than this dated summary, as authoritative
for the latest commit, deployed addresses, receipts, hashes, gas, and timings.

## Non-negotiable invariants

1. Use Node.js 24, Solc 0.8.30, Istanbul EVM, and the project-local checksummed
   SwissLedger Foundry v1.11.0 binaries under `bin/`.
2. Do not use stock Foundry, Hardhat, Truffle, London defaults, `PUSH0`, or
   `MCOPY` in executable bytecode.
3. Keep `vendor/poseidon-solidity/PoseidonT3.sol` statically vendored and pinned.
   Semaphore's LeanIMT links PoseidonT3 for two-child hashing.
4. `verifyMembership` is reusable. `validateMembership` consumes a nullifier
   and is the replay-protected claim path. Never silently substitute one for
   the other.
5. Never expose identity JSON, private keys, mnemonics, authenticated URLs, or
   GitHub tokens in output, fixtures, logs, artifacts, issues, or commits.
6. Chain `222` is fresh testnet evidence only. Chain `110` has no automated
   deployment path and must not reuse testnet credentials or addresses.
7. Preserve user changes and untracked files. Do not assume generated or ignored
   evidence under `artifacts/` is safe to publish until it passes secret scans.

## Repository map

| Responsibility | Paths |
|---|---|
| Registry and generated version | `src/MerkleRootRegistryZK.sol`, `src/generated/BuildInfo.sol` |
| Vendored linked library | `vendor/poseidon-solidity/PoseidonT3.sol` |
| Solidity unit/fuzz tests | `test/MerkleRootRegistryZK.t.sol` |
| Client and real proof tests | `clients/anonset/anonset-cli.mjs`, `clients/anonset/anonset.test.mjs` |
| Local protocol smoke | `scripts/e2e-smoke`, `test/e2e-smoke.test.sh` |
| Protected testnet path | `scripts/testnet-deploy`, `scripts/testnet-zk-smoke`, `scripts/testnet-evidence.mjs` |
| CI and release boundaries | `.github/workflows/test.yml`, `.github/workflows/release.yml` |
| Operator procedures | `docs/DEPLOYMENT.md`, `docs/OPERATIONS.md`, `docs/READINESS.md` |

## Standard workflow

Inspect before editing:

```bash
git status --short --branch
make toolchain-info
```

Install a missing local toolchain and dependencies:

```bash
make toolchain-install
npm ci
```

Use focused gates while iterating:

```bash
make build
make test-client
make test-solidity
make test-smoke
make artifact-compatibility
make reproducible-build
make coverage
```

Before declaring work complete, always run:

```bash
make test
git diff --check
git status --short --branch
```

`make test` is the sole complete local/CI quality contract. Do not infer a full
pass from one focused target. Expected current measurements are 42 Solidity
tests, 96.04% registry line coverage, 86.67% registry branch coverage, and zero
production audit findings; investigate unexplained changes rather than merely
updating documented numbers.

## Client contract

```bash
npm run anonset -- identity create identity.json
npm run anonset -- proof generate identity.json group.json 0 <group-id>
npm run anonset -- proof generate-chain <identity.json|-> <registry-address> <rpc-url> <chain-id> 0 [from-block] [--checkpoint <file>] [--confirmations <n>]
npm run anonset -- verify local proof.json
npm run anonset -- verify on-chain <registry-address> proof.json <rpc-url> <chain-id>
```

Identity files are owner-only, atomic, size-limited, regular files. Secret data
must never reach standard output or errors. Preserve stable exit classes:
usage/input `2`, local file/proof `3`, and RPC/chain `4`. Read
`clients/anonset/README.md` before changing the CLI contract.

`proof generate-chain` is the authoritative secret-plus-chain flow. It derives
the registry deployment block (or accepts a trusted override), replays
Semaphore member events in canonical order, checks every event root and the
snapshot's final root/depth/size, and only then generates a scope-bound proof.
Raw secrets are accepted only through bounded stdin (`-`), never as a command
argument. Its JSON exposes non-secret reconstruction/timing/gas-estimate
measurements but never the identity commitment or leaf index.
Use `--checkpoint <file>` for an atomically written, public cache. It is only
used after its block anchor and historical group state validate; otherwise the
command rebuilds trusted complete history. Successful output includes a
redacted `checkpoint` descriptor and checkpoint timings.

## CI and evidence contract

All pull requests receive the secret-free local gate. The protected testnet job
may run for an Environment-approved same-repository PR targeting `main`, or for
protected `main`; fork PRs never receive secrets. It consumes organization
variables `SWISSLEDGER_TESTNET_RPC` and `SWISSLEDGER_TESTNET_ADDRESS`, plus
organization secret `SWISSLEDGER_TESTNET_DEPLOY`.

A valid evidence manifest must identify the upstream RPC host, deployer, four
linked contract addresses, successful deployment and protocol receipts,
runtime/ABI/bytecode hashes, dependency evidence, and these semantic outcomes:
reusable verification twice, protected validation, replay rejection, tampered
proof rejection, and member removal. It also records per-operation gas,
block number, observed duration, aggregate gas, identity setup, proof
generation, and total smoke duration. Timings are observations, not SLAs.

The release workflow is `main`-only, GitHub-only, exact-SHA/evidence-gated, and
does not publish npm packages or deploy production contracts.

## Completion checklist

- Confirm intended file scope and retain unrelated work.
- Add or update tests for every observable behavior change.
- Run focused tests, then current `make test` and `git diff --check`.
- For testnet/release changes, require a green protected workflow and inspect
  the downloaded artifact rather than trusting the job conclusion alone.
- Report measured evidence and distinguish local, testnet, release, and
  production claims.
- Leave external audit, production key governance, and chain-110 promotion as
  explicit decision-owner requirements until they actually occur.
