import {
    chmodSync,
    closeSync,
    constants,
    existsSync,
    lstatSync,
    openSync,
    readFileSync,
    readSync,
    renameSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof, verifyProof } from "./proof-runtime.mjs";
import { Contract, Interface, isAddress, JsonRpcProvider, toBeHex, zeroPadValue } from "ethers";
import { performance } from "node:perf_hooks";
import { DEFAULT_MAX_INSERTION_SLOTS, MAX_INSERTION_SLOTS, MAX_TREE_DEPTH } from "./insertion-policy.mjs";

const MAX_JSON_BYTES = 1024 * 1024;
export { DEFAULT_MAX_INSERTION_SLOTS, MAX_INSERTION_SLOTS } from "./insertion-policy.mjs";
const MAX_STDIN_SECRET_BYTES = 128;
const LOG_BLOCK_SPAN = 50_000;
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

function identityFromStdin() {
    const chunks = [];
    let size = 0;
    while (true) {
        const chunk = Buffer.alloc(64);
        const read = readSync(0, chunk, 0, chunk.length, null);
        if (read === 0) break;
        size += read;
        if (size > MAX_STDIN_SECRET_BYTES) fail("stdin identity secret is too large", EXIT_FILE);
        chunks.push(chunk.subarray(0, read));
    }
    const secret = Buffer.concat(chunks).toString("utf8").trim();
    return new Identity(Buffer.from(privateKey(secret), "hex"));
}

function identityFromSource(source) {
    if (!source) fail("identity source is required");
    return source === "-" ? identityFromStdin() : identityFromFile(source);
}

export function parseInsertionSlotBudget(value) {
    if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
        fail("max insertion slots must be a positive safe integer");
    }
    const budget = Number(value);
    if (!Number.isSafeInteger(budget)) fail("max insertion slots must be a positive safe integer");
    if (budget > MAX_INSERTION_SLOTS) fail(`max insertion slots cannot exceed ${MAX_INSERTION_SLOTS} for depth ${MAX_TREE_DEPTH}`);
    return budget;
}

function groupFromFile(filePath, maxInsertionSlots) {
    const data = readJsonFile(filePath, "group");
    const members = Array.isArray(data) ? data : requireObject(data, "group").members;
    if (!Array.isArray(members) || members.length === 0 || members.length > maxInsertionSlots) {
        fail(`group.members must contain 1-${maxInsertionSlots} insertion slots`);
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

function blockNumber(value, label) {
    if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) fail(`${label} must be a decimal block number`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) fail(`${label} exceeds the supported safe integer range`);
    return parsed;
}

function elapsed(started) {
    return Math.round((performance.now() - started) * 1000) / 1000;
}

async function discoverDeploymentBlock(provider, address, latestBlock) {
    let latestCode;
    try { latestCode = await provider.getCode(address, latestBlock); } catch { fail("registry bytecode lookup failed", EXIT_RPC); }
    if (latestCode === "0x") fail("registry has no bytecode at the snapshot block", EXIT_RPC);
    let low = 0;
    let high = latestBlock;
    try {
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (await provider.getCode(address, middle) === "0x") low = middle + 1;
            else high = middle;
        }
    } catch {
        fail("deployment-block discovery needs historical RPC state; pass [from-block] from trusted deployment evidence", EXIT_RPC);
    }
    return low;
}

export const SEMAPHORE_EVENTS = new Interface([
    "event MemberAdded(uint256 indexed groupId,uint256 index,uint256 identityCommitment,uint256 merkleTreeRoot)",
    "event MembersAdded(uint256 indexed groupId,uint256 startIndex,uint256[] identityCommitments,uint256 merkleTreeRoot)",
    "event MemberUpdated(uint256 indexed groupId,uint256 index,uint256 identityCommitment,uint256 newIdentityCommitment,uint256 merkleTreeRoot)",
    "event MemberRemoved(uint256 indexed groupId,uint256 index,uint256 identityCommitment,uint256 merkleTreeRoot)",
]);

async function fetchGroupLogs(provider, semaphoreAddress, groupId, fromBlock, toBlock) {
    const eventNames = ["MemberAdded", "MembersAdded", "MemberUpdated", "MemberRemoved"];
    const topics = [eventNames.map((name) => SEMAPHORE_EVENTS.getEvent(name).topicHash), zeroPadValue(toBeHex(groupId), 32)];
    const logs = [];
    try {
        for (let start = fromBlock; start <= toBlock; start += LOG_BLOCK_SPAN) {
            const end = Math.min(start + LOG_BLOCK_SPAN - 1, toBlock);
            logs.push(...await provider.getLogs({ address: semaphoreAddress, fromBlock: start, toBlock: end, topics }));
        }
    } catch { fail("Semaphore event scan failed", EXIT_RPC); }
    return logs.sort((left, right) => left.blockNumber - right.blockNumber || left.transactionIndex - right.transactionIndex || left.index - right.index);
}

export function replayGroupLogs(logs, maxInsertionSlots = DEFAULT_MAX_INSERTION_SLOTS, verifyEventRoots = true) {
    const group = new Group();
    let insertions = 0;
    for (const log of logs) {
        let parsed;
        try { parsed = SEMAPHORE_EVENTS.parseLog(log); } catch { fail("Semaphore event decoding failed", EXIT_RPC); }
        const args = parsed.args;
        const index = Number(parsed.name === "MembersAdded" ? args.startIndex : args.index);
        if (!Number.isSafeInteger(index) || index < 0) fail("Semaphore event contains an unsupported member index", EXIT_RPC);
        try {
            if (parsed.name === "MemberAdded") {
                if (index !== group.size) fail("Semaphore member event sequence is incomplete", EXIT_RPC);
                if (insertions >= maxInsertionSlots) fail(`reconstructed group exceeds ${maxInsertionSlots} insertion slots`, EXIT_FILE);
                group.addMember(args.identityCommitment);
                insertions += 1;
            } else if (parsed.name === "MembersAdded") {
                if (index !== group.size) fail("Semaphore batch event sequence is incomplete", EXIT_RPC);
                if (insertions + args.identityCommitments.length > maxInsertionSlots) fail(`reconstructed group exceeds ${maxInsertionSlots} insertion slots`, EXIT_FILE);
                group.addMembers([...args.identityCommitments]);
                insertions += args.identityCommitments.length;
            } else if (parsed.name === "MemberUpdated") {
                if (index >= group.size || group.members[index] !== args.identityCommitment) fail("Semaphore update event does not match reconstructed state", EXIT_RPC);
                group.updateMember(index, args.newIdentityCommitment);
            } else {
                if (index >= group.size || group.members[index] !== args.identityCommitment) fail("Semaphore removal event does not match reconstructed state", EXIT_RPC);
                group.removeMember(index);
            }
        } catch (error) {
            if (error instanceof CliError) throw error;
            fail("Semaphore event cannot be replayed", EXIT_RPC);
        }
        if (verifyEventRoots && group.root !== args.merkleTreeRoot) fail("Semaphore event root does not match reconstructed state", EXIT_RPC);
        if (insertions > maxInsertionSlots) fail(`reconstructed group exceeds ${maxInsertionSlots} insertion slots`, EXIT_FILE);
    }
    return { group, insertions };
}

async function estimateProofGas(registry, proof) {
    const args = [proof.merkleTreeDepth, proof.merkleTreeRoot, proof.nullifier, proof.message, proof.points];
    const estimate = async (signature) => {
        try {
            if (await registry[signature].staticCall(...args) !== true) return null;
            return (await registry[signature].estimateGas(...args)).toString();
        } catch { return null; }
    };
    return {
        verifyMembership: await estimate("verifyMembership(uint256,uint256,uint256,uint256,uint256[8])"),
        validateMembership: await estimate("validateMembership(uint256,uint256,uint256,uint256,uint256[8])"),
    };
}

async function cmdIdentityCreate(filePath, key, force) {
    if (!filePath) fail("identity create requires <identity.json>");
    const identity = key ? new Identity(Buffer.from(privateKey(key), "hex")) : new Identity();
    writeIdentity(filePath, identity, force);
    output({ ok: true, commitment: identity.commitment.toString() });
}

async function cmdProofGenerate(identityPath, groupPath, message = "0", scope = "0", maxInsertionSlots = DEFAULT_MAX_INSERTION_SLOTS) {
    const identity = identityFromFile(identityPath);
    const group = groupFromFile(groupPath, maxInsertionSlots);
    field(message, "message");
    field(scope, "scope");
    const proof = await generateProof(identity, group, message, scope);
    output({ merkleTreeDepth: proof.merkleTreeDepth, merkleTreeRoot: proof.merkleTreeRoot, nullifier: proof.nullifier, message: proof.message, scope: proof.scope, points: proof.points });
}

async function cmdProofGenerateChain(identitySource, registryAddress, rpcUrl, chainId, message = "0", suppliedFromBlock, maxInsertionSlots = DEFAULT_MAX_INSERTION_SLOTS) {
    const totalStarted = performance.now();
    if (!isAddress(registryAddress)) fail("registry address is invalid");
    const expectedChainId = field(chainId, "chain ID");
    if (expectedChainId === 0n) fail("chain ID must be nonzero");
    if (expectedChainId > BigInt(Number.MAX_SAFE_INTEGER)) fail("chain ID exceeds the supported safe integer range");
    field(message, "message");
    const identity = identityFromSource(identitySource);
    await assertRpcChain(rpcUrl, expectedChainId);
    const provider = new JsonRpcProvider(rpcUrl, Number(expectedChainId), { staticNetwork: true });
    try {
        const latestBlock = await provider.getBlockNumber();
        const discoveryStarted = performance.now();
        const fromBlock = suppliedFromBlock === undefined
            ? await discoverDeploymentBlock(provider, registryAddress, latestBlock)
            : blockNumber(suppliedFromBlock, "from block");
        if (fromBlock > latestBlock) fail("from block is newer than the snapshot block");
        const deploymentDiscoveryMs = elapsed(discoveryStarted);
        const registryAbi = [
            "function semaphore() view returns (address)",
            "function groupId() view returns (uint256)",
            "function verifyMembership(uint256,uint256,uint256,uint256,uint256[8]) returns (bool)",
            "function validateMembership(uint256,uint256,uint256,uint256,uint256[8]) returns (bool)",
        ];
        const registry = new Contract(registryAddress, registryAbi, provider);
        let semaphoreAddress;
        let groupId;
        try {
            [semaphoreAddress, groupId] = await Promise.all([
                registry.semaphore({ blockTag: latestBlock }),
                registry.groupId({ blockTag: latestBlock }),
            ]);
        } catch { fail("registry metadata lookup failed", EXIT_RPC); }
        if (!isAddress(semaphoreAddress) || await provider.getCode(semaphoreAddress, latestBlock) === "0x") fail("registry Semaphore address has no bytecode", EXIT_RPC);
        const fetchStarted = performance.now();
        const logs = await fetchGroupLogs(provider, semaphoreAddress, groupId, fromBlock, latestBlock);
        const eventFetchMs = elapsed(fetchStarted);
        const reconstructionStarted = performance.now();
        const { group, insertions } = replayGroupLogs(logs, maxInsertionSlots);
        const semaphore = new Contract(semaphoreAddress, [
            "function getMerkleTreeRoot(uint256) view returns (uint256)",
            "function getMerkleTreeDepth(uint256) view returns (uint256)",
            "function getMerkleTreeSize(uint256) view returns (uint256)",
        ], provider);
        let onChainRoot;
        let onChainDepth;
        let onChainSize;
        try {
            [onChainRoot, onChainDepth, onChainSize] = await Promise.all([
                semaphore.getMerkleTreeRoot(groupId, { blockTag: latestBlock }),
                semaphore.getMerkleTreeDepth(groupId, { blockTag: latestBlock }),
                semaphore.getMerkleTreeSize(groupId, { blockTag: latestBlock }),
            ]);
        } catch { fail("Semaphore state lookup failed", EXIT_RPC); }
        if (group.root !== onChainRoot || BigInt(group.depth) !== onChainDepth || BigInt(group.size) !== onChainSize) {
            fail("reconstructed group does not match on-chain root, depth, and size", EXIT_RPC);
        }
        if (group.indexOf(identity.commitment) < 0) fail("identity is not an active member of the reconstructed group", EXIT_FILE);
        if (group.depth === 0 || group.depth > MAX_TREE_DEPTH) fail(`reconstructed tree depth must be 1-${MAX_TREE_DEPTH}`, EXIT_FILE);
        const activeMembers = group.members.filter((member) => member !== 0n).length;
        const reconstructionMs = elapsed(reconstructionStarted);
        const proofStarted = performance.now();
        const proof = await generateProof(identity, group, message, groupId);
        const proofGenerationMs = elapsed(proofStarted);
        const gasStarted = performance.now();
        const gasEstimates = await estimateProofGas(registry, proof);
        const gasEstimationMs = elapsed(gasStarted);
        output({
            merkleTreeDepth: proof.merkleTreeDepth,
            merkleTreeRoot: proof.merkleTreeRoot,
            nullifier: proof.nullifier,
            message: proof.message,
            scope: proof.scope,
            points: proof.points,
            chain: {
                chainId: expectedChainId.toString(),
                registry: registryAddress,
                semaphore: semaphoreAddress,
                groupId: groupId.toString(),
                fromBlock,
                toBlock: latestBlock,
                eventCount: logs.length,
                insertionSlots: insertions,
                activeMembers,
            },
            metrics: { deploymentDiscoveryMs, eventFetchMs, reconstructionMs, proofGenerationMs, gasEstimationMs, totalMs: elapsed(totalStarted) },
            gasEstimates,
        });
    } catch (error) {
        if (error instanceof CliError) throw error;
        fail("chain proof generation failed", EXIT_RPC);
    } finally { provider.destroy(); }
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

const USAGE = "Usage: anonset-cli identity create <identity.json> [private-key-hex] [--force] | proof generate <identity.json> <group.json> [message] [scope] [--max-insertion-slots <n>] | proof generate-chain <identity.json|-> <registry-address> <rpc-url> <chain-id> [message] [from-block] [--max-insertion-slots <n>] | verify local <proof.json> | verify on-chain <address> <proof.json> <rpc-url> <chain-id>";

function parseProofPositionals(arguments_, minimum, maximum) {
    const positional = [];
    let maxInsertionSlots = DEFAULT_MAX_INSERTION_SLOTS;
    let sawBudget = false;
    for (let index = 0; index < arguments_.length; index += 1) {
        const argument = arguments_[index];
        if (argument === "--max-insertion-slots") {
            if (sawBudget) fail("max insertion slots option may only be supplied once");
            sawBudget = true;
            if (index + 1 === arguments_.length) fail("--max-insertion-slots requires a value");
            maxInsertionSlots = parseInsertionSlotBudget(arguments_[index + 1]);
            index += 1;
        } else if (argument.startsWith("-") && argument !== "-") {
            fail(`unknown option: ${argument}`);
        } else {
            positional.push(argument);
        }
    }
    if (positional.length < minimum || positional.length > maximum) fail(USAGE);
    return { positional, maxInsertionSlots };
}

async function run(args) {
    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") { process.stdout.write(`${USAGE}\n`); return; }
    const [command, subcommand, ...rest] = args;
    if (command === "identity" && subcommand === "create") {
        const force = rest.includes("--force");
        const positional = rest.filter((arg) => arg !== "--force");
        if (positional.length < 1 || positional.length > 2) fail("identity create requires <identity.json> [private-key-hex] [--force]");
        return cmdIdentityCreate(positional[0], positional[1], force);
    }
    if (command === "proof" && subcommand === "generate") {
        const { positional, maxInsertionSlots } = parseProofPositionals(rest, 2, 4);
        return cmdProofGenerate(positional[0], positional[1], positional[2], positional[3], maxInsertionSlots);
    }
    if (command === "proof" && subcommand === "generate-chain") {
        const { positional, maxInsertionSlots } = parseProofPositionals(rest, 4, 6);
        return cmdProofGenerateChain(positional[0], positional[1], positional[2], positional[3], positional[4], positional[5], maxInsertionSlots);
    }
    if (command === "verify" && subcommand === "local" && rest.length === 1) return cmdVerifyLocal(rest[0]);
    if (command === "verify" && subcommand === "on-chain" && rest.length === 4) return cmdVerifyOnChain(...rest);
    fail(USAGE);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        await run(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`${error instanceof CliError ? error.message : "operation failed"}\n`);
        process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
    }
}
