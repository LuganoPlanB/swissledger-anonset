import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof, verifyProof } from "./proof-runtime.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "anonset-cli.mjs");
const TMP = path.resolve(__dirname, "..", "..", "fixtures", "anonset");

function runCli(args) {
    return execSync(`node ${CLI} ${args}`, { encoding: "utf8", cwd: __dirname }).trim();
}

/**
 * Helper to run CLI and get JSON output.
 */
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
        // hex private key should be 64 hex chars (32 bytes)
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

describe("anonset CLI — proof generation", () => {
    const tmpDir = TMP;

    function setup() {
        rmSync(tmpDir, { recursive: true, force: true });
        mkdirSync(tmpDir, { recursive: true });
    }

    it("generates a valid Semaphore proof (local verification)", async () => {
        setup();
        // Create identities
        const id1 = new Identity();
        const id2 = new Identity();

        const identityFile = path.join(tmpDir, "identity.json");
        writeFileSync(identityFile, JSON.stringify({
            privateKey: Buffer.from(id1.privateKey).toString("hex"),
            commitment: id1.commitment.toString(),
        }));

        // Create group with both commitments
        const group = new Group([id1.commitment, id2.commitment]);
        const groupFile = path.join(tmpDir, "group.json");
        writeFileSync(groupFile, JSON.stringify({
            members: group.members.map(String),
        }));

        // Generate proof via CLI
        const proof = cliJson(`proof generate ${identityFile} ${groupFile}`);

        assert.ok(proof.merkleTreeDepth, "missing depth");
        assert.ok(proof.merkleTreeRoot, "missing root");
        assert.ok(proof.nullifier, "missing nullifier");
        assert.equal(proof.points.length, 8, "points must be 8 elements");

        // Verify locally
        const valid = await verifyProof(proof);
        assert.equal(valid, true, "proof failed local verification");
    });

    it("custom message and scope", async () => {
        setup();
        const id = new Identity();
        const identityFile = path.join(tmpDir, "identity2.json");
        writeFileSync(identityFile, JSON.stringify({
            privateKey: Buffer.from(id.privateKey).toString("hex"),
            commitment: id.commitment.toString(),
        }));

        const group = new Group([id.commitment]);
        const groupFile = path.join(tmpDir, "group2.json");
        writeFileSync(groupFile, JSON.stringify({
            members: group.members.map(String),
        }));

        const proof = cliJson(
            `proof generate ${identityFile} ${groupFile} "my-message" "my-scope"`
        );

        // Message and scope are stored as bigint representations
        assert.ok(proof.nullifier, "should have nullifier");
        assert.ok(proof.points, "should have points");

        const valid = await verifyProof(proof);
        assert.equal(valid, true);
    });

    it("rejects non-membership proof", () => {
        setup();
        const id = new Identity();
        const nonMember = new Identity();

        const identityFile = path.join(tmpDir, "identity3.json");
        writeFileSync(identityFile, JSON.stringify({
            privateKey: Buffer.from(nonMember.privateKey).toString("hex"),
            commitment: nonMember.commitment.toString(),
        }));

        const group = new Group([id.commitment]); // nonMember is NOT in the group
        const groupFile = path.join(tmpDir, "group3.json");
        writeFileSync(groupFile, JSON.stringify({
            members: group.members.map(String),
        }));

        assert.throws(
            () => runCli(`proof generate ${identityFile} ${groupFile}`),
            /does not exist|not found|index/i
        );
    });

    it("rejects missing arguments", () => {
        assert.throws(
            () => runCli("proof generate"),
            /requires/
        );
    });

    it("releases proof worker resources", async () => {
        const identity = new Identity();
        const group = new Group([identity.commitment]);
        const proof = await generateProof(identity, group, "0", "0");

        assert.equal(await verifyProof(proof), true);
        assert.equal(
            process.getActiveResourcesInfo().filter((resource) => resource === "MessagePort").length,
            0,
        );
    });
});

describe("anonset CLI — verify local", () => {
    const tmpDir = TMP;

    function setupVerify() {
        rmSync(tmpDir, { recursive: true, force: true });
        mkdirSync(tmpDir, { recursive: true });
    }

    it("verifies a valid proof as true", async () => {
        setupVerify();
        const id = new Identity();
        const group = new Group([id.commitment]);

        const proof = await generateProof(id, group, "0", "0");
        const proofFile = path.join(tmpDir, "valid-proof.json");
        writeFileSync(proofFile, JSON.stringify(proof, null, 2));

        const result = runCli(`verify local ${proofFile}`);
        assert.equal(result, "true");
    });

    it("returns false for tampered proof", async () => {
        const id = new Identity();
        const group = new Group([id.commitment]);

        const proof = await generateProof(id, group, "0", "0");
        // Tamper with the first point
        proof.points[0] = "1";
        const proofFile = path.join(tmpDir, "bad-proof.json");
        writeFileSync(proofFile, JSON.stringify(proof, null, 2));

        const result = runCli(`verify local ${proofFile}`);
        assert.equal(result, "false");
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
