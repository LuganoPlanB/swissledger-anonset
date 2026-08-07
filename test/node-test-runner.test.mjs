import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("finite Node runner reports the timed-out phase", () => {
    const result = spawnSync(
        process.execPath,
        ["scripts/run-node-tests.mjs", "--phase=unit"],
        {
            cwd: process.cwd(),
            encoding: "utf8",
            env: { ...process.env, NODE_TEST_PHASE_TIMEOUT_MS: "1" },
            timeout: 5_000,
        },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Node test phase 'client unit' exceeded 1ms/);
});
