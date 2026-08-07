# Swissledger AnonSet — Agent Reference

## Project Map

| Area | Path | What |
|---|---|---|
| Solidity contracts | `src/` | `MerkleRootRegistryZK.sol`, `BuildInfo.sol` |
| Tests (Solidity) | `test/` | `forge test` via swissledger-foundry |
| Tests (Node) | `clients/anonset/*.test.mjs` | `node --test` |
| Off-chain client | `clients/anonset/anonset-cli.mjs` | Identity, proof generation, verification |
| Deploy scripts | `scripts/testnet-deploy`, `scripts/testnet-zk-smoke` | Fresh chain-222 CI stack and proof smoke |
| Scripts | `scripts/` | pinned toolchain installer, build-info, local smoke, testnet evidence |
| Config | `foundry.toml`, `package.json`, `GNUmakefile`, `mise.toml` |

## Quick Commands

```bash
make toolchain-install # install checksummed SwissLedger Foundry v1.11.0 in ./bin
make build             # regenerate BuildInfo.sol + Istanbul build
make test              # complete finite local/CI quality gate
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

The reusable API calls `Semaphore.verifyProof()`.
This means:
- No nullifier reuse tracking
- Same member can prove inclusion unlimited times
- `validateMembership` is the distinct replay-protected registry API and uses
  Semaphore's nullifier validation; do not mistake reusable checks for claims.

### Deployed contract addresses

Each fresh protected CI testnet deployment records these three addresses in its
downloadable evidence manifest:

| Contract | Variable |
|---|---|
| `MerkleRootRegistryZK` | `registryAddr` |
| `Semaphore` | `semaphoreAddr` |
| `SemaphoreVerifier` | `semaphoreVerifierAddr` |

## SwissLedger networks

### Chain identity

| Property | Value |
|---|---|
| Testnet | `222`; protected CI only; each run creates fresh evidence-only addresses |
| Production | `110`; manual governance-gated promotion only; no CI deployment |
| EVM level | Istanbul; reject executed `PUSH0`/`MCOPY` with `make artifact-compatibility` |

### EVM compatibility

The project uses checksummed **SwissLedger Foundry v1.11.0** from `./bin` and
`foundry.toml` is authoritative for Solc 0.8.30/Istanbul. Use:

```bash
make artifact-compatibility
```

### Testnet deployment

Only `.github/workflows/test.yml` starts a fresh chain-222 deployment. It uses
the protected `swissledger-testnet` Environment, organization RPC/address
variables, and the deployer organization secret after an approved
same-repository PR to `main`, or on protected `main`; fork PRs stay secret-free.
PR validation never triggers release automation. It uses legacy
zero-price transactions and `scripts/rpc-proxy.py` solely to normalize the
known mandatory-`params` RPC behavior. The proxy accepts an explicit target;
it is not a production deploy tool. Read `docs/DEPLOYMENT.md` for evidence
location and the manual production process.

## Client CLI

The client uses `@semaphore-protocol/identity`, `@semaphore-protocol/group`,
and `@semaphore-protocol/proof` for off-chain proof generation.

See `clients/anonset/README.md` for the exact CLI contract.

## Dependencies

- **Node 24** with ESM modules
- **SwissLedger Foundry v1.11.0** (`bin/swissledger-forge`, `bin/swissledger-cast`, `bin/swissledger-anvil`)
- Solidity builds/tests are Foundry-only; do not add Hardhat or Truffle. The
  Node client intentionally uses `ethers` for read-only JSON-RPC verification.
- Semaphore v4 packages from npm
