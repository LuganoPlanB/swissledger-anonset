#!/usr/bin/env node

// SPDX-FileCopyrightText: 2026 PlanB foundation
// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const output = resolve(".vitepress/dist");
const expectedPages = [
    "index.html",
    "USAGE.html",
    "AGENTS.html",
    "DEPENDENCY_SECURITY.html",
    "clients/anonset/README.html",
    "scripts/README.html",
    "docs/DEPLOYMENT.html",
    "docs/OPERATIONS.html",
    "docs/READINESS.html",
    "docs/releasing.html",
];

for (const page of expectedPages) {
    const file = resolve(output, page);
    if (!existsSync(file)) throw new Error(`documentation page was not built: ${page}`);
    const html = readFileSync(file, "utf8");
    if (!html.includes("Swissledger AnonSet")) throw new Error(`documentation page has no site title: ${page}`);
}

if (existsSync(resolve(output, "README.html"))) {
    throw new Error("README.md was emitted twice instead of remaining the canonical home-page source");
}

process.stdout.write(`documentation build: ${expectedPages.length} canonical pages verified\n`);
