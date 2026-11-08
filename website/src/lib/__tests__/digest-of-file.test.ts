import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { digestOfFile } from "../plugins.ts";

const expected = (b: Uint8Array) => new Uint8Array(createHash("sha256").update(b).digest());

for (const [name, size] of [["empty", 0], ["one byte", 1], ["one chunk boundary", 65536], ["several megabytes", 5_000_123]] as const) {
  test(`streaming and whole reads give the true SHA-256: ${name}`, async () => {
    const bytes = new Uint8Array(size).map((_, i) => (i * 31 + 7) & 255);
    const blob = new Blob([bytes]);
    assert.deepEqual(new Uint8Array(await digestOfFile(blob, -1)), expected(bytes));
    assert.deepEqual(new Uint8Array(await digestOfFile(blob, Number.MAX_SAFE_INTEGER)), expected(bytes));
  });
}
