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
anonset-cli proof generate-chain <identity.json|-> <registry-address> <rpc-url> <chain-id> [message] [from-block]
anonset-cli verify local <proof.json>
anonset-cli verify on-chain <address> <proof.json> <rpc-url> <chain-id>
```

`group.json` contains `{"members":["<commitment>", ...]}`. Message and scope
default to zero. For an on-chain proof, set scope to the registry's `groupId`;
`verify on-chain` checks the supplied RPC's chain ID before its static
`verifyMembership` call.

`generate-chain` is the self-contained path when the prover has only an
identity secret, registry address, RPC URL, and chain ID. It discovers the
registry deployment block, reads its Semaphore address and group ID, scans and
canonically replays the group's public events, and refuses to prove unless the
reconstructed root, depth, and size match the same block's on-chain state. An
explicit trusted `from-block` avoids historical bytecode discovery when the RPC
does not expose archive state.

## Safe workflow

```bash
# Creates identity.json mode 0600; do not print, commit, or upload it.
npm run anonset -- identity create identity.json
npm run anonset -- proof generate-chain identity.json <registry-address> <rpc-url> <chain-id> 0 > proof.json
npm run anonset -- proof generate identity.json group.json 0 <group-id> > proof.json
npm run anonset -- verify local proof.json
npm run anonset -- verify on-chain <registry-address> proof.json <rpc-url> <chain-id>
```

The identity file contains a private key. Keep it out of version control, CI
artifacts, shell history, and support tickets. The CLI refuses overwrite unless
`--force` is explicit. Prefer its file-producing command over passing a private
key argument; that optional argument exists only for controlled test fixtures.

If a secret manager supplies only the raw 32-byte hexadecimal identity secret,
pass `-` and pipe the secret on standard input:

```bash
secret-manager read anonset-identity |
  npm run anonset -- proof generate-chain - <registry-address> <rpc-url> <chain-id> 0 > proof.json
```

Do not put the secret directly in command arguments: process listings and shell
history may expose it. The command accepts at most 128 bytes on stdin and never
includes the secret, identity commitment, or member index in its JSON output.

The output includes `metrics` for deployment discovery, event download, tree
reconstruction, Groth16 proof generation, gas estimation, and total observed
wall time. `gasEstimates.verifyMembership` and
`gasEstimates.validateMembership` are decimal estimates or `null` when the RPC
does not support a usable estimate. Reconstruction and proof generation are
off-chain and consume no gas. Timings are observations on that client/RPC, not
an SLA. RPC estimates are advisory and may understate actual execution; only a
signed transaction receipt supplies authoritative `gasUsed`.

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
- Automatic deployment discovery needs historical `eth_getCode`. If the RPC
  prunes historical state, pass the trusted registry deployment block as the
  final `generate-chain` argument. Event history is still required.
- `generate-chain` intentionally limits reconstruction to 1,024 insertion
  slots. Use a verified indexer snapshot for larger groups.
- A replay failure after `validateMembership` is expected for an already-used
  nullifier, not a failed reusable check.
