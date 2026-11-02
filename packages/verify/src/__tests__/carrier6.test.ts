/**
 * The BitGraphed file, v6 (carrier5.ts): v5 and the file's own Base floor. The fixture is real: BitGraph #304 of epoch
 * KmoE…, the home page's ChatGPT picture (website/public/demo/chatgpt.png), bound on 2026-11-02 right after #302, the
 * block read of Base block 53,405,648 the host bound for that drop, with #304's Base ceiling as the site serves it.
 * Every check runs offline.
 *
 *   cd packages/verify && npx tsc -p . && node --test dist/__tests__/carrier6.test.js
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { buildBitGraphedFileV5, buildBitGraphedFileV6 } from "../carrier5.js";
import { verifyCarrier } from "../carrier-verify.js";
import { parseCarrier, CARRIER_VERSION_6 } from "../carrier.js";

const dir = new URL("../../src/__tests__/fixtures/carrier6/", import.meta.url);
const file = new Uint8Array(readFileSync(new URL("../../../../../../website/public/demo/chatgpt.png", dir)));
const proof = JSON.parse(readFileSync(new URL("proof.json", dir), "utf8")) as Record<string, unknown>;
const ceiling = JSON.parse(readFileSync(new URL("ceiling.json", dir), "utf8")) as Record<string, unknown>;
const floor = { proof: JSON.parse(readFileSync(new URL("floor-proof.json", dir), "utf8")) as Record<string, unknown>, blockFile: readFileSync(new URL("floor-block.json", dir), "utf8") };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const claim = (r: Awaited<ReturnType<typeof verifyCarrier>>, id: string) => r.claims.find((c) => c.id === id)?.result;

test("the real v6 file checks: the file, the proof, its own Base floor and the Base ceiling", async () => {
  const bg = buildBitGraphedFileV6(file, proof, ceiling, floor);
  const parsed = parseCarrier(bg);
  assert.equal(parsed.kind === "carrier" && parsed.payload.carrier, CARRIER_VERSION_6);
  assert.deepEqual(parsed.kind === "carrier" ? parsed.inner.length : null, file.length, "stripping the block gives the file back");
  const r = await verifyCarrier(bg);
  assert.equal(r.verdict, "TRUE", r.reasons.join("; "));
  assert.equal(r.version, 6);
  assert.equal(claim(r, "bytes.digest"), "TRUE");
  assert.equal(claim(r, "floor.read"), "TRUE");
  assert.equal(claim(r, "floor.time"), "TRUE");
  assert.equal(claim(r, "ceiling.time"), "TRUE");
  assert.equal(r.bounds?.notBefore.blockNumber, 53405648);
  assert.ok(r.bounds?.existedBy && r.bounds.existedBy.blockNumber > 53405648, "the ceiling is after the floor");
  assert.match(r.reading, /BitGraph #304: these exact bytes, .* after Base block 53405648 and written to Base by block/);
});

test("a v6 file bound without a floor still checks, and says the floor is not carried", async () => {
  const r = await verifyCarrier(buildBitGraphedFileV6(file, proof, ceiling, null));
  assert.equal(r.verdict, "TRUE", r.reasons.join("; "));
  assert.equal(claim(r, "floor.read"), "NOT_CARRIED");
  assert.equal(r.bounds, null);
});

test("a floor that is not this file's does not check: another block, an edited proof, or a record further back", async () => {
  const otherBlock = { ...floor, blockFile: floor.blockFile.replace("53405648", "53405647") };
  const r1 = await verifyCarrier(buildBitGraphedFileV6(file, proof, ceiling, otherBlock));
  assert.equal(r1.verdict, "FALSE");
  assert.equal(claim(r1, "floor.read"), "FALSE");

  const edited = clone(floor);
  (edited.proof["commit"] as Record<string, unknown>)["counter"] = "300";
  const r2 = await verifyCarrier(buildBitGraphedFileV6(file, proof, ceiling, edited));
  assert.equal(r2.verdict, "FALSE");

  // The file's own proof, offered as its floor: a real BitGraph, but not the record right before it.
  const r3 = await verifyCarrier(buildBitGraphedFileV6(file, proof, ceiling, { proof, blockFile: floor.blockFile }));
  assert.equal(r3.verdict, "FALSE");
  assert.equal(claim(r3, "floor.read"), "FALSE");
});

test("v5 files keep checking as they did: the same proof without the floor block", async () => {
  const r = await verifyCarrier(buildBitGraphedFileV5(file, proof, ceiling));
  assert.equal(r.verdict, "TRUE", r.reasons.join("; "));
  assert.equal(r.version, 5);
  assert.equal(claim(r, "floor.read"), undefined);
});

test("a v6 block missing floorInTime, or with a malformed one, is unreadable, never a verdict", async () => {
  const bg = buildBitGraphedFileV6(file, proof, ceiling, floor);
  const p = parseCarrier(bg);
  assert.equal(p.kind, "carrier");
  for (const bad of [{ status: "present", proof: floor.proof }, { status: "maybe" }, undefined]) {
    const payload = clone((p as unknown as { payload: Record<string, unknown> }).payload);
    if (bad === undefined) delete payload["floorInTime"]; else payload["floorInTime"] = bad;
    const json = new TextEncoder().encode(JSON.stringify(payload));
    const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, json.length);
    const magic = bg.slice(bg.length - 8);
    const rebuilt = new Uint8Array([...file, ...magic, ...len, ...json, ...len, ...magic]);
    assert.notEqual(parseCarrier(rebuilt).kind, "carrier", JSON.stringify(bad));
  }
});
