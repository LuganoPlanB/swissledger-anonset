#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

./scripts/e2e-smoke >/dev/null
./scripts/e2e-smoke >/dev/null
./scripts/e2e-smoke >/dev/null &
first=$!
./scripts/e2e-smoke >/dev/null &
second=$!
wait "$first"
wait "$second"
pid_file="$(mktemp)"
if ANONSET_SMOKE_FAIL_AFTER_READY=1 ANONSET_SMOKE_PID_FILE="$pid_file" ./scripts/e2e-smoke >/dev/null 2>&1; then
    printf 'injected smoke failure unexpectedly succeeded\n' >&2
    exit 1
fi
read -r pid port <"$pid_file"
rm -f -- "$pid_file"
if kill -0 "$pid" 2>/dev/null || ./bin/swissledger-cast chain-id --rpc-url "http://127.0.0.1:$port" >/dev/null 2>&1; then
    printf 'injected smoke failure leaked its Anvil process or listener\n' >&2
    exit 1
fi
