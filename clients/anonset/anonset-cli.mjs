import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof, verifyProof } from "@semaphore-protocol/proof";
import { Contract, JsonRpcProvider } from "ethers";

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function writeStdout(value) {
    process.stdout.write(`${value}\n`);
}

function fail(message, exitCode = 2) {
    process.stderr.write(`${message}\n`);
    process.exit(exitCode);
}

function parseJson(text, label) {
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`${label} must be valid JSON: ${error.message}`);
    }
}

function readJsonArg(argument, label) {
    if (existsSync(argument)) {
        return parseJson(readFileSync(argument, "utf8"), `${label} file`);
    }
    return parseJson(argument, label);
}

// ---------------------------------------------------------------------------
//  Commands
// ---------------------------------------------------------------------------

async function cmdIdentityCreate(privateKey) {
    const identity = privateKey ? new Identity(privateKey) : new Identity();
    const result = {
        privateKey: Buffer.from(identity.privateKey).toString("hex"),
        commitment: identity.commitment.toString(),
    };
    writeStdout(JSON.stringify(result, null, 2));
    return result;
}

async function cmdProofGenerate(identityPath, groupPath, message, scope) {
    const identityData = readJsonArg(identityPath, "identity");
    const groupData = readJsonArg(groupPath, "group");

    // Reconstruct identity from hex-encoded private key
    const identity = new Identity(Buffer.from(identityData.privateKey, "hex"));

    // group can be { members: [...] } or { root, depth, members }
    const members = groupData.members || groupData.values || groupData;
    const group = new Group(members.map(BigInt));

    const proof = await generateProof(
        identity,
        group,
        message || "0",
        scope || "0"
    );

    const result = {
        merkleTreeDepth: proof.merkleTreeDepth,
        merkleTreeRoot: proof.merkleTreeRoot,
        nullifier: proof.nullifier,
        message: proof.message,
        scope: proof.scope,
        points: proof.points,
    };

    writeStdout(JSON.stringify(result, null, 2));
    return result;
}

async function cmdVerifyOnChain(contractAddress, proofPath, rpcUrl) {
    const proofData = readJsonArg(proofPath, "proof");
    const provider = new JsonRpcProvider(rpcUrl);

    const abi = [
        "function verifyMembership(uint256,uint256,uint256,uint256,uint256[8]) view returns (bool)",
        "function verifyMembership(uint256,uint256,uint256,uint256[8]) view returns (bool)",
        "function activeRoot() view returns (uint256)",
    ];

    const contract = new Contract(contractAddress, abi, provider);

    try {
        // Try 5-argument version first (with explicit message)
        const result = await contract.verifyMembership(
            proofData.merkleTreeDepth,
            proofData.merkleTreeRoot,
            proofData.nullifier,
            proofData.message || "0",
            proofData.points
        );
        writeStdout(String(result));
        return result;
    } catch {
        // Fall back to 4-argument version (message=0 implicitly)
        const result = await contract.verifyMembership(
            proofData.merkleTreeDepth,
            proofData.merkleTreeRoot,
            proofData.nullifier,
            proofData.points
        );
        writeStdout(String(result));
        return result;
    }
}

async function cmdVerifyLocal(proofPath) {
    const proofData = readJsonArg(proofPath, "proof");
    const result = await verifyProof(proofData);
    writeStdout(String(result));
    return result;
}

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------

const USAGE = `Usage:
  npm run anonset -- identity create [private-key-hex]
  npm run anonset -- proof generate <identity.json> <group.json> [message] [scope]
  npm run anonset -- verify on-chain <contract-address> <proof.json> <rpc-url>
  npm run anonset -- verify local <proof.json>

Examples:
  npm run anonset -- identity create
  npm run anonset -- identity create 0xabcdef...
  npm run anonset -- proof generate identity.json group.json
  npm run anonset -- proof generate identity.json group.json "my-vote" "election-42"
  npm run anonset -- verify local proof.json
  npm run anonset -- verify on-chain 0x123... proof.json https://rpc.example.com
`;

async function run() {
    const args = process.argv.slice(2);

    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
        writeStdout(USAGE.trimEnd());
        return;
    }

    const [command, ...rest] = args;

    if (command === "identity") {
        const [sub, privateKey] = rest;
        if (sub !== "create") {
            fail(`Unknown identity subcommand: ${sub}`);
        }
        await cmdIdentityCreate(privateKey);
        return;
    }

    if (command === "proof") {
        const [sub, identityPath, groupPath, message, scope] = rest;
        if (sub !== "generate") {
            fail(`Unknown proof subcommand: ${sub}`);
        }
        if (!identityPath || !groupPath) {
            fail("proof generate requires <identity.json> <group.json>");
        }
        await cmdProofGenerate(identityPath, groupPath, message, scope);
        return;
    }

    if (command === "verify") {
        const [sub, ...verifyArgs] = rest;
        if (sub === "on-chain") {
            const [contractAddress, proofPath, rpcUrl] = verifyArgs;
            if (!contractAddress || !proofPath || !rpcUrl) {
                fail("verify on-chain requires <contract-address> <proof.json> <rpc-url>");
            }
            await cmdVerifyOnChain(contractAddress, proofPath, rpcUrl);
            return;
        }
        if (sub === "local") {
            const [proofPath] = verifyArgs;
            if (!proofPath) {
                fail("verify local requires <proof.json>");
            }
            await cmdVerifyLocal(proofPath);
            return;
        }
        fail(`Unknown verify subcommand: ${sub}`);
    }

    fail(`Unknown command: ${command}`);
}

try {
    await run();
    process.exit(0);
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
}
