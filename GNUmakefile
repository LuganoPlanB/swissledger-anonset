setup:
	./scripts/install-deps
	./scripts/keygen

generate-build-info:
	npm run generate:build-info

build: generate-build-info
	forge build

test-solidity: generate-build-info
	forge test -vvv

test-client:
	npm test

test-smoke: generate-build-info
	./scripts/e2e-smoke

test-all: build test-client test-solidity test-smoke

test: test-all
