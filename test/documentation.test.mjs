import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url);
const text = (path) => readFileSync(new URL(path, root), "utf8");

test("maintainer documentation points to current commands and paths", () => {
    const readme = text("README.md");
    const agents = text("AGENTS.md");
    const deployment = text("docs/DEPLOYMENT.md");
    for (const path of ["README.md", "USAGE.md", "AGENTS.md", "GNUmakefile", "clients/anonset/README.md", "docs/DEPLOYMENT.md", "docs/OPERATIONS.md", "docs/READINESS.md"]) {
        assert.ok(existsSync(new URL(path, root)), `missing documented path: ${path}`);
    }
    assert.match(readme, /SwissLedger Foundry v1\.11\.0/);
    assert.match(readme, /SwissLedger testnet \| `222`/);
    assert.match(readme, /SwissLedger production \| `110`/);
    assert.match(readme, /validateMembership/);
    assert.match(readme, /96\.04%/);
    assert.match(readme, /10,689,124/);
    assert.match(readme, /36\.279 s/);
    const usage = text("USAGE.md");
    assert.match(usage, /LLM usage contract/);
    assert.match(usage, /make test/);
    assert.match(usage, /PoseidonT6` is not interchangeable/);
    assert.match(usage, /Chain `110` has no automated/);
    assert.match(usage, /Timings are observations, not SLAs/);
    assert.doesNotMatch(agents, /clients\/merklezk/);
    assert.match(agents, /Node client intentionally uses `ethers`/);
    assert.match(agents, /do not add Hardhat or Truffle/);
    assert.match(agents, /vendor\/poseidon-solidity\/PoseidonT3\.sol/);
    assert.match(agents, /do not substitute PoseidonT6/);
    assert.match(deployment, /external Solidity and ZK-protocol audit/);
    assert.match(deployment, /zero native-token balance is valid/);
    assert.doesNotMatch(deployment, /nonzero registered balance/);
    const operations = text("docs/OPERATIONS.md");
    for (const incident of ["Leaked testnet deployer key", "Wrong-chain RPC", "Partial linked-stack deployment", "Compromised member manager", "Ownership acceptance failure", "Vulnerable Semaphore\/toolchain dependency", "Bad GitHub release"]) {
        assert.match(operations, new RegExp(incident));
    }
    assert.match(operations, /Detection \| Containment \| Recovery \| Preserve evidence/);
    assert.match(text("docs/READINESS.md"), /Required external evidence gate/);
    assert.match(deployment, /aggregate deployment, protocol,/);
    assert.match(deployment, /wall-clock observations/);
    assert.match(readme, /same-repository PR whose base is `main`/);
    assert.match(readme, /fork PRs remain secret-free/);
    assert.match(readme, /PR\s+validation creates fresh\s+testnet evidence only; it never starts a release/);
    assert.match(readme, /SWISSLEDGER_TESTNET_RPC/);
    assert.match(readme, /organization secret `SWISSLEDGER_TESTNET_DEPLOY`/);
});

test("documented CLI interface matches current help", () => {
    const help = execFileSync(process.execPath, ["clients/anonset/anonset-cli.mjs", "--help"], {
        cwd: new URL(".", root), encoding: "utf8"
    });
    const client = text("clients/anonset/README.md");
    for (const fragment of [
        "identity create <identity.json> [private-key-hex] [--force]",
        "proof generate <identity.json> <group.json> [message] [scope]",
        "verify local <proof.json>",
        "verify on-chain <address> <proof.json> <rpc-url> <chain-id>"
    ]) {
        assert.match(help, new RegExp(fragment.replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&")));
        assert.match(client, new RegExp(fragment.replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&")));
    }
});
