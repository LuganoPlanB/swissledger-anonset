// SPDX-FileCopyrightText: 2026 PlanB foundation
// SPDX-License-Identifier: AGPL-3.0-or-later

import { h } from "vue";
import DefaultTheme from "vitepress/theme";
import "lugano-planb-vite-theme/theme.css";
import "./swissledger.css";

const Layout = () => h(DefaultTheme.Layout, null, {
    "nav-bar-title-before": () => h("span", {
        class: "planb-brand__mark",
        "aria-hidden": "true",
    }),
});

export default {
    extends: DefaultTheme,
    Layout,
    enhanceApp() {
        if (typeof document === "undefined") return;
        const root = document.documentElement;
        const synchronizeTheme = () => {
            root.dataset.theme = root.classList.contains("dark") ? "dark" : "light";
        };
        synchronizeTheme();
        new MutationObserver(synchronizeTheme).observe(root, {
            attributes: true,
            attributeFilter: ["class"],
        });
    },
};
