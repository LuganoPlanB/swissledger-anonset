import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const deploymentArtifacts = [
    ["registry", "out/MerkleRootRegistryZK.sol/MerkleRootRegistryZK.json"],
    ["PoseidonT3", "out/PoseidonT3.sol/PoseidonT3.json"],
    ["Semaphore", "out/Semaphore.sol/Semaphore.json"],
    ["SemaphoreVerifier", "out/SemaphoreVerifier.sol/SemaphoreVerifier.json"]
];
const MAX_RUNTIME_SIZE = 24_576;
const MAX_INITCODE_SIZE = 49_152;
const CODE_DEPOSIT_GAS_PER_BYTE = 200;

function hexBytes(bytecode) {
    // Foundry preserves unresolved library references as a 20-byte placeholder.
    // Substitute only that address payload so instruction offsets stay intact.
    const normalized = String(bytecode ?? "")
        .replace(/^0x/, "")
        .replace(/__\$[0-9a-fA-F]{34}\$__/g, "00".repeat(20));
    if (!/^(?:[0-9a-fA-F]{2})*$/.test(normalized)) {
        throw new Error("bytecode must be an even-length hexadecimal string");
    }
    return Buffer.from(normalized, "hex");
}

export function findUnsupportedInstructions(bytecode) {
    let bytes = hexBytes(bytecode);
    if (bytes.length >= 3) {
        const metadataLength = bytes.readUInt16BE(bytes.length - 2);
        const metadataOffset = bytes.length - metadataLength - 2;
        // Solidity appends a CBOR map and its two-byte length. Exclude only a
        // structurally plausible final metadata section, never executable code.
        if (metadataOffset >= 0 && bytes[metadataOffset] >= 0xa0 && bytes[metadataOffset] <= 0xbf) {
            bytes = bytes.subarray(0, metadataOffset);
        }
    }
    const findings = [];
    const work = [{ offset: 0, stack: [] }];
    const visited = new Set();

    function stackEffect(opcode) {
        if (opcode >= 0x01 && opcode <= 0x0b) return opcode === 0x08 || opcode === 0x09 ? [3, 1] : [2, 1];
        if (opcode >= 0x10 && opcode <= 0x1d) return opcode === 0x15 || opcode === 0x19 ? [1, 1] : [2, 1];
        if (opcode === 0x20) return [2, 1];
        const effects = new Map([
            [0x30, [0, 1]], [0x31, [1, 1]], [0x32, [0, 1]], [0x33, [0, 1]], [0x34, [0, 1]],
            [0x35, [1, 1]], [0x36, [0, 1]], [0x37, [3, 0]], [0x38, [0, 1]], [0x39, [3, 0]],
            [0x3a, [0, 1]], [0x3b, [1, 1]], [0x3c, [4, 0]], [0x3d, [0, 1]], [0x3e, [3, 0]], [0x3f, [1, 1]],
            [0x40, [1, 1]], [0x41, [0, 1]], [0x42, [0, 1]], [0x43, [0, 1]], [0x44, [0, 1]],
            [0x45, [0, 1]], [0x46, [0, 1]], [0x47, [0, 1]], [0x48, [0, 1]], [0x49, [1, 1]], [0x4a, [0, 1]],
            [0x50, [1, 0]], [0x51, [1, 1]], [0x52, [2, 0]], [0x53, [2, 0]], [0x54, [1, 1]], [0x55, [2, 0]],
            [0x58, [0, 1]], [0x59, [0, 1]], [0x5a, [0, 1]], [0x5b, [0, 0]], [0x5c, [1, 1]], [0x5d, [2, 0]], [0x5e, [3, 0]],
            [0xf0, [3, 1]], [0xf1, [7, 1]], [0xf2, [7, 1]], [0xf4, [6, 1]], [0xf5, [4, 1]], [0xfa, [6, 1]], [0xff, [1, 0]],
        ]);
        if (opcode >= 0xa0 && opcode <= 0xa4) return [2 + opcode - 0xa0, 0];
        return effects.get(opcode) ?? [0, 0];
    }

    function enqueue(offset, stack) {
        if (offset === bytes.length) return;
        if (offset < 0 || offset > bytes.length) throw new Error(`control flow targets invalid offset ${offset}`);
        const key = `${offset}:${stack.map((value) => value === null ? "?" : value.toString(16)).join(",")}`;
        if (!visited.has(key)) {
            visited.add(key);
            work.push({ offset, stack });
        }
    }

    while (work.length > 0) {
        const state = work.pop();
        const { offset } = state;
        const stack = [...state.stack];
        const opcode = bytes[offset];
        let next = offset + 1;

        if (opcode === 0x5f) findings.push({ offset, opcode: "PUSH0" });
        if (opcode === 0x5e) findings.push({ offset, opcode: "MCOPY" });

        if (opcode >= 0x60 && opcode <= 0x7f) {
            const width = opcode - 0x5f;
            if (next + width > bytes.length) throw new Error(`truncated PUSH${width} at offset ${offset}`);
            stack.push(BigInt(`0x${bytes.subarray(next, next + width).toString("hex") || "0"}`));
            next += width;
        } else if (opcode === 0x5f) {
            stack.push(0n);
        } else if (opcode >= 0x80 && opcode <= 0x8f) {
            const depth = opcode - 0x7f;
            stack.push(stack.at(-depth) ?? null);
        } else if (opcode >= 0x90 && opcode <= 0x9f) {
            const depth = opcode - 0x8f;
            const top = stack.length - 1;
            const other = stack.length - 1 - depth;
            if (other < 0) throw new Error(`stack underflow at SWAP${depth} offset ${offset}`);
            [stack[top], stack[other]] = [stack[other], stack[top]];
        } else if (opcode === 0x56 || opcode === 0x57) {
            const destination = stack.pop();
            if (typeof destination !== "bigint" || destination > BigInt(Number.MAX_SAFE_INTEGER)) {
                throw new Error(`unresolved dynamic jump at offset ${offset}`);
            }
            const target = Number(destination);
            if (bytes[target] !== 0x5b) throw new Error(`jump at offset ${offset} targets non-JUMPDEST ${target}`);
            if (opcode === 0x57) {
                stack.pop();
                enqueue(next, [...stack]);
            }
            enqueue(target, stack);
            continue;
        } else {
            const [pops, pushes] = stackEffect(opcode);
            for (let index = 0; index < pops; index += 1) stack.pop();
            for (let index = 0; index < pushes; index += 1) stack.push(opcode === 0x58 ? BigInt(offset) : null);
        }

        if ([0x00, 0xf3, 0xfd, 0xfe, 0xff].includes(opcode)) continue;
        enqueue(next, stack);
    }
    return findings.sort((left, right) => left.offset - right.offset);
}

export function artifactReport(name, artifact) {
    const runtime = hexBytes(artifact.deployedBytecode?.object);
    const initcode = hexBytes(artifact.bytecode?.object);
    const unsupported = [
        ...findUnsupportedInstructions(artifact.deployedBytecode?.object).map((finding) => ({ ...finding, section: "runtime" })),
        ...findUnsupportedInstructions(artifact.bytecode?.object).map((finding) => ({ ...finding, section: "initcode" }))
    ];
    return {
        name,
        runtimeBytes: runtime.length,
        initcodeBytes: initcode.length,
        codeDepositGas: runtime.length * CODE_DEPOSIT_GAS_PER_BYTE,
        runtimeHash: createHash("sha256").update(runtime).digest("hex"),
        abiHash: createHash("sha256").update(JSON.stringify(artifact.abi)).digest("hex"),
        unsupported
    };
}

export function loadDeploymentReports(projectRoot = root) {
    return deploymentArtifacts.map(([name, relativePath]) => {
        const artifact = JSON.parse(readFileSync(resolve(projectRoot, relativePath), "utf8"));
        return artifactReport(name, artifact);
    });
}

function printReports(reports) {
    let failed = false;
    for (const report of reports) {
        const runtimeOk = report.runtimeBytes <= MAX_RUNTIME_SIZE;
        const initcodeOk = report.initcodeBytes <= MAX_INITCODE_SIZE;
        const opcodeOk = report.unsupported.length === 0;
        failed ||= !runtimeOk || !initcodeOk || !opcodeOk;
        console.log(
            `${report.name}: runtime=${report.runtimeBytes}/${MAX_RUNTIME_SIZE}B initcode=${report.initcodeBytes}/${MAX_INITCODE_SIZE}B ` +
            `code-deposit-gas=${report.codeDepositGas} runtime-sha256=${report.runtimeHash} abi-sha256=${report.abiHash} ` +
            `unsupported=${report.unsupported.map(({ section, opcode, offset }) => `${section}:${opcode}@${offset}`).join(",") || "none"}`
        );
    }
    if (failed) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) printReports(loadDeploymentReports());
