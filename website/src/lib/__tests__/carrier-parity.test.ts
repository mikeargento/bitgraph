/**
 * The carrier format lives twice on purpose: the canonical module in
 * packages/verify (published with the package) and the site's copy (the
 * website installs @mikeargento/* from npm, so it cannot import unpublished
 * code). This test is the contract: the two files are BYTE-IDENTICAL, the
 * same way version-client-parity pins its pair. Edit one, copy to the other.
 *
 * The round-trip below runs against the same real fixtures the verify
 * package tests use, through the SITE's copy, so a divergence in behaviour
 * (not just bytes) would also fail here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCarrier, parseCarrier, completeCarrier, innerDigestMatches, carrierBounds, verifyWitnessHeader, type CarrierPayload, type CarrierProof, type CarrierWitness } from "../carrier.ts";

const here = dirname(fileURLToPath(import.meta.url));
const siteCopy = join(here, "..", "carrier.ts");
const canonical = join(here, "..", "..", "..", "..", "packages", "verify", "src", "carrier.ts");
const fixtures = join(here, "..", "..", "..", "..", "packages", "verify", "src", "__tests__", "fixtures", "carrier");

test("the site's carrier.ts is byte-identical to the verify package's", () => {
  const a = readFileSync(siteCopy, "utf-8");
  const b = readFileSync(canonical, "utf-8");
  assert.equal(a, b, "website/src/lib/carrier.ts and packages/verify/src/carrier.ts have diverged: edit one, copy to the other");
});

test("the site copy round-trips the real fixture material", () => {
  const bytes = new Uint8Array(readFileSync(join(fixtures, "demo2.txt")));
  const proof = JSON.parse(readFileSync(join(fixtures, "demo2.proof.json"), "utf-8")) as CarrierProof;
  const anchor = JSON.parse(readFileSync(join(fixtures, "floor2.anchor.json"), "utf-8")) as CarrierProof;
  const witness = JSON.parse(readFileSync(join(fixtures, "floor2.witness.json"), "utf-8")) as CarrierWitness;
  const ceilingAnchor = JSON.parse(readFileSync(join(fixtures, "ceiling2.anchor.json"), "utf-8")) as CarrierProof;
  const ceilingWitness = JSON.parse(readFileSync(join(fixtures, "ceiling2.witness.json"), "utf-8")) as CarrierWitness;

  const payload: CarrierPayload = { carrier: "bitgraph-carrier/1", proof, floor: { status: "present", anchor, witness }, ceiling: { status: "unfetched" } };
  const carrier = buildCarrier(bytes, payload);
  const p = parseCarrier(carrier);
  assert.equal(p.kind, "carrier");
  if (p.kind !== "carrier") return;
  assert.ok(innerDigestMatches(p.inner, p.payload));
  assert.equal(carrierBounds(p.payload).notAfter, null);
  assert.ok(verifyWitnessHeader(witness).ok);

  const done = completeCarrier(carrier, { anchor: ceilingAnchor, witness: ceilingWitness });
  assert.equal(done.changed, true);
  const p2 = parseCarrier(done.bytes);
  assert.equal(p2.kind === "carrier" && p2.payload.ceiling.status, "present");
  assert.equal(carrierBounds((p2 as Extract<typeof p2, { kind: "carrier" }>).payload).notAfter?.blockNumber, 26037894);
  // The committed bytes never moved.
  assert.deepEqual(Buffer.from((p2 as Extract<typeof p2, { kind: "carrier" }>).inner), Buffer.from(bytes));
});
