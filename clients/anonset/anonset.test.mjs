import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Group } from "@semaphore-protocol/group";
import { Identity } from "@semaphore-protocol/identity";
import { generateProof, verifyProof } from "./proof-runtime.mjs";
import { DEFAULT_MAX_INSERTION_SLOTS, MAX_INSERTION_SLOTS, parseInsertionSlotBudget, replayGroupLogs, SEMAPHORE_EVENTS } from "./anonset-cli.mjs";
import { CHECKPOINT_SCHEMA, createCheckpoint, importCheckpoint, readCheckpointFile, serializeCheckpoint, writeCheckpointFile } from "./checkpoint.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(directory, "anonset-cli.mjs");
const tmp = path.join(directory, "..", "..", "fixtures", "anonset");

function run(...args) {
    return spawnSync(process.execPath, [cli, ...args], { cwd: directory, encoding: "utf8", timeout: 10_000 });
}
function runWithInput(input, ...args) {
    return spawnSync(process.execPath, [cli, ...args], { cwd: directory, encoding: "utf8", input, timeout: 10_000 });
}
function json(result) { return JSON.parse(typeof result === "string" ? result : result.stdout); }
function identityFile(name = "identity.json") { return path.join(tmp, name); }
function writeIdentity(file = identityFile()) {
    const identity = new Identity(Buffer.from("0".repeat(64), "hex"));
    writeFileSync(file, JSON.stringify({ privateKey: Buffer.from(identity.privateKey).toString("hex"), commitment: identity.commitment.toString() }));
    return identity;
}
function writeProof(file = path.join(tmp, "proof.json")) {
    writeFileSync(file, JSON.stringify({ merkleTreeDepth: "20", merkleTreeRoot: "1", nullifier: "2", message: "0", scope: "0", points: Array(8).fill("1") }));
    return file;
}
function eventLog(name, values) {
    const encoded = SEMAPHORE_EVENTS.encodeEventLog(SEMAPHORE_EVENTS.getEvent(name), values);
    return { topics: encoded.topics, data: encoded.data };
}
async function startWrongChainRpc() {
    const source = "const h=require('http').createServer((q,s)=>{q.resume();s.setHeader('content-type','application/json');s.end(JSON.stringify({jsonrpc:'2.0',id:1,result:'0x1'}))});h.listen(0,'127.0.0.1',()=>console.log(h.address().port));";
    const child = spawn(process.execPath, ["-e", source], { stdio: ["ignore", "pipe", "inherit"] });
    const port = await new Promise((resolve, reject) => {
        child.stdout.once("data", (data) => resolve(Number.parseInt(String(data), 10)));
        child.once("error", reject);
    });
    return { child, port };
}
async function startHangingRpc() {
    const source = "require('http').createServer((q,s)=>{q.resume()}).listen(0,'127.0.0.1',function(){console.log(this.address().port)})";
    const child = spawn(process.execPath, ["-e", source], { stdio: ["ignore", "pipe", "inherit"] });
    const port = await new Promise((resolve, reject) => {
        child.stdout.once("data", (data) => resolve(Number.parseInt(String(data), 10)));
        child.once("error", reject);
    });
    return { child, port };
}

beforeEach(() => { rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true }); });
after(() => rmSync(tmp, { recursive: true, force: true }));

describe("anonset CLI client hardening", () => {
    it("uses a 65,536 insertion-slot default and strictly parses bounded overrides", () => {
        assert.equal(DEFAULT_MAX_INSERTION_SLOTS, 65_536);
        assert.equal(MAX_INSERTION_SLOTS, 4_294_967_296);
        for (const value of ["65535", "65536", "65537", String(MAX_INSERTION_SLOTS)]) assert.equal(parseInsertionSlotBudget(value), Number(value));
        assert.equal(parseInsertionSlotBudget("1"), 1);
        for (const value of ["0", "-1", "1.5", "9007199254740992", String(MAX_INSERTION_SLOTS + 1)]) {
            assert.throws(() => parseInsertionSlotBudget(value));
        }
        const id = identityFile(); writeIdentity(id);
        assert.equal(run("proof", "generate", id, "missing.json", "--max-insertion-slots", "1").status, 3);
        assert.equal(run("proof", "generate", id, "missing.json", "--max-insertion-slots", "1", "--max-insertion-slots", "2").status, 2);
        assert.equal(run("proof", "generate", id, "missing.json", "--unrecognized").status, 2);
    });

    it("enforces insertion slots before single and batch replay work, while removals retain slots", () => {
        const first = new Group([1n]);
        const added = eventLog("MemberAdded", [1n, 0n, 1n, first.root]);
        assert.throws(() => replayGroupLogs([added], 0), /exceeds 0 insertion slots/);
        const batchTree = new Group([1n, 2n]);
        const batch = eventLog("MembersAdded", [1n, 0n, [1n, 2n], batchTree.root]);
        assert.throws(() => replayGroupLogs([batch], 1), /exceeds 1 insertion slots/);
        const removedTree = new Group([1n]);
        removedTree.removeMember(0);
        const removed = eventLog("MemberRemoved", [1n, 0n, 1n, removedTree.root]);
        const replayed = replayGroupLogs([added, removed], 1);
        assert.equal(replayed.insertions, 1);
        assert.equal(replayed.group.members.filter((member) => member !== 0n).length, 0);
    });

    it("writes an atomic owner-only identity and never writes its secret to stdout", () => {
        const destination = identityFile();
        const result = run("identity", "create", destination, "0".repeat(64));
        assert.equal(result.status, 0);
        assert.deepEqual(json(result), { ok: true, commitment: json(readFileSync(destination, "utf8")).commitment });
        assert.equal(statSync(destination).mode & 0o777, 0o600);
        assert.doesNotMatch(result.stdout + result.stderr, /0000000000000000000000000000000000000000000000000000000000000000/);
    });

    it("refuses overwrite without force and retains safe replacement semantics", () => {
        const destination = identityFile();
        assert.equal(run("identity", "create", destination).status, 0);
        const original = readFileSync(destination, "utf8");
        const refused = run("identity", "create", destination);
        assert.equal(refused.status, 3);
        assert.match(refused.stderr, /already exists/);
        assert.equal(readFileSync(destination, "utf8"), original);
        assert.equal(run("identity", "create", destination, "f".repeat(64), "--force").status, 0);
        assert.equal(statSync(destination).mode & 0o777, 0o600);
    });

    it("rejects malformed, oversized, symlinked, and invalid field input before proof generation", () => {
        const id = identityFile(); writeIdentity(id);
        const malformed = path.join(tmp, "malformed.json"); writeFileSync(malformed, "{");
        assert.equal(run("proof", "generate", malformed, malformed).status, 2);
        const oversized = path.join(tmp, "large.json"); writeFileSync(oversized, " ".repeat(1024 * 1024 + 1));
        assert.equal(run("proof", "generate", id, oversized).status, 3);
        const linked = path.join(tmp, "identity-link.json"); symlinkSync(id, linked);
        assert.equal(run("proof", "generate", linked, oversized).status, 3);
        const directoryInput = path.join(tmp, "directory"); mkdirSync(directoryInput);
        assert.equal(run("proof", "generate", directoryInput, directoryInput).status, 3);
        const group = path.join(tmp, "group.json"); writeFileSync(group, JSON.stringify({ members: ["-1"] }));
        assert.equal(run("proof", "generate", id, group).status, 2);
        writeFileSync(group, JSON.stringify({ members: ["1"] }));
        assert.equal(run("proof", "generate", id, group, "-1").status, 2);
    });

    it("rejects malformed proof shapes and invalid addresses without networking", () => {
        const proof = writeProof();
        writeFileSync(proof, JSON.stringify({ merkleTreeDepth: "20", merkleTreeRoot: "1", nullifier: "2", message: "0", scope: "0", points: ["1"] }));
        assert.equal(run("verify", "local", proof).status, 2);
        assert.equal(run("verify", "on-chain", "not-an-address", proof, "http://127.0.0.1:1", "31337").status, 2);
    });

    it("accepts a bounded stdin identity secret without exposing it", () => {
        const secret = "6".repeat(64);
        const result = runWithInput(secret, "proof", "generate-chain", "-", "0x0000000000000000000000000000000000000001", "http://127.0.0.1:1", "31337");
        assert.equal(result.status, 4);
        assert.match(result.stderr, /RPC chain check failed/);
        assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
        assert.equal(runWithInput("x".repeat(129), "proof", "generate-chain", "-", "0x0000000000000000000000000000000000000001", "http://127.0.0.1:1", "31337").status, 3);
        assert.equal(runWithInput("not-a-secret", "proof", "generate-chain", "-", "0x0000000000000000000000000000000000000001", "http://127.0.0.1:1", "31337").status, 2);
    });

    it("checks RPC timeout and wrong-chain response with stable exit code and redacted errors", async () => {
        const proof = writeProof();
        const { child, port } = await startWrongChainRpc();
        const wrong = run("verify", "on-chain", "0x0000000000000000000000000000000000000001", proof, `http://127.0.0.1:${port}`, "31337");
        assert.equal(wrong.status, 4);
        assert.equal(wrong.stdout, "");
        assert.match(wrong.stderr, /chain ID/);
        child.kill();
        const timeout = run("verify", "on-chain", "0x0000000000000000000000000000000000000001", proof, "http://127.0.0.1:1", "31337");
        assert.equal(timeout.status, 4);
        assert.doesNotMatch(timeout.stderr, /privateKey|0000000000000000/i);
        const hanging = await startHangingRpc();
        const actualTimeout = run("verify", "on-chain", "0x0000000000000000000000000000000000000001", proof, `http://127.0.0.1:${hanging.port}`, "31337");
        hanging.child.kill();
        assert.equal(actualTimeout.status, 4);
        assert.match(actualTimeout.stderr, /chain check failed/);
        assert.doesNotMatch(actualTimeout.stderr, /privateKey|0000000000000000/i);
    });

    it("has deterministic identity output, JSON stdout contracts, and usage exit code", () => {
        const first = identityFile("one.json"); const second = identityFile("two.json");
        const key = "a".repeat(64);
        assert.equal(run("identity", "create", first, key).status, 0);
        assert.equal(run("identity", "create", second, key).status, 0);
        assert.equal(json(readFileSync(first, "utf8")).commitment, json(readFileSync(second, "utf8")).commitment);
        const usage = run("identity", "create");
        assert.equal(usage.status, 2);
        assert.equal(usage.stdout, "");
        assert.match(usage.stderr, /requires/);
        const unsafeChain = run("verify", "on-chain", "0x0000000000000000000000000000000000000001", writeProof(path.join(tmp, "safe-proof.json")), "http://127.0.0.1:1", "9007199254740992");
        assert.equal(unsafeChain.status, 2);
        assert.match(unsafeChain.stderr, /safe integer/);
    });
});

it("synthetic replay observation: 65,536 insertion slots without transactions", { timeout: 120_000 }, (t) => {
    const started = performance.now();
    const before = process.memoryUsage().rss;
    const members = Array.from({ length: DEFAULT_MAX_INSERTION_SLOTS }, (_, index) => BigInt(index + 1));
    const batch = eventLog("MembersAdded", [1n, 0n, members, 0n]);
    const replayed = replayGroupLogs([batch], DEFAULT_MAX_INSERTION_SLOTS, false);
    assert.equal(replayed.insertions, DEFAULT_MAX_INSERTION_SLOTS);
    assert.equal(replayed.group.size, DEFAULT_MAX_INSERTION_SLOTS);
    t.diagnostic(`observational replay: ${Math.round(performance.now() - started)} ms; rss delta ${process.memoryUsage().rss - before} bytes`);
});

it("checkpoint module round-trips deterministic public state", () => {
    const group = new Group([1n, 2n]); group.removeMember(0);
    const metadata = { chainId: "31337", registry: "0x0000000000000000000000000000000000000001", semaphore: "0x0000000000000000000000000000000000000002", groupId: "7", startBlock: "1", snapshotBlock: "2", snapshotHash: `0x${"a".repeat(64)}`, root: group.root.toString(), depth: String(group.depth), size: String(group.size), insertionSlots: "2", activeMembers: "1" };
    const checkpoint = createCheckpoint(metadata, group, DEFAULT_MAX_INSERTION_SLOTS);
    assert.equal(checkpoint.schema, CHECKPOINT_SCHEMA);
    assert.equal(serializeCheckpoint(checkpoint), serializeCheckpoint(importCheckpoint(serializeCheckpoint(checkpoint), { maxInsertionSlots: DEFAULT_MAX_INSERTION_SLOTS }).checkpoint));
    assert.throws(() => importCheckpoint(serializeCheckpoint({ ...checkpoint, root: "0" }), { maxInsertionSlots: DEFAULT_MAX_INSERTION_SLOTS }), /root/);
    const underreported = { ...checkpoint, insertionSlots: "1" };
    assert.throws(() => importCheckpoint(serializeCheckpoint(underreported), { maxInsertionSlots: 1 }), /insertionSlots/);
    assert.throws(() => createCheckpoint({ ...metadata, insertionSlots: "1" }, group, 2), /insertionSlots/);
});

it("checkpoint persistence rejects unsafe or modified input and retains prior data on failure", () => {
    const group = new Group([1n]);
    const metadata = { chainId: "31337", registry: "0x0000000000000000000000000000000000000001", semaphore: "0x0000000000000000000000000000000000000002", groupId: "7", startBlock: "1", snapshotBlock: "2", snapshotHash: `0x${"b".repeat(64)}`, root: group.root.toString(), depth: String(group.depth), size: String(group.size), insertionSlots: "1", activeMembers: "1" };
    const checkpoint = createCheckpoint(metadata, group, DEFAULT_MAX_INSERTION_SLOTS);
    const destination = path.join(tmp, "checkpoint.json");
    const descriptor = writeCheckpointFile(destination, checkpoint);
    assert.equal(descriptor.groupExport, undefined);
    assert.equal(readCheckpointFile(destination, { maxInsertionSlots: DEFAULT_MAX_INSERTION_SLOTS }).group.root, group.root);
    const original = readFileSync(destination, "utf8");
    assert.throws(() => writeCheckpointFile(destination, checkpoint, { injectFailure: true }), /injected/);
    assert.equal(readFileSync(destination, "utf8"), original);
    const linked = path.join(tmp, "checkpoint-link.json"); symlinkSync(destination, linked);
    assert.throws(() => readCheckpointFile(linked, { maxInsertionSlots: DEFAULT_MAX_INSERTION_SLOTS }), /non-symlink/);
    assert.throws(() => writeCheckpointFile(linked, checkpoint), /unsafe/);
    const directory = path.join(tmp, "checkpoint-directory"); mkdirSync(directory);
    assert.throws(() => readCheckpointFile(directory, { maxInsertionSlots: DEFAULT_MAX_INSERTION_SLOTS }), /regular/);
    writeFileSync(destination, JSON.stringify({ ...checkpoint, groupExportSha256: "0".repeat(64) }));
    assert.throws(() => readCheckpointFile(destination, { maxInsertionSlots: DEFAULT_MAX_INSERTION_SLOTS }), /hash/);
    writeFileSync(destination, "x".repeat(5000));
    assert.throws(() => readCheckpointFile(destination, { maxInsertionSlots: 1 }), /size policy/);
    const twoMembers = new Group([1n, 2n]);
    const twoMemberCheckpoint = createCheckpoint({ ...metadata, root: twoMembers.root.toString(), depth: String(twoMembers.depth), size: String(twoMembers.size), insertionSlots: "2", activeMembers: "2" }, twoMembers, 2);
    assert.throws(() => writeCheckpointFile(path.join(tmp, "over-budget.json"), twoMemberCheckpoint, { maxInsertionSlots: 1 }), /budget/);
});

describe("anonset CLI proof integration", () => {
    function createIdentity(name, key) {
        const result = run("identity", "create", identityFile(name), key);
        assert.equal(result.status, 0);
        return { file: identityFile(name), commitment: json(result).commitment };
    }

    it("proof integration: generates a real member proof and verifies it locally", () => {
        const member = createIdentity("member.json", "1".repeat(64));
        const second = createIdentity("second.json", "2".repeat(64));
        const group = path.join(tmp, "group.json");
        writeFileSync(group, JSON.stringify({ members: [member.commitment, second.commitment] }));
        const generated = run("proof", "generate", member.file, group, "0", "0");
        assert.equal(generated.status, 0, generated.stderr);
        const proof = json(generated);
        assert.equal(proof.points.length, 8);
        const proofPath = writeProof(path.join(tmp, "valid-proof.json"));
        writeFileSync(proofPath, JSON.stringify(proof));
        const verified = run("verify", "local", proofPath);
        assert.equal(verified.status, 0, verified.stderr);
        assert.deepEqual(json(verified), { ok: true });
    });

    it("proof integration: binds a custom numeric message and scope", () => {
        const member = createIdentity("message-member.json", "3".repeat(64));
        const group = path.join(tmp, "message-group.json");
        writeFileSync(group, JSON.stringify({ members: [member.commitment] }));
        const generated = run("proof", "generate", member.file, group, "123", "456");
        assert.equal(generated.status, 0, generated.stderr);
        const proofPath = path.join(tmp, "message-proof.json");
        writeFileSync(proofPath, JSON.stringify(json(generated)));
        assert.deepEqual(json(run("verify", "local", proofPath)), { ok: true });
    });

    it("proof integration: rejects a non-member before proving", () => {
        const member = createIdentity("listed.json", "4".repeat(64));
        const outsider = createIdentity("outsider.json", "5".repeat(64));
        const group = path.join(tmp, "non-member-group.json");
        writeFileSync(group, JSON.stringify({ members: [member.commitment] }));
        const result = run("proof", "generate", outsider.file, group, "0", "0");
        assert.notEqual(result.status, 0);
        assert.doesNotMatch(result.stderr, /privateKey|[0-9a-f]{64}/i);
    });

    it("proof integration: rejects a tampered proof and releases worker resources", async () => {
        const identity = new Identity();
        const group = new Group([identity.commitment]);
        const proof = await generateProof(identity, group, "0", "0");
        assert.equal(await verifyProof(proof), true);
        proof.points[0] = "1";
        const proofPath = path.join(tmp, "tampered-proof.json");
        writeFileSync(proofPath, JSON.stringify(proof));
        assert.deepEqual(json(run("verify", "local", proofPath)), { ok: false });
        assert.equal(process.getActiveResourcesInfo().filter((resource) => resource === "MessagePort").length, 0);
    });
});
