import {
    chmodSync,
    closeSync,
    constants,
    existsSync,
    lstatSync,
    openSync,
    readFileSync,
    renameSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof, verifyProof } from "./proof-runtime.mjs";
import { Contract, isAddress, JsonRpcProvider } from "ethers";

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_GROUP_MEMBERS = 1024;
const MAX_TREE_DEPTH = 32;
const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const EXIT_USAGE = 2;
const EXIT_FILE = 3;
const EXIT_RPC = 4;

class CliError extends Error {
    constructor(message, exitCode = EXIT_USAGE) {
        super(message);
        this.exitCode = exitCode;
    }
}

function fail(message, exitCode = EXIT_USAGE) {
    throw new CliError(message, exitCode);
}

function output(value) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
}

function parseJson(text, label) {
    try {
        return JSON.parse(text);
    } catch {
        fail(`${label} must be valid JSON`);
    }
}

function readJsonFile(filePath, label) {
    let stats;
    try {
        stats = lstatSync(filePath);
    } catch {
        fail(`${label} file does not exist`, EXIT_FILE);
    }
    if (!stats.isFile() || stats.isSymbolicLink()) fail(`${label} file must be a regular file`, EXIT_FILE);
    if (stats.size > MAX_JSON_BYTES) fail(`${label} file exceeds ${MAX_JSON_BYTES} bytes`, EXIT_FILE);
    return parseJson(readFileSync(filePath, "utf8"), `${label} file`);
}

function field(value, label) {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
        fail(`${label} must be a decimal field element`);
    }
    const text = String(value);
    if (!/^(0|[1-9][0-9]*)$/.test(text)) fail(`${label} must be a decimal field element`);
    const parsed = BigInt(text);
    if (parsed >= FIELD_MODULUS) fail(`${label} is outside the Semaphore field`);
    return parsed;
}

function requireObject(value, label) {
    if (value === null || Array.isArray(value) || typeof value !== "object") fail(`${label} must be an object`);
    return value;
}

function identityFromFile(filePath) {
    const data = requireObject(readJsonFile(filePath, "identity"), "identity");
    if (typeof data.privateKey !== "string" || !/^[0-9a-f]{64}$/i.test(data.privateKey)) {
        fail("identity.privateKey must be 32-byte hexadecimal");
    }
    return new Identity(Buffer.from(data.privateKey, "hex"));
}

function groupFromFile(filePath) {
    const data = readJsonFile(filePath, "group");
    const members = Array.isArray(data) ? data : requireObject(data, "group").members;
    if (!Array.isArray(members) || members.length === 0 || members.length > MAX_GROUP_MEMBERS) {
        fail(`group.members must contain 1-${MAX_GROUP_MEMBERS} members`);
    }
    return new Group(members.map((member, index) => field(member, `group.members[${index}]`)));
}

function proofFromFile(filePath) {
    const proof = requireObject(readJsonFile(filePath, "proof"), "proof");
    const depth = field(proof.merkleTreeDepth, "proof.merkleTreeDepth");
    if (depth === 0n || depth > BigInt(MAX_TREE_DEPTH)) fail(`proof.merkleTreeDepth must be 1-${MAX_TREE_DEPTH}`);
    for (const name of ["merkleTreeRoot", "nullifier", "message", "scope"]) field(proof[name], `proof.${name}`);
    if (!Array.isArray(proof.points) || proof.points.length !== 8) fail("proof.points must contain exactly 8 field elements");
    proof.points.forEach((point, index) => field(point, `proof.points[${index}]`));
    return proof;
}

function writeIdentity(filePath, identity, force) {
    const target = path.resolve(filePath);
    if (existsSync(target) && !force) fail("identity file already exists; pass --force to replace it", EXIT_FILE);
    if (existsSync(target) && !lstatSync(target).isFile()) fail("identity output must be a regular file", EXIT_FILE);
    const parent = path.dirname(target);
    const temporary = path.join(parent, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
    const payload = `${JSON.stringify({ privateKey: Buffer.from(identity.privateKey).toString("hex"), commitment: identity.commitment.toString() })}\n`;
    let fd;
    try {
        fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
        writeFileSync(fd, payload, { encoding: "utf8" });
        chmodSync(temporary, 0o600);
        closeSync(fd);
        fd = undefined;
        renameSync(temporary, target);
        chmodSync(target, 0o600);
    } catch (error) {
        if (fd !== undefined) closeSync(fd);
        try { unlinkSync(temporary); } catch { /* nothing to remove */ }
        fail("could not write identity file", EXIT_FILE);
    }
}

function privateKey(value) {
    if (value === undefined) return undefined;
    const normalized = value.replace(/^0x/i, "");
    if (!/^[0-9a-f]{64}$/i.test(normalized)) fail("private key must be 32-byte hexadecimal");
    return normalized;
}

async function assertRpcChain(url, expectedChainId) {
    let parsed;
    try { parsed = new URL(url); } catch { fail("RPC URL must be an absolute http(s) URL", EXIT_RPC); }
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) fail("RPC URL must be an absolute credential-free http(s) URL", EXIT_RPC);
    let response;
    try {
        response = await fetch(parsed, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
            signal: AbortSignal.timeout(5_000),
        });
    } catch { fail("RPC chain check failed", EXIT_RPC); }
    let payload;
    try { payload = await response.json(); } catch { fail("RPC chain check returned invalid JSON", EXIT_RPC); }
    if (!response.ok || typeof payload?.result !== "string" || !/^0x[0-9a-f]+$/i.test(payload.result)) fail("RPC chain check failed", EXIT_RPC);
    if (BigInt(payload.result) !== expectedChainId) fail("RPC chain ID does not match the expected chain", EXIT_RPC);
}

async function cmdIdentityCreate(filePath, key, force) {
    if (!filePath) fail("identity create requires <identity.json>");
    const identity = key ? new Identity(Buffer.from(privateKey(key), "hex")) : new Identity();
    writeIdentity(filePath, identity, force);
    output({ ok: true, commitment: identity.commitment.toString() });
}

async function cmdProofGenerate(identityPath, groupPath, message = "0", scope = "0") {
    const identity = identityFromFile(identityPath);
    const group = groupFromFile(groupPath);
    field(message, "message");
    field(scope, "scope");
    const proof = await generateProof(identity, group, message, scope);
    output({ merkleTreeDepth: proof.merkleTreeDepth, merkleTreeRoot: proof.merkleTreeRoot, nullifier: proof.nullifier, message: proof.message, scope: proof.scope, points: proof.points });
}

async function cmdVerifyLocal(proofPath) {
    const result = await verifyProof(proofFromFile(proofPath));
    output({ ok: result });
}

async function cmdVerifyOnChain(contractAddress, proofPath, rpcUrl, chainId) {
    if (!isAddress(contractAddress)) fail("contract address is invalid");
    const expectedChainId = field(chainId, "chain ID");
    if (expectedChainId === 0n) fail("chain ID must be nonzero");
    if (expectedChainId > BigInt(Number.MAX_SAFE_INTEGER)) {
        fail("chain ID exceeds the supported safe integer range");
    }
    const proof = proofFromFile(proofPath);
    await assertRpcChain(rpcUrl, expectedChainId);
    const provider = new JsonRpcProvider(rpcUrl, Number(expectedChainId), { staticNetwork: true });
    const abi = ["function verifyMembership(uint256,uint256,uint256,uint256,uint256[8]) returns (bool)"];
    try {
        const result = await new Contract(contractAddress, abi, provider).verifyMembership.staticCall(proof.merkleTreeDepth, proof.merkleTreeRoot, proof.nullifier, proof.message, proof.points);
        output({ ok: result });
    } catch { fail("on-chain proof verification failed", EXIT_RPC); } finally { provider.destroy(); }
}

const USAGE = "Usage: anonset-cli identity create <identity.json> [private-key-hex] [--force] | proof generate <identity.json> <group.json> [message] [scope] | verify local <proof.json> | verify on-chain <address> <proof.json> <rpc-url> <chain-id>";

async function run(args) {
    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") { process.stdout.write(`${USAGE}\n`); return; }
    const [command, subcommand, ...rest] = args;
    if (command === "identity" && subcommand === "create") {
        const force = rest.includes("--force");
        const positional = rest.filter((arg) => arg !== "--force");
        if (positional.length < 1 || positional.length > 2) fail("identity create requires <identity.json> [private-key-hex] [--force]");
        return cmdIdentityCreate(positional[0], positional[1], force);
    }
    if (command === "proof" && subcommand === "generate" && rest.length >= 2 && rest.length <= 4) return cmdProofGenerate(...rest);
    if (command === "verify" && subcommand === "local" && rest.length === 1) return cmdVerifyLocal(rest[0]);
    if (command === "verify" && subcommand === "on-chain" && rest.length === 4) return cmdVerifyOnChain(...rest);
    fail(USAGE);
}

try {
    await run(process.argv.slice(2));
} catch (error) {
    process.stderr.write(`${error instanceof CliError ? error.message : "operation failed"}\n`);
    process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
}
