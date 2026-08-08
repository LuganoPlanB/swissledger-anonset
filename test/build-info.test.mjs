import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

const script = resolve("scripts/generate-build-info.mjs");
function run(version) {
    const dir = mkdtempSync(resolve(tmpdir(), "build-info-"));
    const pkg = resolve(dir, "package.json"); const target = resolve(dir, "BuildInfo.sol");
    writeFileSync(pkg, JSON.stringify({ version }));
    return { target, exec: (check = false) => execFileSync(process.execPath, [script, ...(check ? ["--check"] : [])], { env: { ...process.env, BUILD_INFO_PACKAGE: pkg, BUILD_INFO_TARGET: target } }) };
}
test("writes valid SemVer atomically", () => { const x = run("1.2.3-beta.1+build.7"); x.exec(); assert.match(readFileSync(x.target, "utf8"), /1.2.3-beta.1\+build.7/); });
test("rejects invalid or escaping versions", () => {
    for (const version of ["1.2", "01.2.3", "1.2.3-01", "1.2.3\";"]) {
        assert.throws(() => run(version).exec(), /valid SemVer/);
    }
});
test("check detects generated drift", () => { const x = run("1.2.3"); x.exec(); writeFileSync(x.target, "drift"); assert.throws(() => x.exec(true), /BuildInfo drift/); });
