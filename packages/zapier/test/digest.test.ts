// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
  digestForms,
  fromUrlSafeB64,
  looksLikeB64Digest,
  looksLikeHexDigest,
  normalizeDigest,
  sha256Buffer,
  sha256Stream,
  toUrlSafeB64,
} from "../src/lib/digest";

const B64 = "mYNezUiNnzhS3V0xqDsGUWCg2ZsKshiftAI016JPBUc=";
const URLSAFE = "mYNezUiNnzhS3V0xqDsGUWCg2ZsKshiftAI016JPBUc";
const HEX = "99835ecd488d9f3852dd5d31a83b065160a0d99b0ab2189fb40234d7a24f0547";

test("base64 forms round-trip", () => {
  assert.equal(toUrlSafeB64(B64), URLSAFE);
  assert.equal(fromUrlSafeB64(URLSAFE), B64);
  assert.equal(fromUrlSafeB64(B64), B64, "already-standard input is unchanged apart from padding");
});

test("all three digest forms normalize to the same standard base64", () => {
  assert.equal(normalizeDigest(HEX), B64);
  assert.equal(normalizeDigest(B64), B64);
  assert.equal(normalizeDigest(URLSAFE), B64);
  assert.equal(normalizeDigest(`  ${HEX.toUpperCase()}  `), B64, "whitespace and case are tolerated");
});

test("normalizeDigest rejects non-digests with a message a Zap builder can act on", () => {
  for (const bad of ["", "hello", "abc123", HEX.slice(0, 63), `${HEX}ff`]) {
    assert.throws(() => normalizeDigest(bad), /not a SHA-256 digest/);
  }
});

test("digest shape detectors do not confuse the forms", () => {
  assert.ok(looksLikeHexDigest(HEX));
  assert.ok(!looksLikeHexDigest(B64));
  assert.ok(looksLikeB64Digest(B64));
  assert.ok(looksLikeB64Digest(URLSAFE));
  // 64 hex characters are also 64 valid base64 characters, so the hex check
  // has to run first; if it did not, a hex digest would be decoded as base64
  // and produce 48 wrong bytes rather than the right 32.
  assert.ok(!looksLikeB64Digest(HEX), "hex must not be mistaken for base64");
  assert.equal(Buffer.from(normalizeDigest(HEX), "base64").length, 32);
});

test("streaming a file produces the same digest as hashing it whole", async () => {
  const data = Buffer.from("the quick brown fox".repeat(5000));
  const expected = createHash("sha256").update(data).digest();

  const streamed = await sha256Stream(Readable.from([data.subarray(0, 1000), data.subarray(1000)]));
  assert.equal(streamed.digestB64, expected.toString("base64"));
  assert.equal(streamed.digestHex, expected.toString("hex"));
  assert.equal(streamed.digestUrlSafe, toUrlSafeB64(expected.toString("base64")));
  assert.equal(streamed.bytes, data.length, "byte count reflects everything hashed");

  assert.equal(sha256Buffer(data).digestB64, streamed.digestB64);
});

test("an empty file still hashes, to the SHA-256 of no bytes", async () => {
  const streamed = await sha256Stream(Readable.from([]));
  assert.equal(streamed.digestHex, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(streamed.bytes, 0);
});

test("digestForms presents one digest in every form the platforms use", () => {
  assert.deepEqual(digestForms(B64), { digestB64: B64, digestUrlSafe: URLSAFE, digestHex: HEX });
});
