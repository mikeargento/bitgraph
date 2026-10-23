/**
 * The BitGraphed file, v5 (carrier5.ts). The fixture is real: BitGraph #16 of epoch oHvG…, made by enclave v13 on
 * 2026-10-20 from bitgraph.ing's Make page, a tree of two (the floor leaf, base-block.json, and single.txt), with its
 * Base ceiling as the site serves it. Every check runs offline.
 *
 *   cd packages/verify && npx tsc -p . && node --test dist/__tests__/carrier5.test.js
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { buildBitGraphedFileV5 } from "../carrier5.js";
import { verifyCarrier } from "../carrier-verify.js";
import { parseCarrier, CARRIER_VERSION_5 } from "../carrier.js";

const dir = new URL("../../src/__tests__/fixtures/carrier5/", import.meta.url);
const file = new Uint8Array(readFileSync(new URL("single.txt", dir)));
const proof = JSON.parse(readFileSync(new URL("proof.json", dir), "utf8")) as Record<string, unknown>;
const ceiling = JSON.parse(readFileSync(new URL("ceiling.json", dir), "utf8")) as Record<string, unknown>;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const claim = (r: Awaited<ReturnType<typeof verifyCarrier>>, id: string) => r.claims.find((c) => c.id === id)?.result;

test("the real BitGraphed file checks: the file, the proof, the floor leaf and the Base ceiling", async () => {
  const bg = buildBitGraphedFileV5(file, proof, ceiling);
  const parsed = parseCarrier(bg);
  assert.equal(parsed.kind, "carrier");
  assert.equal(parsed.kind === "carrier" && parsed.payload.carrier, CARRIER_VERSION_5);
  assert.deepEqual(parsed.kind === "carrier" ? Array.from(parsed.inner) : null, Array.from(file), "stripping the block gives the file back, byte for byte");
  const r = await verifyCarrier(bg);
  assert.equal(r.verdict, "TRUE", r.reasons.join("; "));
  assert.equal(r.version, 5);
  assert.equal(claim(r, "tree.member"), "TRUE");
  assert.equal(claim(r, "floor.leaf"), "TRUE");
  assert.equal(claim(r, "floor.time"), "TRUE");
  assert.equal(claim(r, "ceiling.time"), "TRUE");
  assert.equal(r.bounds?.notBefore.blockNumber, 52878656);
  assert.ok(r.bounds?.existedBy && r.bounds.existedBy.blockNumber >= 52878656, "the ceiling is after the floor");
  assert.match(r.reading, /file 2 of a tree of 2/);
});

test("without the ceiling it still checks, and says the ceiling is not carried", async () => {
  const r = await verifyCarrier(buildBitGraphedFileV5(file, proof, null));
  assert.equal(r.verdict, "TRUE", r.reasons.join("; "));
  assert.equal(claim(r, "ceiling.time"), "NOT_CARRIED");
});

test("a changed file, a changed floor, or another proof's ceiling does not check", async () => {
  const edited = new Uint8Array(file); edited[0] = edited[0]! ^ 1;
  assert.equal((await verifyCarrier(buildBitGraphedFileV5(edited, proof, ceiling))).verdict, "FALSE", "one changed bit in the file");
  const p2 = clone(proof) as { metadata: Record<string, { floor: { file: string } }> };
  p2.metadata["bitgraph-tree-member/1"]!.floor.file = p2.metadata["bitgraph-tree-member/1"]!.floor.file.replace("52878656", "52878655");
  const r2 = await verifyCarrier(buildBitGraphedFileV5(file, p2 as unknown as Record<string, unknown>, ceiling));
  assert.equal(r2.verdict, "FALSE", "a floor block that is not the leaf");
  assert.equal(claim(r2, "floor.leaf"), "FALSE");
  const c3 = clone(ceiling) as Record<string, unknown>; c3["proofHash"] = "AAAA" + String(c3["proofHash"]).slice(4);
  assert.equal((await verifyCarrier(buildBitGraphedFileV5(file, proof, c3))).verdict, "FALSE", "a ceiling for another proof");
});

test("a block that is not exactly carrier, proof and ceilingInTime is unreadable, never a verdict", async () => {
  const bg = buildBitGraphedFileV5(file, proof, ceiling);
  const text = new TextDecoder().decode(bg).replace('"ceilingInTime"', '"ceilingInTimX"');
  const r = await verifyCarrier(new TextEncoder().encode(text));
  assert.equal(r.carrier, "corrupt");
  assert.equal(r.verdict, "UNDETERMINED");
});
