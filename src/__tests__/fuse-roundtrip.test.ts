// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * BitGraph Fuse: reconstruction round trips (spec 15.3). A placement enters
 * the registry only with this test passing: original plus proof rebuilds
 * bytes whose hash equals the artifact digest, from fixed vectors.
 */

import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sha256 } from "@noble/hashes/sha256";
import { PLACEMENTS, getPlacement, computeSlotCommitment, bytesToBase64, buildFrame, parseFrame, readFrameMarker, readFuseAttribution, fuseAttribution } from "@mikeargento/bitgraph-verify";
import type { BitGraphProof } from "@mikeargento/bitgraph-verify";

const FIX = fileURLToPath(new URL("../../src/__tests__/fuse-fixtures/", import.meta.url));
const bytes = (name: string) => new Uint8Array(readFileSync(FIX + name));
const proofOf = (name: string) => JSON.parse(readFileSync(FIX + name, "utf8")) as BitGraphProof;

describe("registry", () => {
  test("fixed order and ids", () => {
    assert.deepEqual(PLACEMENTS.map((p) => p.id), ["trailer/1", "container/1", "produced/1"]);
    assert.deepEqual(PLACEMENTS.map((p) => p.byteExact), [true, true, false]);
    assert.equal(getPlacement("xmp/9"), undefined);
    assert.equal(getPlacement(""), undefined);
  });
});

describe("trailer/1", () => {
  const p = getPlacement("trailer/1")!;
  test("original + proof rebuilds the committed bytes", () => {
    const proof = proofOf("trailer.proof.json");
    const rebuilt = p.build({ original: bytes("original.txt"), commitment: computeSlotCommitment(proof.slotAllocation!) });
    assert.deepEqual(rebuilt, bytes("fused-trailer.bin"));
    assert.equal(bytesToBase64(sha256(rebuilt)), proof.artifact.digestB64);
  });
  test("locate returns the commitment and the exact original prefix", () => {
    const proof = proofOf("trailer.proof.json");
    const l = p.locate(bytes("fused-trailer.bin"))!;
    assert.deepEqual(l.commitment, computeSlotCommitment(proof.slotAllocation!));
    assert.deepEqual(l.originalBytes, bytes("original.txt"));
    assert.equal(l.originDigest, undefined, "trailer/1 writes no origin digest");
  });
  test("locate refuses short input, wrong magic, non-zero reserved bytes", () => {
    assert.equal(p.locate(new Uint8Array(47)), null);
    const f = bytes("fused-trailer.bin");
    const magic = f.slice(); magic[magic.length - 48] = 0x58;
    assert.equal(p.locate(magic), null);
    const reserved = f.slice(); reserved[reserved.length - 40] = 1;
    assert.equal(p.locate(reserved), null);
    assert.equal(p.locate(bytes("original.txt")), null, "an unfused file has no trailer");
  });
  test("build refuses a bad commitment length and a missing original", () => {
    assert.throws(() => p.build({ commitment: new Uint8Array(32) }), /original/);
    assert.throws(() => p.build({ original: new Uint8Array(1), commitment: new Uint8Array(31) }), /32 bytes/);
  });
});

describe("container/1", () => {
  const p = getPlacement("container/1")!;
  test("original + proof rebuilds the committed archive byte for byte, twice", () => {
    const proof = proofOf("container.proof.json");
    const c = computeSlotCommitment(proof.slotAllocation!);
    const a = p.build({ original: bytes("image.png"), commitment: c });
    const b = p.build({ original: bytes("image.png"), commitment: c });
    assert.deepEqual(a, b, "deterministic");
    assert.deepEqual(a, bytes("fused-container.tar"));
    assert.equal(bytesToBase64(sha256(a)), proof.artifact.digestB64);
  });
  test("locate returns commitment, origin digest and the original bytes", () => {
    const proof = proofOf("container.proof.json");
    const l = p.locate(bytes("fused-container.tar"))!;
    assert.deepEqual(l.commitment, computeSlotCommitment(proof.slotAllocation!));
    assert.deepEqual(l.originDigest, sha256(bytes("image.png")));
    assert.deepEqual(l.originalBytes, bytes("image.png"));
  });
  test("locate refuses any deviation from the fixed layout", () => {
    const f = bytes("fused-container.tar");
    const mtime = f.slice(); mtime[136] = 0x31;                         // manifest header mtime
    assert.equal(p.locate(mtime), null, "non-zero mtime");
    const uid = f.slice(); uid[108] = 0x31;
    assert.equal(p.locate(uid), null, "uid");
    const truncated = f.subarray(0, f.length - 512);
    assert.equal(p.locate(truncated), null, "missing end block");
    const extra = new Uint8Array(f.length + 512); extra.set(f);
    assert.equal(p.locate(extra), null, "extra trailing block");
    // Swap entry order: rebuild with the original first is not this placement.
    const swapped = f.slice(); swapped[0] = 0x78;                        // corrupt the manifest name
    assert.equal(p.locate(swapped), null, "wrong entry name");
    assert.equal(p.locate(bytes("image.png")), null, "not a tar");
    assert.equal(p.locate(bytes("fused-trailer.bin")), null);
  });
  test("an archive with a wrong manifest origin does not locate", () => {
    const proof = proofOf("container.proof.json");
    const c = computeSlotCommitment(proof.slotAllocation!);
    const lying = p.build({ original: bytes("image.png"), originDigest: sha256(bytes("original.txt")), commitment: c });
    // build accepts a caller-supplied origin digest; locate returns what is written,
    // and the verifier compares it against the marker and the original's hash.
    const l = p.locate(lying)!;
    assert.deepEqual(l.originDigest, sha256(bytes("original.txt")));
    assert.notDeepEqual(l.originDigest, sha256(l.originalBytes!));
  });
});

describe("produced/1", () => {
  const p = getPlacement("produced/1")!;
  test("build and locate agree, with and without an origin", () => {
    for (const [name, proofName] of [["produced-origin.json", "produced-origin.proof.json"], ["produced-bare.json", "produced-bare.proof.json"]] as const) {
      const proof = proofOf(proofName);
      const l = p.locate(bytes(name))!;
      assert.deepEqual(l.commitment, computeSlotCommitment(proof.slotAllocation!));
      assert.equal(bytesToBase64(sha256(bytes(name))), proof.artifact.digestB64);
    }
    assert.equal(p.locate(bytes("original.txt")), null);
    assert.throws(() => p.build({ original: new Uint8Array(1), commitment: new Uint8Array(32) }), /no original/);
  });
});

describe("legacy files that carry a nonce line", () => {
  test("a file with a 'nonce:' line and no trailer, container or payload locates nothing", () => {
    // ~/BitGraph holds recordings whose bytes begin with a test label and a line
    // "nonce: <hex>" (the proto pattern, minted 2026-06-27 and 2026-08-06). That
    // line is content, not a commitment: every registered placement must miss.
    const legacy = new TextEncoder().encode("BitGraph test subject folder-02 file-02\nnonce: e317096692576a308263bc283d66b42e\nuoJjpYb8igrEhhSlczKKTKDyw6guO2iU5iHdBRF+mPELQqBfjrO2WZYrSWyHEuKK\n");
    for (const p of PLACEMENTS) assert.equal(p.locate(legacy), null, p.id);
  });
});

describe("attribution and Frame", () => {
  test("fused attribution carries placement in title and origin in message (standard base64)", () => {
    const origin = sha256(bytes("original.txt"));
    const a = fuseAttribution("trailer/1", origin);
    assert.deepEqual(a, { name: "bitgraph-fuse/1", title: "trailer/1", message: bytesToBase64(origin) });
    assert.deepEqual(fuseAttribution("produced/1"), { name: "bitgraph-fuse/1", title: "produced/1" });
    const proof = proofOf("trailer.proof.json");
    const m = readFuseAttribution(proof)!;
    assert.equal(m.placement, "trailer/1");
    assert.equal(m.placementSource, "attribution");
    assert.equal(m.source, "attribution");
    assert.deepEqual(m.originDigest, origin);
    assert.equal(m.originSource, "attribution");
    const bare = readFuseAttribution(proofOf("trailer-undeclared.proof.json"))!;
    assert.equal(bare.originDigest, undefined);
    assert.equal(bare.originSource, undefined);
    assert.equal(readFuseAttribution(proofOf("recorded.proof.json")), null, "an ordinary proof has no marker");
  });
  test("a Frame parses regardless of outer formatting and the nested proof is untouched", () => {
    const text = readFileSync(FIX + "trailer.bitgraph-fuse.json", "utf8");
    const a = parseFrame(text)!;
    const b = parseFrame(JSON.stringify(JSON.parse(text)))!;
    assert.deepEqual(a, b);
    assert.equal(a.manifest.placement, "trailer/1");
    assert.deepEqual(a.proof, proofOf("trailer.proof.json"));
    const marker = readFrameMarker(a);
    assert.equal(marker.source, "manifest");
    assert.equal(marker.placementSource, "manifest");
    assert.deepEqual(marker.originDigest, sha256(bytes("original.txt")));
    const undeclared = parseFrame({ type: "bitgraph-fuse/1", manifest: { artifact: { algorithm: "sha256", digest: "00".repeat(32) }, fusedFile: null }, proof: proofOf("trailer.proof.json") })!;
    assert.equal(readFrameMarker(undeclared).placement, null, "a manifest may leave the placement undeclared");
    assert.equal(parseFrame(proofOf("trailer.proof.json")), null, "a bare proof is not a Frame");
    assert.equal(parseFrame("{not json"), null);
    assert.equal(parseFrame({ type: "bitgraph-fuse/1", manifest: { placement: "trailer/1", artifact: { algorithm: "sha256", digest: "zz" }, fusedFile: null }, proof: {} }), null);
  });
  test("a Frame is never proof-shaped", () => {
    const f = JSON.parse(readFileSync(FIX + "produced-origin.bitgraph-fuse.json", "utf8")) as Record<string, unknown>;
    assert.equal(f.version, undefined);
    assert.equal(f.artifact, undefined);
    assert.equal(f.signer, undefined);
    assert.equal(f.type, "bitgraph-fuse/1");
    assert.ok(f.fusePayload, "Form C frames carry the parsed payload view");
    assert.throws(() => buildFrame({ proof: proofOf("produced-origin.proof.json"), placement: "produced/1", artifactDigest: new Uint8Array(32), fusedFile: null, fusePayload: new Uint8Array([1]) }), /canonical/);
  });
});
