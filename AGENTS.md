# Swissledger AnonSet — Agent Reference

## Project Map

| Area | Path | What |
|---|---|---|
| Solidity contracts | `src/` | `MerkleRootRegistryZK.sol`, `BuildInfo.sol` |
| Tests (Solidity) | `test/` | `forge test` via swissledger-foundry |
| Tests (Node) | `clients/anonset/*.test.mjs` | `node --test` |
| Off-chain client | `clients/anonset/anonset-cli.mjs` | Identity, proof generation, verification |
| Deploy script | `script/DeployMerkleRootRegistryZK.s.sol` | Full Semaphore stack deployment |
| Scripts | `scripts/` | install-deps, keygen, build-info gen, e2e-smoke, rpc-proxy |
| Config | `foundry.toml`, `package.json`, `GNUmakefile`, `mise.toml` |

## Quick Commands

```bash
make setup         # install Foundry + npm deps + generate keys
make build         # regenerate BuildInfo.sol + forge build
make test          # full suite (client + solidity + smoke)
make test-client   # Node.js tests only
make test-solidity # forge test only
make test-smoke    # local Anvil e2e deployment
```

## Architecture

**Semaphore group model**: Instead of a single updatable root, this contract
uses Semaphore's on-chain Incremental Merkle Tree. Members are added and
removed via transactions, and the root changes automatically.

- `MerkleRootRegistryZK` — the main contract. Owner-managed member managers,
  Semaphore group creation, anonymous membership verification.
- `Semaphore` (imported) — group management, Merkle tree, proof routing.
- `SemaphoreVerifier` (imported) — Groth16 proof verification.
- `BuildInfo` — auto-generated contract embedding npm package version.

### Anonymous membership (no nullifier tracking)

The contract calls `Semaphore.verifyProof()` instead of `Semaphore.validateProof()`.
This means:
- No nullifier reuse tracking
- Same member can prove inclusion unlimited times
- For replay-protected claims, call `Semaphore.validateProof()` directly

### Deployed contract addresses

After `forge script DeployMerkleRootRegistryZK.s.sol --broadcast`, three
addresses are returned:

| Contract | Variable |
|---|---|
| `MerkleRootRegistryZK` | `registryAddr` |
| `Semaphore` | `semaphoreAddr` |
| `SemaphoreVerifier` | `semaphoreVerifierAddr` |

## SwissLedger Chain (ledger.swiss)

### Chain identity

| Property | Value |
|---|---|
| Chain ID | `110` (0x6e) |
| Explorer | `https://explorer.ledger.swiss` |
| RPC endpoint | `https://explorer.ledger.swiss/api/eth-rpc` |
| Block gas limit | ~20,000,000 |
| Gas price | Always 0 (permissioned, gas-free) |
| EVM level | **Pre-Shanghai** (no `PUSH0`, no `MCOPY`) |

### EVM compatibility

The project is built with **swissledger-foundry**, a Swissledger-fork of Foundry
with default `evm_version = "istanbul"` (matching the chain's pre-Shanghai EVM).
This avoids emitting PUSH0/MCOPY without needing `via_ir`. Always verify with:

```bash
forge inspect MerkleRootRegistryZK bytecode |
  python3 -c "
import sys
b = sys.stdin.read().strip()[2:]
i, push0, mcopy = 0, 0, 0
while i < len(b):
    op = int(b[i:i+2], 16)
    if op == 0x5f: push0 += 1; i += 2
    elif op == 0x5e: mcopy += 1; i += 2
    elif 0x60 <= op <= 0x7f: i += 2 + (op - 0x5f) * 2
    else: i += 2
print(f'PUSH0: {push0}, MCOPY: {mcopy}')
"
```

### Deploying to ledger.swiss

```bash
# Build with swissledger-foundry (istanbul EVM, no PUSH0/MCOPY)
swissledger-forge build

# Get bytecodes
REGISTRY_BYTECODE=$(forge inspect MerkleRootRegistryZK bytecode)
VERIFIER_BYTECODE=$(forge inspect SemaphoreVerifier bytecode)
SEMAPHORE_BYTECODE=$(forge inspect Semaphore bytecode)

# Deploy via the script (requires rpc-proxy or mock RPC for nonce)
# See swissledger-merkle AGENTS.md for detailed deploy instructions.
```

### RPC quirk: mandatory `params` field

Use `scripts/rpc-proxy.py` to inject missing `params` fields for forge/cast:

```bash
python3 scripts/rpc-proxy.py  # listens on :8545, forwards to ledger.swiss
# Then use --rpc-url http://127.0.0.1:8545 for forge/cast commands
```

Always use `--legacy` and `--gas-price 0`.

## Client CLI

The client uses `@semaphore-protocol/identity`, `@semaphore-protocol/group`,
and `@semaphore-protocol/proof` for off-chain proof generation.

See `clients/merklezk/README.md` for full CLI documentation.

## Dependencies

- **Node 24** with ESM modules
- **swissledger-foundry** (`swissledger-forge` + `swissledger-cast`), built from `../swissledger-foundry`
- No `ethers`/`hardhat`/`truffle` — Foundry-only for Solidity
- Semaphore v4 packages from npm
