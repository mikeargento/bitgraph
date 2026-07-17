// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fromUrlSafeB64,
  looksLikeDigest,
  mapConcurrent,
  sha256FileB64,
  toUrlSafeB64,
} from "../encoding.js";

// A real 32-byte digest with + and / to exercise both substitutions.
const STANDARD = createHash("sha256").update("bitgraph").digest("base64");

test("url-safe round trip preserves the digest", () => {
  const safe = toUrlSafeB64(STANDARD);
  assert.ok(!safe.includes("+") && !safe.includes("/") && !safe.includes("="));
  assert.equal(fromUrlSafeB64(safe), STANDARD);
});

test("fromUrlSafeB64 is a no-op on standard base64", () => {
  assert.equal(fromUrlSafeB64(STANDARD), STANDARD);
});

test("looksLikeDigest accepts both forms, rejects junk", () => {
  assert.ok(looksLikeDigest(STANDARD));
  assert.ok(looksLikeDigest(toUrlSafeB64(STANDARD)));
  assert.ok(!looksLikeDigest("not-a-digest"));
  assert.ok(!looksLikeDigest(""));
  assert.ok(!looksLikeDigest(Buffer.alloc(16).toString("base64"))); // 16 bytes, not 32
});

test("sha256FileB64 matches crypto over the same bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bitgraph-mcp-"));
  const file = join(dir, "sample.bin");
  const bytes = Buffer.from("BitGraph proves causal ordering.\n");
  await writeFile(file, bytes);
  const expected = createHash("sha256").update(bytes).digest("base64");
  assert.equal(await sha256FileB64(file), expected);
});

test("sha256FileB64 rejects directories and missing files", async () => {
  await assert.rejects(() => sha256FileB64(tmpdir()), /Not a regular file/);
  await assert.rejects(() => sha256FileB64(join(tmpdir(), "definitely-missing-9x7")));
});

test("mapConcurrent preserves order and honors the limit", async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await mapConcurrent([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14, 16]);
  assert.ok(peak <= 3, `peak concurrency ${peak} exceeded 3`);
});
