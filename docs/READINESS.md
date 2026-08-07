<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Readiness evidence and residual risk

This is a handoff record, not a production approval. It deliberately separates
current local evidence from evidence that only a protected GitHub Environment
can produce.

## Current local evidence

The latest local aggregate run in this worktree completed `make test`, including
generated-file drift, format, dependency policy, deterministic artifacts,
workflow/release unit tests, Node tests, 42 Forge tests, analysis, coverage,
and local Anvil protocol smoke. Documentation checks passed with:

```bash
node --test test/documentation.test.mjs
make help
git diff --check
```

Observed pinned versions: Node `v24.18.1`, npm `11.16.0`, and SwissLedger
Forge/Cast/Anvil `1.11.0` at
`7ac07c5731c9a768edcab2b8506047e4d9dc587c`; the configured compiler is Solc
`0.8.30` with Istanbul EVM. `npm audit --omit=dev` reported zero findings.
The reproducibility check produced matching artifact hashes for the registry,
Semaphore, and SemaphoreVerifier. These are local worktree observations, not a
substitute for a clean-checkout release or live-network result.

## Required external evidence — currently unverified

The exact commit must still run the protected `.github/workflows/test.yml`
testnet job, using the `swissledger-testnet` GitHub Environment, organization
RPC/address variables, and the real organization deployer secret. It may be an Environment-approved same-repository PR targeting `main`
or the protected `main` run required for release; fork PRs remain secret-free.
That run must deploy a **fresh chain-222** stack, complete the full reusable and
replay-protected smoke, upload `anonset-testnet-<commit>`, and pass downstream
evidence validation. This cannot be truthfully produced from a local checkout
without the Environment secrets and must not be faked.

Only after that exact-commit artifact is available may the release workflow
download it, compare rebuilt artifacts, and perform its GitHub-only release
path. A future canonical chain-110 deployment remains a separate manual change
with no automatic deployment path.

## Production blockers and owners

| Residual risk / blocker | Decision owner | Required resolution |
|---|---|---|
| Exact-commit chain-222 evidence absent | Release maintainer / GitHub Environment approver | Run and retain the protected workflow artifact. |
| External Solidity and ZK-protocol audit not asserted as complete | Production governance owner | Obtain audit and disposition findings before canonical promotion. |
| Production owner/key governance not established | Production governance owner | Approve hardware-backed multisig, threshold, recovery, rotation, and manager policy. |
| Canonical chain-110 deployment | Change owner and production multisig | Complete the manual deployment checklist and independent receipt/code verification. |

Until every applicable row is resolved, describe the repository as locally
verified and awaiting protected testnet/governance evidence—not production-ready.
