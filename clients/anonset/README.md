<!--
SPDX-FileCopyrightText: 2026 PlanB foundation

SPDX-License-Identifier: AGPL-3.0-or-later
-->

# AnonSet CLI

The Node.js CLI generates Semaphore v4 proofs from a private identity file and
can verify them locally or through the registry's reusable on-chain API.

## Setup and exact interface

```bash
npm ci
npm run anonset -- --help
```

```text
anonset-cli identity create <identity.json> [private-key-hex] [--force]
anonset-cli proof generate <identity.json> <group.json> [message] [scope]
anonset-cli verify local <proof.json>
anonset-cli verify on-chain <address> <proof.json> <rpc-url> <chain-id>
```

`group.json` contains `{"members":["<commitment>", ...]}`. Message and scope
default to zero. For an on-chain proof, set scope to the registry's `groupId`;
`verify on-chain` checks the supplied RPC's chain ID before its static
`verifyMembership` call.

## Safe workflow

```bash
# Creates identity.json mode 0600; do not print, commit, or upload it.
npm run anonset -- identity create identity.json
npm run anonset -- proof generate identity.json group.json 0 <group-id> > proof.json
npm run anonset -- verify local proof.json
npm run anonset -- verify on-chain <registry-address> proof.json <rpc-url> <chain-id>
```

The identity file contains a private key. Keep it out of version control, CI
artifacts, shell history, and support tickets. The CLI refuses overwrite unless
`--force` is explicit. Prefer its file-producing command over passing a private
key argument; that optional argument exists only for controlled test fixtures.

## Reusable checks versus claims

`verify local` and `verify on-chain` do not consume a nullifier. They are for
reusable membership checks, not one-time authorization. For a one-use claim,
an application must submit the generated proof to `validateMembership` and
handle an already-consumed nullifier as a rejected replay. Never treat a
successful reusable check as replay protection.

## Troubleshooting

- A wrong RPC chain ID is rejected before the contract call; correct the
  endpoint or expected chain ID instead of bypassing the check.
- A local proof root must correspond to the deployed group; rebuild `group.json`
  after approved additions or removals.
- A replay failure after `validateMembership` is expected for an already-used
  nullifier, not a failed reusable check.
