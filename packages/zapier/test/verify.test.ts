// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Verify BitGraph.
 *
 * These run the real @mikeargento/bitgraph-verify against the real public
 * example proof, captured whole in test/fixtures. A synthetic proof would only
 * prove the step can read its own invention: the Ed25519 signature, the slot
 * binding, and the Nitro attestation in this fixture are the genuine ones, so
 * a valid result here means the same thing it means in production.
 *
 * The distinction the suite exists to protect: "this proof is genuine" and
 * "this file is the one the proof describes" are different claims, and a
 * workflow acting on the first while believing the second is the failure mode
 * that matters.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import verifyBitGraph from "../src/creates/verify-bitgraph";
import { bundleOf, fakeZ, type Route } from "./helpers";

const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "example-proof.json"), "utf8")
) as { proof: Record<string, unknown>; detail: Record<string, unknown> };

const REAL_PROOF = fixture.proof;
const REAL_DIGEST_B64 = (REAL_PROOF["artifact"] as { digestB64: string }).digestB64;
const REAL_DIGEST_URLSAFE = REAL_DIGEST_B64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const REAL_DIGEST_HEX = Buffer.from(REAL_DIGEST_B64, "base64").toString("hex");

const perform = verifyBitGraph.operation.perform;

const ledgerHas = (): Route => (req) => {
  if (req.url.endsWith("/api/proofs/batch")) {
    const asked = (req.body as { digests?: string[] })?.digests ?? [];
    const results: Record<string, unknown> = {};
    for (const d of asked) results[d] = { proofs: [{ proof: REAL_PROOF }] };
    return { status: 200, data: { results } };
  }
  if (req.url.includes("/api/proofs/digest/")) return { status: 200, data: fixture.detail };
  return undefined;
};

const ledgerEmpty = (): Route => (req) =>
  req.url.endsWith("/api/proofs/batch")
    ? { status: 200, data: { results: {} } }
    : req.url.includes("/api/proofs/digest/")
      ? { status: 200, data: { proofs: [] } }
      : undefined;

test("a digest on record verifies, with the file binding actually checked", async () => {
  const { z } = fakeZ([ledgerHas()]);
  const result = await perform(z, bundleOf({ digest: REAL_DIGEST_B64 }));

  assert.equal(result.verified, true);
  assert.equal(result.status, "valid");
  assert.equal(result.artifactBinding, "checked");
  assert.equal(result.reason, null);
  assert.equal(result.onRecord, true);
  assert.equal(result.checkedAgainst, "ledger");
  assert.equal(result.counter, "7910");
  assert.equal(result.bitgraphedAfter, "2026-07-29T16:54:11.000Z");
  assert.equal(result.bitgraphedBefore, "2026-07-29T16:54:23.000Z");
  assert.equal(result.anchorSettled, true);
});

test("a hex digest verifies identically to the base64 one", async () => {
  const { z } = fakeZ([ledgerHas()]);
  const result = await perform(z, bundleOf({ digest: REAL_DIGEST_HEX }));
  assert.equal(result.verified, true);
  assert.equal(result.artifactHash, REAL_DIGEST_B64);
});

test("a file whose bytes are not on record is 'not on record', not 'invalid'", async () => {
  // Conflating the two would tell a workflow that a file FAILED verification
  // when in truth it was simply never recorded. Those warrant opposite actions.
  const { z } = fakeZ([ledgerEmpty()]);
  const result = await perform(z, bundleOf({ digest: REAL_DIGEST_B64 }));

  assert.equal(result.verified, false);
  assert.equal(result.status, "not on record");
  assert.equal(result.onRecord, false);
  assert.equal(result.artifactBinding, "not-checked");
  assert.match(String(result.reason), /never been recorded/);
  assert.equal(result.proof, null);
});

test("a proof supplied without a file is genuine but unbound, and says so", async () => {
  const { z } = fakeZ([ledgerHas()]);
  const result = await perform(z, bundleOf({ proof: JSON.stringify(REAL_PROOF) }));

  assert.equal(result.verified, true);
  assert.equal(
    result.status,
    "valid, file not checked",
    "a bare 'valid' here would read as 'this file is proven', which nothing established"
  );
  assert.equal(result.artifactBinding, "not-checked");
  assert.equal(result.checkedAgainst, "supplied proof");
});

test("a genuine proof presented for the wrong file is a mismatch, not a pass", async () => {
  const otherDigest = Buffer.alloc(32, 9).toString("base64");
  const { z } = fakeZ([ledgerHas()]);
  const result = await perform(z, bundleOf({ proof: JSON.stringify(REAL_PROOF), digest: otherDigest }));

  assert.equal(result.verified, false);
  assert.equal(result.artifactBinding, "mismatch");
  assert.equal(result.status, "mismatch");
  assert.match(String(result.reason), /different bytes/);
});

test("a tampered proof fails, and the reason names what broke", async () => {
  const tampered = JSON.parse(JSON.stringify(REAL_PROOF)) as Record<string, unknown>;
  (tampered["commit"] as Record<string, unknown>)["counter"] = "999999";

  const { z } = fakeZ([ledgerHas()]);
  const result = await perform(z, bundleOf({ proof: JSON.stringify(tampered), digest: REAL_DIGEST_B64 }));

  assert.equal(result.verified, false);
  assert.equal(result.status, "invalid");
  assert.ok(typeof result.reason === "string" && result.reason.length > 0);
});

test("pinning a different enclave measurement rejects an otherwise valid proof", async () => {
  const { z } = fakeZ([ledgerHas()]);
  const result = await perform(
    z,
    bundleOf({ digest: REAL_DIGEST_B64, allowedMeasurements: "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" })
  );

  assert.equal(result.verified, false);
  assert.equal(result.status, "invalid");
  assert.match(String(result.reason), /measurement/);
});

test("pinning the real measurement accepts it", async () => {
  const measurement = (REAL_PROOF["environment"] as { measurement: string }).measurement;
  const { z } = fakeZ([ledgerHas()]);
  const result = await perform(z, bundleOf({ digest: REAL_DIGEST_B64, allowedMeasurements: measurement }));
  assert.equal(result.verified, true);
});

test("a proof field that is not JSON is refused before any network call", async () => {
  const { z, requests } = fakeZ([ledgerHas()]);
  await assert.rejects(perform(z, bundleOf({ proof: "not json at all" })), /not valid JSON/);
  assert.equal(requests.length, 0);
});

test("no inputs at all is refused", async () => {
  const { z } = fakeZ([ledgerHas()]);
  await assert.rejects(perform(z, bundleOf({})), /Provide a File to verify/);
});

test("every outcome returns the same field set, so a Zap's mapping cannot break", async () => {
  // A downstream step maps `counter` and `bitgraphedAfter` from a run that
  // found a proof. The day a file turns out not to be on record, those keys
  // must still be there and empty, not absent.
  const found = await perform(fakeZ([ledgerHas()]).z, bundleOf({ digest: REAL_DIGEST_B64 }));
  const missing = await perform(fakeZ([ledgerEmpty()]).z, bundleOf({ digest: REAL_DIGEST_B64 }));

  assert.deepEqual(
    Object.keys(found).sort(),
    Object.keys(missing).sort(),
    "found and not-found results must have identical keys"
  );
  assert.equal(missing.counter, null);
  assert.equal(missing.bitgraphedAfter, null);
});

test("verification never writes: no request in any path is a commit", async () => {
  for (const input of [
    { digest: REAL_DIGEST_B64 },
    { proof: JSON.stringify(REAL_PROOF) },
    { proof: JSON.stringify(REAL_PROOF), digest: REAL_DIGEST_B64 },
  ]) {
    const { z, requests } = fakeZ([ledgerHas()]);
    await perform(z, bundleOf(input));
    assert.ok(
      requests.every((r) => !r.url.endsWith("/api/commit")),
      `verifying with ${Object.keys(input).join("+")} must stay read-only`
    );
  }
});

void REAL_DIGEST_URLSAFE;
