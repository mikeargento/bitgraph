// Copyright (c) 2024-2026 Mike Argento. All rights reserved.

/**
 * Byte-parity pin: the browser version minter against the shipped
 * parser. Canonical-bytes enforcement means parsing at all proves
 * parity; the checks past that prove the gate and the edge.
 *
 * Run: node --test src/lib/__tests__/version-client-parity.test.ts
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mintVersionClient } from "../version-client.ts";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- outside the website's tsconfig on purpose: the test pins parity with the shipped package
import { parseVersion, checkVersion } from "../../../../packages/titles/dist/index.js";

test("a browser-minted version parses canonically and verifies under the shipped checker", async () => {
  const work = new TextEncoder().encode("the exact bytes of a work");
  const { bytes, digestB64 } = await mintVersionClient(work, "for the couple");

  const v = parseVersion(bytes);
  assert.equal(v.body, "for the couple");
  assert.equal(checkVersion(v, work).possession, "verified");
  assert.equal(checkVersion(v, new TextEncoder().encode("other")).possession, "refuted");

  const expected = Buffer.from(
    new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource))
  ).toString("base64");
  assert.equal(digestB64, expected);
});
