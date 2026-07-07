<!--
SPDX-FileCopyrightText: 2026 PlanB foundation

SPDX-License-Identifier: AGPL-3.0-or-later
-->

# MerkleZK CLI

Zero-knowledge Merkle proof client for `swissledger-merklezk`.

Uses the Semaphore v4 protocol to generate and verify Groth16 ZK proofs
of anonymous membership. Proves "I am in this Merkle group" without
revealing which leaf or path.

## Setup

```bash
npm ci
```

## Help

```bash
npm run merklezk -- --help
```

## Commands

### Create an identity

```bash
# Random identity
npm run merklezk -- identity create

# Deterministic identity from a private key
npm run merklezk -- identity create 0xabcdef1234...
```

Output:

```json
{
  "privateKey": "0x...",
  "commitment": "123456..."
}
```

**Important**: Save the private key. It is needed to generate proofs.
The commitment is public and gets added to the on-chain group.

### Generate a ZK proof

```bash
npm run merklezk -- proof generate identity.json group.json
npm run merklezk -- proof generate identity.json group.json "message" "scope"
```

Parameters:
- `identity.json` — output from `identity create`
- `group.json` — `{ "members": ["commitment1", "commitment2", ...] }`
- `message` (optional, default `"0"`) — arbitrary signal carried in the proof
- `scope` (optional, default `"0"`) — domain separator

Output:

```json
{
  "merkleTreeDepth": 1,
  "merkleTreeRoot": "123...",
  "nullifier": "456...",
  "message": "0",
  "scope": "0",
  "points": ["a1...", "b1...", "c1...", "d1...", "e1...", "f1...", "g1...", "h1..."]
}
```

### Verify a proof locally

```bash
npm run merklezk -- verify local proof.json
```

Output: `true` or `false`

This verification runs entirely off-chain using the Semaphore verification
keys. No network access is needed.

### Verify a proof on-chain

```bash
npm run merklezk -- verify on-chain 0xCONTRACT proof.json https://rpc.example.com
```

Output: `true` or `false`

Calls `MerkleRootRegistryZK.verifyMembership()` on the deployed contract.

## Workflow example

```bash
# 1. Create two identities
ID1=$(npm run --silent merklezk -- identity create)
ID2=$(npm run --silent merklezk -- identity create)

# Extract commitments
COMMITMENT1=$(echo "$ID1" | jq -r '.commitment')
COMMITMENT2=$(echo "$ID2" | jq -r '.commitment')

# Save identity 1 for later proof generation
echo "$ID1" > identity.json

# 2. Create group JSON
echo "{\"members\": [\"$COMMITMENT1\", \"$COMMITMENT2\"]}" > group.json

# 3. Generate proof for identity 1
PROOF=$(npm run --silent merklezk -- proof generate identity.json group.json)

# 4. Verify locally
echo "$PROOF" > proof.json
npm run --silent merklezk -- verify local proof.json
# → true

# 5. Verify on-chain (after adding commitments to the contract)
npm run --silent merklezk -- verify on-chain 0xREGISTRY proof.json http://127.0.0.1:8545
# → true
```

## Identity security

The `identity.json` file contains the **private key**. Anyone with this file
can generate proofs claiming to be that identity. Keep it secure.

For production use:
- Generate identities in a secure environment
- Distribute private keys via encrypted channels
- Store private keys in a secrets manager, not in plaintext files
