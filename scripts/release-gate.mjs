import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const [evidenceDirectory, expectedCommit] = process.argv.slice(2);
if (!evidenceDirectory || !expectedCommit) throw new Error("usage: release-gate EVIDENCE_DIRECTORY EXPECTED_COMMIT");

const forbidden = /(private.?key|mnemonic|authorization|github_token|x-access-token|https?:\/\/[^\s/@]+:[^\s/@]+@)/i;
const root = resolve(evidenceDirectory);
const readJson = (name) => JSON.parse(readFileSync(resolve(root, name), "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const manifest = readJson("manifest.json");

if (manifest.schema !== 1 || manifest.chainId !== 222 || manifest.commit !== expectedCommit) {
  throw new Error("testnet evidence does not describe the intended commit");
}
if (!Array.isArray(manifest.contracts) || manifest.contracts.length !== 3) throw new Error("testnet evidence has no complete contract identity");
for (const contract of manifest.contracts) {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(contract.name) || !/^[a-f0-9]{64}$/.test(contract.abiSha256) || !/^[a-f0-9]{64}$/.test(contract.bytecodeSha256)) {
    throw new Error("testnet evidence contains an invalid contract identity");
  }
  const artifactPath = resolve(root, `${contract.name}.json`);
  if (!existsSync(artifactPath)) throw new Error(`missing testnet artifact: ${contract.name}`);
  const artifactText = readFileSync(artifactPath, "utf8");
  if (forbidden.test(artifactText)) throw new Error("secret-shaped data in testnet artifact");
  const artifact = JSON.parse(artifactText);
  if (sha256(JSON.stringify(artifact.abi)) !== contract.abiSha256 || sha256(artifact.bytecode?.object) !== contract.bytecodeSha256) {
    throw new Error(`testnet artifact hash mismatch: ${contract.name}`);
  }
}
for (const name of ["dependencies.cdx.json", "dependency-licenses.json"]) {
  const text = readFileSync(resolve(root, name), "utf8");
  if (forbidden.test(text)) throw new Error(`secret-shaped data in ${name}`);
}
if (forbidden.test(JSON.stringify(manifest))) throw new Error("secret-shaped data in testnet manifest");
process.stdout.write(`validated testnet evidence for ${expectedCommit}\n`);
