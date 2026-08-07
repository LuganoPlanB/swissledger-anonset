import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const [deploymentPath, smokePath, out] = process.argv.slice(2);
if (!deploymentPath || !smokePath || !out) throw new Error("usage: testnet-evidence DEPLOYMENT SMOKE OUT_DIR");
const deployment = JSON.parse(readFileSync(deploymentPath));
const smoke = JSON.parse(readFileSync(smokePath));
if (deployment.schema !== 1 || deployment.chainId !== 222 || smoke.registry !== deployment.registry) throw new Error("inconsistent testnet inputs");
const forbidden = /(private.?key|mnemonic|authorization|github_token|x-access-token|https?:\/\/[^\s/@]+:[^\s/@]+@)/i;
const raw = JSON.stringify({ deployment, smoke });
if (forbidden.test(raw)) throw new Error("secret-shaped data in evidence input");
mkdirSync(out, { recursive: true });
const root = resolve(process.env.ANONSET_EVIDENCE_ROOT ?? resolve(import.meta.dirname, ".."));
const artifact = (name) => resolve(root, "out", `${name}.sol`, `${name}.json`);
const contracts = ["MerkleRootRegistryZK", "Semaphore", "SemaphoreVerifier"].map((name) => {
  const path = artifact(name);
  if (!existsSync(path)) throw new Error(`missing compiled artifact: ${path}`);
  const value = JSON.parse(readFileSync(path));
  return { name, abiSha256: createHash("sha256").update(JSON.stringify(value.abi)).digest("hex"), bytecodeSha256: createHash("sha256").update(value.bytecode.object).digest("hex") };
});
const manifest = { schema: 1, commit: process.env.GITHUB_SHA ?? "local", utc: new Date().toISOString(), chainId: 222, rpcHost: deployment.rpcHost, deployer: deployment.deployer, tool: process.env.SWISSLEDGER_FOUNDRY_VERSION ?? "swissledger-foundry-1.11.0", solc: "0.8.30", deployments: deployment.deployments.map(({ name, address, transactionHash, gasUsed }) => ({ name, address, transactionHash, gasUsed })), wiring: { verifier: deployment.verifier, semaphore: deployment.semaphore, registry: deployment.registry }, contracts, smoke, runUrl: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : "local" };
const text = JSON.stringify(manifest, null, 2);
if (forbidden.test(text)) throw new Error("secret-shaped data in evidence manifest");
writeFileSync(resolve(out, "manifest.json"), text);
for (const name of ["MerkleRootRegistryZK", "Semaphore", "SemaphoreVerifier"]) cpSync(artifact(name), resolve(out, `${basename(name)}.json`));
for (const file of ["dependencies.cdx.json", "dependency-licenses.json"]) {
  const source = resolve(root, "artifacts", file);
  if (!existsSync(source)) throw new Error(`missing release evidence input: ${source}`);
  const contents = readFileSync(source, "utf8");
  if (forbidden.test(contents)) throw new Error(`secret-shaped data in ${file}`);
  cpSync(source, resolve(out, file));
}
