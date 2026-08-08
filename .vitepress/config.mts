// SPDX-FileCopyrightText: 2026 PlanB foundation
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from "vitepress";

const repository = "https://github.com/LuganoPlanB/swissledger-anonset";

export default defineConfig({
    title: "Swissledger AnonSet",
    titleTemplate: ":title · Swissledger AnonSet",
    description: "Anonymous Semaphore v4 membership, progressive proof reconstruction, and group rotation on SwissLedger.",
    lang: "en-US",
    base: "/swissledger-anonset/",
    cleanUrls: true,
    lastUpdated: true,
    srcExclude: ["README.md", "vendor/**"],
    sitemap: { hostname: "https://luganoplanb.github.io/swissledger-anonset/" },
    head: [
        ["meta", { name: "color-scheme", content: "light dark" }],
        ["meta", { name: "theme-color", content: "#082952" }],
    ],
    themeConfig: {
        nav: [
            { text: "Overview", link: "/" },
            { text: "Client", link: "/clients/anonset/README" },
            {
                text: "Operations",
                items: [
                    { text: "Deployment", link: "/docs/DEPLOYMENT" },
                    { text: "Runbook", link: "/docs/OPERATIONS" },
                    { text: "Readiness", link: "/docs/READINESS" },
                    { text: "Releasing", link: "/docs/releasing" },
                ],
            },
            {
                text: "Reference",
                items: [
                    { text: "LLM usage contract", link: "/USAGE" },
                    { text: "Agent reference", link: "/AGENTS" },
                    { text: "Script catalog", link: "/scripts/README" },
                    { text: "Dependency security", link: "/DEPENDENCY_SECURITY" },
                ],
            },
        ],
        sidebar: [
            {
                text: "Project",
                items: [
                    { text: "Overview", link: "/" },
                    { text: "Client and CLI", link: "/clients/anonset/README" },
                ],
            },
            {
                text: "Operations",
                items: [
                    { text: "Deployment", link: "/docs/DEPLOYMENT" },
                    { text: "Operations runbook", link: "/docs/OPERATIONS" },
                    { text: "Readiness evidence", link: "/docs/READINESS" },
                    { text: "Release lifecycle", link: "/docs/releasing" },
                ],
            },
            {
                text: "Maintainer reference",
                items: [
                    { text: "LLM usage contract", link: "/USAGE" },
                    { text: "Agent reference", link: "/AGENTS" },
                    { text: "Script catalog", link: "/scripts/README" },
                    { text: "Dependency security", link: "/DEPENDENCY_SECURITY" },
                ],
            },
        ],
        search: { provider: "local" },
        outline: { level: [2, 3], label: "On this page" },
        socialLinks: [{ icon: "github", link: repository }],
        footer: {
            message: "Anonymous membership infrastructure for SwissLedger.",
            copyright: "AGPL-3.0-or-later · PlanB foundation",
        },
    },
});
