/**
 * SPEC.md as the site serves it. Every tree/1 proof pins the SHA-256 of the
 * spec it follows, and every export ships SPEC.md beside it, so the copy at
 * public/spec/SPEC.md must be spec/SPEC.md byte for byte, and its hash must be
 * the one the site's makers pin. A stale copy fails here, before a single
 * export goes out with the wrong text under the right name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha256";
import { KNOWN_TREE_SPEC_HASHES, bytesToBase64, currentTreeSpecHash } from "@mikeargento/bitgraph-verify";
import { SPEC_PATH } from "../fuse-tree.ts";

const repoSpec = new Uint8Array(readFileSync(new URL("../../../../spec/SPEC.md", import.meta.url)));
const siteSpec = new Uint8Array(readFileSync(new URL(`../../../public${SPEC_PATH}`, import.meta.url)));

test("public/spec/SPEC.md is spec/SPEC.md, byte for byte (copy spec/SPEC.md over it when this fails)", () => {
  assert.equal(siteSpec.length, repoSpec.length, "lengths differ");
  assert.ok(Buffer.compare(Buffer.from(siteSpec), Buffer.from(repoSpec)) === 0, "contents differ");
});

test("its SHA-256 is the spec hash the site's makers pin, and one the verifier knows", () => {
  const h = sha256(siteSpec);
  assert.equal(bytesToBase64(h), bytesToBase64(currentTreeSpecHash()), "rebuild packages/verify after node spec/pin-hash.mjs");
  assert.ok(KNOWN_TREE_SPEC_HASHES.includes(bytesToBase64(h)));
});
