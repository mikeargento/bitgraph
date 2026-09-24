// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-carrier/1 tests, against REAL material: the two demonstration
 * proofs from the live ledger (task-committed text files, enclave v8, signed
 * slotAnchor), their floor anchors, one ceiling anchor, and the raw Ethereum
 * block headers, all fetched once from public data on 2026-09-24 and frozen
 * as fixtures. No slot is ever spent by a test.
 *
 * Fixtures resolve against the package's src/ tree because tsc does not copy
 * JSON or bytes into dist/.
 */

import { test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCarrier, parseCarrier, completeCarrier, carrierBounds,
  checkFloorBinding, checkCeilingBinding, verifyWitnessHeader,
  innerDigestMatches, type CarrierPayload, type CarrierWitness, type CarrierProof,
} from "../carrier.js";
import { verifyCarrier } from "../carrier-verify.js";

const fix = (name: string): Buffer => readFileSync(new URL(`../../src/__tests__/fixtures/carrier/${name}`, import.meta.url));
const jfix = <T = Record<string, unknown>>(name: string): T => JSON.parse(fix(name).toString("utf-8")) as T;

const demo2 = new Uint8Array(fix("demo2.txt"));
const proof2 = jfix<CarrierProof>("demo2.proof.json");
const floor2 = { status: "present" as const, anchor: jfix<CarrierProof>("floor2.anchor.json"), witness: jfix<CarrierWitness>("floor2.witness.json") };
const ceil2 = { anchor: jfix<CarrierProof>("ceiling2.anchor.json"), witness: jfix<CarrierWitness>("ceiling2.witness.json") };

const demo1 = new Uint8Array(fix("demo1.txt"));
const proof1 = jfix<CarrierProof>("demo1.proof.json");
const floor1 = { status: "present" as const, anchor: jfix<CarrierProof>("floor1.anchor.json"), witness: jfix<CarrierWitness>("floor1.witness.json") };

const payload2: CarrierPayload = { carrier: "bitgraph-carrier/1", proof: proof2, floor: floor2, ceiling: { status: "unfetched" } };
const payload1: CarrierPayload = { carrier: "bitgraph-carrier/1", proof: proof1, floor: floor1, ceiling: { status: "unfetched" } };

test("build and parse round-trip; the committed bytes come back exactly", () => {
  const carrier = buildCarrier(demo2, payload2);
  const p = parseCarrier(carrier);
  assert.equal(p.kind, "carrier");
  if (p.kind !== "carrier") return;
  assert.deepEqual(Buffer.from(p.inner), Buffer.from(demo2));
  assert.equal(p.payload.ceiling.status, "unfetched");
  assert.ok(innerDigestMatches(p.inner, p.payload));
  const b = carrierBounds(p.payload);
  assert.equal(b.notBefore.blockNumber, 26037892);
  assert.equal(b.notAfter, null);
  assert.ok(typeof b.notBefore.timestamp === "number" && b.notBefore.timestamp > 1_700_000_000);
});

test("plain bytes are not a carrier; that is 'none', not a verdict", () => {
  assert.equal(parseCarrier(demo2).kind, "none");
});

test("an empty or tiny file is 'none', never an error", () => {
  assert.equal(parseCarrier(new Uint8Array(0)).kind, "none");
  assert.equal(parseCarrier(new Uint8Array(25)).kind, "none");
});

test("bytes that merely END with the magic are 'corrupt', and readers leave them as plain bytes", () => {
  // A ~2^-64 coincidence, pinned so the behaviour is documented: the trailing
  // magic is there, but the lengths and leading magic cannot agree, so the
  // parse reports an unreadable block rather than inventing a carrier. Site
  // and CLI both fall through to treating the file as ordinary bytes.
  const coincidence = new Uint8Array(200);
  coincidence.fill(7);
  coincidence.set([0x42, 0x47, 0x50, 0x52, 0x4f, 0x4f, 0x46, 0x01], 192);
  assert.equal(parseCarrier(coincidence).kind, "corrupt");
});

test("the block-header witnesses verify by keccak and carry the block time", () => {
  for (const w of [floor1.witness, floor2.witness, ceil2.witness]) {
    const r = verifyWitnessHeader(w);
    assert.equal(r.error, null);
    assert.ok(r.ok && r.timestamp !== null);
  }
  const bad = { ...floor2.witness, headerRlpHex: floor2.witness.headerRlpHex.replace(/.$/, (c) => (c === "0" ? "1" : "0")) };
  assert.equal(verifyWitnessHeader(bad).ok, false);
});

test("the floor binds by identity to the signed slotAnchor, never by counter alone", () => {
  assert.deepEqual(checkFloorBinding(proof2, floor2), []);
  assert.deepEqual(checkFloorBinding(proof1, floor1), []);
  // An anchor from the same epoch at a DIFFERENT counter is not this proof's floor.
  const swapped = { ...floor2, anchor: ceil2.anchor };
  const errs = checkFloorBinding(proof2, swapped);
  assert.ok(errs.some((e) => e.includes("slotAnchor counter")), errs.join("; "));
});

test("a ceiling must follow the commit in the same partition", () => {
  const good = { status: "present" as const, basis: "counter-order" as const, ...ceil2 };
  assert.deepEqual(checkCeilingBinding(proof2, good), []);
  // The floor anchor (counter 2870) does not follow commit 2874.
  const notAfter = { status: "present" as const, basis: "counter-order" as const, anchor: floor2.anchor, witness: floor2.witness };
  const errs = checkCeilingBinding(proof2, notAfter);
  assert.ok(errs.some((e) => e.includes("does not follow")), errs.join("; "));
});

test("verifyCarrier: TRUE with the floor only, notAfter stated as null", async () => {
  const r = await verifyCarrier(buildCarrier(demo2, payload2));
  assert.equal(r.verdict, "TRUE");
  assert.equal(r.ceiling, "unfetched");
  assert.equal(r.bounds?.notAfter, null);
  assert.equal(r.bounds?.notBefore.blockNumber, 26037892);
  assert.deepEqual(r.reasons, []);
});

test("verifyCarrier: TRUE on the older partition too (demo1)", async () => {
  const r = await verifyCarrier(buildCarrier(demo1, payload1));
  assert.equal(r.verdict, "TRUE");
  assert.equal(r.bounds?.notBefore.blockNumber, 26022195);
});

test("completion stamps a verified ceiling; the verdict then carries both bounds", async () => {
  const undeveloped = buildCarrier(demo2, payload2);
  const done = completeCarrier(undeveloped, ceil2);
  assert.equal(done.changed, true);
  const r = await verifyCarrier(done.bytes);
  assert.equal(r.verdict, "TRUE");
  assert.equal(r.ceiling, "present");
  assert.equal(r.bounds?.notAfter?.blockNumber, 26037894);
  assert.ok((r.bounds?.notAfter?.timestamp ?? 0) >= (r.bounds?.notBefore.timestamp ?? Infinity - 1));
  // Completing again is a no-op…
  const again = completeCarrier(done.bytes, ceil2);
  assert.equal(again.changed, false);
  assert.equal(again.error, undefined);
  // …and a DIFFERENT ceiling is refused, never overwritten.
  const conflict = completeCarrier(done.bytes, { anchor: floor2.anchor, witness: floor2.witness });
  assert.equal(conflict.changed, false);
  assert.ok(conflict.error?.includes("refusing"));
});

test("a completion that found nothing records where it looked", () => {
  const undeveloped = buildCarrier(demo2, payload2);
  const marked = completeCarrier(undeveloped, null, { asOfCounter: "2999", epochId: "x" });
  assert.equal(marked.changed, true);
  const p = parseCarrier(marked.bytes);
  assert.equal(p.kind === "carrier" && p.payload.ceiling.status === "unfetched" && p.payload.ceiling.searched?.asOfCounter, "2999");
});

test("one flipped byte in the committed bytes → FALSE on the digest", async () => {
  const tampered = buildCarrier(demo2, payload2);
  tampered[10] = tampered[10]! ^ 0x01;
  const r = await verifyCarrier(tampered);
  assert.equal(r.verdict, "FALSE");
  assert.ok(r.reasons[0]?.includes("do not hash"));
});

test("a payload from a different file → FALSE", async () => {
  const forged = buildCarrier(demo2, payload1);
  const r = await verifyCarrier(forged);
  assert.equal(r.verdict, "FALSE");
});

test("a corrupted block → UNDETERMINED, and it says unreadable, not forged", async () => {
  const carrier = buildCarrier(demo2, payload2);
  const corrupt = new Uint8Array(carrier);
  corrupt[corrupt.length - 10] = corrupt[corrupt.length - 10]! ^ 0xff; // trailing length disagrees with the leading one
  const r = await verifyCarrier(corrupt);
  assert.equal(r.verdict, "UNDETERMINED");
  assert.equal(r.carrier, "corrupt");
  assert.ok(r.reasons[0]?.includes("unreadable"));
});

test("a swapped floor anchor → FALSE, even though it is a real anchor from the same epoch", async () => {
  const swapped: CarrierPayload = { ...payload2, floor: { status: "present", anchor: ceil2.anchor, witness: ceil2.witness } };
  const r = await verifyCarrier(buildCarrier(demo2, swapped));
  assert.equal(r.verdict, "FALSE");
});

test("a carrier fused inside a carrier resolves outermost-first", () => {
  const inner = buildCarrier(demo2, payload2);
  const outer = buildCarrier(inner, payload1); // nonsense payload on purpose; structure is what is under test
  const p1 = parseCarrier(outer);
  assert.equal(p1.kind, "carrier");
  if (p1.kind !== "carrier") return;
  assert.deepEqual(Buffer.from(p1.inner), Buffer.from(inner));
  const p2 = parseCarrier(p1.inner);
  assert.equal(p2.kind, "carrier");
  if (p2.kind !== "carrier") return;
  assert.deepEqual(Buffer.from(p2.inner), Buffer.from(demo2));
});
