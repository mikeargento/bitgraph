// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * BitGraph Fuse: fixed vectors (spec 15.2).
 *
 * The slot record hash, the commitment preimage, the commitment, the Form C
 * payload bytes, the trailer bytes and the container bytes are pinned, and
 * the enclave's own commit.slotHashB64 on real fixture proofs must equal what
 * this package computes from the embedded slot record.
 */

import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sha256 } from "@noble/hashes/sha256";
import {
  FUSE_DOMAIN,
  TRAILER_MAGIC,
  canonicalSlotBody,
  canonicalize,
  computeSlotRecordHash,
  slotCommitmentPreimage,
  computeSlotCommitment,
  buildFusePayload,
  parseFusePayload,
  getPlacement,
  bytesToHex,
  hexToBytes,
  bytesToBase64,
  base64ToBytes,
} from "@mikeargento/bitgraph-verify";
import type { BitGraphProof, SlotAllocation } from "@mikeargento/bitgraph-verify";

const FIX = fileURLToPath(new URL("../../src/__tests__/fuse-fixtures/", import.meta.url));
const bytes = (name: string) => new Uint8Array(readFileSync(FIX + name));
const json = <T>(name: string): T => JSON.parse(readFileSync(FIX + name, "utf8")) as T;

interface Vec { slot: SlotAllocation; canonicalSlotBody: string; slotRecordHashHex: string; preimageHex: string; commitmentHex: string }
interface Vectors {
  domainHex: string;
  synthetic: Vec;
  trailerFixture: Vec & { fusedDigestB64: string; originDigestB64: string };
  containerFixture: Vec & { fusedDigestB64: string; originDigestB64: string };
  producedOriginFixture: Vec & { payload: string; fusedDigestB64: string };
  producedBareFixture: Vec & { payload: string; fusedDigestB64: string };
}
const V = json<Vectors>("vectors.json");

describe("domain separation", () => {
  test("the domain is the 15 profile bytes followed by one zero byte, 16 bytes total", () => {
    assert.equal(FUSE_DOMAIN.length, 16);
    assert.equal(new TextDecoder().decode(FUSE_DOMAIN.subarray(0, 15)), "bitgraph-fuse/1");
    assert.equal(FUSE_DOMAIN[15], 0);
    assert.equal(bytesToHex(FUSE_DOMAIN), V.domainHex);
  });

  test("changing the domain label changes the commitment", () => {
    const slot = V.synthetic.slot;
    const nonce = base64ToBytes(slot.nonceB64)!;
    const other = new Uint8Array([...new TextEncoder().encode("bitgraph-fuse/2"), 0, ...computeSlotRecordHash(slot), ...nonce]);
    assert.notEqual(bytesToHex(sha256(other)), V.synthetic.commitmentHex);
  });
});

describe("slot record hash and commitment, synthetic vector", () => {
  const slot = V.synthetic.slot;

  test("canonical slot body is the enclave's field subset, sorted, compact", () => {
    const body = new TextDecoder().decode(canonicalize(canonicalSlotBody(slot)));
    assert.equal(body, V.synthetic.canonicalSlotBody);
    assert.equal(body, `{"chainId":"bitgraph:main","counter":"7","epochId":"${slot.epochId}","nonceB64":"${slot.nonceB64}","publicKeyB64":"${slot.publicKeyB64}","version":"bitgraph/slot/1"}`);
    assert.ok(!body.includes("signatureB64"), "the signature is outside the hashed body");
  });

  test("slotRecordHash, preimage and commitment are pinned and structurally related", () => {
    const hash = computeSlotRecordHash(slot);
    assert.equal(bytesToHex(hash), V.synthetic.slotRecordHashHex);
    const pre = slotCommitmentPreimage(slot);
    assert.equal(bytesToHex(pre), V.synthetic.preimageHex);
    assert.equal(pre.length, 16 + 32 + 32);
    assert.deepEqual(pre.subarray(0, 16), FUSE_DOMAIN);
    assert.deepEqual(pre.subarray(16, 48), hash);
    assert.deepEqual(pre.subarray(48, 80), base64ToBytes(slot.nonceB64));
    assert.equal(bytesToHex(computeSlotCommitment(slot)), V.synthetic.commitmentHex);
    assert.equal(bytesToHex(sha256(pre)), V.synthetic.commitmentHex);
  });

  test("one-bit mutations of the nonce or any signed slot field change the commitment", () => {
    const base = bytesToHex(computeSlotCommitment(slot));
    const nonce = base64ToBytes(slot.nonceB64)!;
    nonce[0] = nonce[0]! ^ 1;
    assert.notEqual(bytesToHex(computeSlotCommitment({ ...slot, nonceB64: bytesToBase64(nonce) })), base);
    assert.notEqual(bytesToHex(computeSlotCommitment({ ...slot, counter: "8" })), base);
    assert.notEqual(bytesToHex(computeSlotCommitment({ ...slot, epochId: bytesToBase64(new Uint8Array(32).fill(9)) })), base);
    assert.notEqual(bytesToHex(computeSlotCommitment({ ...slot, chainId: "global" })), base);
    const { chainId: _c, ...noChain } = slot;
    assert.notEqual(bytesToHex(computeSlotCommitment(noChain as SlotAllocation)), base, "a record without chainId is a different record");
    // The signature is not part of the hashed body, so changing it changes nothing here.
    assert.equal(bytesToHex(computeSlotCommitment({ ...slot, signatureB64: bytesToBase64(new Uint8Array(64).fill(7)) })), base);
  });

  test("a nonce that is not 32 bytes is refused", () => {
    assert.throws(() => computeSlotCommitment({ ...slot, nonceB64: bytesToBase64(new Uint8Array(16)) }), /32 bytes/);
    assert.throws(() => computeSlotCommitment({ ...slot, nonceB64: "not base64!" }), /32 bytes/);
  });
});

describe("real fixture proofs: the enclave agrees with this package", () => {
  for (const name of ["trailer", "container", "produced-origin", "produced-bare", "trailer-undeclared", "wrong-slot", "unregistered", "order-fused-during-hold"]) {
    test(`${name}: SHA-256 of the canonical slot body equals commit.slotHashB64`, () => {
      const proof = json<BitGraphProof>(`${name}.proof.json`);
      assert.ok(proof.slotAllocation, "fixture carries its slot record");
      assert.equal(bytesToBase64(computeSlotRecordHash(proof.slotAllocation!)), proof.commit.slotHashB64);
      assert.equal(proof.slotAllocation!.nonceB64, proof.commit.nonceB64);
    });
  }

  test("the fixture vectors match the embedded slot records", () => {
    for (const [name, v] of [["trailer", V.trailerFixture], ["container", V.containerFixture], ["produced-origin", V.producedOriginFixture], ["produced-bare", V.producedBareFixture]] as const) {
      const proof = json<BitGraphProof>(`${name}.proof.json`);
      assert.equal(bytesToHex(computeSlotCommitment(proof.slotAllocation!)), v.commitmentHex, name);
      assert.equal(proof.artifact.digestB64, v.fusedDigestB64, name);
    }
  });
});

describe("Form C payload bytes", () => {
  test("pinned bytes: sorted keys, compact, lowercase hex, type last", () => {
    const v = V.producedOriginFixture;
    const commitment = hexToBytes(v.commitmentHex)!;
    const origin = base64ToBytes(V.trailerFixture.originDigestB64)!;
    const built = buildFusePayload(commitment, origin);
    assert.equal(new TextDecoder().decode(built), v.payload);
    assert.equal(v.payload, `{"origin":{"algorithm":"sha256","digest":"${bytesToHex(origin)}"},"slotCommitment":{"algorithm":"sha256","digest":"${v.commitmentHex}"},"type":"bitgraph-fuse/1"}`);
    assert.equal(bytesToBase64(sha256(built)), v.fusedDigestB64);
    const bare = buildFusePayload(hexToBytes(V.producedBareFixture.commitmentHex)!);
    assert.equal(new TextDecoder().decode(bare), V.producedBareFixture.payload);
    assert.ok(!V.producedBareFixture.payload.includes("origin"));
  });

  test("parse round-trips and rejects every non-canonical or malformed form", () => {
    const good = bytes("produced-origin.json");
    const parsed = parseFusePayload(good)!;
    assert.equal(bytesToHex(parsed.commitment), V.producedOriginFixture.commitmentHex);
    assert.equal(bytesToBase64(parsed.originDigest!), V.trailerFixture.originDigestB64);
    const text = new TextDecoder().decode(good);
    const enc = (s: string) => new TextEncoder().encode(s);
    assert.equal(parseFusePayload(enc(JSON.stringify(JSON.parse(text), null, 2))), null, "whitespace");
    assert.equal(parseFusePayload(enc(text.replace("bitgraph-fuse/1", "bitgraph-fuse/2"))), null, "type");
    assert.equal(parseFusePayload(enc(text.replace(/"digest":"([0-9a-f]{8})/, (_m, h: string) => `"digest":"${h.toUpperCase()}`))), null, "uppercase hex");
    assert.equal(parseFusePayload(enc(text.replace("{\"origin\"", "{\"extra\":1,\"origin\""))), null, "extra key");
    assert.equal(parseFusePayload(enc(text.replace("\"type\":\"bitgraph-fuse/1\"", "\"type\":\"bitgraph-fuse/1\",\"type\":\"bitgraph-fuse/1\""))), null, "duplicate key");
    assert.equal(parseFusePayload(enc(text.replace("sha256", "sha512"))), null, "algorithm");
    assert.equal(parseFusePayload(enc("[]")), null);
    assert.equal(parseFusePayload(new Uint8Array([0xff, 0xfe])), null, "not UTF-8");
  });
});

describe("trailer/1 and container/1 bytes", () => {
  test("trailer is original || 'BGFUSE01' || 8 zero bytes || commitment", () => {
    const fused = bytes("fused-trailer.bin");
    const original = bytes("original.txt");
    assert.equal(fused.length, original.length + 48);
    assert.deepEqual(fused.subarray(0, original.length), original);
    assert.equal(new TextDecoder().decode(fused.subarray(original.length, original.length + 8)), TRAILER_MAGIC);
    assert.ok(fused.subarray(original.length + 8, original.length + 16).every((b) => b === 0));
    assert.equal(bytesToHex(fused.subarray(original.length + 16)), V.trailerFixture.commitmentHex);
    assert.equal(bytesToBase64(sha256(fused)), V.trailerFixture.fusedDigestB64);
  });

  test("container is a fixed-layout ustar: manifest, original, two zero blocks, all metadata zeroed", () => {
    const fused = bytes("fused-container.tar");
    const png = bytes("image.png");
    assert.equal(fused.length % 512, 0);
    const name = (off: number) => new TextDecoder().decode(fused.subarray(off, off + 100)).replace(/\0+$/, "");
    assert.equal(name(0), "bitgraph-fuse/manifest.json");
    const manifestLen = parseInt(new TextDecoder().decode(fused.subarray(124, 135)), 8);
    const manifest = fused.subarray(512, 512 + manifestLen);
    const parsed = parseFusePayload(manifest)!;
    assert.equal(bytesToHex(parsed.commitment), V.containerFixture.commitmentHex);
    assert.equal(bytesToBase64(parsed.originDigest!), V.containerFixture.originDigestB64);
    const second = 512 + manifestLen + ((512 - (manifestLen % 512)) % 512);
    assert.equal(name(second), "bitgraph-fuse/original");
    assert.equal(new TextDecoder().decode(fused.subarray(second + 136, second + 147)), "00000000000", "mtime is zero");
    assert.deepEqual(fused.subarray(second + 512, second + 512 + png.length), png);
    assert.ok(fused.subarray(fused.length - 1024).every((b) => b === 0), "two zero blocks end the archive");
    assert.equal(bytesToBase64(sha256(fused)), V.containerFixture.fusedDigestB64);
    const rebuilt = getPlacement("container/1")!.build({ original: png, commitment: parsed.commitment });
    assert.deepEqual(rebuilt, fused);
  });

  test("one-bit mutation of the fused bytes changes the artifact digest", () => {
    for (const name of ["fused-trailer.bin", "fused-container.tar", "produced-origin.json"]) {
      const f = bytes(name);
      const d0 = bytesToBase64(sha256(f));
      f[0] = f[0]! ^ 1;
      assert.notEqual(bytesToBase64(sha256(f)), d0, name);
    }
  });
});

describe("encoding helpers", () => {
  test("base64 is strict standard alphabet with canonical padding", () => {
    assert.deepEqual(base64ToBytes("AQID"), new Uint8Array([1, 2, 3]));
    assert.equal(base64ToBytes("AQI"), null, "length");
    assert.equal(base64ToBytes("AQI-"), null, "url-safe alphabet");
    assert.equal(base64ToBytes("AQ==\n"), null, "whitespace");
    assert.equal(base64ToBytes("AR=="), null, "non-canonical trailing bits");
    assert.equal(bytesToBase64(new Uint8Array(32).fill(255)), "//////////////////////////////////////////8=");
    assert.deepEqual(base64ToBytes("//////////////////////////////////////////8="), new Uint8Array(32).fill(255));
  });
  test("hex is lowercase only", () => {
    assert.deepEqual(hexToBytes("00ff"), new Uint8Array([0, 255]));
    assert.equal(hexToBytes("00FF"), null);
    assert.equal(hexToBytes("0"), null);
  });
});
