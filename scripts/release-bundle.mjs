import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const [evidenceDirectory, outputDirectory, sourceDirectory = process.cwd()] = process.argv.slice(2);
if (!evidenceDirectory || !outputDirectory) throw new Error("usage: release-bundle EVIDENCE_DIRECTORY OUTPUT_DIRECTORY [SOURCE_DIRECTORY]");

const root = resolve(sourceDirectory);
const evidence = resolve(evidenceDirectory);
const output = resolve(outputDirectory);
const contracts = ["MerkleRootRegistryZK", "PoseidonT3", "Semaphore", "SemaphoreVerifier"];
const forbidden = /(private.?key|mnemonic|authorization|github_token|x-access-token|https?:\/\/[^\s/@]+:[^\s/@]+@)/i;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const copy = (from, to) => cpSync(from, to, { force: true });
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

rmSync(output, { recursive: true, force: true });
mkdirSync(resolve(output, "contracts"), { recursive: true });
mkdirSync(resolve(output, "evidence"), { recursive: true });
cpSync(resolve(root, "src"), resolve(output, "source"), { recursive: true });
cpSync(resolve(root, "vendor"), resolve(output, "source", "vendor"), { recursive: true });
const evidenceManifest = json(resolve(evidence, "manifest.json"));
if (evidenceManifest.schema !== 1 || evidenceManifest.chainId !== 222 || evidenceManifest.contracts?.length !== 4) throw new Error("invalid deployment evidence");

for (const name of contracts) {
  const artifactPath = resolve(root, "out", `${name}.sol`, `${name}.json`);
  if (!existsSync(artifactPath)) throw new Error(`missing compiled artifact: ${artifactPath}`);
  const artifact = json(artifactPath);
  const identity = evidenceManifest.contracts.find((item) => item.name === name);
  if (!identity || sha256(JSON.stringify(artifact.abi)) !== identity.abiSha256 || sha256(artifact.bytecode?.object) !== identity.bytecodeSha256) {
    throw new Error(`rebuilt artifact differs from deployed evidence: ${name}`);
  }
  writeFileSync(resolve(output, "contracts", `${name}.abi.json`), `${JSON.stringify(artifact.abi, null, 2)}\n`);
  writeFileSync(resolve(output, "contracts", `${name}.bytecode.txt`), `${artifact.bytecode.object}\n`);
  copy(artifactPath, resolve(output, "contracts", `${name}.artifact.json`));
}
for (const name of ["manifest.json", "dependencies.cdx.json", "dependency-licenses.json"]) copy(resolve(evidence, name), resolve(output, "evidence", name));
for (const name of ["gas-report.txt", "test-summary.txt"]) {
  const source = resolve(root, "artifacts", "release-input", name);
  if (!existsSync(source)) throw new Error(`missing release report: ${source}`);
  copy(source, resolve(output, name));
}
const pkg = json(resolve(root, "package.json"));
const buildInfo = readFileSync(resolve(root, "src/generated/BuildInfo.sol"), "utf8");
if (!buildInfo.includes(`VERSION = \"${pkg.version}\"`)) throw new Error("BuildInfo version does not match package version");
const metadata = { schema: 1, package: pkg.name, version: pkg.version, commit: evidenceManifest.commit, chainId: 222, contracts, testnetAddressesAreEvidenceOnly: true };
writeFileSync(resolve(output, "build-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
const files = [];
const visit = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) { visit(path); continue; }
    if (entry.name === "checksums.sha256") continue;
    const value = readFileSync(path);
    if (forbidden.test(value.toString("utf8"))) throw new Error(`secret-shaped data in release bundle: ${path}`);
    files.push([path.slice(output.length + 1), sha256(value)]);
  }
};
visit(output);
files.sort(([left], [right]) => left.localeCompare(right));
writeFileSync(resolve(output, "checksums.sha256"), files.map(([name, hash]) => `${hash}  ${name}`).join("\n") + "\n");
process.stdout.write(`release bundle: ${output}\n`);
