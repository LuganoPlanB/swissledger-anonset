import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const [deploymentPath, smokePath, out] = process.argv.slice(2);
if (!deploymentPath || !smokePath || !out) throw new Error("usage: testnet-evidence DEPLOYMENT SMOKE OUT_DIR");
const deployment = JSON.parse(readFileSync(deploymentPath));
const smoke = JSON.parse(readFileSync(smokePath));
const contractNames = ["MerkleRootRegistryZK", "PoseidonT3", "Semaphore", "SemaphoreVerifier"];
const deploymentNames = ["poseidon", "verifier", "semaphore", "registry"];
if (deployment.schema !== 1 || deployment.chainId !== 222 || smoke.registry !== deployment.registry ||
    deployment.poseidon !== deployment.wiring?.semaphorePoseidon ||
    deployment.verifier !== deployment.wiring?.semaphoreVerifier ||
    deployment.semaphore !== deployment.wiring?.registrySemaphore ||
    smoke.verifyReusable !== true || smoke.validateReplayRejected !== true ||
    smoke.tamperedRejected !== true || smoke.memberRemoval !== true ||
    deployment.deployments?.map(({ name }) => name).join(",") !== deploymentNames.join(",")) {
  throw new Error("inconsistent testnet inputs");
}
if (process.env.GITHUB_ACTIONS === "true" && /^(?:localhost|127(?:\.|:)|\[::1\])/i.test(deployment.rpcHost)) {
  throw new Error("testnet evidence contains a loopback RPC host");
}
const forbidden = /(private.?key|mnemonic|authorization|github_token|x-access-token|https?:\/\/[^\s/@]+:[^\s/@]+@)/i;
const raw = JSON.stringify({ deployment, smoke });
if (forbidden.test(raw)) throw new Error("secret-shaped data in evidence input");
if (deployment.deployments.some(({ address, transactionHash, status, gasUsed, blockNumber, runtimeCodeSha256, observedDurationMs }) =>
  !/^0x[0-9a-f]{40}$/i.test(address) || !/^0x[0-9a-f]{64}$/i.test(transactionHash) || status !== "0x1" ||
  !/^[0-9]+$/.test(gasUsed) || !/^[0-9]+$/.test(blockNumber) || !/^[0-9a-f]{64}$/.test(runtimeCodeSha256) ||
  !Number.isSafeInteger(observedDurationMs) || observedDurationMs < 0)) {
  throw new Error("invalid deployment identity");
}
const expectedTransactionLabels = ["add-member-one", "add-member-two", "verify-membership-1", "verify-membership-2", "validate-membership", "remove-member"];
const chainProofMetrics = smoke.timings?.chainProof;
const validMetricObject = chainProofMetrics && ["deploymentDiscoveryMs", "eventFetchMs", "reconstructionMs", "checkpointLoadMs", "checkpointWriteMs", "proofGenerationMs", "gasEstimationMs", "totalMs"]
  .every((name) => Number.isFinite(chainProofMetrics[name]) && chainProofMetrics[name] >= 0);
const validGasEstimate = (value) => value === null || (typeof value === "string" && /^[0-9]+$/.test(value));
const checkpoint = smoke.checkpoint;
const checkpointKeys = ["mode", "persisted", "path", "fileSha256", "bytes", "baseBlock", "baseHash", "targetBlock", "targetHash", "schema", "root", "depth", "size", "insertionSlots", "activeMembers", "deltaEvents"];
const decimal = (value) => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
const hash = (value) => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
const validCheckpoint = checkpoint && Object.keys(checkpoint).sort().join(",") === checkpointKeys.sort().join(",") &&
  ["full", "resumed", "rebuilt-after-reorg", "unpersisted"].includes(checkpoint.mode) && typeof checkpoint.persisted === "boolean" &&
  (checkpoint.path === null || typeof checkpoint.path === "string") && (checkpoint.fileSha256 === null || /^[0-9a-f]{64}$/i.test(checkpoint.fileSha256)) &&
  (checkpoint.bytes === null || (Number.isSafeInteger(checkpoint.bytes) && checkpoint.bytes > 0)) && Number.isSafeInteger(checkpoint.baseBlock) && Number.isSafeInteger(checkpoint.targetBlock) && checkpoint.baseBlock >= 0 && checkpoint.targetBlock >= checkpoint.baseBlock && hash(checkpoint.baseHash) && hash(checkpoint.targetHash) &&
  checkpoint.schema === "swissledger-anonset-checkpoint/v1" && [checkpoint.root, checkpoint.depth, checkpoint.size, checkpoint.insertionSlots, checkpoint.activeMembers].every(decimal) && Number.isSafeInteger(checkpoint.deltaEvents) && checkpoint.deltaEvents >= 0 &&
  !/groupExport|privateKey|commitment|siblings|points|nullifier/i.test(JSON.stringify(checkpoint));
if (!Array.isArray(smoke.transactions) || smoke.transactions.length !== expectedTransactionLabels.length ||
    smoke.transactions.map(({ label }) => label).join(",") !== expectedTransactionLabels.join(",") ||
    smoke.transactions.some(({ transactionHash, status, gasUsed, blockNumber, observedDurationMs }) =>
      !/^0x[0-9a-f]{64}$/i.test(transactionHash) || status !== "0x1" ||
      !/^[0-9]+$/.test(gasUsed) || !/^[0-9]+$/.test(blockNumber) ||
      !Number.isSafeInteger(observedDurationMs) || observedDurationMs < 0) ||
    ![smoke.timings?.identitySetupMs, smoke.timings?.proofGenerationMs, smoke.timings?.totalObservedMs]
      .every((value) => Number.isSafeInteger(value) && value >= 0) || !validMetricObject ||
    !validGasEstimate(smoke.gasEstimates?.verifyMembership) || !validGasEstimate(smoke.gasEstimates?.validateMembership) ||
    ![smoke.reconstruction?.fromBlock, smoke.reconstruction?.toBlock, smoke.reconstruction?.eventCount,
      smoke.reconstruction?.insertionSlots, smoke.reconstruction?.activeMembers]
      .every((value) => Number.isSafeInteger(value) && value >= 0) || !validCheckpoint) {
  throw new Error("invalid smoke benchmark evidence");
}
mkdirSync(out, { recursive: true });
const root = resolve(process.env.ANONSET_EVIDENCE_ROOT ?? resolve(import.meta.dirname, ".."));
const artifact = (name) => resolve(root, "out", `${name}.sol`, `${name}.json`);
const contracts = contractNames.map((name) => {
  const path = artifact(name);
  if (!existsSync(path)) throw new Error(`missing compiled artifact: ${path}`);
  const value = JSON.parse(readFileSync(path));
  return { name, abiSha256: createHash("sha256").update(JSON.stringify(value.abi)).digest("hex"), bytecodeSha256: createHash("sha256").update(value.bytecode.object).digest("hex") };
});
const sumGas = (items) => items.reduce((sum, { gasUsed }) => sum + BigInt(gasUsed), 0n).toString();
const sumDuration = (items) => items.reduce((sum, { observedDurationMs }) => sum + observedDurationMs, 0);
const deploymentGasUsed = sumGas(deployment.deployments);
const protocolTransactionGasUsed = sumGas(smoke.transactions);
const benchmarks = {
  deploymentGasUsed,
  protocolTransactionGasUsed,
  totalTransactionGasUsed: (BigInt(deploymentGasUsed) + BigInt(protocolTransactionGasUsed)).toString(),
  deploymentObservedDurationMs: sumDuration(deployment.deployments),
  protocolTransactionObservedDurationMs: sumDuration(smoke.transactions),
  identitySetupObservedDurationMs: smoke.timings.identitySetupMs,
  proofGenerationObservedDurationMs: smoke.timings.proofGenerationMs,
  chainDeploymentDiscoveryObservedDurationMs: chainProofMetrics.deploymentDiscoveryMs,
  chainEventFetchObservedDurationMs: chainProofMetrics.eventFetchMs,
  chainReconstructionObservedDurationMs: chainProofMetrics.reconstructionMs,
  groth16ProofObservedDurationMs: chainProofMetrics.proofGenerationMs,
  proofGasEstimationObservedDurationMs: chainProofMetrics.gasEstimationMs,
  chainProofTotalObservedDurationMs: chainProofMetrics.totalMs,
  verifyMembershipEstimatedGas: smoke.gasEstimates.verifyMembership,
  validateMembershipEstimatedGas: smoke.gasEstimates.validateMembership,
  smokeTotalObservedDurationMs: smoke.timings.totalObservedMs
};
const manifest = { schema: 1, commit: process.env.GITHUB_SHA ?? "local", utc: new Date().toISOString(), chainId: 222, rpcHost: deployment.rpcHost, deployer: deployment.deployer, tool: process.env.SWISSLEDGER_FOUNDRY_VERSION ?? "swissledger-foundry-1.11.0", solc: "0.8.30", deployments: deployment.deployments.map(({ name, address, transactionHash, status, gasUsed, blockNumber, runtimeCodeSha256, observedDurationMs }) => ({ name, address, transactionHash, status, gasUsed, blockNumber, runtimeCodeSha256, observedDurationMs })), wiring: { poseidon: deployment.poseidon, verifier: deployment.verifier, semaphore: deployment.semaphore, registry: deployment.registry }, contracts, benchmarks, smoke, runUrl: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : "local" };
const text = JSON.stringify(manifest, null, 2);
if (forbidden.test(text)) throw new Error("secret-shaped data in evidence manifest");
writeFileSync(resolve(out, "manifest.json"), text);
process.stdout.write(`${JSON.stringify({ chainId: manifest.chainId, rpcHost: manifest.rpcHost, wiring: manifest.wiring, benchmarks })}\n`);
for (const name of contractNames) cpSync(artifact(name), resolve(out, `${basename(name)}.json`));
for (const file of ["dependencies.cdx.json", "dependency-licenses.json"]) {
  const source = resolve(root, "artifacts", file);
  if (!existsSync(source)) throw new Error(`missing release evidence input: ${source}`);
  const contents = readFileSync(source, "utf8");
  if (forbidden.test(contents)) throw new Error(`secret-shaped data in ${file}`);
  cpSync(source, resolve(out, file));
}
