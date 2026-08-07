import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const forge = resolve(root, "bin/swissledger-forge");
const artifacts = [
    "out/MerkleRootRegistryZK.sol/MerkleRootRegistryZK.json",
    "out/Semaphore.sol/Semaphore.json",
    "out/SemaphoreVerifier.sol/SemaphoreVerifier.json"
];

function command(...args) {
    execFileSync(forge, args, { cwd: root, stdio: "inherit" });
}

function hashArtifacts() {
    return artifacts.map((artifactPath) => {
        const artifact = JSON.parse(readFileSync(resolve(root, artifactPath), "utf8"));
        const normalized = JSON.stringify({ abi: artifact.abi, bytecode: artifact.bytecode.object, deployedBytecode: artifact.deployedBytecode.object });
        return [artifactPath, createHash("sha256").update(normalized).digest("hex")];
    });
}

command("clean");
command("build");
const first = hashArtifacts();
command("clean");
command("build");
const second = hashArtifacts();
if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error("clean-build artifact hashes drifted");
for (const [artifactPath, hash] of second) console.log(`${artifactPath} sha256=${hash}`);
