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
anonset-cli proof generate <identity.json> <group.json> [message] [scope] [--max-insertion-slots <n>]
anonset-cli proof generate-chain <identity.json|-> <registry-address> <rpc-url> <chain-id> [message] [from-block] [--max-insertion-slots <n>] [--checkpoint <file>] [--confirmations <n>]
anonset-cli group rotate <source-registry> <rpc-url> <chain-id> --checkpoint <file> --journal <file> --expected-signer <address> [--max-insertion-slots <n>] [--target-owner <address>] [--manager <address> ...] [--batch-size <1..64>] [--confirmations <n>] [--gas-price <n>] [--deploy-gas-limit <n>] [--batch-gas-limit <n>]
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

`--checkpoint <file>` writes a public tree cache and resumes from it only after
its chain identity, saved block hash, and historical Semaphore state validate.
A stale/unavailable anchor safely falls back to complete history. The response
always contains a secret-free `checkpoint` descriptor; without this option it
reports `mode: "unpersisted"`. `--confirmations <n>` selects `head - n`.

## Group rotation

Rotation is an operational migration, never an in-place prune or reset. It
deploys a new registry on the source Semaphore, copies active commitments in
leaf order, and creates a new group ID. Freeze source membership during the
migration and explicitly cut applications over to the new scope.

```sh
printf '%s\n' "$ROTATION_KEY" | npm run anonset -- group rotate "$SOURCE" "$RPC_URL" 110 \
  --checkpoint source.checkpoint.json --journal rotation.journal.json \
  --expected-signer "$DEPLOYER" --target-owner "$GOVERNANCE" --batch-size 64
```

The key is accepted only from bounded stdin. The 0600 journal is non-secret
audit state: rerun the exact command to resume confirmed work. Source drift
aborts that candidate and requires a fresh checkpoint. A distinct target owner
returns `AWAITING_OWNER_ACCEPTANCE` until it accepts; managers are supplied
explicitly and are never silently copied from the source.

Both proof-generation commands default to a budget of 65,536 insertion slots.
An insertion slot is retained after a member removal, so it differs from the
number of active members. Use `--max-insertion-slots <n>` to choose a positive
safe integer up to 4,294,967,296 (the depth-32 protocol ceiling). The option
may follow the required positional arguments; duplicate or unknown options are
rejected before files are read or RPC access begins. Ordinary JSON inputs remain
limited to 1 MiB.

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
wall time, plus checkpoint load/validation/write observations. `gasEstimates.verifyMembership` and
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
- `generate-chain` defaults to 65,536 insertion slots. Choose a lower explicit
  budget when client memory must be constrained.
- A replay failure after `validateMembership` is expected for an already-used
  nullifier, not a failed reusable check.
