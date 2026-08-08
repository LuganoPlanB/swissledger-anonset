import { closeSync, constants, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { Group } from "@semaphore-protocol/group";
import { getAddress, isAddress } from "ethers";
import { DEFAULT_MAX_INSERTION_SLOTS, MAX_TREE_DEPTH, normalizeInsertionSlotBudget } from "./insertion-policy.mjs";

export const CHECKPOINT_SCHEMA = "swissledger-anonset-checkpoint/v1";
const decimal = (value, label, allowZero = true) => {
    if (typeof value !== "string" || !(allowZero ? /^(0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/).test(value)) throw new Error(`${label} must be decimal`);
    return value;
};
const digest = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const address = (value, label) => {
    if (typeof value !== "string" || !isAddress(value) || getAddress(value) !== value) throw new Error(`${label} must be checksummed address`);
    return value;
};
function validateMetadata(metadata, maxInsertionSlots) {
    const fields = ["chainId", "groupId", "startBlock", "snapshotBlock", "root", "depth", "size", "insertionSlots", "activeMembers"];
    for (const name of fields) decimal(metadata[name], name);
    address(metadata.registry, "registry"); address(metadata.semaphore, "semaphore");
    if (typeof metadata.snapshotHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(metadata.snapshotHash)) throw new Error("snapshotHash must be a block hash");
    if (Number(metadata.depth) > MAX_TREE_DEPTH) throw new Error(`depth must not exceed ${MAX_TREE_DEPTH}`);
    if (BigInt(metadata.insertionSlots) > BigInt(maxInsertionSlots)) throw new Error("checkpoint insertion slots exceed configured budget");
}
export function createCheckpoint(metadata, group, maxInsertionSlots = DEFAULT_MAX_INSERTION_SLOTS) {
    const budget = normalizeInsertionSlotBudget(maxInsertionSlots);
    validateMetadata(metadata, budget);
    const groupExport = group.export();
    const activeMembers = group.members.filter((member) => member !== 0n).length;
    const actual = { root: group.root.toString(), depth: String(group.depth), size: String(group.size), insertionSlots: String(group.size), activeMembers: String(activeMembers) };
    for (const [name, value] of Object.entries(actual)) if (metadata[name] !== value) throw new Error(`checkpoint ${name} does not match group state`);
    return { schema: CHECKPOINT_SCHEMA, ...metadata, groupExport, groupExportSha256: digest(groupExport) };
}
export function serializeCheckpoint(checkpoint) { return `${JSON.stringify(checkpoint)}\n`; }
export function importCheckpoint(text, { maxInsertionSlots, expected } = {}) {
    const budget = normalizeInsertionSlotBudget(maxInsertionSlots ?? DEFAULT_MAX_INSERTION_SLOTS);
    let checkpoint; try { checkpoint = JSON.parse(text); } catch { throw new Error("checkpoint must be valid JSON"); }
    const expectedKeys = ["schema", "chainId", "registry", "semaphore", "groupId", "startBlock", "snapshotBlock", "snapshotHash", "root", "depth", "size", "insertionSlots", "activeMembers", "groupExport", "groupExportSha256"];
    if (!checkpoint || typeof checkpoint !== "object" || checkpoint.schema !== CHECKPOINT_SCHEMA || Object.keys(checkpoint).sort().join(",") !== expectedKeys.sort().join(",")) throw new Error("unsupported checkpoint schema");
    validateMetadata(checkpoint, budget);
    if (typeof checkpoint.groupExport !== "string" || !/^[0-9a-f]{64}$/.test(checkpoint.groupExportSha256) || digest(checkpoint.groupExport) !== checkpoint.groupExportSha256) throw new Error("checkpoint export hash does not match");
    if (expected) for (const name of ["chainId", "registry", "semaphore", "groupId", "startBlock"]) if (expected[name] !== undefined && checkpoint[name] !== expected[name]) throw new Error(`checkpoint ${name} does not match expected metadata`);
    let group; try { group = Group.import(checkpoint.groupExport); } catch { throw new Error("checkpoint group export is invalid"); }
    const rebuilt = createCheckpoint(checkpoint, group, budget);
    if (serializeCheckpoint(rebuilt) !== serializeCheckpoint(checkpoint)) throw new Error("checkpoint contains unexpected or modified state");
    return { checkpoint, group, descriptor: checkpointDescriptor(checkpoint) };
}
export function checkpointDescriptor(checkpoint, persistedPath = null, bytes = null) {
    const { groupExport, ...descriptor } = checkpoint;
    return { ...descriptor, path: persistedPath, bytes, fileSha256: null };
}
function safeFile(filePath, label) {
    const stat = lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular non-symlink file`);
    return stat;
}
export function readCheckpointFile(filePath, options = {}) {
    const budget = normalizeInsertionSlotBudget(options.maxInsertionSlots ?? DEFAULT_MAX_INSERTION_SLOTS);
    const stat = safeFile(filePath, "checkpoint");
    const limit = Math.max(4096, budget * 256);
    if (stat.size > limit) throw new Error("checkpoint exceeds configured size policy");
    return importCheckpoint(readFileSync(filePath, "utf8"), { ...options, maxInsertionSlots: budget });
}
export function writeCheckpointFile(filePath, checkpoint, { injectFailure, maxInsertionSlots = DEFAULT_MAX_INSERTION_SLOTS } = {}) {
    const budget = normalizeInsertionSlotBudget(maxInsertionSlots);
    const target = path.resolve(filePath); const directory = path.dirname(target); const payload = serializeCheckpoint(checkpoint);
    if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) throw new Error("checkpoint parent must be a directory");
    importCheckpoint(payload, { maxInsertionSlots: budget });
    try { if (lstatSync(target).isSymbolicLink() || !lstatSync(target).isFile()) throw new Error("unsafe checkpoint replacement"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`); let fd;
    try { fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600); writeFileSync(fd, payload, "utf8"); fsyncSync(fd); closeSync(fd); fd = undefined; if (injectFailure) throw new Error("injected checkpoint write failure"); renameSync(temporary, target); }
    catch (error) { if (fd !== undefined) closeSync(fd); try { unlinkSync(temporary); } catch {} throw error; }
    return { ...checkpointDescriptor(checkpoint, filePath, Buffer.byteLength(payload)), fileSha256: digest(payload) };
}
