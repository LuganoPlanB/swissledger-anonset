#!/usr/bin/env node

import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));

const semaphoreVersion = "4.14.3";
const semaphorePackages = ["core", "contracts", "group", "identity", "proof"];
const requiredOverrides = {
    snarkjs: "0.7.5",
    underscore: "1.13.8",
    ws: "8.21.3",
};

function fail(message) {
    process.stderr.write(`dependency integrity: ${message}\n`);
    process.exitCode = 1;
}

for (const name of semaphorePackages) {
    const dependencyName = `@semaphore-protocol/${name}`;
    const declared = packageJson.dependencies?.[dependencyName] ?? packageJson.devDependencies?.[dependencyName];
    if (declared !== semaphoreVersion) {
        fail(`${dependencyName} must be pinned to ${semaphoreVersion}, found ${declared ?? "missing"}`);
    }

    const locked = packageLock.packages?.[`node_modules/${dependencyName}`]?.version;
    if (locked !== semaphoreVersion) {
        fail(`${dependencyName} lock version must be ${semaphoreVersion}, found ${locked ?? "missing"}`);
    }
}

for (const [name, version] of Object.entries(requiredOverrides)) {
    if (packageJson.overrides?.[name] !== version) {
        fail(`${name} override must be ${version}`);
    }

    const mismatches = Object.entries(packageLock.packages ?? {})
        .filter(([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`))
        .filter(([, metadata]) => metadata.version !== version)
        .map(([path, metadata]) => `${path}@${metadata.version}`);

    if (mismatches.length > 0) {
        fail(`${name} override is not applied everywhere: ${mismatches.join(", ")}`);
    }
}

if (process.exitCode) {
    process.exit(process.exitCode);
}

process.stdout.write(
    `dependency integrity: Semaphore ${semaphoreVersion}; overrides ${Object.entries(requiredOverrides)
        .map(([name, version]) => `${name}@${version}`)
        .join(", ")}\n`,
);
