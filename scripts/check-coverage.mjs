import { readFileSync } from "node:fs";

const reportPath = process.argv[2];
if (!reportPath) throw new Error("usage: check-coverage.mjs <forge-coverage-report>");
const report = readFileSync(reportPath, "utf8");
const registry = report.split("\n").find((line) => line.includes("src/MerkleRootRegistryZK.sol"));
if (!registry) throw new Error("coverage report does not include MerkleRootRegistryZK.sol");
const percentages = [...registry.matchAll(/([0-9]+(?:\.[0-9]+)?)%/g)].map((match) => Number(match[1]));
if (percentages.length < 3) throw new Error("coverage report does not contain line and branch percentages");
const [lines, statements, branches] = percentages;
if (lines < 95 || branches < 85) {
    throw new Error(`MerkleRootRegistryZK coverage below threshold: lines ${lines}% (min 95%), branches ${branches}% (min 85%)`);
}
process.stdout.write(`coverage threshold: registry lines ${lines}%, statements ${statements}%, branches ${branches}%\n`);
