#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

CI=false
FULL=false
SMOKE=false

for arg in "$@"; do
  case "$arg" in
    --ci)   CI=true ;;
    --full) FULL=true ;;
    --smoke) SMOKE=true ;;
    --help|-h)
      echo "Usage: ./scripts/test.sh [--ci] [--full] [--smoke]"
      echo ""
      echo "  --ci      CI mode (skip npm ci, deps pre-installed)"
      echo "  --full    Run full test suite (includes Groth16 ZK proof tests)"
      echo "  --smoke   Also run on-chain smoke test (needs RPC_URL + PRIVATE_KEY)"
      echo ""
      echo "  default: fast tests (DummyVerifier, no Groth16 compilation)"
      exit 0
      ;;
    *) echo "unknown flag: $arg"; exit 1 ;;
  esac
done

banner() { echo ""; echo "=== $* ==="; }

# --- deps ---
if $CI; then
  echo "[ci] skipping npm install"
else
  banner "installing dependencies"
  npm ci
fi

# --- build info ---
banner "generating BuildInfo"
node scripts/generate-build-info.mjs

# --- forge build ---
banner "forge build (compiling Solidity)"
forge build

# --- forge test ---
if $FULL; then
  banner "forge test (full suite — includes Groth16 ZK proofs)"
  cp test-slow/*.t.sol test/
  forge test -vvv
  rm -f test/MerkleRootRegistryZK.t.sol
else
  banner "forge test (fast suite — DummyVerifier, no Groth16)"
  forge test -vvv
fi

# --- node tests ---
banner "node client tests"
node --test clients/anonset/anonset.test.mjs

# --- smoke ---
if $SMOKE; then
  banner "on-chain smoke test"

  RPC_URL="${RPC_URL:-}"
  PRIVATE_KEY="${PRIVATE_KEY:-}"
  CHAIN_ID="${CHAIN_ID:-222}"

  if [ -z "$RPC_URL" ] || [ -z "$PRIVATE_KEY" ]; then
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  WARNING: on-chain smoke test SKIPPED                       ║"
    echo "║  RPC_URL or PRIVATE_KEY not available.                      ║"
    echo "║  No chain compatibility validation was performed.           ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
  else
    banner "deploying SemaphoreVerifier (Groth16, heavy)"
    forge create node_modules/@semaphore-protocol/contracts/base/SemaphoreVerifier.sol:SemaphoreVerifier \
      --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" \
      --legacy --gas-price 0 --chain "$CHAIN_ID" \
      --gas-limit 10000000 \
      --broadcast --json > /tmp/anonset-verifier.json
    VERIFIER=$(jq -r .deployedTo /tmp/anonset-verifier.json)
    echo "  verifier: $VERIFIER"

    banner "deploying Semaphore"
    forge create node_modules/@semaphore-protocol/contracts/Semaphore.sol:Semaphore \
      --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" \
      --legacy --gas-price 0 --chain "$CHAIN_ID" \
      --gas-limit 10000000 \
      --broadcast --json \
      --constructor-args "$VERIFIER" \
      > /tmp/anonset-semaphore.json
    SEMAPHORE=$(jq -r .deployedTo /tmp/anonset-semaphore.json)
    echo "  semaphore: $SEMAPHORE"

    banner "deploying MerkleRootRegistryZK"
    forge create src/MerkleRootRegistryZK.sol:MerkleRootRegistryZK \
      --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" \
      --legacy --gas-price 0 --chain "$CHAIN_ID" \
      --gas-limit 10000000 \
      --broadcast --json \
      --constructor-args "$SEMAPHORE" \
      > /tmp/anonset-registry.json
    REGISTRY=$(jq -r .deployedTo /tmp/anonset-registry.json)
    echo "  registry: $REGISTRY"

    banner "smoke: addMember + verify"
    COMMITMENT=11005642493773047649202648265396872197147567800455247120861783398111750817516
    cast send "$REGISTRY" "addMember(uint256)" "$COMMITMENT" \
      --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" \
      --legacy --gas-price 0 --chain "$CHAIN_ID" \
      --gas-limit 500000 > /dev/null

    COUNT=$(cast call "$REGISTRY" "memberCount()(uint256)" --rpc-url "$RPC_URL" --chain "$CHAIN_ID")
    ROOT=$(cast call "$REGISTRY" "activeRoot()(uint256)" --rpc-url "$RPC_URL" --chain "$CHAIN_ID")
    VERSION=$(cast call "$REGISTRY" "version()(string)" --rpc-url "$RPC_URL" --chain "$CHAIN_ID")

    echo "  members:  $COUNT"
    echo "  root:     $ROOT"
    echo "  version:  $VERSION"

    if [ "$COUNT" = "0" ]; then echo "FAIL: empty group after addMember"; exit 1; fi
    if [ "$ROOT"  = "0" ]; then echo "FAIL: zero root after addMember";   exit 1; fi
    if [ -z "$VERSION" ];  then echo "FAIL: no version string";            exit 1; fi

    echo "  PASS: on-chain smoke test"
  fi
fi

echo ""
echo "=== all tests passed ==="
