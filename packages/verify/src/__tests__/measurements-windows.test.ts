/**
 * Retired images and published writers (measurements.ts).
 *
 *   cd packages/verify && npx tsc -p . && node --test dist/__tests__/measurements-windows.test.js
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { PUBLISHED_ENCLAVE_MEASUREMENTS, imageIsAtomic, imageRetiredAfterMs, isPublishedWriter } from "../measurements.js";

const byVersion = (v: string) => PUBLISHED_ENCLAVE_MEASUREMENTS.find((m) => m.version === v)!;

test("an image is accepted until a week after the next went live; the newest has no end", () => {
  const v12 = imageRetiredAfterMs(byVersion("v12").pcr0)!;
  assert.equal(new Date(v12).toISOString(), "2026-10-26T23:59:59.999Z"); // v13 went live 2026-10-19
  assert.equal(imageRetiredAfterMs(byVersion("v13").pcr0), null);
  assert.equal(imageRetiredAfterMs("00".repeat(48)), null);
});

test("atomic from v11 on", () => {
  assert.equal(imageIsAtomic("v10"), false);
  assert.equal(imageIsAtomic("v11"), true);
  assert.equal(imageIsAtomic("v13"), true);
});

test("published writers: address and chain, any case", () => {
  assert.equal(isPublishedWriter("0xF3972408D853c975F86351C311f4310220bbF2a3", 8453), true);
  assert.equal(isPublishedWriter("0xf3972408d853c975f86351c311f4310220bbf2a3", 84532), false);
  assert.equal(isPublishedWriter("0x" + "ab".repeat(20), 8453), false);
  assert.equal(isPublishedWriter(undefined, 8453), false);
});
