// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * The marker's title in its second vocabulary: an ENCODING rather than a
 * placement, for an artifact MADE with the commitment inside it.
 *
 * A placement is a recipe, so a holder of the original rebuilds the committed
 * artifact byte for byte. An encoding says there is no recipe and no original:
 * the commitment was in the thing while it was being made (a prompt, a build
 * id, a commit message), so the only thing to do is look for it. One marker
 * answers both, which is why this file tests verifyFuse and not a second
 * function. It was briefly a second profile, bitgraph-run/1, on 2026-09-07.
 *
 * The positive case is real: the canonical inline artifact minted on
 * production, enclave v8, slot 2072 consumed at commit 2075. Categories that
 * need a key under this test's control mint their own proofs, because every one
 * of them is reached by changing something the enclave signed.
 */

import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sha256 } from "@noble/hashes/sha256";
import { getPublicKeyAsync, signAsync, utils } from "@noble/ed25519";
import {
  verifyFuse,
  inlineAttribution,
  isCarryEncoding,
  findCommitment,
  computeSlotCommitment,
  canonicalize,
  bytesToBase64,
  ENCODING_BASE64URL,
} from "@mikeargento/bitgraph-verify";
import type { BitGraphProof } from "@mikeargento/bitgraph-verify";

const FIX = fileURLToPath(new URL("../../src/__tests__/fuse-fixtures/", import.meta.url));
const b64 = (b: Uint8Array) => bytesToBase64(b);
const b64u = (b: Uint8Array) => b64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const utf8 = (s: string) => new TextEncoder().encode(s);

const liveProof = JSON.parse(readFileSync(FIX + "inline.proof.json", "utf8")) as BitGraphProof;
const liveBytes = new Uint8Array(readFileSync(FIX + "inline.artifact.txt"));

/** Mint a proof the way the enclave does, so the signature covers the marker. */
async function mint(
  makeBytes: (commitment: string) => Uint8Array,
  opts: { title?: string; message?: string } = {},
) {
  const seed = utils.randomPrivateKey();
  const publicKeyB64 = b64(await getPublicKeyAsync(seed));
  const slotBody = {
    version: "bitgraph/slot/1" as const,
    nonceB64: b64(new Uint8Array(32).fill(7)),
    counter: "41",
    epochId: "inline-test-epoch",
    publicKeyB64,
  };
  const slotAllocation = { ...slotBody, signatureB64: b64(await signAsync(canonicalize(slotBody), seed)) };
  const commitment = b64u(computeSlotCommitment(slotAllocation));
  const bytes = makeBytes(commitment);
  const digestB64 = b64(sha256(bytes));
  const attribution: Record<string, string> = { name: "bitgraph-fuse/1", title: opts.title ?? ENCODING_BASE64URL };
  if (opts.message !== undefined) attribution["message"] = opts.message;
  const commit = {
    nonceB64: slotBody.nonceB64,
    counter: "42",
    slotCounter: "41",
    slotHashB64: b64(sha256(canonicalize(slotBody))),
    epochId: "inline-test-epoch",
  };
  const signedBody = {
    version: "bitgraph/1" as const,
    artifact: { hashAlg: "sha256" as const, digestB64 },
    commit,
    publicKeyB64,
    enforcement: "measured-tee" as const,
    measurement: "inline-test-measurement",
    attribution,
  };
  const proof = {
    version: "bitgraph/1",
    artifact: signedBody.artifact,
    commit,
    signer: { publicKeyB64, signatureB64: b64(await signAsync(canonicalize(signedBody), seed)) },
    environment: { enforcement: "measured-tee", measurement: "inline-test-measurement" },
    slotAllocation,
    attribution,
  } as unknown as BitGraphProof;
  return { proof, bytes, commitment };
}

describe("carry encodings", () => {
  test("base64url is registered; a placement id and nonsense are not", () => {
    assert.equal(isCarryEncoding(ENCODING_BASE64URL), true);
    for (const id of ["trailer/1", "container/2", "set/1", "hex/1", "", null, undefined]) {
      assert.equal(isCarryEncoding(id as string), false, `${String(id)} should not be an encoding`);
    }
  });

  test("inlineAttribution declares the encoding and no origin, because there is none", () => {
    const a = inlineAttribution();
    assert.deepEqual(a, { name: "bitgraph-fuse/1", title: ENCODING_BASE64URL });
    assert.equal("message" in a, false, "a 32-byte message would be read as an origin digest");
    assert.deepEqual(a, liveProof.attribution);
  });

  test("findCommitment locates every occurrence, and none for an unregistered encoding", () => {
    const c = new Uint8Array(32).fill(3);
    const text = b64u(c);
    assert.deepEqual(findCommitment(utf8(`a${text}b${text}`), c, ENCODING_BASE64URL), [1, 1 + text.length + 1]);
    assert.deepEqual(findCommitment(utf8("nothing"), c, ENCODING_BASE64URL), []);
    assert.deepEqual(findCommitment(utf8(text), c, "hex/1"), []);
  });
});

describe("the canonical inline artifact (slot 2072, commit 2075)", () => {
  test("CARRIED_INLINE, located, and named as carried by an encoding", async () => {
    const r = await verifyFuse({ proof: liveProof, bytes: liveBytes });
    assert.equal(r.category, "CARRIED_INLINE");
    assert.equal(r.proof.valid, true);
    assert.equal(r.reason, null);
    assert.deepEqual(r.carriedBy, { kind: "encoding", id: ENCODING_BASE64URL });
    assert.equal(r.placement, null, "an inline artifact has no placement: there is no recipe");
    assert.equal(r.originDigestB64, null, "and no original");
    assert.equal(r.offsets.length, 1);
    // The bytes at the reported offset really are the commitment.
    const at = Buffer.from(liveBytes.slice(r.offsets[0]!, r.offsets[0]! + 43)).toString("utf8");
    assert.equal(at, r.slotCommitmentB64!.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
  });

  test("the span is the real one, and the statements name it", async () => {
    const r = await verifyFuse({ proof: liveProof, bytes: liveBytes });
    assert.equal(r.span?.slotCounter, "2072");
    assert.equal(r.span?.commitCounter, "2075");
    assert.match(r.statements[0] ?? "", /slot at position 2072/);
    assert.match(r.statements[1] ?? "", /committed at position 2075/);
  });

  test("the limit rides with the claim and is carried by nothing else", async () => {
    const r = await verifyFuse({ proof: liveProof, bytes: liveBytes });
    assert.equal(r.limits.length, 1);
    assert.match(r.limits[0] ?? "", /appended to a finished file pass the same check/);
    const { proof, bytes } = await mint(() => utf8("no commitment in here"));
    assert.deepEqual((await verifyFuse({ proof, bytes })).limits, [], "a result that establishes nothing carries no limits");
  });

  test("one edited byte is refused on the proof, not on the search", async () => {
    const edited = new Uint8Array(liveBytes);
    edited[edited.length - 2] = edited[edited.length - 2]! ^ 0x01;
    const r = await verifyFuse({ proof: liveProof, bytes: edited });
    assert.equal(r.category, "NO_MATCH", "the bytes are neither the artifact nor a declared original");
  });

  test("a measurement outside the pinned list is refused", async () => {
    const r = await verifyFuse({ proof: liveProof, bytes: liveBytes, trustAnchors: { allowedMeasurements: ["0".repeat(96)] } });
    assert.equal(r.category, "INVALID_UNDERLYING_PROOF");
  });
});

describe("the other inline outcomes", () => {
  test("every occurrence is counted and the first is the one the statement names", async () => {
    const { proof, bytes } = await mint((c) => utf8(`${c}\nmiddle\n${c}\n`));
    const r = await verifyFuse({ proof, bytes });
    assert.equal(r.category, "CARRIED_INLINE");
    assert.deepEqual(r.offsets.length, 2);
    assert.equal(r.offsets[0], 0);
    assert.match(r.statements[1] ?? "", /byte 0/);
  });

  test("COMMITMENT_ABSENT: the proof is valid, the bytes simply do not carry it", async () => {
    const { proof, bytes } = await mint(() => utf8("nothing of the sort in here\n"));
    const r = await verifyFuse({ proof, bytes });
    assert.equal(r.category, "COMMITMENT_ABSENT");
    assert.equal(r.proof.valid, true);
    assert.deepEqual(r.offsets, []);
    assert.deepEqual(r.statements, []);
  });

  test("an inline marker that declares an origin is refused: there is no original to name", async () => {
    const { proof, bytes } = await mint((c) => utf8(`token ${c}\n`), { message: b64(new Uint8Array(32).fill(9)) });
    const r = await verifyFuse({ proof, bytes });
    assert.equal(r.category, "INVALID_ORIGIN_ATTRIBUTION");
    assert.match(r.reason ?? "", /has no original/);
  });

  test("an unregistered title is UNDETERMINED_PLACEMENT, neither a pass nor a failure", async () => {
    const { proof, bytes } = await mint((c) => utf8(`token ${c}\n`), { title: "hex/1" });
    const r = await verifyFuse({ proof, bytes });
    assert.equal(r.category, "UNDETERMINED_PLACEMENT");
  });

  test("a commitment appended to finished work passes, and the limit says so", async () => {
    const { proof, bytes } = await mint((c) => utf8(`the work was already done\n${c}\n`));
    const r = await verifyFuse({ proof, bytes });
    assert.equal(r.category, "CARRIED_INLINE");
    assert.ok((r.offsets[0] ?? 0) > 0);
    assert.match(r.limits[0] ?? "", /producer's claim/);
  });

  test("a fused artifact still reports a placement, and carries no limits", async () => {
    const fused = JSON.parse(readFileSync(FIX + "trailer.proof.json", "utf8")) as BitGraphProof;
    const bytes = new Uint8Array(readFileSync(FIX + "fused-trailer.bin"));
    const r = await verifyFuse({ proof: fused, bytes });
    assert.equal(r.category, "FUSED_DIRECT");
    assert.deepEqual(r.carriedBy, { kind: "placement", id: r.placement! });
    assert.deepEqual(r.limits, []);
    assert.deepEqual(r.offsets, []);
  });
});
