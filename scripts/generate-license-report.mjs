#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const projectDirectory = resolve(new URL("..", import.meta.url).pathname);
const packageLock = JSON.parse(readFileSync(resolve(projectDirectory, "package-lock.json"), "utf8"));
const outputFlag = process.argv.indexOf("--output");
const outputPath = outputFlag === -1 ? undefined : process.argv[outputFlag + 1];

if (outputFlag !== -1 && !outputPath) {
    throw new Error("--output requires a path");
}

const packages = [];
for (const [lockPath, lockMetadata] of Object.entries(packageLock.packages ?? {})) {
    if (!lockPath || lockMetadata.dev === true || !lockPath.includes("node_modules/")) {
        continue;
    }

    const metadataPath = resolve(projectDirectory, lockPath, "package.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    const license = metadata.license
        ?? metadata.licenses?.map((entry) => typeof entry === "string" ? entry : entry.type).filter(Boolean).join(" OR ")
        ?? "UNKNOWN";
    packages.push({
        name: metadata.name,
        version: metadata.version,
        license,
        repository: typeof metadata.repository === "string" ? metadata.repository : metadata.repository?.url ?? null,
    });
}

packages.sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
const report = `${JSON.stringify({ schemaVersion: 1, packages }, null, 2)}\n`;

if (outputPath) {
    const absoluteOutput = resolve(projectDirectory, outputPath);
    mkdirSync(dirname(absoluteOutput), { recursive: true });
    writeFileSync(absoluteOutput, report, { encoding: "utf8", mode: 0o644 });
} else {
    process.stdout.write(report);
}
