BIN_DIR := $(CURDIR)/bin
FORGE := $(BIN_DIR)/swissledger-forge
CAST := $(BIN_DIR)/swissledger-cast
ANVIL := $(BIN_DIR)/swissledger-anvil

.PHONY: help setup toolchain-install toolchain-info assert-toolchain generate-build-info check-build-info build artifact-compatibility reproducible-build test-artifact-compatibility dependency-integrity dependency-evidence format solidity-analysis coverage test-build test-solidity test-client test-smoke test-smoke-isolation test-all test ci

help:
	@printf '%s\n' 'Swissledger AnonSet targets:' \
	  '  make toolchain-install  install checksummed SwissLedger Foundry v1.11.0 into ./bin' \
	  '  make toolchain-info     verify the pinned local toolchain' \
	  '  make build              generate BuildInfo and compile Istanbul artifacts' \
	  '  make test               run the complete local/CI quality gate' \
	  '  make test-client        run Node client tests' \
	  '  make test-solidity      run Forge unit/fuzz tests' \
	  '  make test-smoke         run the local-only Anvil protocol smoke' \
	  '  make dependency-evidence write ignored SBOM and license evidence under artifacts/' \
	  'See README.md and docs/ for testnet, release, and production procedures.'

setup:
	./scripts/install-deps
	./scripts/keygen

toolchain-install:
	./scripts/install-swissledger-toolchain

toolchain-info: assert-toolchain
	@$(FORGE) --version
	@$(CAST) --version
	@$(ANVIL) --version

assert-toolchain:
	@test -x "$(FORGE)" && test -x "$(CAST)" && test -x "$(ANVIL)" || { echo "SwissLedger Foundry v1.11.0 is missing; run make toolchain-install" >&2; exit 1; }
	@$(FORGE) --version | grep -F "1.11.0" >/dev/null
	@$(CAST) --version | grep -F "1.11.0" >/dev/null
	@$(ANVIL) --version | grep -F "1.11.0" >/dev/null

generate-build-info:
	npm run generate:build-info

check-build-info:
	npm run check:build-info

build: assert-toolchain generate-build-info
	$(FORGE) build

artifact-compatibility: build
	node scripts/check-artifact-compatibility.mjs

reproducible-build: assert-toolchain generate-build-info
	node scripts/verify-reproducibility.mjs

test-artifact-compatibility:
	node --test test/artifact-compatibility.test.mjs

dependency-integrity:
	npm run check:dependencies
	npm audit --omit=dev

dependency-evidence: dependency-integrity
	mkdir -p artifacts
	npm sbom --omit=dev --sbom-format=cyclonedx > artifacts/dependencies.cdx.json
	npm run licenses -- --output artifacts/dependency-licenses.json

format: assert-toolchain
	$(FORGE) fmt --check

solidity-analysis:
	npx --no-install solhint 'src/**/*.sol'

coverage: assert-toolchain generate-build-info
	@report=$$(mktemp); trap 'rm -f "$$report"' EXIT; $(FORGE) coverage --report summary >"$$report"; cat "$$report"; node scripts/check-coverage.mjs "$$report"

test-solidity: assert-toolchain generate-build-info
	$(FORGE) test -vvv

test-client:
	npm test

test-build:
	node --test test/*.test.mjs
	./test/toolchain-installer.test.sh
	shellcheck scripts/build-solc scripts/e2e-smoke scripts/install-deps scripts/install-swissledger-toolchain scripts/keygen scripts/testnet-deploy scripts/testnet-zk-smoke test/e2e-smoke.test.sh test/toolchain-installer.test.sh

test-smoke: assert-toolchain generate-build-info
	./scripts/e2e-smoke

test-smoke-isolation: assert-toolchain generate-build-info
	./test/e2e-smoke.test.sh

test-all: check-build-info format dependency-integrity build artifact-compatibility reproducible-build test-build test-client test-solidity solidity-analysis coverage test-smoke test-smoke-isolation

test: test-all

ci: test
