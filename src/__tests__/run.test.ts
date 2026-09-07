// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * BitGraph Run (profile bitgraph-run/1): an artifact MADE with its slot
 * commitment inside it, rather than wrapped around an original afterwards.
 *
 * The positive case is the real thing: the first run artifact minted on
 * production, 2026-09-07, enclave v8, slot 1760 consumed at commit 1763. Its
 * proof and its bytes are the fixtures, so RUN_CONFIRMED here means the
 * enclave's own signature over the marker.
 *
 * The other categories need a key under this test's control, because every one
 * of them is reached by changing something the enclave signed: an edited
 * fixture fails at the signature before it can fail at the thing under test.
 * Those cases mint their own proofs the way the enclave does.
 */

import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sha256 } from "@noble/hashes/sha256";
import { getPublicKeyAsync, signAsync, utils } from "@noble/ed25519";
import {
  verifyRun,
  readRunAttribution,
  runAttribution,
  computeSlotCommitment,
  canonicalize,
  RUN_PROFILE,
  RUN_ENCODING_BASE64URL,
} from "@mikeargento/bitgraph-verify";
import type { BitGraphProof } from "@mikeargento/bitgraph-verify";

const FIX = fileURLToPath(new URL("../../src/__tests__/run-fixtures/", import.meta.url));
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const b64u = (b: Uint8Array) => b64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const utf8 = (s: string) => new TextEncoder().encode(s);

const liveProof = JSON.parse(readFileSync(FIX + "run.proof.json", "utf8")) as BitGraphProof;
const liveBytes = new Uint8Array(readFileSync(FIX + "run.output.txt"));

/** Mint a proof the way the enclave does, so the signature covers the marker. */
async function mint(
  makeBytes: (commitment: string) => Uint8Array,
  opts: { encoding?: string; declared?: string; profile?: string } = {},
) {
  const seed = utils.randomPrivateKey();
  const publicKeyB64 = b64(await getPublicKeyAsync(seed));
  const slotBody = {
    version: "bitgraph/slot/1" as const,
    nonceB64: b64(new Uint8Array(32).fill(7)),
    counter: "41",
    epochId: "run-test-epoch",
    publicKeyB64,
  };
  const slotAllocation = { ...slotBody, signatureB64: b64(await signAsync(canonicalize(slotBody), seed)) };
  const commitment = b64u(computeSlotCommitment(slotAllocation));
  const bytes = makeBytes(commitment);
  const digestB64 = b64(sha256(bytes));
  const attribution = {
    name: opts.profile ?? RUN_PROFILE,
    title: opts.encoding ?? RUN_ENCODING_BASE64URL,
    message: opts.declared ?? commitment,
  };
  const commit = {
    nonceB64: slotBody.nonceB64,
    counter: "42",
    slotCounter: "41",
    slotHashB64: b64(sha256(canonicalize(slotBody))),
    epochId: "run-test-epoch",
  };
  const signedBody = {
    version: "bitgraph/1" as const,
    artifact: { hashAlg: "sha256" as const, digestB64 },
    commit,
    publicKeyB64,
    enforcement: "measured-tee" as const,
    measurement: "run-test-measurement",
    attribution,
  };
  const proof = {
    version: "bitgraph/1",
    artifact: signedBody.artifact,
    commit,
    signer: { publicKeyB64, signatureB64: b64(await signAsync(canonicalize(signedBody), seed)) },
    environment: { enforcement: "measured-tee", measurement: "run-test-measurement" },
    slotAllocation,
    attribution,
  } as unknown as BitGraphProof;
  return { proof, bytes, commitment };
}

describe("bitgraph-run/1: the marker", () => {
  test("reads the encoding and the declared commitment", () => {
    assert.deepEqual(readRunAttribution(liveProof), {
      encoding: RUN_ENCODING_BASE64URL,
      declaredCommitment: b64u(computeSlotCommitment(liveProof.slotAllocation!)),
    });
  });

  test("is null for a fused proof, an anchor and a plain recording", () => {
    for (const name of ["bitgraph-fuse/1", "Ethereum Anchor", undefined]) {
      const proof = { attribution: name === undefined ? undefined : { name } } as unknown as BitGraphProof;
      assert.equal(readRunAttribution(proof), null);
    }
  });

  test("runAttribution builds exactly what the live proof carries", () => {
    const commitment = b64u(computeSlotCommitment(liveProof.slotAllocation!));
    assert.deepEqual(runAttribution(commitment), liveProof.attribution);
    assert.deepEqual(runAttribution(computeSlotCommitment(liveProof.slotAllocation!)), liveProof.attribution);
  });
});

describe("bitgraph-run/1: the live artifact (slot 1760, commit 1763)", () => {
  test("RUN_CONFIRMED, with the commitment located in the bytes", async () => {
    const r = await verifyRun({ proof: liveProof, bytes: liveBytes });
    assert.equal(r.category, "RUN_CONFIRMED");
    assert.equal(r.proof.valid, true);
    assert.equal(r.reason, null);
    assert.equal(r.occurrences, 1);
    assert.equal(typeof r.offset, "number");
    assert.equal(r.fileDigestB64, r.artifactDigestB64);
    // The located bytes really are the commitment, at the offset reported.
    const at = Buffer.from(liveBytes.slice(r.offset!, r.offset! + r.slotCommitmentB64u!.length)).toString("utf8");
    assert.equal(at, r.slotCommitmentB64u);
  });

  test("the span is the real one, and the statements name it", async () => {
    const r = await verifyRun({ proof: liveProof, bytes: liveBytes });
    assert.equal(r.span?.slotCounter, "1760");
    assert.equal(r.span?.commitCounter, "1763");
    assert.match(r.statements[0] ?? "", /slot at position 1760/);
    assert.match(r.statements[1] ?? "", /committed at position 1763/);
  });

  test("the limits are always carried with the claim, never dropped", async () => {
    const r = await verifyRun({ proof: liveProof, bytes: liveBytes });
    assert.equal(r.limits.length, 2);
    assert.match(r.limits.join(" "), /does not show it was an input/);
    assert.match(r.limits.join(" "), /producer's claim/);
  });

  test("one edited byte is refused on the proof, not on the search", async () => {
    const edited = new Uint8Array(liveBytes);
    edited[edited.length - 2] = edited[edited.length - 2]! ^ 0x01;
    const r = await verifyRun({ proof: liveProof, bytes: edited });
    assert.equal(r.category, "INVALID_UNDERLYING_PROOF");
    assert.equal(r.proof.valid, false);
    assert.notEqual(r.fileDigestB64, r.artifactDigestB64);
  });

  test("a proof declaring an unpinned measurement is refused", async () => {
    const r = await verifyRun({ proof: liveProof, bytes: liveBytes, trustAnchors: { allowedMeasurements: ["0".repeat(96)] } });
    assert.equal(r.category, "INVALID_UNDERLYING_PROOF");
  });
});

describe("bitgraph-run/1: every other category", () => {
  test("counts every occurrence and reports the first", async () => {
    const { proof, bytes } = await mint((c) => utf8(`${c}\nmiddle\n${c}\n`));
    const r = await verifyRun({ proof, bytes });
    assert.equal(r.category, "RUN_CONFIRMED");
    assert.equal(r.offset, 0);
    assert.equal(r.occurrences, 2);
  });

  test("COMMITMENT_ABSENT: the proof is valid, the bytes simply do not carry it", async () => {
    const { proof, bytes } = await mint(() => utf8("nothing of the sort in here\n"));
    const r = await verifyRun({ proof, bytes });
    assert.equal(r.category, "COMMITMENT_ABSENT");
    assert.equal(r.proof.valid, true);
    assert.equal(r.offset, null);
    assert.deepEqual(r.statements, []);
    assert.deepEqual(r.limits, [], "a result that establishes nothing carries no limits either");
  });

  test("INVALID_SLOT_COMMITMENT: the signed marker names a commitment this slot did not make", async () => {
    const { proof, bytes } = await mint((c) => utf8(`token ${c}\n`), { declared: b64u(new Uint8Array(32).fill(9)) });
    const r = await verifyRun({ proof, bytes });
    assert.equal(r.category, "INVALID_SLOT_COMMITMENT");
    assert.match(r.reason ?? "", /this proof's slot record commits to/);
  });

  test("UNDETERMINED_ENCODING: an encoding this build does not register is not a failure and not a pass", async () => {
    const { proof, bytes } = await mint((c) => utf8(`token ${c}\n`), { encoding: "hex/1" });
    const r = await verifyRun({ proof, bytes });
    assert.equal(r.category, "UNDETERMINED_ENCODING");
    assert.match(r.reason ?? "", /does not register/);
  });

  test("NOT_A_RUN: another profile is left alone, signature untouched", async () => {
    const { proof, bytes } = await mint((c) => utf8(`token ${c}\n`), { profile: "bitgraph-fuse/1" });
    const r = await verifyRun({ proof, bytes });
    assert.equal(r.category, "NOT_A_RUN");
    assert.equal(r.marker, null);
    assert.equal(r.proof.valid, false, "the underlying proof is never even run for a profile this verifier does not own");
  });

  test("a commitment appended to finished work passes, and the limit says so", async () => {
    const { proof, bytes } = await mint((c) => utf8(`the work was already done\n${c}\n`));
    const r = await verifyRun({ proof, bytes });
    assert.equal(r.category, "RUN_CONFIRMED");
    assert.ok((r.offset ?? 0) > 0);
    assert.match(r.limits[0] ?? "", /appended to a finished file pass the same check/);
  });
});
