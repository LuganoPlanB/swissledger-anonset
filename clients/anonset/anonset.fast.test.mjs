import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "anonset-cli.mjs");

function runCli(args) {
    return execSync(`node ${CLI} ${args}`, { encoding: "utf8", cwd: __dirname }).trim();
}

function cliJson(args) {
    return JSON.parse(runCli(args));
}

describe("anonset CLI — identity", () => {
    it("creates a random identity", () => {
        const result = cliJson("identity create");
        assert.ok(result.privateKey, "missing privateKey");
        assert.ok(result.commitment, "missing commitment");
        assert.equal(typeof result.privateKey, "string");
        assert.equal(typeof result.commitment, "string");
        assert.match(result.privateKey, /^[0-9a-f]{64}$/);
    });

    it("creates a deterministic identity from a given private key", () => {
        const privateKey = "0".repeat(64);
        const result1 = cliJson(`identity create ${privateKey}`);
        const result2 = cliJson(`identity create ${privateKey}`);
        assert.equal(result1.commitment, result2.commitment, "same key should produce same commitment");
    });

    it("different keys produce different commitments", () => {
        const r1 = cliJson("identity create");
        const r2 = cliJson("identity create");
        assert.notEqual(r1.commitment, r2.commitment);
    });
});

describe("anonset CLI — help", () => {
    it("prints usage with --help", () => {
        const output = runCli("--help");
        assert.match(output, /Usage/);
        assert.match(output, /identity create/);
        assert.match(output, /proof generate/);
    });

    it("prints usage with no arguments", () => {
        const output = runCli("");
        assert.match(output, /Usage/);
    });
});

describe("anonset CLI — proof errors (no ZK download)", () => {
    it("rejects missing arguments", () => {
        assert.throws(
            () => runCli("proof generate"),
            /requires/
        );
    });
});
