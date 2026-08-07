<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Operations and incident runbooks

This document governs the immutable registry and its deployment credentials.
It does not grant production authority. A canonical chain-110 deployment
requires the external Solidity/ZK audit and hardware-backed multisig governance
listed in [DEPLOYMENT.md](DEPLOYMENT.md).

## Roles, access, and routine controls

| Role | Least privilege | Routine evidence |
|---|---|---|
| CI testnet deployer | Protected `swissledger-testnet` Environment only; can deploy chain 222 only. | Workflow URL, manifest, receipts. |
| Release maintainer | GitHub release permission after exact-commit testnet gate. No deployer secret. | Release-gate output and bundle checksums. |
| Production owner | Hardware-backed multisig; starts/cancels ownership transfer and appoints managers. | Approved change record and multisig transaction IDs. |
| Member manager | Adds/removes approved commitments only. Cannot transfer ownership. | Approval reference, transaction hash, root/count. |
| Incident lead | Coordinates containment and disclosure; does not receive private keys. | Timeline, decision log, sanitized evidence archive. |

Keep `SWISSLEDGER_TESTNET_RPC` and `SWISSLEDGER_TESTNET_ADDRESS` as scoped
organization variables and `SWISSLEDGER_TESTNET_DEPLOY` as a scoped organization
secret. Do not duplicate them as repository or PR configuration. Give
Environment approval access only to named operators and review it after every
role change. The RPC URL must not contain credentials. Never print a private
key, identity JSON, mnemonic, GitHub token, raw secret value, or authenticated
URL; never upload any of them as an artifact.

Rotate/revoke a testnet deployer by creating a replacement Environment secret,
authorizing the new testnet address under the network access policy, running a
protected fresh chain-222 workflow, then deleting the old secret and
disabling/revoking its network access. Preserve only public old-address,
transaction, workflow, and revocation timestamps. A production signer follows
the approved multisig/key custody procedure; a testnet key is never promoted to
production.

Before a testnet run, the workflow itself checks chain `222`, credential-free
RPC syntax, deployer address, and explicit gas limits. Successful signed
deployment receipts establish network authorization; native-token balance is
not a prerequisite on this permissioned zero-gas chain. Before any manually
authorized production action, independently verify chain `110`, signer
identity, approved release hashes, address book, and multisig threshold. Stop
on a mismatch.

## Deployment, upgrade, and recovery rules

- Fresh CI deployment means a new `SemaphoreVerifier → Semaphore →
  MerkleRootRegistryZK` stack on chain 222. Its addresses are run-specific
  evidence, never a canonical address book.
- A failure after one or two deployment transactions is a partial deployment:
  stop broadcasting, retain public hashes/receipts/nonce/RPC host label, and
  notify the change owner. Do not call it successful and do not silently reuse
  a nonce. Resolve nonce state with the provider, then begin a new approved
  stack if needed.
- Contracts are not upgradeable. An upgrade, dependency remediation, or bad
  release recovery is a new reviewed release and new deployment after local
  gates, fresh testnet evidence, audit/governance review as appropriate, and
  an explicit migration/communication plan. There is no code rollback.
- To recover owner control, the current owner calls `transferOwnership`, then
  the exact pending address calls `acceptOwnership`. Record both events and
  confirm `owner`, `pendingOwner`, and manager list. If acceptance cannot occur,
  the current owner cancels or replaces the pending transfer; no manager can
  bypass the owner. A lost production owner key invokes the multisig recovery
  policy, not an on-chain shortcut.
- Treat `verifyMembership` as reusable and `validateMembership` as the only
  replay-protected claim path. A suspected duplicate claim requires preserving
  public nullifier/scope/message/transaction evidence, pausing the application
  claim path, and checking whether `MembershipValidated` already exists. Do not
  identify or publish the member behind a proof.
- Explorer pages are convenience views, not final proof. Verify chain ID,
  receipts, deployed code, constructor wiring, ABI/bytecode hashes, owner,
  managers, and group state from the pinned tools and evidence manifest.

## Tabletop incident responses

Every incident record contains the UTC timeline, change owner, public
transaction hashes, sanitized logs, affected commit/release identifiers,
approvals, and recovery decision. Redact secrets before attaching any evidence.

| Incident | Detection | Containment | Recovery | Preserve evidence |
|---|---|---|---|---|
| Leaked testnet deployer key | Secret scanner alert, unexpected sender activity, or GitHub audit log. | Disable Environment access; revoke/delete the secret; stop queued testnet jobs. | Create/fund/register a replacement testnet address, update the protected secret, and run a fresh chain-222 workflow. | Old public address, timestamps, workflow IDs, transactions, revocation record; never the key. |
| Wrong-chain RPC | Workflow/script chain-ID check fails or receipt is on an unexpected network. | Stop before broadcast; disable the endpoint in Environment settings. | Correct the approved endpoint, independently check chain 222 or 110 as applicable, and rerun only under normal approval. | RPC host label, expected/actual chain ID, failed command category, no URL credentials. |
| Partial three-contract deployment or nonce contention | Missing manifest contract/receipt, failed receipt, or provider nonce conflict. | Stop all broadcasts for that deployer/network; preserve the temporary manifest and receipts. | Reconcile nonce with provider; deploy a new complete approved stack—do not treat partial addresses as canonical. | Commit, sender, nonce, contract addresses, transaction hashes, receipts, gas values. |
| Compromised member manager | Unauthorized `MemberAdded`/`MemberRemoved`, alert, or manager report. | Pause application mutation workflow; owner removes the manager if safe; preserve chain state. | Add an approved replacement manager, review affected root/members, and issue a new deployment only if governance determines it necessary. | Manager address, events, approved membership record, root/count before and after. |
| Ownership acceptance failure or owner key loss | `pendingOwner` remains set, acceptance reverts, or multisig signer loss is reported. | Do not transfer again blindly; current owner cancels/replaces pending transfer if still controlled. | Reconfirm exact recipient and execute two-step handover; invoke multisig custody recovery for lost production control. | Ownership events, pending address, multisig approval IDs, recovery decision. |
| Vulnerable Semaphore/toolchain dependency | Advisory, lockfile review, CI dependency-policy failure, or vendor notice. | Block release/promotion; pin/disable affected workflow as directed by the owner. | Assess reachability, update reviewed pins/overrides, run all local gates plus fresh testnet evidence, and obtain new audit/governance review if production impact exists. | Advisory ID, versions, reachability decision, SBOM, gate results, approvals. |
| Bad GitHub release or wrong evidence linkage | Release-gate mismatch, checksum mismatch, incorrect tag/notes, or maintainer report. | Stop distribution/announcements; revoke the GitHub Release asset if policy permits; do not rewrite deployment history. | Publish a corrective GitHub release after exact-commit evidence validation; if immutable artifacts were advertised, issue a signed correction referencing both releases. | Tag/SHA, workflow run, artifact checksums, release-gate output, public notice. |

## Release and promotion decision gate

The incident lead and change owner must answer yes to every item before calling
a result ready: exact `main` commit passed `make test`; the protected chain-222
workflow for that commit produced a validated secret-free evidence bundle; the
release gate compared rebuilt artifacts; dependency policy/SBOM were reviewed;
no unresolved incident or audit finding is being relabeled as accepted; and the
chain-110 audit, multisig owner, and production-key governance prerequisites
are satisfied. If the external audit or production governance is missing, the
result is testnet/release readiness only—not production readiness.
