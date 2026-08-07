<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Deployment and evidence procedure

## Local prerequisites and verification

From a clean checkout, install the pinned dependencies and run the aggregate
gate before considering any deploy work:

```bash
make toolchain-install
npm ci
make toolchain-info
make test
```

`make reproducible-build`, `make artifact-compatibility`, and `make
dependency-evidence` are focused evidence commands. Their outputs under
`artifacts/` are ignored and must be reviewed before sharing. The deployment
scripts require the project-local SwissLedger binaries, Solc 0.8.30, and
Istanbul configuration; do not replace them with stock Foundry.

## Fresh CI testnet deployment (chain 222)

The trusted workflow is the only supported automatic deployment path. It runs
local gates, then can use the `swissledger-testnet` Environment on a protected
`main` push/manual run or an explicitly approved same-repository PR targeting
`main`. Fork PRs cannot access the Environment or its secrets. A PR run creates
fresh chain-222 validation evidence only; the release workflow remains
main-only. The Environment uses:

- `SWISSLEDGER_TESTNET_ADDRESS`: a credential-free HTTP(S) testnet RPC URL;
- `SWISSLEDGER_TESTNET_DEPLOY`: a 32-byte deployer private key held only by
  GitHub Environment secrets.

It rejects every chain other than `222`, validates the deployer address and a
nonzero registered balance, serializes deployment by deployer/network, and
deploys `SemaphoreVerifier → Semaphore → MerkleRootRegistryZK` with explicit
legacy, zero-gas-price limits. `scripts/rpc-proxy.py --target <testnet-rpc>` is
used in CI only for the documented mandatory-`params` RPC quirk. Do not export
secrets or run these scripts in a shell whose history/logging will retain them.

The subsequent smoke adds two ephemeral commitments, checks root/count/wiring,
uses `verifyMembership` twice, uses `validateMembership` once, and confirms a
second validation is rejected. It deletes its temporary identities. A success
therefore proves a fresh testnet stack, not a production deployment.

Download the `anonset-testnet-<commit>` artifact from the successful workflow.
It includes `manifest.json`, contract ABI/bytecode hashes, receipt outcomes,
and dependency evidence. The downstream validation job checks schema, hashes,
and secret-shaped text. Record the workflow URL, commit SHA, artifact checksum,
three addresses, and transaction hashes in the release decision. Explorer data
is supplementary: verify receipts, deployed code, constructor wiring, and
artifact hashes against the manifest rather than relying on an explorer label.

## Manual production promotion (chain 110)

There is deliberately no production deployment command in this repository.
Chain `110` promotion is a change-controlled manual operation, not a reuse of
the chain-222 script or its testnet key. Before an authorized operator writes a
production transaction, obtain all of the following:

1. An external Solidity and ZK-protocol audit with findings disposition.
2. A named production owner controlled by a hardware-backed multisig, recovery
   and rotation contacts, and an approved member-manager policy.
3. An approved immutable release: exact Git commit/tag, validated chain-222
   evidence bundle, rebuilt artifact hashes, dependency/SBOM review, and a
   signed deployment/change record.
4. A production RPC/provider approval and chain-ID `110` verification, plus a
   funded/registered production deployer. Private material stays in the
   approved signing system and is never pasted into a terminal, file, artifact,
   or issue.
5. A written transaction plan for the three-contract order, legacy zero-price
   settings if required by the provider, receipt/code/hash verification, and a
   stop point after every transaction.

If any check fails, stop. A partial deployment is not canonical: preserve
transaction hashes and receipts, inform the change owner, and start a new
approved deployment rather than claiming a rollback. After deployment, verify
chain ID, code and ABI/bytecode hashes for all three addresses, Semaphore
wiring/group ID, owner, managers, version, and both proof semantics using
non-secret test identities. Publish only approved public evidence.

## Release relationship

`release.yml` runs only after the successful `main` test workflow verifies the
same SHA and downloads its evidence artifact. It rebuilds and compares contract
identity before GitHub-only semantic-release. It never publishes to npm. A tag
or GitHub Release refers to chain-222 evidence and release inputs; it does not
create, replace, or authorize a canonical chain-110 deployment.
