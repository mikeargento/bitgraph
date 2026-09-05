/**
 * The scan hasher against the two things it must agree with: the native
 * SHA-256 for the digest, and the trailer/1 placement's own build for a
 * state finished with the trailer. Run: node --test src/lib/__tests__/scan-hash.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashChunks, finishState } from "../scan-hash.ts";
import { trailerBytesFor } from "@mikeargento/bitgraph";
import { getPlacement, bytesToBase64, computeSlotCommitment } from "@mikeargento/bitgraph-verify";

const native = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", b));
async function* chunked(b: Uint8Array, size: number): AsyncIterable<Uint8Array> {
  for (let o = 0; o < b.length; o += size) yield b.subarray(o, Math.min(b.length, o + size));
}
const filled = (n: number, seed: number) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + seed) & 0xff; return b; };
const jpeg = (n: number) => { const b = filled(n, 9); if (n >= 4) b.set([0xff, 0xd8, 0xff, 0xe0], 0); return b; };
const png = (n: number) => { const b = filled(n, 4); if (n >= 8) b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); return b; };
const text = (n: number) => { const b = filled(n, 2); for (let i = 0; i < Math.min(n, 64); i++) b[i] = 0x61 + (i % 26); return b; };
// A slot record shaped like the boundary's, enough for a commitment.
const slot = { version: "bitgraph-slot/1", nonceB64: bytesToBase64(filled(32, 7)), counter: "10", epochId: bytesToBase64(filled(32, 5)), prevB64: bytesToBase64(filled(32, 6)), chainId: "bitgraph:main", allocatedAt: "2026-09-05T00:00:00.000Z", slotHashB64: bytesToBase64(filled(32, 8)), signer: { publicKeyB64: bytesToBase64(filled(32, 1)), signatureB64: bytesToBase64(filled(64, 2)) } } as unknown as Parameters<typeof computeSlotCommitment>[0];

test("the digest is the native SHA-256 whatever the chunking, and the placement is read from the first bytes", async () => {
  for (const [label, make] of [["jpeg", jpeg], ["png", png], ["text", text]] as const) {
    for (const n of [0, 1, 3, 55, 56, 63, 64, 65, 100, 4095, 4096, 4097, 1_000_003]) {
      const b = make(n);
      for (const size of [1, 7, 64, 4096, 1 << 20]) {
        const r = await hashChunks(chunked(b, size), n);
        assert.equal(r.digestB64, bytesToBase64(await native(b)), `${label} ${n} bytes in ${size}-byte chunks`);
        assert.equal(r.bytes, n);
        // The magic decides: a JPEG needs 3 bytes, a PNG 8; text is always a container, and so is anything too short to carry its magic.
        const expected = (label === "jpeg" && n >= 4) || (label === "png" && n >= 8) ? "trailer/1" : "container/2";
        assert.equal(r.placement, expected, `${label} ${n}: placement`);
        assert.ok(r.state !== null, `${label} ${n}: a state for every default placement when the size is known`);
      }
    }
  }
});

test("a trailer/1 state finished with trailerBytesFor(commitment) is the hash of the build, for any commitment, without the bytes", async () => {
  const commitment = computeSlotCommitment(slot);
  const other = filled(32, 99);
  for (const n of [4, 55, 56, 63, 64, 65, 1000, 65_536, 1_000_003]) {
    const b = jpeg(n);
    const r = await hashChunks(chunked(b, 4096), n);
    assert.ok(r.state, "trailer/1 saves a state");
    for (const c of [commitment, other]) {
      const built = getPlacement("trailer/1")!.build({ original: b, commitment: c });
      const finished = await finishState(r.state!, trailerBytesFor(c));
      assert.deepEqual(finished, await native(built), `${n} bytes, commitment ${bytesToBase64(c).slice(0, 6)}`);
    }
    // The state is reusable: finishing it twice gives the same answer.
    assert.deepEqual(await finishState(r.state!, trailerBytesFor(commitment)), await finishState(r.state!, trailerBytesFor(commitment)));
  }
});

test("a container/2 file (text, PDF, video) saves a state too: header and bytes hashed once, finished with the manifest suffix for any commitment", async () => {
  const commitment = computeSlotCommitment(slot);
  const other = filled(32, 99);
  const p = getPlacement("container/2")!;
  for (const n of [1, 511, 512, 513, 5000, 1_000_003]) {
    const b = text(n);
    const r = await hashChunks(chunked(b, 4096), n);
    assert.equal(r.placement, "container/2", `${n}: text goes in the container`);
    assert.ok(r.state, `${n}: a state is saved`);
    assert.equal(r.digestB64, bytesToBase64(await native(b)), `${n}: the origin digest is the file's own`);
    const originDigest = await native(b);
    for (const c of [commitment, other]) {
      const built = p.build({ original: b, originDigest, commitment: c });
      const finished = await finishState(r.state!, p.frame!({ originalSize: n, originDigest, commitment: c }).suffix);
      assert.deepEqual(finished, await native(built), `${n} bytes, commitment ${bytesToBase64(c).slice(0, 6)}`);
    }
  }
  // Without the size no header can be written, so no state; the digest still comes back.
  const blind = await hashChunks(chunked(text(5000), 1024));
  assert.equal(blind.placement, "container/2");
  assert.equal(blind.state, null);
  assert.equal(blind.digestB64, bytesToBase64(await native(text(5000))));
});
