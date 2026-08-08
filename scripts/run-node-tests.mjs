#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const phaseArgument = process.argv.find((argument) => argument.startsWith("--phase="));
const selectedPhase = phaseArgument?.slice("--phase=".length) ?? "all";
const configuredPhaseTimeout = Number.parseInt(process.env.NODE_TEST_PHASE_TIMEOUT_MS ?? "30000", 10);
if (!Number.isSafeInteger(configuredPhaseTimeout) || configuredPhaseTimeout <= 0) {
    throw new Error("NODE_TEST_PHASE_TIMEOUT_MS must be a positive integer");
}
const suiteDeadline = Date.now() + Math.max(60_000, configuredPhaseTimeout * 2);
const phases = [
    {
        id: "unit",
        label: "client unit",
        pattern: "client hardening",
    },
    {
        id: "proof",
        label: "proof integration",
        pattern: "proof integration:",
        requiredTests: 4,
    },
].filter(({ id }) => selectedPhase === "all" || selectedPhase === id);

if (phases.length === 0) {
    throw new Error(`unknown Node test phase: ${selectedPhase}`);
}

async function runPhase({ label, pattern }) {
    const source = readFileSync("clients/anonset/anonset.test.mjs", "utf8");
    const matchedTests = (source.match(/it\("proof integration:/g) ?? []).length;
    if (pattern === "proof integration:" && matchedTests < 4) {
        throw new Error(`Node test phase '${label}' requires at least 4 executable proof integration tests; found ${matchedTests}`);
    }
    const remainingSuiteTime = suiteDeadline - Date.now();
    const timeoutMilliseconds = Math.min(configuredPhaseTimeout, remainingSuiteTime);
    if (timeoutMilliseconds <= 0) {
        throw new Error("Node test suite exceeded 60000ms before the next phase started");
    }

    process.stdout.write(`==> Node test phase: ${label}\n`);
    const child = spawn(
        process.execPath,
        [
            "--test",
            "--test-timeout=20000",
            `--test-name-pattern=${pattern}`,
            "clients/anonset/anonset.test.mjs",
        ],
        { stdio: "inherit" },
    );

    let timedOut = false;
    let forcedKill;
    const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        forcedKill = setTimeout(() => child.kill("SIGKILL"), 2_000);
        forcedKill.unref();
    }, timeoutMilliseconds);

    const { code, signal } = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (exitCode, exitSignal) => resolve({ code: exitCode, signal: exitSignal }));
    }).finally(() => {
        clearTimeout(timeout);
        clearTimeout(forcedKill);
    });

    if (timedOut) {
        throw new Error(`Node test phase '${label}' exceeded ${timeoutMilliseconds}ms`);
    }
    if (code !== 0) {
        throw new Error(`Node test phase '${label}' failed with ${signal ? `signal ${signal}` : `exit ${code}`}`);
    }
}

for (const phase of phases) {
    await runPhase(phase);
}
