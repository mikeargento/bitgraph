// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-carrier/2 against the golden example: BitGraph #4,546, the home
 * page's demonstration file, with its floor anchor (#4,542, Ethereum block
 * 26,088,457), its closing anchor (#4,548, block 26,088,459), both raw
 * Ethereum headers, and its Base ceiling (block 51,979,918), all fetched from
 * public data on 2026-09-30 and frozen. No position is ever spent by a test.
 */

import { test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assembleCarrierV2Payload, buildCarrier, parseCarrier, carrierBlockSize, carrierBounds,
  completeCarrierInTime, completeCarrierSettlement, CARRIER_VERSION_2, CARRIER_BLOCK_ZIP_LIMIT,
  type CarrierPayload, type CarrierWitness, type CarrierProof,
} from "../index.js";
import { verifyCarrier } from "../carrier-verify.js";
import { verifyNitroAttestation, attestationWitness, witnessMatchesAttestation, awsNitroRootSha256 } from "../nitro.js";
import { computeSignedBodyHash } from "../proof-hash.js";

const fix = (name: string): Buffer => readFileSync(new URL(`../../src/__tests__/fixtures/carrier2/${name}`, import.meta.url));
const jfix = <T = Record<string, unknown>>(name: string): T => JSON.parse(fix(name).toString("utf-8")) as T;

const inner = new Uint8Array(fix("demo4546.txt"));
const proof = jfix<CarrierProof>("demo4546.proof.json");
const floor = { status: "present" as const, anchor: jfix<CarrierProof>("floor-4542.anchor.json"), witness: jfix<CarrierWitness>("floor-26088457.witness.json") };
const ceiling = { status: "present" as const, basis: "counter-order" as const, anchor: jfix<CarrierProof>("ceiling-4548.anchor.json"), witness: jfix<CarrierWitness>("ceiling-26088459.witness.json") };
const sidecar = jfix("demo4546.ceiling.json");

const golden = (): CarrierPayload => assembleCarrierV2Payload({ proof, floor, ceiling, ceilingInTime: { status: "present", sidecar } });
const claimsById = (r: { claims: Array<{ id: string; result: string }> }) => Object.fromEntries(r.claims.map((c) => [c.id, c.result]));

test("the golden carrier/2 verifies TRUE offline, every carried claim TRUE, the online ones UNDETERMINED", async () => {
  const bytes = buildCarrier(inner, golden());
  const r = await verifyCarrier(bytes);
  assert.equal(r.verdict, "TRUE", r.reasons.join("; "));
  assert.equal(r.version, 2);
  const c = claimsById(r);
  for (const id of ["block", "bytes.digest", "proof.signature", "proof.hash", "proof.fused", "attestation.signature", "attestation.chain", "attestation.root", "attestation.validity", "attestation.pcr0", "attestation.binding", "attestation.witness", "floor.anchor", "floor.binding", "floor.header", "ceiling.position.anchor", "ceiling.position.binding", "ceiling.position.header", "ceiling.time.record", "ceiling.time.payload", "ceiling.time.sender", "ceiling.time.inclusion", "ceiling.time.floor", "pins"]) {
    assert.equal(c[id], "TRUE", `${id}: ${r.claims.find((x) => x.id === id)?.detail}`);
  }
  assert.equal(c["attestation.pins"], "UNDETERMINED", "no allowlist given");
  assert.equal(c["confirmed.floor"], "UNDETERMINED");
  assert.equal(c["confirmed.ceiling.time"], "UNDETERMINED");
  assert.equal(c["ceiling.time.status"], "UNDETERMINED", "status is reported, never proven");
  // The window, read from the headers.
  assert.equal(r.bounds?.notBefore.blockNumber, 26088457);
  assert.equal(r.bounds?.notBefore.timestamp, 1790749163);
  assert.equal(r.bounds?.notAfter?.blockNumber, 26088459);
  assert.equal(r.bounds?.existedBy?.blockNumber, 51979918);
  assert.equal(r.bounds?.existedBy?.timestamp, 1790749183);
  assert.match(r.reading, /made after Ethereum block 26088457 \(2026-09-30T06:19:23Z\), and existed by Base block 51979918 \(2026-09-30T06:19:43Z\)/);
  assert.match(r.reading, /Rests on: SHA-256, Ed25519, the AWS Nitro root \(641A0321…\), Ethereum block 26088457, Base block 51979918/);
});

test("the block stays under the ZIP limit, with the witness inside", () => {
  const size = carrierBlockSize(golden());
  assert.ok(size < CARRIER_BLOCK_ZIP_LIMIT, `block is ${size} bytes`);
  assert.ok(size > 40_000, `a v2 block carries two anchors, a Base sidecar and the witness: ${size}`);
});

test("confirmed level: lookups that agree make the online claims TRUE; a disagreeing node makes them FALSE", async () => {
  const bytes = buildCarrier(inner, golden());
  const agree = await verifyCarrier(bytes, {
    lookups: {
      ethereumBlockHash: async (n) => (n === 26088457 ? floor.witness.blockHash : n === 26088459 ? ceiling.witness.blockHash : null),
      baseBlockHash: async (n) => (n === 51979918 ? (sidecar["anchor"] as { blockHash: string }).blockHash : null),
    },
    pins: { pcr0: [String((proof as { environment: { measurement: string } }).environment.measurement)] },
  });
  const c = claimsById(agree);
  assert.equal(c["confirmed.floor"], "TRUE");
  assert.equal(c["confirmed.ceiling.position"], "TRUE");
  assert.equal(c["confirmed.ceiling.time"], "TRUE");
  assert.equal(c["attestation.pins"], "TRUE");
  assert.match(agree.reading, /Every block was confirmed against a node/);
  const disagree = await verifyCarrier(bytes, { lookups: { ethereumBlockHash: async () => "0x" + "ab".repeat(32) } });
  assert.equal(disagree.verdict, "FALSE");
  assert.equal(claimsById(disagree)["confirmed.floor"], "FALSE");
});

test("NEGATIVE: one changed byte in the committed bytes → FALSE at the digest", async () => {
  const changed = new Uint8Array(inner);
  changed[10] = (changed[10] ?? 0) ^ 0x01;
  const r = await verifyCarrier(buildCarrier(changed, golden()));
  assert.equal(r.verdict, "FALSE");
  assert.equal(claimsById(r)["bytes.digest"], "FALSE");
});

test("NEGATIVE: the closing anchor offered as the floor → FALSE at the floor binding", async () => {
  const swapped = assembleCarrierV2Payload({ proof, floor: { status: "present", anchor: ceiling.anchor, witness: ceiling.witness }, ceiling, ceilingInTime: { status: "present", sidecar } });
  const r = await verifyCarrier(buildCarrier(inner, swapped));
  assert.equal(r.verdict, "FALSE");
  assert.equal(claimsById(r)["floor.binding"], "FALSE");
});

test("NEGATIVE: a ceiling in time from another writer → FALSE at the sender", async () => {
  const r = await verifyCarrier(buildCarrier(inner, golden()), { pins: { ceilingWriter: "0x" + "11".repeat(20) } });
  assert.equal(r.verdict, "FALSE");
  assert.equal(claimsById(r)["ceiling.time.sender"], "FALSE");
});

test("NEGATIVE: a witness that is not the document's → FALSE at the witness", async () => {
  const p = golden();
  const w = p.attestation! as unknown as { decoded: { pcr0: string } };
  w.decoded = { ...w.decoded, pcr0: "00".repeat(48) };
  const r = await verifyCarrier(buildCarrier(inner, p));
  assert.equal(claimsById(r)["attestation.witness"], "FALSE");
  assert.equal(r.verdict, "FALSE");
});

test("NEGATIVE: a declared pin that is not the verifier's is reported, never trusted", async () => {
  const p = golden();
  p.pins = { ...p.pins, ceilingWriter: "0x" + "22".repeat(20) };
  const r = await verifyCarrier(buildCarrier(inner, p));
  assert.equal(claimsById(r)["pins"], "FALSE");
  // The ceiling itself still verifies against the VERIFIER's pin, not the declared one.
  assert.equal(claimsById(r)["ceiling.time.sender"], "TRUE");
});

test("a v2 block with the ceiling in time not fetched verifies TRUE and says so", async () => {
  const p = assembleCarrierV2Payload({ proof, floor, ceiling: { status: "unfetched" }, ceilingInTime: { status: "unfetched", searched: { at: "2026-09-30T06:20:00Z" } } });
  const r = await verifyCarrier(buildCarrier(inner, p));
  assert.equal(r.verdict, "TRUE", r.reasons.join("; "));
  assert.equal(claimsById(r)["ceiling.time.record"], "NOT_CARRIED");
  assert.equal(claimsById(r)["ceiling.position.binding"], "NOT_CARRIED");
  assert.equal(r.bounds?.existedBy, null);
});

test("completion stamps the ceiling in time once and never overwrites a different one", () => {
  const start = buildCarrier(inner, assembleCarrierV2Payload({ proof, floor, ceiling, ceilingInTime: { status: "unfetched" } }));
  const once = completeCarrierInTime(start, sidecar);
  assert.equal(once.changed, true);
  const again = completeCarrierInTime(once.bytes, sidecar);
  assert.equal(again.changed, false);
  assert.equal(again.error, undefined);
  const other = { ...sidecar, anchor: { ...(sidecar["anchor"] as Record<string, unknown>), txHash: "0x" + "33".repeat(32) } };
  const refused = completeCarrierInTime(once.bytes, other);
  assert.equal(refused.changed, false);
  assert.match(refused.error ?? "", /refusing to overwrite/);
  const p = parseCarrier(once.bytes);
  assert.equal(p.kind, "carrier");
  if (p.kind === "carrier") assert.equal(p.payload.ceilingInTime?.status, "present");
});

test("a v1 reader's view of a v2 block: an unknown version is UNDETERMINED, never a verdict", async () => {
  // A reader from before /2 rejects the version string in payloadShapeError; the same
  // path is taken here for any version this reader does not know.
  const p = golden() as unknown as Record<string, unknown>;
  p["carrier"] = "bitgraph-carrier/3";
  const r = await verifyCarrier(buildCarrier(inner, p as unknown as CarrierPayload));
  assert.equal(r.verdict, "UNDETERMINED");
  assert.equal(r.carrier, "corrupt");
  assert.match(r.reasons[0] ?? "", /unknown carrier version/);
});

test("the v1 carrier still builds, parses and verifies unchanged", async () => {
  const v1: CarrierPayload = { carrier: "bitgraph-carrier/1", proof, floor, ceiling };
  const r = await verifyCarrier(buildCarrier(inner, v1));
  assert.equal(r.verdict, "TRUE", r.reasons.join("; "));
  assert.equal(r.version, 1);
  assert.equal(r.bounds?.existedBy, null);
  assert.equal(carrierBounds(v1).settledBy, null);
});

test("the attestation module on the golden proof: seven checks pass, and the witness is the document's", () => {
  const att = (proof as { environment: { attestation: { reportB64: string }; measurement: string } }).environment;
  const r = verifyNitroAttestation(att.attestation.reportB64, { expectedPcr0: att.measurement, expectedUserDataB64: computeSignedBodyHash(proof as never) });
  assert.equal(r.valid, true, r.checks.filter((c) => !c.pass).map((c) => c.detail).join("; "));
  assert.equal(r.checks.length, 7);
  assert.equal(r.rootSha256, "641A0321A3E244EFE456463195D606317ED7CDCC3C1756E09893F3C68F79BB5B");
  assert.equal(awsNitroRootSha256(), r.rootSha256);
  const w = attestationWitness(att.attestation.reportB64, { pcr0: att.measurement, signedBodyHashB64: computeSignedBodyHash(proof as never) });
  assert.equal(w.chainPem.length, 4, "leaf plus three intermediates; the root is the pin");
  assert.equal(w.decoded.pcr0, att.measurement);
  assert.ok(witnessMatchesAttestation(w, att.attestation.reportB64).ok);
  const wrongBody = verifyNitroAttestation(att.attestation.reportB64, { expectedUserDataB64: "AAAA" + computeSignedBodyHash(proof as never).slice(4) });
  assert.equal(wrongBody.valid, false);
  assert.equal(wrongBody.checks.find((c) => c.name === "Bound to this proof")?.pass, false);
});

test("settlement completion refuses to overwrite a different pointer", () => {
  const start = buildCarrier(inner, golden());
  const pointer = { version: "bitgraph-settlement/1", baseBlockNumber: 51979918, baseBlockHash: (sidecar["anchor"] as { blockHash: string }).blockHash, l1: { txHash: "0x" + "44".repeat(32), blockHash: "0x" + "55".repeat(32) } };
  const once = completeCarrierSettlement(start, pointer);
  assert.equal(once.changed, true);
  const other = completeCarrierSettlement(once.bytes, { ...pointer, l1: { ...pointer.l1, txHash: "0x" + "66".repeat(32) } });
  assert.equal(other.changed, false);
  assert.match(other.error ?? "", /refusing to overwrite/);
  assert.equal(CARRIER_VERSION_2, "bitgraph-carrier/2");
});

// Outside review, 2026-10-02: the verify output must say plainly that the BitGraphed file's
// own SHA-256 is not the committed digest, because the file travels without the README.
test("the reading says the file's own SHA-256 is not the committed digest, and names both hashes", async () => {
  const { createHash } = await import("node:crypto");
  const bytes = buildCarrier(inner, golden());
  const r = await verifyCarrier(bytes);
  assert.equal(r.verdict, "TRUE", r.reasons.join("; "));
  const outer = createHash("sha256").update(bytes).digest("hex");
  const committed = createHash("sha256").update(inner).digest("hex");
  assert.notEqual(outer, committed);
  assert.ok(r.reading.includes(`This file's own SHA-256 (${outer}) is not the committed digest`), r.reading);
  assert.ok(r.reading.includes(`(SHA-256 ${committed})`), r.reading);
  // A file with no proof block makes no such statement.
  const plain = await verifyCarrier(inner);
  assert.ok(!plain.reading.includes("is not the committed digest"));
});
