import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(path, "utf8");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const release = JSON.parse(read(join(root, ".releaserc.json")));

test("semantic release is pinned, main-only, GitHub-only, and version-aligned", () => {
  const pkg = JSON.parse(read(join(root, "package.json")));
  const lock = JSON.parse(read(join(root, "package-lock.json")));
  assert.deepEqual(release.branches, ["main"]);
  assert.equal(release.tagFormat, "v${version}");
  assert.deepEqual(release.plugins.map(([plugin]) => plugin), ["@semantic-release/commit-analyzer", "@semantic-release/release-notes-generator", "@semantic-release/github"]);
  assert.ok(!JSON.stringify(release).match(/semantic-release\/(npm|git|changelog)(?:"|$)/));
  assert.ok(!Object.keys(pkg.devDependencies).some((name) => /semantic-release\/(npm|git|changelog)$/.test(name)));
  for (const [name, version] of Object.entries(pkg.devDependencies).filter(([name]) => name.includes("semantic-release") || name === "semantic-release")) {
    assert.match(version, /^\d+\.\d+\.\d+$/);
    assert.equal(lock.packages[""].devDependencies[name], version);
  }
  assert.match(read(join(root, "src/generated/BuildInfo.sol")), new RegExp(`VERSION = "${pkg.version}"`));
});

test("conventional histories have deterministic SemVer expectations without a publish path", () => {
  const next = (current, commits) => {
    if (!commits.some((message) => /^(feat|fix)(?:\(.+\))?!?:/.test(message) || /BREAKING CHANGE:/.test(message))) return null;
    const [major, minor, patch] = current.split(".").map(Number);
    if (commits.some((message) => /!:/.test(message) || /BREAKING CHANGE:/.test(message))) return `${major + 1}.0.0`;
    if (commits.some((message) => /^feat(?:\(.+\))?:/.test(message))) return `${major}.${minor + 1}.0`;
    return `${major}.${minor}.${patch + 1}`;
  };
  assert.equal(next("1.0.0", ["feat: add proof export"]), "1.1.0");
  assert.equal(next("1.0.0", ["fix: reject malformed proof"]), "1.0.1");
  assert.equal(next("1.0.0", ["feat!: replace proof encoding"]), "2.0.0");
  assert.equal(next("1.0.0", ["chore: update readme"]), null);
  assert.equal(`v${next("1.0.0", ["fix: x"])}`, "v1.0.1");
});

test("release workflow is SHA- and evidence-gated with publication permission only", () => {
  const workflow = read(join(root, ".github/workflows/release.yml"));
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows: \[test\]/);
  assert.match(workflow, /head_branch == 'main'/);
  assert.doesNotMatch(workflow, /pull_request/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /node scripts\/release-gate\.mjs/);
  assert.match(workflow, /anonset-testnet-\$EXPECTED_SHA/);
  assert.match(workflow, /group: anonset-release-main/);
  assert.match(workflow, /wc -l\)" -eq 3/);
  assert.match(workflow, /grep -v ':success\$'/);
  assert.match(workflow, /contents: read/);
  assert.equal((workflow.match(/contents: write/g) ?? []).length, 1);
  assert.doesNotMatch(workflow, /NPM_TOKEN|npm publish|registry\.npmjs/i);
  assert.match(workflow, /git diff --exit-code -- CHANGELOG\.md package\.json package-lock\.json src\/generated\/BuildInfo\.sol/);
  assert.match(read(join(root, "docs/releasing.md")), /never changed by the release workflow/);
  assert.doesNotMatch(workflow, /@[vV]\d+(?:\.|\s|$)/);
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "anonset-release-"));
  const out = join(directory, "out"); const evidence = join(directory, "evidence"); const release = join(directory, "artifacts", "release-bundle");
  mkdirSync(evidence, { recursive: true }); mkdirSync(join(directory, "artifacts", "release-input"), { recursive: true });
  const contracts = ["MerkleRootRegistryZK", "Semaphore", "SemaphoreVerifier"].map((name, index) => {
    const artifact = { abi: [{ type: "function", name }], bytecode: { object: `60${index}` } };
    mkdirSync(join(out, `${name}.sol`), { recursive: true });
    writeFileSync(join(out, `${name}.sol`, `${name}.json`), JSON.stringify(artifact));
    writeFileSync(join(evidence, `${name}.json`), JSON.stringify(artifact));
    return { name, abiSha256: sha(JSON.stringify(artifact.abi)), bytecodeSha256: sha(artifact.bytecode.object) };
  });
  writeFileSync(join(evidence, "manifest.json"), JSON.stringify({ schema: 1, chainId: 222, commit: "a".repeat(40), contracts }));
  writeFileSync(join(evidence, "dependencies.cdx.json"), "{}"); writeFileSync(join(evidence, "dependency-licenses.json"), "[]");
  writeFileSync(join(directory, "artifacts", "release-input", "gas-report.txt"), "gas report\n"); writeFileSync(join(directory, "artifacts", "release-input", "test-summary.txt"), "tests pass\n");
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }));
  mkdirSync(join(directory, "src", "generated"), { recursive: true }); writeFileSync(join(directory, "src", "generated", "BuildInfo.sol"), 'VERSION = "1.0.0"');
  return { directory, out, evidence, release };
}

test("gate blocks stale or corrupt evidence before a release mutation", () => {
  const { directory, evidence } = fixture();
  try {
    execFileSync(process.execPath, [join(root, "scripts/release-gate.mjs"), evidence, "a".repeat(40)]);
    assert.throws(() => execFileSync(process.execPath, [join(root, "scripts/release-gate.mjs"), evidence, "b".repeat(40)]));
    writeFileSync(join(evidence, "MerkleRootRegistryZK.json"), "{}");
    assert.throws(() => execFileSync(process.execPath, [join(root, "scripts/release-gate.mjs"), evidence, "a".repeat(40)]));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("release bundle is reproducible, complete, and secret-free", () => {
  const { directory, evidence, release } = fixture();
  try {
    execFileSync(process.execPath, [join(root, "scripts/release-bundle.mjs"), evidence, release, directory]);
    const first = read(join(release, "checksums.sha256"));
    execFileSync(process.execPath, [join(root, "scripts/release-bundle.mjs"), evidence, release, directory]);
    assert.equal(read(join(release, "checksums.sha256")), first);
    for (const path of ["build-metadata.json", "source/generated/BuildInfo.sol", "contracts/MerkleRootRegistryZK.abi.json", "contracts/Semaphore.bytecode.txt", "evidence/manifest.json", "evidence/dependencies.cdx.json", "gas-report.txt", "test-summary.txt"]) assert.ok(read(join(release, path)).length > 0);
    const archive = join(directory, "artifacts", "release-bundle.tar.gz");
    execFileSync("tar", ["--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "-C", release, "-czf", archive, "."]);
    const firstArchive = sha(readFileSync(archive));
    execFileSync("tar", ["--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "-C", release, "-czf", archive, "."]);
    assert.equal(sha(readFileSync(archive)), firstArchive);
    const listed = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" });
    assert.match(listed, /gas-report\.txt/);
    assert.match(listed, /test-summary\.txt/);
    writeFileSync(join(evidence, "dependency-licenses.json"), "privateKey=bad");
    assert.throws(() => execFileSync(process.execPath, [join(root, "scripts/release-bundle.mjs"), evidence, release, directory]));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
