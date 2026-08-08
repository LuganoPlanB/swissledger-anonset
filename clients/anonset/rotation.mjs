import { closeSync, constants, existsSync, fsyncSync, lstatSync, openSync, readFileSync, readSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Contract, ContractFactory, JsonRpcProvider, NonceManager, Wallet, getAddress, isAddress } from "ethers";
import { Group } from "@semaphore-protocol/group";
import { performance } from "node:perf_hooks";
import { readCheckpointFile } from "./checkpoint.mjs";
import { DEFAULT_MAX_INSERTION_SLOTS, normalizeInsertionSlotBudget } from "./insertion-policy.mjs";

export const ROTATION_JOURNAL_SCHEMA = "swissledger-anonset-rotation/v1";
const MAX_KEY_BYTES = 128;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const decimal = (value, label) => {
    if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${label} must be decimal`);
    return value;
};
const safeInteger = (value, label, fail, positive = false) => {
    const serialized = typeof value === "number" ? String(value) : value;
    if (typeof serialized !== "string" || !(positive ? /^[1-9][0-9]*$/ : /^(0|[1-9][0-9]*)$/).test(serialized)) fail(`${label} must be a ${positive ? "positive" : "non-negative"} safe integer`);
    const parsed = Number(serialized);
    if (!Number.isSafeInteger(parsed)) fail(`${label} must be a ${positive ? "positive" : "non-negative"} safe integer`);
    return parsed;
};
const insertionBudget = (value, fail) => {
    const serialized = typeof value === "number" ? String(value) : value;
    if (typeof serialized !== "string" || !/^[1-9][0-9]*$/.test(serialized)) fail("max insertion slots must be a positive safe integer");
    try { return normalizeInsertionSlotBudget(Number(serialized)); }
    catch (error) { fail(error.message); }
};
const safePath = (file, label) => {
    const target = path.resolve(file); const parent = path.dirname(target);
    if (lstatSync(parent).isSymbolicLink() || !lstatSync(parent).isDirectory()) throw new Error(`${label} parent must be a directory`);
    try { const stat = lstatSync(target); if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular non-symlink file`); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    return target;
};
export function writeRotationJournal(file, value) {
    const target = safePath(file, "journal");
    const payload = `${JSON.stringify(value)}\n`; const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`); let fd;
    try { fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600); writeFileSync(fd, payload); fsyncSync(fd); closeSync(fd); fd = undefined; renameSync(tmp, target); }
    catch (error) { if (fd !== undefined) closeSync(fd); try { unlinkSync(tmp); } catch {} throw error; }
}
export function readRotationJournal(file) {
    safePath(file, "journal"); let value;
    try { value = JSON.parse(readFileSync(file, "utf8")); } catch { throw new Error("journal must be valid JSON"); }
    if (!value || value.schema !== ROTATION_JOURNAL_SCHEMA || !Array.isArray(value.transactions)) throw new Error("unsupported rotation journal");
    return value;
}
export function parseRotationArguments(args, fail) {
    const positional = []; const options = { managers: [], batchSize: 64, confirmations: 0, targetOwner: null, gasPrice: null, deployGasLimit: null, batchGasLimit: null, checkpoint: null, journal: null, expectedSigner: null, maxInsertionSlots: DEFAULT_MAX_INSERTION_SLOTS };
    const seen = new Set(); const names = new Map([["--checkpoint", "checkpoint"], ["--journal", "journal"], ["--expected-signer", "expectedSigner"], ["--target-owner", "targetOwner"], ["--batch-size", "batchSize"], ["--confirmations", "confirmations"], ["--gas-price", "gasPrice"], ["--deploy-gas-limit", "deployGasLimit"], ["--batch-gas-limit", "batchGasLimit"], ["--max-insertion-slots", "maxInsertionSlots"]]);
    for (let i = 0; i < args.length; i += 1) { const token = args[i]; if (token === "--manager") { const value = args[++i]; if (!value || !isAddress(value)) fail("--manager requires a valid address"); options.managers.push(getAddress(value)); continue; } if (names.has(token)) { const name = names.get(token); if (seen.has(name)) fail(`${token} may only be supplied once`); seen.add(name); const value = args[++i]; if (!value || value.startsWith("-")) fail(`${token} requires a value`); options[name] = value; continue; } if (token.startsWith("-")) fail(`unknown option: ${token}`); else positional.push(token); }
    if (positional.length !== 3 || !options.checkpoint || !options.journal || !options.expectedSigner) fail("group rotate requires source registry, RPC URL, chain ID, --checkpoint, --journal, and --expected-signer");
    for (const name of ["expectedSigner", "targetOwner"]) if (options[name] && !isAddress(options[name])) fail(`${name} must be an address`); options.expectedSigner = getAddress(options.expectedSigner); if (options.targetOwner) options.targetOwner = getAddress(options.targetOwner);
    for (const name of ["batchSize", "gasPrice", "deployGasLimit", "batchGasLimit"]) if (options[name] !== null) { if (!/^(0|[1-9][0-9]*)$/.test(options[name])) fail(`${name} must be a non-negative integer`); options[name] = BigInt(options[name]); }
    if (options.batchSize < 1n || options.batchSize > 64n) fail("batchSize must be 1-64");
    options.confirmations = safeInteger(options.confirmations, "confirmations", fail);
    options.maxInsertionSlots = insertionBudget(options.maxInsertionSlots, fail);
    if (!isAddress(positional[0])) fail("source registry address is invalid");
    if (!/^https?:\/\//.test(positional[1]) || /@/.test(positional[1])) fail("RPC URL must be absolute credential-free http(s)");
    safeInteger(positional[2], "chain ID", fail, true);
    return { source: positional[0], rpcUrl: positional[1], chainId: positional[2], ...options };
}
function stdinKey(fail) { const chunks = []; let total = 0; for (;;) { const chunk = Buffer.alloc(64); const count = readSync(0, chunk, 0, chunk.length, null); if (count === 0) break; total += count; if (total > MAX_KEY_BYTES) fail("stdin signing key is too large"); chunks.push(chunk.subarray(0, count)); } const value = Buffer.concat(chunks).toString("utf8").trim().replace(/^0x/, ""); if (!/^[0-9a-f]{64}$/i.test(value)) fail("stdin signing key must be a raw 32-byte hexadecimal key"); return `0x${value}`; }
function artifact() { const file = new URL("../../out/MerkleRootRegistryZK.sol/MerkleRootRegistryZK.json", import.meta.url); const raw = readFileSync(file, "utf8"); const parsed = JSON.parse(raw); if (!Array.isArray(parsed.abi) || typeof parsed.bytecode?.object !== "string" || !/^0x[0-9a-f]+$/i.test(parsed.bytecode.object)) throw new Error("registry artifact is invalid"); return { abi: parsed.abi, bytecode: parsed.bytecode.object, abiSha256: hash(JSON.stringify(parsed.abi)), bytecodeSha256: hash(parsed.bytecode.object) }; }
const registryAbi = ["function semaphore() view returns(address)", "function groupId() view returns(uint256)", "function owner() view returns(address)", "function pendingOwner() view returns(address)", "function getMemberManagers() view returns(address[])", "function addMemberManager(address)", "function addMembers(uint256[])", "function transferOwnership(address)"];
const semaphoreAbi = ["function getMerkleTreeRoot(uint256) view returns(uint256)", "function getMerkleTreeDepth(uint256) view returns(uint256)", "function getMerkleTreeSize(uint256) view returns(uint256)"];
export async function rotateGroup(options, fail) {
    const startedAt = performance.now();
    const lockPath = `${safePath(options.journal, "journal")}.lock`; let lock;
    try { lock = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600); closeSync(lock); lock = undefined; }
    catch { fail("rotation journal is locked by another operation"); }
    try {
    if (!isAddress(options.source)) fail("source registry address is invalid"); if (!/^https?:\/\//.test(options.rpcUrl) || /@/.test(options.rpcUrl)) fail("RPC URL must be absolute credential-free http(s)");
    const chainId = typeof options.chainId === "string" ? options.chainId : String(options.chainId); const chainIdNumber = safeInteger(chainId, "chain ID", fail, true); const confirmations = safeInteger(options.confirmations, "confirmations", fail); const maxInsertionSlots = insertionBudget(options.maxInsertionSlots ?? DEFAULT_MAX_INSERTION_SLOTS, fail);
    const source = getAddress(options.source); const checkpoint = readCheckpointFile(options.checkpoint, { maxInsertionSlots }).checkpoint; if (checkpoint.registry !== source || checkpoint.chainId !== chainId) fail("checkpoint does not match source registry or chain");
    const provider = new JsonRpcProvider(options.rpcUrl, chainIdNumber, { staticNetwork: true });
    try { if ((await provider.getNetwork()).chainId !== BigInt(chainId)) fail("RPC chain ID does not match requested chain"); const head = await provider.getBlockNumber(); const target = head - confirmations; if (target < 0) fail("confirmations exceed chain height"); const sourceRegistry = new Contract(source, registryAbi, provider); const [semaphore, groupId, sourceRoot, sourceSize] = await Promise.all([sourceRegistry.semaphore(), sourceRegistry.groupId(), new Contract(checkpoint.semaphore, semaphoreAbi, provider).getMerkleTreeRoot(checkpoint.groupId, { blockTag: target }), new Contract(checkpoint.semaphore, semaphoreAbi, provider).getMerkleTreeSize(checkpoint.groupId, { blockTag: target })]);
        const sourceMatches = getAddress(semaphore) === checkpoint.semaphore && groupId.toString() === checkpoint.groupId && sourceRoot.toString() === checkpoint.root && sourceSize.toString() === checkpoint.size;
        const key = stdinKey(fail); const wallet = new Wallet(key, provider); if (getAddress(wallet.address) !== options.expectedSigner) fail("stdin signer does not match --expected-signer"); const signer = new NonceManager(wallet); await signer.getNonce("pending"); const active = Group.import(checkpoint.groupExport).members.filter((m) => m !== 0n); const compact = new Group(active); const art = artifact(); let journal = null;
        if (existsSync(options.journal)) journal = readRotationJournal(options.journal);
        if (!sourceMatches) { if (journal) { journal.status = "ABORTED_SOURCE_CHANGED"; writeRotationJournal(options.journal, journal); } fail("source wiring or checkpoint state changed"); }
        const identity = { source, semaphore: checkpoint.semaphore, groupId: checkpoint.groupId, sourceRoot: checkpoint.root, checkpointSha256: hash(readFileSync(options.checkpoint)), activeHash: hash(active.map(String).join(",")), activeCount: active.length, signer: wallet.address, batchSize: String(options.batchSize), artifact: { abiSha256: art.abiSha256, bytecodeSha256: art.bytecodeSha256 } };
        if (journal && JSON.stringify(journal.identity) !== JSON.stringify(identity)) fail("journal immutable identity does not match requested rotation"); if (!journal) { journal = { schema: ROTATION_JOURNAL_SCHEMA, identity, status: "PREPARED", newRegistry: null, newGroupId: null, nextActiveIndex: 0, completedManagers: [], ownershipTransferInitiated: false, transactions: [] }; writeRotationJournal(options.journal, journal); } journal.completedManagers ??= []; journal.ownershipTransferInitiated ??= false;
        if (!Number.isSafeInteger(journal.nextActiveIndex) || journal.nextActiveIndex < 0 || journal.nextActiveIndex > active.length || !["PREPARED", "DEPLOYED", "MIGRATING", "AWAITING_OWNER_ACCEPTANCE", "READY", "ABORTED_SOURCE_CHANGED"].includes(journal.status)) fail("journal cursor or status is invalid");
        if (journal.status === "ABORTED_SOURCE_CHANGED") fail("journal records an aborted source; start a fresh rotation");
        let newRegistry; if (!journal.newRegistry) { const factory = new ContractFactory(art.abi, art.bytecode, signer); const sentAt = performance.now(); const contract = await factory.deploy(checkpoint.semaphore, { type: 0, gasPrice: options.gasPrice ?? 0n, ...(options.deployGasLimit === null ? {} : { gasLimit: options.deployGasLimit }) }); const receipt = await contract.deploymentTransaction().wait(); const observedDurationMs = Math.max(0, performance.now() - sentAt); if (receipt.status !== 1) fail("registry deployment reverted"); journal.newRegistry = await contract.getAddress(); journal.status = "DEPLOYED"; journal.transactions.push({ kind: "deploy", hash: receipt.hash, gasUsed: receipt.gasUsed.toString(), observedDurationMs }); writeRotationJournal(options.journal, journal); if (process.env.ANONSET_ROTATION_FAIL_AFTER_DEPLOY === "1") fail("injected failure after deployment"); }
        if (await provider.getCode(journal.newRegistry) === "0x") fail("journal deployment has no bytecode");
        newRegistry = new Contract(journal.newRegistry, registryAbi, signer); const [newSemaphore, newGroupId, owner] = await Promise.all([newRegistry.semaphore(), newRegistry.groupId(), newRegistry.owner()]); if (getAddress(newSemaphore) !== checkpoint.semaphore || getAddress(owner) !== wallet.address) fail("deployed registry wiring or ownership is invalid"); journal.newGroupId = newGroupId.toString();
        if (journal.nextActiveIndex > 0 && Number(await new Contract(checkpoint.semaphore, semaphoreAbi, provider).getMerkleTreeSize(newGroupId)) !== journal.nextActiveIndex) fail("journal cursor does not match deployed group prefix");
        while (journal.nextActiveIndex < active.length) { const latestRoot = await new Contract(checkpoint.semaphore, semaphoreAbi, provider).getMerkleTreeRoot(checkpoint.groupId); if (latestRoot.toString() !== checkpoint.root) { journal.status = "ABORTED_SOURCE_CHANGED"; writeRotationJournal(options.journal, journal); fail("source changed; rotation candidate aborted"); } const end = Math.min(active.length, journal.nextActiveIndex + Number(options.batchSize)); const batch = active.slice(journal.nextActiveIndex, end); const sentAt = performance.now(); const tx = await newRegistry.addMembers(batch, { type: 0, gasPrice: options.gasPrice ?? 0n, ...(options.batchGasLimit === null ? {} : { gasLimit: options.batchGasLimit }) }); const receipt = await tx.wait(); const observedDurationMs = Math.max(0, performance.now() - sentAt); if (receipt.status !== 1) fail("migration batch reverted"); journal.transactions.push({ kind: "batch", hash: receipt.hash, start: journal.nextActiveIndex, count: batch.length, gasUsed: receipt.gasUsed.toString(), observedDurationMs }); journal.nextActiveIndex = end; journal.status = "MIGRATING"; writeRotationJournal(options.journal, journal); if (process.env.ANONSET_ROTATION_FAIL_AFTER_BATCH === "1") fail("injected failure after migration batch"); }
        const sem = new Contract(checkpoint.semaphore, semaphoreAbi, provider); const [root, depth, size] = await Promise.all([sem.getMerkleTreeRoot(newGroupId), sem.getMerkleTreeDepth(newGroupId), sem.getMerkleTreeSize(newGroupId)]); if (root !== compact.root || Number(depth) !== compact.depth || Number(size) !== compact.size) fail("migrated tree does not match compact active set"); for (const manager of options.managers) { if (journal.completedManagers.includes(manager)) continue; const sentAt = performance.now(); const tx = await newRegistry.addMemberManager(manager, { type: 0, gasPrice: options.gasPrice ?? 0n }); const receipt = await tx.wait(); const observedDurationMs = Math.max(0, performance.now() - sentAt); if (receipt.status !== 1) fail("manager setup reverted"); journal.transactions.push({ kind: "manager", hash: receipt.hash, manager, gasUsed: receipt.gasUsed.toString(), observedDurationMs }); journal.completedManagers.push(manager); writeRotationJournal(options.journal, journal); if (process.env.ANONSET_ROTATION_FAIL_AFTER_MANAGER === "1") fail("injected failure after manager setup"); }
        const timedTransactions = journal.transactions;
        if (options.targetOwner && options.targetOwner !== wallet.address) { const pending = getAddress(await newRegistry.pendingOwner()); if (!journal.ownershipTransferInitiated) { if (pending !== "0x0000000000000000000000000000000000000000" && pending !== options.targetOwner) fail("pending owner does not match journal target"); if (pending === "0x0000000000000000000000000000000000000000") { const sentAt = performance.now(); const tx = await newRegistry.transferOwnership(options.targetOwner, { type: 0, gasPrice: options.gasPrice ?? 0n }); const receipt = await tx.wait(); const observedDurationMs = Math.max(0, performance.now() - sentAt); if (receipt.status !== 1) fail("ownership transfer initiation reverted"); journal.transactions.push({ kind: "transferOwnership", hash: receipt.hash, gasUsed: receipt.gasUsed.toString(), observedDurationMs }); } journal.ownershipTransferInitiated = true; writeRotationJournal(options.journal, journal); if (process.env.ANONSET_ROTATION_FAIL_AFTER_TRANSFER === "1") fail("injected failure after ownership transfer"); } if (getAddress(await newRegistry.pendingOwner()) !== options.targetOwner) fail("pending owner does not match target owner"); journal.status = "AWAITING_OWNER_ACCEPTANCE"; } else journal.status = "READY"; writeRotationJournal(options.journal, journal); const gas = journal.transactions.reduce((sum, tx) => sum + BigInt(tx.gasUsed), 0n); return { status: journal.status, sourceRegistry: source, sourceGroupId: checkpoint.groupId, newRegistry: journal.newRegistry, newGroupId: journal.newGroupId, activeMembers: active.length, root: compact.root.toString(), journal: options.journal, transactions: timedTransactions, benchmark: { totalTransactions: timedTransactions.length, totalReceiptGas: gas.toString(), batches: timedTransactions.filter((tx) => tx.kind === "batch").map(({ gasUsed, observedDurationMs }) => ({ gasUsed, observedDurationMs })), observedDurationMs: Math.max(0, performance.now() - startedAt) } };
        // Receipt timings are public operational observations and are persisted
        // before the result is returned on a subsequent resume.
    } finally { provider.destroy(); }
    } finally { if (lock !== undefined) closeSync(lock); try { unlinkSync(lockPath); } catch {} }
}
