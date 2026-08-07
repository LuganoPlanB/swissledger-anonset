<!--
SPDX-FileCopyrightText: 2026 PlanB foundation

SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Swissledger AnonSet

Anonymous Semaphore v4 membership on SwissLedger. This repository provides a
single Semaphore group, a Node.js proof client, a pinned Istanbul-compatible
toolchain, local protocol smoke coverage, and a protected fresh-testnet CI
workflow. It does **not** designate a canonical production deployment.

## Start here

Prerequisites are Node.js 24, npm, `curl`, and `sha256sum` (or `shasum`). The
installer downloads only checksummed SwissLedger Foundry v1.11.0 binaries into
this checkout's ignored `bin/` directory; it does not install stock Foundry or
modify a shell profile.

```bash
make toolchain-install
npm ci
make toolchain-info
make test
```

`make test` is the complete local quality gate: generated-file drift,
formatting, production dependency policy, deterministic Istanbul artifacts,
unit/fuzz/client tests, static analysis, coverage, and an isolated local Anvil
protocol smoke. Run `make help` for focused targets. The build is pinned to
Solc 0.8.30 and `evm_version = "istanbul"`; do not substitute stock Foundry
or London-era settings.

## Proof semantics and administration

`verifyMembership` is a reusable membership check. It verifies a Semaphore
proof but deliberately does not consume the nullifier, so the same valid proof
can be checked repeatedly. Use it only where replay is acceptable.

`validateMembership` is the separate replay-protected claim path. It delegates
to Semaphore's nullifier validation and rejects a repeated nullifier for the
group scope. A caller-supplied message remains part of the proof; use an
application-specific message and scope when defining a claim protocol. These
events are intentionally distinct: `MembershipVerified` means reusable check;
`MembershipValidated` means one-use validation.

The registry has a two-step owner transfer (`transferOwnership`, then
`acceptOwnership`). The accepted owner becomes a member manager; explicitly
added managers are retained. See [operations](docs/OPERATIONS.md) before any
administrative action.

## Chains and deployment evidence

| Network | Chain ID | Purpose |
|---|---:|---|
| SwissLedger testnet | `222` | Protected CI deploys a new three-contract stack for each trusted run. |
| SwissLedger production | `110` | Manual governance-gated promotion only; no workflow deploys it. |

The test workflow runs local gates for pull requests, `main` pushes, and manual
runs. Its secret-bearing testnet job runs only after local gates on a protected
`main` push/workflow dispatch, or on a same-repository PR whose base is `main`.
The latter requires explicit `swissledger-testnet` GitHub Environment approval;
fork PRs remain secret-free and cannot start the testnet job. It requires
`SWISSLEDGER_TESTNET_ADDRESS` (credential-free RPC URL) and
`SWISSLEDGER_TESTNET_DEPLOY` (deployer key). Never put either value in files,
command lines, artifacts, issue text, or logs. PR validation creates fresh
testnet evidence only; it never starts a release.

Each successful trusted run uploads `anonset-testnet-<commit>` for 90 days. It
contains a secret-scanned manifest, contract ABI/bytecode hashes, deployment
and smoke receipts, and dependency evidence. Testnet addresses prove that
specific fresh CI run only; they are not canonical production addresses.
Release runs download and validate this exact-commit evidence before publishing
GitHub-only semantic-release output. Package publication is disabled.

For the manual chain-110 checklist, address/code verification, and the
mandatory production governance gates, see [deployment](docs/DEPLOYMENT.md).
The current handoff status and explicit external blockers are in
[readiness evidence](docs/READINESS.md).

## Client

```bash
npm run anonset -- identity create identity.json
npm run anonset -- proof generate identity.json group.json 0 <group-id>
npm run anonset -- verify local proof.json
npm run anonset -- verify on-chain <registry-address> proof.json <rpc-url> <chain-id>
```

See [clients/anonset/README.md](clients/anonset/README.md) for exact argument
rules, safe identity handling, and local/on-chain verification.

## Versioning and release

The package is private. Conventional commits drive GitHub-only semantic-release
tags and release notes. `BuildInfo.sol` embeds the package version and the
release workflow refuses a release unless rebuilt artifacts match the fresh
chain-222 evidence for the exact `main` commit. A release is not a production
deployment authorization.

## Licensing

Swissledger AnonSet is Copyright (C) 2026 PlanB Foundation and is licensed
under the GNU Affero General Public License, version 3 or later, without
warranty.
