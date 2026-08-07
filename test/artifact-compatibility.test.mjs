import test from "node:test";
import assert from "node:assert/strict";
import { findUnsupportedInstructions } from "../scripts/check-artifact-compatibility.mjs";

test("detects executed Istanbul-incompatible opcodes", () => {
    assert.deepEqual(findUnsupportedInstructions("0x5f5e"), [
        { offset: 0, opcode: "PUSH0" },
        { offset: 1, opcode: "MCOPY" }
    ]);
});

test("skips opcode-looking PUSH data", () => {
    assert.deepEqual(findUnsupportedInstructions("0x615f5e"), []);
    assert.deepEqual(findUnsupportedInstructions("0x605f5e"), [{ offset: 2, opcode: "MCOPY" }]);
});

test("follows jumps across embedded data", () => {
    assert.deepEqual(findUnsupportedInstructions("0x600456fe5b5f00"), [
        { offset: 5, opcode: "PUSH0" },
    ]);
});

test("skips structurally valid Solidity metadata", () => {
    assert.deepEqual(findUnsupportedInstructions("0x5f00a1000002"), [
        { offset: 0, opcode: "PUSH0" },
    ]);
});

test("rejects malformed bytecode", () => {
    assert.throws(() => findUnsupportedInstructions("0x5"), /even-length hexadecimal/);
});
