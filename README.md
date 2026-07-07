<!--
SPDX-FileCopyrightText: 2026 PlanB foundation

SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Swissledger AnonSet

Zero-knowledge anonymous set membership using the Semaphore v4 protocol,
deployed on the Swissledger chain (ID 110).

Prove you belong to an on-chain group without revealing your identity — the
contract verifies a succinct Groth16 ZK proof while learning nothing about
your leaf, your path, or your position. No nullifier tracking.

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
│                           └── Groth16 pairing check       │
│                           └── Merkle root matches group   │
└─────────────────────────────────────────────────────────┘
```

## Performance

| Operation | Time | Where |
|---|---|---|
| `Identity.create()` | **22 ms** | off-chain |
| `Identity.create(key)` | **21 ms** | off-chain |
| `Group(2 members)` | **0.6 ms** | off-chain |
| `Group(10 members)` | **1.2 ms** | off-chain |
| `generateProof` (2 leaves) | **404 ms** | off-chain |
| `generateProof` (10 leaves) | **190 ms** | off-chain |
| `verifyProof` (local) | **15 ms** | off-chain |
| `verifyMembership` (ZK proof) | 258,755 gas (~259 ms) | on-chain |
| `addMember` | 117,292 gas (~117 ms) | on-chain |
| `addMembers` (2 leaves) | 217,740 gas (~218 ms) | on-chain |
| `activeRoot` / `memberCount` | ~3,000 gas (~3 ms) | on-chain |

### Deployment costs

| Contract | Gas | Size |
|---|---|---|
| `PoseidonT3` | 3,375,785 | 16.9 KB |
| `SemaphoreVerifier` | 3,720,276 | 30.4 KB |
| `Semaphore` | 1,827,134 | 8.3 KB |
| `MerkleRootRegistryZK` | 1,243,236 | 5.4 KB |
| **Total** | **10,166,431** | |

On-chain times are estimated at ~1M gas/second execution.

## Architecture

| Layer | Technology |
|---|---|
| ZK circuits | Semaphore v4 (Poseidon hash, Groth16) |
| On-chain Merkle tree | LeanIMT (via SemaphoreGroups) |
| Contract | `MerkleRootRegistryZK.sol` |
| Proof generation | `@semaphore-protocol/proof` (off-chain, JS) |
| Proof verification | `SemaphoreVerifier.sol` (on-chain pairing check) |
| Client | Node.js ESM CLI (`anonset-cli.mjs`) |

## Quick start

```bash
make setup    # install npm dependencies + generate keys
make build    # regenerate BuildInfo.sol + compile (swissledger-forge)
make test     # full suite: client + solidity + smoke
```

## Contract API

```solidity
// Permissioned group management
function addMember(uint256 identityCommitment) external returns (uint256 root);
function addMembers(uint256[] identityCommitments) external returns (uint256 root);
function removeMember(uint256 identityCommitment, uint256[] proof) external returns (uint256 root);

// Anonymous membership verification (no nullifier tracking — unlimited proofs)
function verifyMembership(uint256 depth, uint256 root, uint256 nullifier, uint256[8] points) external returns (bool);
function verifyMembership(uint256 depth, uint256 root, uint256 nullifier, uint256 msg, uint256[8] points) external returns (bool);

// Queries
function activeRoot() external view returns (uint256);
function memberCount() external view returns (uint256);
function version() external pure returns (string memory);
```

## Client CLI

```bash
# Create an identity
npm run anonset -- identity create

# Generate a ZK proof
npm run anonset -- proof generate identity.json group.json

# Verify locally (no chain needed)
npm run anonset -- verify local proof.json

# Verify on-chain
npm run anonset -- verify on-chain 0xCONTRACT proof.json https://rpc.example.com
```

See [clients/anonset/README.md](clients/anonset/README.md) for the full workflow.

## Deployment

```bash
# Local
swissledger-forge script script/DeployMerkleRootRegistryZK.s.sol --rpc-url anvil --broadcast

# Production (Swissledger chain ID 110)
swissledger-forge script script/DeployMerkleRootRegistryZK.s.sol \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast --legacy --gas-price 0
```

The deploy script deploys the full stack: `SemaphoreVerifier` → `Semaphore` → `MerkleRootRegistryZK`.

## Chain compatibility

Built exclusively with **swissledger-foundry** (`evm_version = "istanbul"`).
Always use `--legacy` and `--gas-price 0` for on-chain transactions.

## Versioning

`semantic-release` computes the next SemVer version from conventional commits.
The build embeds it via `BuildInfo.sol` → `MerkleRootRegistryZK.version()`.

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
