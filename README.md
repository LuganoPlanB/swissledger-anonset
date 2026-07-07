<!--
SPDX-FileCopyrightText: 2026 PlanB foundation

SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Swissledger AnonSet

Zero-knowledge anonymous membership proofs using the Semaphore v4 protocol,
deployed on the Swissledger chain (ID 110).

This repository builds a Merkle-based anonymous membership registry and its
local client. Anyone can prove they are in the on-chain group without revealing
their identity — the contract verifies a succinct Groth16 ZK proof.

## How it works

1. **Owner** adds identity commitments to an on-chain Semaphore group.
2. **Member** holds the secret corresponding to their commitment.
3. **Member** generates a ZK proof off-chain proving:
   > "I know a secret whose commitment is in this Merkle tree."
4. **Anyone** calls `verifyMembership()` on-chain. The contract verifies only
   the ZK proof — it learns nothing about the leaf or the path.

No nullifier tracking is performed. Members may prove inclusion as many times
as they want. For replay-protected claims, use the parent Semaphore contract's
`validateProof` directly.

## Architecture

| Layer | Technology |
|---|---|
| ZK circuits | Semaphore v4 (Poseidon hash, Groth16) |
| On-chain Merkle tree | LeanIMT (via SemaphoreGroups) |
| Contract | `MerkleRootRegistryZK.sol` |
| Proof generation | `@semaphore-protocol/proof` (off-chain, JS) |
| Client | Node.js ESM CLI (`anonset-cli.mjs`) |

```
┌─────────────────────────────────────────────────────────┐
│                     Off-chain                             │
│  Identity (secret) ──► @semaphore/proof ──► Groth16 proof│
└─────────────────────────────────────────────────────────┘
                            │
                            ▼ (proof + public inputs)
┌─────────────────────────────────────────────────────────┐
│                       On-chain                            │
│  MerkleRootRegistryZK ──► Semaphore.verifyProof()        │
│                           └── Groth16 verifier            │
│                           └── Merkle root matches group   │
└─────────────────────────────────────────────────────────┘
```

## Quick start

```bash
make setup    # install Foundry + npm dependencies + generate keys
make build    # regenerate BuildInfo.sol + compile
make test     # full suite (client + solidity + smoke)
```

## Commands

```bash
make test-client    # Node.js tests only
make test-solidity  # forge test only
make test-smoke     # local Anvil e2e deployment
```

## Client CLI

The client mirrors the `swissledger-merkle` CLI interface but generates
Semaphore ZK proofs instead of plain Merkle proofs.

```bash
# Create an identity
npm run anonset -- identity create
# → { privateKey: "0x...", commitment: "..." }

# Generate a ZK proof
npm run anonset -- proof generate identity.json group.json

# Verify locally (no chain needed)
npm run anonset -- verify local proof.json

# Verify on-chain
npm run anonset -- verify on-chain 0xCONTRACT proof.json https://rpc.example.com
```

See [clients/anonset/README.md](clients/anonset/README.md) for details.

## Deployment

```bash
# Against local Anvil
forge script script/DeployMerkleRootRegistryZK.s.sol \
  --rpc-url anvil --broadcast

# Against a real chain (e.g., Swissledger)
forge script script/DeployMerkleRootRegistryZK.s.sol \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast --legacy
```

The deploy script deploys three contracts:
1. `SemaphoreVerifier` — Groth16 verifier for Semaphore circuits
2. `Semaphore` — on-chain group management + proof routing
3. `MerkleRootRegistryZK` — anonymous membership registry

## Contract API

```solidity
// Permissioned group management
function addMember(uint256 identityCommitment) external onlyMemberManager returns (uint256 root);
function addMembers(uint256[] calldata identityCommitments) external onlyMemberManager returns (uint256 root);
function removeMember(uint256 identityCommitment, uint256[] calldata proof) external onlyMemberManager returns (uint256 root);

// Anonymous membership verification (no nullifier tracking)
function verifyMembership(uint256 depth, uint256 root, uint256 nullifier, uint256[8] points) external returns (bool);
function verifyMembership(uint256 depth, uint256 root, uint256 nullifier, uint256 msg, uint256[8] points) external returns (bool);

// Queries
function activeRoot() external view returns (uint256);
function memberCount() external view returns (uint256);
function version() external pure returns (string memory);
```

## Chain compatibility

The project is built exclusively with **swissledger-foundry**, a Swissledger-fork
of Foundry preconfigured with `evm_version = "istanbul"` matching the chain's
pre-Shanghai EVM. The chain's engine natively supports PUSH0/MCOPY even when the
compiler targets istanbul, so no special workarounds are needed.

Always use `--legacy` and `--gas-price 0` for transactions.

## Versioning

`semantic-release` computes the next SemVer version from conventional commits.
The Solidity build embeds the current project version via `BuildInfo.sol`,
exposed through `MerkleRootRegistryZK.version()`.

# Licensing

Swissledger AnonSet is Copyright (C) 2026 PlanB Foundation

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but
WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public
License along with this program.  If not, see
<https://www.gnu.org/licenses/>.
