#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT
readonly INSTALLER="$ROOT/scripts/install-swissledger-toolchain"

expect_failure() {
    local description="$1"
    shift
    if "$@" >/dev/null 2>&1; then
        printf 'expected failure: %s\n' "$description" >&2
        exit 1
    fi
}

expect_failure "unsupported platform" env SWISSLEDGER_PLATFORM="Plan9-mips" "$INSTALLER"

temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
mock_bin="$temporary/mock-bin"
mkdir "$mock_bin"
cat >"$mock_bin/curl" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
output=""
while (($#)); do
    if [[ "$1" == "--output" ]]; then output="$2"; shift 2; continue; fi
    shift
done
printf 'untrusted bytes' >"$output"
EOF
chmod 0755 "$mock_bin/curl"

expect_failure "checksum mismatch" env PATH="$mock_bin:$PATH" SWISSLEDGER_BIN_DIR="$temporary/bin" "$INSTALLER"
[[ ! -e "$temporary/bin/swissledger-forge" ]]
[[ -z "$(find "$temporary/bin" -mindepth 1 -maxdepth 1 -print -quit)" ]]
printf 'toolchain installer failure paths: PASS\n'
