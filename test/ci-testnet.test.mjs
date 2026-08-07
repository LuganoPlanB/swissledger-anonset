import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const workflow = readFileSync(join(root, ".github/workflows/test.yml"), "utf8");
const deploy = join(root, "scripts/testnet-deploy");
const evidence = readFileSync(join(root, "scripts/testnet-evidence.mjs"), "utf8");

test("workflow permits Environment-approved same-repository PR testnet validation but excludes forks", () => {
    assert.match(workflow, /pull_request:/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /needs: local-gates/);
    assert.match(workflow, /environment: swissledger-testnet/);
    assert.match(workflow, /swissledger-testnet-deployer-222/);
    assert.match(workflow, /SWISSLEDGER_TESTNET_RPC: \$\{\{ vars\.SWISSLEDGER_TESTNET_RPC \}\}/);
    assert.match(workflow, /SWISSLEDGER_TESTNET_ADDRESS: \$\{\{ vars\.SWISSLEDGER_TESTNET_ADDRESS \}\}/);
    assert.match(workflow, /SWISSLEDGER_TESTNET_DEPLOY/);
    assert.match(workflow, /scripts\/rpc-proxy\.py --target "\$SWISSLEDGER_TESTNET_RPC"/);
    assert.match(workflow, /missing org variable SWISSLEDGER_TESTNET_RPC/);
    assert.match(workflow, /missing org variable SWISSLEDGER_TESTNET_ADDRESS/);
    assert.match(workflow, /github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'/);
    assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
    assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
    assert.match(workflow, /github\.event\.pull_request\.base\.ref == 'main'/);
    const permitsTestnet = ({ event, ref, headRepository, repository, base }) =>
        (["push", "workflow_dispatch"].includes(event) && ref === "refs/heads/main") ||
        (event === "pull_request" && headRepository === repository && base === "main");
    assert.equal(permitsTestnet({ event: "pull_request", ref: "refs/pull/1/merge", headRepository: "owner/repo", repository: "owner/repo", base: "main" }), true);
    assert.equal(permitsTestnet({ event: "pull_request", ref: "refs/pull/1/merge", headRepository: "fork/repo", repository: "owner/repo", base: "main" }), false);
    assert.equal(permitsTestnet({ event: "pull_request", ref: "refs/pull/1/merge", headRepository: "owner/repo", repository: "owner/repo", base: "release" }), false);
    assert.equal(permitsTestnet({ event: "workflow_dispatch", ref: "refs/heads/feature/untrusted" }), false);
    assert.equal(permitsTestnet({ event: "workflow_dispatch", ref: "refs/heads/main" }), true);
    assert.doesNotMatch(workflow, /@[vV]\d+(?:\.|\s|$)/);
    assert.match(workflow, /make dependency-evidence/);
});

test("evidence bundle has explicit secret scanning and bytecode identity", () => {
    assert.match(evidence, /abiSha256/);
    assert.match(evidence, /bytecodeSha256/);
    assert.match(evidence, /secret-shaped data/);
    assert.match(evidence, /dependencies\.cdx\.json/);
});

test("evidence generator validates fixture schema, hashes, and secret rejection", () => {
    const dir = mkdtempSync(join(tmpdir(), "anonset-evidence-test-"));
    const out = join(dir, "out"); const artifacts = join(dir, "artifacts"); mkdirSync(join(out, "MerkleRootRegistryZK.sol"), { recursive: true }); mkdirSync(join(out, "Semaphore.sol"), { recursive: true }); mkdirSync(join(out, "SemaphoreVerifier.sol"), { recursive: true }); mkdirSync(artifacts);
    for (const name of ["MerkleRootRegistryZK", "Semaphore", "SemaphoreVerifier"]) writeFileSync(join(out, `${name}.sol`, `${name}.json`), JSON.stringify({ abi: [{ name }], bytecode: { object: "6000" } }));
    writeFileSync(join(artifacts, "dependencies.cdx.json"), "{}"); writeFileSync(join(artifacts, "dependency-licenses.json"), "[]");
    const deployment = join(dir, "deployment.json"), smoke = join(dir, "smoke.json"), bundle = join(dir, "bundle");
    writeFileSync(deployment, JSON.stringify({ schema: 1, chainId: 222, rpcHost: "testnet.example", deployer: "0x0000000000000000000000000000000000000001", registry: "0x0000000000000000000000000000000000000002", semaphore: "0x0000000000000000000000000000000000000003", verifier: "0x0000000000000000000000000000000000000004", deployments: [] })); writeFileSync(smoke, JSON.stringify({ registry: "0x0000000000000000000000000000000000000002" }));
    try { execFileSync(process.execPath, [join(root, "scripts/testnet-evidence.mjs"), deployment, smoke, bundle], { env: { ...process.env, ANONSET_EVIDENCE_ROOT: dir } }); const manifest = JSON.parse(readFileSync(join(bundle, "manifest.json"))); assert.equal(manifest.chainId, 222); assert.equal(manifest.contracts.length, 3); assert.match(manifest.contracts[0].bytecodeSha256, /^[a-f0-9]{64}$/); writeFileSync(smoke, JSON.stringify({ registry: "0x0000000000000000000000000000000000000002", privateKey: "bad" })); assert.throws(() => execFileSync(process.execPath, [join(root, "scripts/testnet-evidence.mjs"), deployment, smoke, bundle], { env: { ...process.env, ANONSET_EVIDENCE_ROOT: dir } })); } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("testnet deployment rejects invalid credentials and the production chain before broadcasting", () => {
    const base = { FORGE_BIN: "/definitely/missing", CAST_BIN: "/definitely/missing", SWISSLEDGER_TESTNET_RPC: "https://testnet.example", SWISSLEDGER_TESTNET_ADDRESS: "0x00000000000000000000000000000000000000aa", SWISSLEDGER_TESTNET_DEPLOY: "0x" + "1".repeat(64) };
    for (const [extra, expected] of [[{ SWISSLEDGER_TESTNET_CHAIN_ID: "110" }, /only SwissLedger testnet/], [{ SWISSLEDGER_TESTNET_DEPLOY: "invalid" }, /32-byte private key/], [{ SWISSLEDGER_TESTNET_RPC: "https:\/\/user:pass@example" }, /credential-free/], [{ SWISSLEDGER_TESTNET_RPC: "" }, /missing SWISSLEDGER_TESTNET_RPC/], [{ SWISSLEDGER_TESTNET_ADDRESS: "" }, /expected public deployer address/], [{ SWISSLEDGER_TESTNET_VERIFIER_GAS_LIMIT: "nope" }, /operational ceiling/], [{ SWISSLEDGER_TESTNET_REGISTRY_GAS_LIMIT: "20000000" }, /operational ceiling/]]) {
        const result = spawnSync(deploy, ["/tmp/unused.json"], { cwd: root, env: { ...process.env, ...base, ...extra }, encoding: "utf8" });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, expected);
    }
});

test("testnet deployment writes a secret-free three-contract manifest against a stub RPC", () => {
    const dir = mkdtempSync(join(tmpdir(), "anonset-testnet-test-"));
    const forge = join(dir, "forge");
    const cast = join(dir, "cast");
    const out = join(dir, "deployment.json");
    writeFileSync(forge, `#!/usr/bin/env bash\nset -eu\nif [[ $1 == build ]]; then exit 0; fi\n[[ -z \${MOCK_FORGE_EXIT:-} ]] || exit "$MOCK_FORGE_EXIT"\nif [[ -n \${MOCK_FORGE_JSON:-} ]]; then printf '%s' "$MOCK_FORGE_JSON"; exit 0; fi\nname=$2\ncase "$name" in *SemaphoreVerifier*) a=0x0000000000000000000000000000000000000001; h=0x$(printf '1%.0s' {1..64});; *Semaphore.sol*) a=0x0000000000000000000000000000000000000002; h=0x$(printf '2%.0s' {1..64});; *) a=0x0000000000000000000000000000000000000003; h=0x$(printf '3%.0s' {1..64});; esac\nprintf '{"deployedTo":"%s","transactionHash":"%s"}' "$a" "$h"\n`);
    writeFileSync(cast, `#!/usr/bin/env bash\nset -eu\ncase "$1" in chain-id) echo "\${MOCK_CHAIN_ID:-222}";; wallet) echo 0x00000000000000000000000000000000000000aa;; balance) echo "\${MOCK_BALANCE:-1}";; receipt) if [[ -n \${MOCK_RECEIPT:-} ]]; then echo "$MOCK_RECEIPT"; else echo '{"status":"0x1","gasUsed":"0x5208"}'; fi;; code) echo "\${MOCK_CODE:-0x6000}";; call) case "$3" in verifier*) echo 0x0000000000000000000000000000000000000001;; semaphore*) echo 0x0000000000000000000000000000000000000002;; esac;; *) exit 99;; esac\n`);
    chmodSync(forge, 0o755); chmodSync(cast, 0o755);
    try {
        const privateKey = "0x" + "a".repeat(64);
        const deploymentEnvironment = { ...process.env, FORGE_BIN: forge, CAST_BIN: cast, SWISSLEDGER_TESTNET_RPC: "https://testnet.example", SWISSLEDGER_TESTNET_ADDRESS: "0x00000000000000000000000000000000000000aa", SWISSLEDGER_TESTNET_DEPLOY: privateKey };
        execFileSync(deploy, [out], { cwd: root, env: deploymentEnvironment });
        const manifest = JSON.parse(readFileSync(out));
        assert.equal(manifest.chainId, 222);
        assert.equal(manifest.operationalGasCeiling, 20000000);
        assert.equal(manifest.deployments.length, 3);
        assert.deepEqual(manifest.deployments.map(({ gasLimit }) => gasLimit), ["1000000", "5000000", "5000000"]);
        assert.equal(JSON.stringify(manifest).includes(privateKey), false);
        const mismatch = spawnSync(deploy, [out], { cwd: root, env: { ...deploymentEnvironment, SWISSLEDGER_TESTNET_ADDRESS: "0x00000000000000000000000000000000000000ab" }, encoding: "utf8" });
        assert.notEqual(mismatch.status, 0);
        assert.match(mismatch.stderr, /derived deployer does not match/);
        for (const [mock, expected] of [
            [{ MOCK_CHAIN_ID: "110" }, /chain ID is not 222/],
            [{ MOCK_RECEIPT: '{"status":"0x0","gasUsed":"0x5208"}' }, /not successful/],
            [{ MOCK_RECEIPT: "null" }, /not successful/],
            [{ MOCK_CODE: "0x" }, /empty runtime code/],
            [{ MOCK_RECEIPT: '{"status":"0x1","gasUsed":"0xb71b00"}' }, /gas cap/],
            [{ MOCK_FORGE_JSON: "not-json" }, /returned no deployment address/],
            [{ MOCK_FORGE_EXIT: "17" }, /returned no deployment address/],
        ]) {
            const result = spawnSync(deploy, [out], { cwd: root, env: { ...deploymentEnvironment, ...mock }, encoding: "utf8" });
            assert.notEqual(result.status, 0);
            assert.match(result.stderr, expected);
        }
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
