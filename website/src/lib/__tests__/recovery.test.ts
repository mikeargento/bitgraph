/**
 * bitgraph-recovery/1: the formats, the envelope, the plaintext, the tree
 * checks, and the lookup. Every derivation is checked against an independent
 * implementation (node:crypto, and golden values computed with Python's
 * hashlib), and every refusal has its negative case.
 *
 * Run: node --test src/lib/__tests__/recovery.test.ts
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, createHash } from "node:crypto";
import { signAsync } from "@noble/ed25519";
import {
  bytesToBase64,
  bytesToHex,
  canonicalize,
  committedBytesFor,
  computeProofHash,
  encodeTreeLeaves,
  parseTreeRootDocument,
  verifyTreeLeaves,
  decodeTreeLeaves,
} from "@mikeargento/bitgraph-verify";
import {
  ENVELOPE_OVERHEAD,
  MAX_BATCH_ENTRIES,
  MAX_BODY_BYTES,
  MAX_ENVELOPE_BYTES,
  MAX_NAME_BYTES,
  MAX_PLAINTEXT_BYTES,
  RECOVERY_FORMAT,
  RecoveryInputError,
  RecoveryUnavailableError,
  clampRecoveryName,
  encodeRecoveryPlaintext,
  existingEntryHoldsMember,
  fetchRecoveredProof,
  findOwnRecoveryEntry,
  newRecoverySalt,
  recoveryObjectKeyFor,
  openRecoveryEnvelope,
  parseRecoveryObjectKey,
  parseRecoveryPlaintext,
  recoverFromDigest,
  recoverFromDigests,
  recoveryAddress,
  recoveryEntryId,
  recoveryKeyBytes,
  recoveryObjectKey,
  recoveryPlaintextFor,
  recoveryTreeFrom,
  recoveryTreeFromParts,
  sameRecoveryMember,
  sealRecoveryEnvelope,
  sealRecoveryMember,
  type RecoveryPlaintext,
} from "../recovery.ts";
import { MemoryRecoveryStore, handleRecoveryPost } from "../recovery-store.ts";
import { fakeFetch, sha256, syntheticTree, utf8, vectorTree } from "./recovery-helpers.ts";

const nodeSha = (...parts: Uint8Array[]) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
};
/** A shallow copy of `o` without `key`. */
const without = (o: object, key: string): Record<string, unknown> => {
  const copy: Record<string, unknown> = { ...o };
  delete copy[key];
  return copy;
};
const u32 = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
};

/** Write every entry of every member of a tree into `store` through the route's handler. */
async function writeTree(store: MemoryRecoveryStore, t: { proof: never | unknown; rootDocument: Uint8Array; leavesBytes: Uint8Array; names: string[] }) {
  const tree = recoveryTreeFrom({ proof: t.proof as never, rootDocument: t.rootDocument, leavesBytes: t.leavesBytes });
  const entries: Array<{ key: string; envelope: string }> = [];
  for (let i = 0; i < tree.count; i++) {
    const { writes } = await sealRecoveryMember(tree, i, t.names[i]);
    for (const w of writes) entries.push({ key: w.objectKey, envelope: bytesToBase64(w.envelope) });
  }
  const r = await handleRecoveryPost(JSON.stringify({ entries }), store, { sleep: async () => {}, log: () => {} });
  assert.equal(r.status, 200);
  return { tree, entries };
}

describe("derivations", () => {
  test("address, key and entry id match golden values computed independently (Python hashlib)", () => {
    const d = Uint8Array.from({ length: 32 }, (_, i) => i);
    const ph = Uint8Array.from({ length: 32 }, (_, i) => 32 + i);
    assert.equal(recoveryAddress(d), "a49ab5d974328ed43d6e7f4999f09791237bd0d1920f660ca3622beeb4de7dbd");
    assert.equal(bytesToHex(recoveryKeyBytes(d)), "c781a5675920e7ff3e49b8c1a8eb3d5d8a84d55dd76dc14dfcca5c0026ff47a3");
    assert.equal(recoveryEntryId(d, ph, 258), "05aaa3ad1382ea09b8bbdd070d09c165cbdb245461d994a4b62a7158df985ea2");
  });

  test("they match node:crypto over the documented preimages for many digests, and the digest is RAW bytes, not text", () => {
    for (let n = 0; n < 50; n++) {
      const d = sha256(utf8(`file ${n}`));
      const ph = sha256(utf8(`proof ${n}`));
      assert.equal(recoveryAddress(d), nodeSha(utf8("bitgraph-lookup"), d).toString("hex"));
      assert.deepEqual(Buffer.from(recoveryKeyBytes(d)), nodeSha(utf8("bitgraph-lookup-key"), d));
      assert.equal(recoveryEntryId(d, ph, n * 7919), nodeSha(utf8("bitgraph-lookup-entry"), d, ph, u32(n * 7919)).toString("hex"));
      // Hashing the hex or base64 text instead would be a different address.
      assert.notEqual(recoveryAddress(d), nodeSha(utf8("bitgraph-lookup"), utf8(bytesToHex(d))).toString("hex"));
    }
  });

  test("the address, the key and the entry id of one digest are three different values", () => {
    const d = sha256(utf8("x"));
    const ph = sha256(utf8("p"));
    const vals = new Set([recoveryAddress(d), bytesToHex(recoveryKeyBytes(d)), recoveryEntryId(d, ph, 0)]);
    assert.equal(vals.size, 3);
  });

  test("bad inputs are refused, not hashed", () => {
    assert.throws(() => recoveryAddress(new Uint8Array(31)), TypeError);
    assert.throws(() => recoveryKeyBytes(new Uint8Array(33)), TypeError);
    assert.throws(() => recoveryEntryId(new Uint8Array(32), new Uint8Array(31), 0), TypeError);
    assert.throws(() => recoveryEntryId(new Uint8Array(32), new Uint8Array(32), -1), RangeError);
    assert.throws(() => recoveryEntryId(new Uint8Array(32), new Uint8Array(32), 2 ** 32), RangeError);
    assert.throws(() => recoveryEntryId(new Uint8Array(32), new Uint8Array(32), 1.5), RangeError);
    assert.ok(recoveryEntryId(new Uint8Array(32), new Uint8Array(32), 0xffffffff));
  });

  test("an object key is recovery/v1/<address>/<entryId>, and only that parses", () => {
    const a = "ab".repeat(32), e = "cd".repeat(32);
    const key = recoveryObjectKey(a, e);
    assert.equal(key, `recovery/v1/${a}/${e}`);
    assert.deepEqual(parseRecoveryObjectKey(key), { address: a, entryId: e });
    for (const bad of [key.toUpperCase(), `recovery/v2/${a}/${e}`, `recovery/v1/${a}`, `recovery/v1/${a}/${e}/`, `/recovery/v1/${a}/${e}`, `recovery/v1/${a.slice(2)}/${e}`, `recovery/v1/../${e}`, 42, null]) {
      assert.equal(parseRecoveryObjectKey(bad), null, String(bad));
    }
    assert.throws(() => recoveryObjectKey(a.toUpperCase(), e), TypeError);
  });

  test("100,000 entries' address, key and entry id derive in well under a second's budget per 10,000", () => {
    const ph = sha256(utf8("one recording"));
    const t0 = performance.now();
    const seen = new Set<string>();
    for (let i = 0; i < 100_000; i++) {
      const d = new Uint8Array(32);
      new DataView(d.buffer).setUint32(0, i);
      seen.add(recoveryAddress(d));
      recoveryKeyBytes(d);
      recoveryEntryId(d, ph, i);
    }
    const ms = performance.now() - t0;
    console.log(`# 100,000 x (address + key + entry id): ${ms.toFixed(0)} ms`);
    assert.equal(seen.size, 100_000, "no two digests share an address");
    assert.ok(ms < 10_000, `took ${ms} ms`);
  });
});

describe("the envelope", () => {
  const d = sha256(utf8("the file"));
  const ph = sha256(utf8("the proof"));
  const key = recoveryObjectKey(recoveryAddress(d), recoveryEntryId(d, ph, 3));
  const plaintext = utf8(JSON.stringify({ any: "bytes the envelope does not read" }));

  test("seal and open round-trip; the layout is 0x01 || nonce(12) || ciphertext || tag(16)", async () => {
    const env = await sealRecoveryEnvelope(recoveryKeyBytes(d), key, plaintext);
    assert.equal(env[0], 0x01);
    assert.equal(env.length, ENVELOPE_OVERHEAD + plaintext.length);
    assert.deepEqual(await openRecoveryEnvelope(recoveryKeyBytes(d), key, env), plaintext);
  });

  test("an independent AES-256-GCM (node:crypto) opens it with the object key as AAD", async () => {
    const env = await sealRecoveryEnvelope(recoveryKeyBytes(d), key, plaintext);
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(recoveryKeyBytes(d)), Buffer.from(env.subarray(1, 13)));
    decipher.setAAD(Buffer.from(utf8(key)));
    decipher.setAuthTag(Buffer.from(env.subarray(env.length - 16)));
    const out = Buffer.concat([decipher.update(Buffer.from(env.subarray(13, env.length - 16))), decipher.final()]);
    assert.deepEqual(new Uint8Array(out), plaintext);
  });

  test("AAD binding: the same envelope moved to any other key does not open", async () => {
    const env = await sealRecoveryEnvelope(recoveryKeyBytes(d), key, plaintext);
    const sibling = recoveryObjectKey(recoveryAddress(d), recoveryEntryId(d, ph, 4));
    const elsewhere = recoveryObjectKey(recoveryAddress(sha256(utf8("other"))), recoveryEntryId(d, ph, 3));
    assert.equal(await openRecoveryEnvelope(recoveryKeyBytes(d), sibling, env), null, "another entry under the same address");
    assert.equal(await openRecoveryEnvelope(recoveryKeyBytes(d), elsewhere, env), null, "another address");
  });

  test("a different digest's key does not open it", async () => {
    const env = await sealRecoveryEnvelope(recoveryKeyBytes(d), key, plaintext);
    assert.equal(await openRecoveryEnvelope(recoveryKeyBytes(sha256(utf8("not the file"))), key, env), null);
  });

  test("the version byte is checked, and every tampered byte fails", async () => {
    const env = await sealRecoveryEnvelope(recoveryKeyBytes(d), key, plaintext);
    for (const v of [0x00, 0x02, 0xff]) {
      const bad = env.slice();
      bad[0] = v;
      assert.equal(await openRecoveryEnvelope(recoveryKeyBytes(d), key, bad), null, `version ${v}`);
    }
    for (const at of [1, 12, 13, env.length - 17, env.length - 1]) {
      const bad = env.slice();
      bad[at]! ^= 0x01;
      assert.equal(await openRecoveryEnvelope(recoveryKeyBytes(d), key, bad), null, `byte ${at}`);
    }
    assert.equal(await openRecoveryEnvelope(recoveryKeyBytes(d), key, env.subarray(0, ENVELOPE_OVERHEAD)), null, "no ciphertext");
    const long = new Uint8Array(MAX_ENVELOPE_BYTES + 1);
    long[0] = 1;
    assert.equal(await openRecoveryEnvelope(recoveryKeyBytes(d), key, long), null, "over the cap");
  });

  test("nonces are fresh: the same plaintext sealed twice gives two different envelopes", async () => {
    const a = await sealRecoveryEnvelope(recoveryKeyBytes(d), key, plaintext);
    const b = await sealRecoveryEnvelope(recoveryKeyBytes(d), key, plaintext);
    assert.notDeepEqual(a.subarray(1, 13), b.subarray(1, 13));
    assert.notDeepEqual(a, b);
    const nonces = new Set<string>();
    for (let i = 0; i < 200; i++) nonces.add(bytesToHex((await sealRecoveryEnvelope(recoveryKeyBytes(d), key, plaintext)).subarray(1, 13)));
    assert.equal(nonces.size, 200);
  });

  test("sealing refuses a bad key, an empty or oversized plaintext and a malformed object key", async () => {
    await assert.rejects(sealRecoveryEnvelope(new Uint8Array(16), key, plaintext), TypeError);
    await assert.rejects(sealRecoveryEnvelope(recoveryKeyBytes(d), key, new Uint8Array(0)), RangeError);
    await assert.rejects(sealRecoveryEnvelope(recoveryKeyBytes(d), key, new Uint8Array(MAX_PLAINTEXT_BYTES + 1)), RangeError);
    await assert.rejects(sealRecoveryEnvelope(recoveryKeyBytes(d), "recovery/v1/x", plaintext), TypeError);
    assert.equal((await sealRecoveryEnvelope(recoveryKeyBytes(d), key, new Uint8Array(MAX_PLAINTEXT_BYTES))).length, MAX_ENVELOPE_BYTES);
  });
});

describe("a tree, its members and their plaintexts", () => {
  test("the vector's five members: placed files are filed twice, the as-is file once, under distinct keys", async () => {
    const v = vectorTree();
    const tree = recoveryTreeFrom({ proof: v.proof, rootDocument: v.rootDocument, leavesBytes: v.leavesBytes });
    const leaves = decodeTreeLeaves(v.leavesBytes)!;
    const keys = new Set<string>();
    for (let i = 0; i < tree.count; i++) {
      const { plaintext, writes } = await sealRecoveryMember(tree, i, v.names[i]);
      assert.equal(writes.length, leaves[i]!.placement === 0 ? 1 : 2, `member ${i}`);
      assert.equal(plaintext.leafIndex, i);
      assert.equal(plaintext.name, v.names[i]);
      for (const w of writes) {
        keys.add(w.objectKey);
        const digest = w.side === "artifact" ? leaves[i]!.artifact : leaves[i]!.origin;
        assert.deepEqual(w.digest, digest);
        assert.equal(w.objectKey, recoveryObjectKey(recoveryAddress(digest), recoveryEntryId(digest, tree.proofHash32, i)));
        const opened = await openRecoveryEnvelope(recoveryKeyBytes(digest), w.objectKey, w.envelope);
        assert.ok(opened);
        assert.ok(sameRecoveryMember(parseRecoveryPlaintext(opened)!, plaintext));
      }
      if (writes.length === 2) assert.notDeepEqual(writes[0]!.envelope.subarray(1, 13), writes[1]!.envelope.subarray(1, 13), "each entry has its own nonce");
    }
    assert.equal(keys.size, 9);
  });

  test("the entry id differs per member and per recording, and a rewrite lands on the same key", async () => {
    const hello = utf8("hello\n");
    const a = syntheticTree([{ name: "hello.txt", original: hello, code: 0x00 }, { name: "b.txt", original: utf8("b\n"), code: 0x00 }], "10");
    const b = syntheticTree([{ name: "hello.txt", original: hello, code: 0x00 }, { name: "c.txt", original: utf8("c\n"), code: 0x00 }], "20");
    const ta = recoveryTreeFrom({ proof: a.proof, leavesBytes: a.leavesBytes });
    const tb = recoveryTreeFrom({ proof: b.proof, leavesBytes: b.leavesBytes });
    const idx = (t: typeof a) => t.names.indexOf("hello.txt");
    const first = await sealRecoveryMember(ta, idx(a), "hello.txt");
    const again = await sealRecoveryMember(ta, idx(a), "hello.txt");
    const other = await sealRecoveryMember(tb, idx(b), "hello.txt");
    const sibling = await sealRecoveryMember(ta, 1 - idx(a), "b.txt");
    assert.equal(first.writes[0]!.objectKey, again.writes[0]!.objectKey, "stable across rewrites");
    assert.notDeepEqual(first.writes[0]!.envelope, again.writes[0]!.envelope, "fresh nonce on the rewrite");
    assert.notEqual(first.writes[0]!.objectKey, other.writes[0]!.objectKey, "another recording of the same file");
    assert.equal(parseRecoveryObjectKey(first.writes[0]!.objectKey)!.address, parseRecoveryObjectKey(other.writes[0]!.objectKey)!.address, "same file, same address");
    assert.notEqual(first.writes[0]!.objectKey, sibling.writes[0]!.objectKey, "another member of the same tree");
    // Two leaves of ONE tree with the same origin (one original under two placements): same address, two keys.
    const twice = syntheticTree([{ name: "x", original: hello, code: 0x01 }, { name: "x", original: hello, code: 0x02 }], "30");
    const tt = recoveryTreeFrom({ proof: twice.proof, leavesBytes: twice.leavesBytes });
    const k0 = (await sealRecoveryMember(tt, 0, null, ["origin"])).writes[0]!.objectKey;
    const k1 = (await sealRecoveryMember(tt, 1, null, ["origin"])).writes[0]!.objectKey;
    assert.equal(parseRecoveryObjectKey(k0)!.address, parseRecoveryObjectKey(k1)!.address);
    assert.notEqual(k0, k1);
  });

  test("the plaintext is section 2 canonical JSON and parses back", () => {
    const v = vectorTree();
    const tree = recoveryTreeFrom({ proof: v.proof, rootDocument: v.rootDocument, leavesBytes: v.leavesBytes });
    const { plaintext, bytes } = recoveryPlaintextFor(tree, 1, "hello.txt");
    const text = new TextDecoder().decode(bytes);
    // Canonical JSON (SPEC section 2): sorted keys at every level, and the very bytes canonicalize() gives.
    assert.deepEqual(Object.keys(JSON.parse(text)), ["format", "leafIndex", "member", "name", "proof", "proofHash", "rootDocument"]);
    assert.deepEqual(Object.keys(JSON.parse(text).member), ["count", "index", "leaf", "path"]);
    assert.deepEqual(Object.keys(JSON.parse(text).proof), ["artifactDigestB64", "counter", "epochId"]);
    assert.deepEqual(bytes, canonicalize(plaintext), "the bytes are section 2's canonicalization of the plaintext");
    assert.equal(plaintext.format, RECOVERY_FORMAT);
    assert.equal(plaintext.proof.artifactDigestB64, v.proof.artifact.digestB64);
    assert.equal(plaintext.proof.epochId, v.proof.commit.epochId);
    assert.equal(plaintext.proof.counter, v.proof.commit.counter);
    assert.equal(plaintext.rootDocument, bytesToHex(v.rootDocument));
    assert.deepEqual(parseRecoveryPlaintext(bytes), plaintext);
    assert.deepEqual(encodeRecoveryPlaintext(parseRecoveryPlaintext(bytes)!), bytes);
  });

  test("the plaintext parse is strict: each deviation is refused", () => {
    const v = vectorTree();
    const tree = recoveryTreeFrom({ proof: v.proof, rootDocument: v.rootDocument, leavesBytes: v.leavesBytes });
    const good = recoveryPlaintextFor(tree, 1, "hello.txt").plaintext;
    const enc = (o: unknown) => utf8(JSON.stringify(o));
    const otherDoc = new Uint8Array(v.rootDocument);
    otherDoc[60]! ^= 1;
    const cases: Array<[string, unknown]> = [
      ["extra key", { ...good, extra: 1 }],
      ["missing key", without(good, "proof")],
      ["format", { ...good, format: "bitgraph-recovery/2" }],
      ["leafIndex disagrees", { ...good, leafIndex: 2 }],
      ["leafIndex as text", { ...good, leafIndex: "1" }],
      ["proofHash short", { ...good, proofHash: bytesToBase64(new Uint8Array(31)) }],
      ["rootDocument uppercase", { ...good, rootDocument: good.rootDocument.toUpperCase() }],
      ["rootDocument another", { ...good, rootDocument: bytesToHex(otherDoc) }],
      ["path does not reach the root", { ...good, member: { ...good.member, path: [good.member.path[0]!.replace(/^./, (c) => (c === "0" ? "1" : "0")), ...good.member.path.slice(1)] } }],
      ["count disagrees", { ...good, member: { ...good.member, count: 6 } }],
      ["locator digest is not the document's", { ...good, proof: { ...good.proof, artifactDigestB64: bytesToBase64(new Uint8Array(32)) } }],
      ["counter not decimal", { ...good, proof: { ...good.proof, counter: "6a" } }],
      ["locator extra key", { ...good, proof: { ...good.proof, slot: 1 } }],
      ["name empty", { ...good, name: "" }],
      ["name over the cap", { ...good, name: "x".repeat(MAX_NAME_BYTES + 1) }],
      ["name not text", { ...good, name: 5 }],
      ["an array", [good]],
    ];
    for (const [why, o] of cases) assert.equal(parseRecoveryPlaintext(enc(o)), null, why);
    assert.equal(parseRecoveryPlaintext(new Uint8Array([0xff, 0xfe, 0x7b])), null, "not UTF-8");
    assert.equal(parseRecoveryPlaintext(utf8("{")), null, "not JSON");
    assert.ok(parseRecoveryPlaintext(enc(without(good, "name"))), "the name is optional");
  });

  test("sameRecoveryMember compares everything but the advisory name", () => {
    const v = vectorTree();
    const tree = recoveryTreeFrom({ proof: v.proof, rootDocument: v.rootDocument, leavesBytes: v.leavesBytes });
    const p = recoveryPlaintextFor(tree, 1, "hello.txt").plaintext;
    const flip = (h: string) => (h[0] === "0" ? "1" : "0") + h.slice(1);
    assert.ok(sameRecoveryMember(p, { ...p }));
    assert.ok(sameRecoveryMember(p, { ...p, name: "renamed.txt" }), "names are advisory");
    const variants: RecoveryPlaintext[] = [
      { ...p, proofHash: bytesToBase64(new Uint8Array(32)) },
      { ...p, leafIndex: 2 },
      { ...p, rootDocument: flip(p.rootDocument) },
      { ...p, member: { ...p.member, path: [flip(p.member.path[0]!), ...p.member.path.slice(1)] } },
      { ...p, member: { ...p.member, path: p.member.path.slice(1) } },
      { ...p, member: { ...p.member, leaf: flip(p.member.leaf) } },
      { ...p, proof: { ...p.proof, counter: "7" } },
      { ...p, proof: { ...p.proof, epochId: bytesToBase64(new Uint8Array(32)) } },
    ];
    for (const x of variants) assert.ok(!sameRecoveryMember(p, x));
  });

  test("names: a long one keeps its tail inside 512 bytes; one that would overflow the plaintext is dropped, never the entry", () => {
    assert.equal(clampRecoveryName(""), undefined);
    assert.equal(clampRecoveryName(null), undefined);
    assert.equal(clampRecoveryName("photo.jpg"), "photo.jpg");
    const long = `${"folder/".repeat(100)}IMG_0001.HEIC`;
    const c = clampRecoveryName(long)!;
    assert.ok(utf8(c).length <= MAX_NAME_BYTES);
    assert.ok(c.startsWith("…") && c.endsWith("/IMG_0001.HEIC"));
    const emoji = clampRecoveryName("😀".repeat(200))!;
    assert.ok(utf8(emoji).length <= MAX_NAME_BYTES && !emoji.includes("�"), "never cuts a code point");
    // 512 control characters escape to 3,072 bytes of JSON. Beside a short
    // path (the vector's five leaves) that still fits and the name is kept;
    // beside a 12-node path (4,096 leaves) it does not, and only the name goes.
    const controls = "\u0001".repeat(MAX_NAME_BYTES);
    const v = vectorTree();
    const small = recoveryTreeFrom({ proof: v.proof, rootDocument: v.rootDocument, leavesBytes: v.leavesBytes });
    assert.equal(recoveryPlaintextFor(small, 1, controls).plaintext.name, controls);
    const files = Array.from({ length: 4096 }, (_, i) => ({ name: `f${i}`, original: utf8(`file ${i}`), code: 0x00 }));
    const big = syntheticTree(files, "4096");
    const deep = recoveryTreeFrom({ proof: big.proof, leavesBytes: big.leavesBytes });
    const r = recoveryPlaintextFor(deep, 4095, controls);
    assert.equal(r.plaintext.member.path.length, 12);
    assert.equal(r.plaintext.name, undefined, "the name goes, the entry stays");
    assert.ok(r.bytes.length <= MAX_PLAINTEXT_BYTES);
    assert.equal(recoveryPlaintextFor(deep, 4095, "IMG_0001.HEIC").plaintext.name, "IMG_0001.HEIC", "an ordinary name is kept");
  });

  test("the largest honest plaintext fits: a 1,000,000-leaf path, the longest locator and a 512-byte name", () => {
    const p: RecoveryPlaintext = {
      format: RECOVERY_FORMAT,
      proofHash: bytesToBase64(new Uint8Array(32).fill(0xff)),
      leafIndex: 999_999,
      rootDocument: "ab".repeat(84),
      member: { index: 999_999, count: 1_000_000, leaf: "cd".repeat(65), path: Array.from({ length: 20 }, () => "ef".repeat(32)) },
      proof: { epochId: "A".repeat(126) + "==", counter: "9".repeat(20), artifactDigestB64: bytesToBase64(new Uint8Array(32)) },
      name: '"'.repeat(MAX_NAME_BYTES), // every byte escaped: the worst printable case
    };
    const n = encodeRecoveryPlaintext(p).length;
    console.log(`# largest honest plaintext: ${n} bytes (cap ${MAX_PLAINTEXT_BYTES})`);
    assert.ok(n <= MAX_PLAINTEXT_BYTES);
  });

  test("a full batch of the largest envelopes fits the body cap and Vercel's 4.5 MB, both ways", () => {
    const keyLen = "recovery/v1/".length + 64 + 1 + 64;
    const perEntry = `{"key":"","envelope":""},`.length + keyLen + Math.ceil(MAX_ENVELOPE_BYTES / 3) * 4;
    const request = `{"entries":[]}`.length + MAX_BATCH_ENTRIES * perEntry;
    const response = `{"results":[]}`.length + MAX_BATCH_ENTRIES * (perEntry + `"status":"exists",`.length);
    assert.ok(request <= MAX_BODY_BYTES, `request ${request}`);
    assert.ok(response <= 4.5 * 1024 * 1024, `response ${response}`);
  });

  test("a list that does not rebuild the committed root is refused before anything is sealed, exactly where verifyTreeLeaves refuses it", () => {
    const v = vectorTree();
    const parts = { proofHash: bytesToBase64(sha256(utf8("p"))), locator: { epochId: v.proof.commit.epochId!, counter: v.proof.commit.counter!, artifactDigestB64: v.proof.artifact.digestB64 }, rootDocument: v.rootDocument };
    assert.ok(verifyTreeLeaves(v.rootDocument, v.leavesBytes).ok);
    assert.equal(recoveryTreeFromParts({ ...parts, leaves: v.leavesBytes }).count, 5);
    const leaves = decodeTreeLeaves(v.leavesBytes)!;
    const swapped = encodeTreeLeaves([leaves[1]!, leaves[0]!, ...leaves.slice(2)]);
    const dup = encodeTreeLeaves([leaves[0]!, leaves[0]!, ...leaves.slice(2)]);
    const flipped = v.leavesBytes.slice();
    flipped[65 * 3 + 40]! ^= 1;
    const badCode = v.leavesBytes.slice();
    badCode[0] = 0x09;
    for (const [why, bad] of [["out of order", swapped], ["duplicate", dup], ["root mismatch", flipped], ["bad placement", badCode], ["count mismatch", v.leavesBytes.subarray(0, 65 * 4)], ["ragged", v.leavesBytes.subarray(0, 100)]] as const) {
      assert.equal(verifyTreeLeaves(v.rootDocument, bad).ok, false, `verifyTreeLeaves: ${why}`);
      assert.throws(() => recoveryTreeFromParts({ ...parts, leaves: bad }), RecoveryInputError, why);
    }
    assert.throws(() => recoveryTreeFromParts({ ...parts, leaves: v.leavesBytes, locator: { ...parts.locator, artifactDigestB64: bytesToBase64(new Uint8Array(32)) } }), /does not hash/);
    assert.throws(() => recoveryTreeFromParts({ ...parts, leaves: v.leavesBytes, proofHash: "nope" }), RecoveryInputError);
    assert.throws(() => recoveryTreeFrom({ proof: { ...v.proof, attribution: { ...v.proof.attribution!, title: "set/2" } }, leavesBytes: v.leavesBytes }), /tree\/1/);
    assert.throws(() => recoveryTreeFrom({ proof: { ...v.proof, commit: { ...v.proof.commit, counter: undefined } }, leavesBytes: v.leavesBytes }), /position/);
    assert.throws(() => recoveryTreeFrom({ proof: { ...v.proof, metadata: {} } }), /root document/);
  });
});

describe("lookup", () => {
  test("recoverFromDigest returns both recordings of one file, and each binds back to its proof", async () => {
    const v = vectorTree();
    const store = new MemoryRecoveryStore();
    const { tree: tv } = await writeTree(store, v);
    // The same hello.txt recorded again, in another tree under another position.
    const second = syntheticTree([{ name: "hello again.txt", original: v.memberFile, code: 0x01 }, { name: "other.txt", original: utf8("other\n"), code: 0x02 }], "900");
    const { tree: ts } = await writeTree(store, second);
    const fetchFn = fakeFetch(store);

    const found = await recoverFromDigest(sha256(v.memberFile), fetchFn);
    assert.equal(found.length, 2, "two recordings of hello.txt");
    assert.deepEqual(new Set(found.map((f) => f.proofHash)), new Set([tv.proofHash, ts.proofHash]));
    for (const f of found) assert.equal(f.matched, "origin");
    const fromVector = found.find((f) => f.proofHash === tv.proofHash)!;
    assert.equal(fromVector.name, "hello.txt");
    assert.equal(fromVector.leafIndex, 1);
    assert.equal(fromVector.rootDocument, bytesToHex(v.rootDocument));
    assert.equal(found.find((f) => f.proofHash === ts.proofHash)!.name, "hello again.txt");

    // By the committed bytes: only the recording those bytes belong to.
    const doc = parseTreeRootDocument(v.rootDocument)!;
    const committed = committedBytesFor(0x01, v.memberFile, doc.commitment);
    const byArtifact = await recoverFromDigest(sha256(committed), fetchFn);
    assert.equal(byArtifact.length, 1);
    assert.equal(byArtifact[0]!.matched, "artifact");
    assert.equal(byArtifact[0]!.proofHash, tv.proofHash);

    // The as-is member, by its one digest.
    const asIs = decodeTreeLeaves(v.leavesBytes)!.findIndex((l) => l.placement === 0);
    const asIsFound = await recoverFromDigest(decodeTreeLeaves(v.leavesBytes)![asIs]!.origin, fetchFn);
    assert.equal(asIsFound.length, 1);
    assert.equal(asIsFound[0]!.matched, "as-is");

    // Nothing kept for bytes never recorded: an answer, empty.
    assert.deepEqual(await recoverFromDigest(sha256(utf8("never recorded")), fetchFn), []);

    // The proof comes back from the public route, bound by proof hash, and verifies.
    const proofsFetch = fakeFetch(store, { proofs: [second.proof, v.proof] });
    const bound = await fetchRecoveredProof(fromVector, proofsFetch, { extraSpecHashes: [v.specHash], trust: "none" });
    assert.ok(bound);
    assert.equal(bound.check.category, "TREE_PATH_VALID", bound.check.reason);
    const withFile = await fetchRecoveredProof(fromVector, proofsFetch, { bytes: v.memberFile, extraSpecHashes: [v.specHash], trust: "none" });
    assert.equal(withFile!.check.category, "TREE_MEMBER_FROM_ORIGIN", withFile!.check.reason);
    const withCommitted = await fetchRecoveredProof(byArtifact[0]!, proofsFetch, { bytes: committed, extraSpecHashes: [v.specHash], trust: "none" });
    assert.equal(withCommitted!.check.category, "TREE_MEMBER_DIRECT", withCommitted!.check.reason);
    // A route that has no proof with this proof hash: null, not a verdict.
    assert.equal(await fetchRecoveredProof(fromVector, fakeFetch(store, { proofs: [] }), { trust: "none" }), null);
    await assert.rejects(fetchRecoveredProof(fromVector, fakeFetch(store, { status: 503 })), RecoveryUnavailableError);
    // The default trust: a proof whose attestation is a stub is nobody's recording, whatever served it.
    assert.equal(await fetchRecoveredProof(fromVector, proofsFetch, { extraSpecHashes: [v.specHash] }), null, "the TEST vector's stub attestation does not pass the published-image policy");
    // A proof answer that is not { proofs } is a failed read, never "no proof".
    const malformed = async (u: string, init?: RequestInit) => (u.startsWith("/api/proofs/") ? new Response(JSON.stringify({ error: "temporarily unavailable" }), { status: 200 }) : fakeFetch(store)(u, init));
    await assert.rejects(fetchRecoveredProof(fromVector, malformed, { trust: "none" }), RecoveryUnavailableError);
  });

  test("pages are followed to the end", async () => {
    const store = new MemoryRecoveryStore();
    const file = utf8("a file recorded five times\n");
    for (let n = 0; n < 5; n++) await writeTree(store, syntheticTree([{ name: `copy ${n}`, original: file, code: 0x00 }], String(100 + n)));
    const calls: string[] = [];
    const found = await recoverFromDigest(sha256(file), fakeFetch(store, { limit: 2, calls }));
    assert.equal(found.length, 5);
    assert.equal(calls.length, 3, "2 + 2 + 1");
    assert.match(calls[1]!, /\?after=[0-9a-f]{64}$/);
  });

  test("entries that do not authenticate, sit under the wrong id, or name another leaf are skipped, not shown", async () => {
    const v = vectorTree();
    const store = new MemoryRecoveryStore();
    const { tree } = await writeTree(store, v);
    const d = sha256(v.memberFile);
    const address = recoveryAddress(d);
    const good = await recoveryPlaintextFor(tree, 1, "hello.txt");
    // 1. Bytes that are not an envelope under this key.
    const junk = new Uint8Array(200);
    junk[0] = 1;
    store.objects.set(recoveryObjectKey(address, "11".repeat(32)), junk);
    // 2. A genuine envelope copied to another key (AAD mismatch).
    const genuineKey = recoveryObjectKey(address, recoveryEntryId(d, tree.proofHash32, 1));
    store.objects.set(recoveryObjectKey(address, "22".repeat(32)), store.objects.get(genuineKey)!);
    // 3. Sealed by someone who knows the digest, under an id its contents do not derive.
    const wrongIdKey = recoveryObjectKey(address, "33".repeat(32));
    store.objects.set(wrongIdKey, await sealRecoveryEnvelope(recoveryKeyBytes(d), wrongIdKey, good.bytes));
    // 4. Sealed correctly by someone who knows the digest, but holding a member whose leaf is not this file.
    const other = recoveryPlaintextFor(tree, 3, "note.md");
    const otherKey = recoveryObjectKey(address, recoveryEntryId(d, tree.proofHash32, 3));
    store.objects.set(otherKey, await sealRecoveryEnvelope(recoveryKeyBytes(d), otherKey, other.bytes));
    // 5. A plaintext that is not a recovery entry at all.
    const notOursKey = recoveryObjectKey(address, recoveryEntryId(d, tree.proofHash32, 4));
    store.objects.set(notOursKey, await sealRecoveryEnvelope(recoveryKeyBytes(d), notOursKey, utf8('{"hello":"world"}')));

    const found = await recoverFromDigest(d, fakeFetch(store));
    assert.equal(found.length, 1, "only the genuine entry");
    assert.equal(found[0]!.objectKey, genuineKey);
  });

  test("more than 200 distinct members listed under one address is unknown, never bound one by one; 200 is still an answer", async () => {
    const store = new MemoryRecoveryStore();
    const file = utf8("a file recorded very many times\n");
    const d = sha256(file);
    // 201 recordings of the same as-is file, each a tree of one under its own position: 201 valid entries under one address.
    for (let n = 0; n < 201; n++) await writeTree(store, syntheticTree([{ name: "copy", original: file, code: 0x00 }], String(10_000 + n)));
    await assert.rejects(recoverFromDigest(d, fakeFetch(store)), /more than 200 members/);
    const [answer] = await recoverFromDigests([d], fakeFetch(store));
    assert.equal(answer!.ok, false);
    assert.match((answer as { reason: string }).reason, /more than 200 members/);
    // Another file recorded 200 times is answered in full.
    const other = utf8("recorded two hundred times\n");
    for (let n = 0; n < 200; n++) await writeTree(store, syntheticTree([{ name: "copy", original: other, code: 0x00 }], String(20_000 + n)));
    assert.equal((await recoverFromDigest(sha256(other), fakeFetch(store))).length, 200);
  });

  test("a failed read is never an empty answer", async () => {
    const store = new MemoryRecoveryStore();
    const d = sha256(utf8("anything"));
    await assert.rejects(recoverFromDigest(d, fakeFetch(store, { status: 503 })), RecoveryUnavailableError);
    await assert.rejects(recoverFromDigest(d, async () => new Response("<html>", { status: 200 })), RecoveryUnavailableError);
    await assert.rejects(recoverFromDigest(d, async () => { throw new TypeError("offline"); }), RecoveryUnavailableError);
    await assert.rejects(recoverFromDigest(d, async () => new Response(JSON.stringify({ entries: [] }), { status: 200 })), RecoveryUnavailableError, "no next field");
    store.failing = true;
    await assert.rejects(recoverFromDigest(d, fakeFetch(store)), RecoveryUnavailableError, "a store that cannot be read answers 503");
    // A cursor that does not advance is a server fault, not an endless loop.
    const stuck = async () => new Response(JSON.stringify({ entries: [], next: "00".repeat(32) }), { status: 200 });
    await assert.rejects(recoverFromDigest(d, stuck), /does not advance/);
    // A route that is not there (a rollback, a routing fault) says nothing about the entries behind it.
    await assert.rejects(recoverFromDigest(d, async () => new Response("not found", { status: 404 })), RecoveryUnavailableError, "404 is a failed read");
    const [viaBatch] = await recoverFromDigests([d], async () => new Response("not found", { status: 404 }));
    assert.equal(viaBatch!.ok, false, "and through the batch route's fallback too");
    // A listed item that is not { key, envelope } is the server's fault, never a candidate to skip.
    const junkItem = async () => new Response(JSON.stringify({ entries: [{}], next: null }), { status: 200 });
    await assert.rejects(recoverFromDigest(d, junkItem), RecoveryUnavailableError, "a malformed listing item is a failed read");
  });

  test("existingEntryHoldsMember: only this member's own entry counts, whatever else sits at the key", async () => {
    const v = vectorTree();
    const tree = recoveryTreeFrom({ proof: v.proof, rootDocument: v.rootDocument, leavesBytes: v.leavesBytes });
    const mine = await sealRecoveryMember(tree, 1, "hello.txt", ["origin"]);
    const w = mine.writes[0]!;
    const sealAt = (pt: Uint8Array) => sealRecoveryEnvelope(recoveryKeyBytes(w.digest), w.objectKey, pt);
    assert.ok(await existingEntryHoldsMember(w.digest, w.objectKey, w.envelope, mine.plaintext), "its own envelope");
    assert.ok(await existingEntryHoldsMember(w.digest, w.objectKey, await sealAt(encodeRecoveryPlaintext({ ...mine.plaintext, name: "other name" })), mine.plaintext), "same member, another name");
    const otherMember = recoveryPlaintextFor(tree, 3, "note.md").bytes;
    assert.ok(!(await existingEntryHoldsMember(w.digest, w.objectKey, await sealAt(otherMember), mine.plaintext)), "another member of the same tree");
    // The design's first test (proof hash and leaf index only) would accept this one.
    const flip = (h: string) => (h[0] === "0" ? "1" : "0") + h.slice(1);
    const sameNumbersWrongPath = utf8(JSON.stringify({ ...mine.plaintext, member: { ...mine.plaintext.member, path: [flip(mine.plaintext.member.path[0]!), ...mine.plaintext.member.path.slice(1)] } }));
    assert.ok(!(await existingEntryHoldsMember(w.digest, w.objectKey, await sealAt(sameNumbersWrongPath), mine.plaintext)), "right proof hash and index around a wrong path");
    const sameNumbersWrongLocator = encodeRecoveryPlaintext({ ...mine.plaintext, proof: { ...mine.plaintext.proof, counter: "99" } });
    assert.ok(!(await existingEntryHoldsMember(w.digest, w.objectKey, await sealAt(sameNumbersWrongLocator), mine.plaintext)), "right proof hash and index, wrong locator");
    // The strongest squat: a whole tree of the squatter's own (its root
    // document, a consistent path, a locator naming that document) holding
    // this very file at this very index, under this proof hash. It passes
    // every check the plaintext alone allows; only the full comparison
    // refuses it.
    let fake: ReturnType<typeof syntheticTree> | null = null;
    for (let n = 0; fake === null; n++) {
      const t = syntheticTree([{ name: "squat", original: v.memberFile, code: 0x01 }, { name: "pad", original: utf8(`pad ${n}`), code: 0x01 }], String(5000 + n));
      if (t.names[1] === "squat") fake = t;
    }
    const fakeTree = recoveryTreeFrom({ proof: fake.proof, leavesBytes: fake.leavesBytes });
    const forged = { ...recoveryPlaintextFor(fakeTree, 1, "hello.txt").plaintext, proofHash: mine.plaintext.proofHash };
    assert.ok(parseRecoveryPlaintext(encodeRecoveryPlaintext(forged)), "internally consistent");
    assert.ok(!(await existingEntryHoldsMember(w.digest, w.objectKey, await sealAt(encodeRecoveryPlaintext(forged)), mine.plaintext)), "a consistent tree of the squatter's own");
    const junk = new Uint8Array(100);
    junk[0] = 1;
    assert.ok(!(await existingEntryHoldsMember(w.digest, w.objectKey, junk, mine.plaintext)), "bytes that do not open");
    // The cold review's hole (10-03): this member's own plaintext WITH a salt, parked at the deterministic name.
    // Same member, so the first rule passes; but no reader accepts it there (its name is the salted one), so it is nobody's entry.
    const salted = recoveryPlaintextFor(tree, 1, "hello.txt", newRecoverySalt()).bytes;
    assert.ok(!(await existingEntryHoldsMember(w.digest, w.objectKey, await sealAt(salted), mine.plaintext)), "a salted plaintext at the deterministic name is not this entry");
    // And the reverse: the unsalted plaintext parked at a salted name.
    const salt = newRecoverySalt();
    const saltedKey = recoveryObjectKeyFor(tree, 1, "origin", salt);
    const sealSalted = (pt: Uint8Array) => sealRecoveryEnvelope(recoveryKeyBytes(w.digest), saltedKey, pt);
    assert.ok(!(await existingEntryHoldsMember(w.digest, saltedKey, await sealSalted(encodeRecoveryPlaintext(mine.plaintext)), mine.plaintext)), "the unsalted plaintext at a salted name is not this entry");
    assert.ok(await existingEntryHoldsMember(w.digest, saltedKey, await sealSalted(recoveryPlaintextFor(tree, 1, "hello.txt", salt).bytes), mine.plaintext), "the salted plaintext under the name its salt derives is");
  });

  test("findOwnRecoveryEntry: the member's entry under any of its names, with the salt to reuse; nothing for another member; unavailable when the address cannot be read", async () => {
    const v = vectorTree();
    const tree = recoveryTreeFrom({ proof: v.proof, rootDocument: v.rootDocument, leavesBytes: v.leavesBytes });
    const store = new MemoryRecoveryStore();
    const d = sha256(v.memberFile);
    const { plaintext } = recoveryPlaintextFor(tree, 1, "hello.txt");
    assert.equal(await findOwnRecoveryEntry(d, plaintext, fakeFetch(store)), null, "nothing there yet");
    // A squatter at the deterministic name, and our entry under a salted one from an earlier run.
    const squatKey = recoveryObjectKey(recoveryAddress(d), recoveryEntryId(d, tree.proofHash32, 1));
    store.objects.set(squatKey, await sealRecoveryEnvelope(recoveryKeyBytes(d), squatKey, recoveryPlaintextFor(tree, 3, "note.md").bytes));
    const salt = newRecoverySalt();
    const ours = (await sealRecoveryMember(tree, 1, "hello.txt", ["origin"], { origin: salt })).writes[0]!;
    store.objects.set(ours.objectKey, ours.envelope);
    const found = await findOwnRecoveryEntry(d, plaintext, fakeFetch(store));
    assert.ok(found !== null);
    assert.equal(found.objectKey, ours.objectKey);
    assert.deepEqual(found.salt, salt, "the salt comes back so a writer reuses it instead of leaving another copy");
    // Another member's plaintext finds nothing of its own here.
    assert.equal(await findOwnRecoveryEntry(d, recoveryPlaintextFor(tree, 3, "note.md").plaintext, fakeFetch(store)), null);
    store.failing = true;
    await assert.rejects(findOwnRecoveryEntry(d, plaintext, fakeFetch(store)), RecoveryUnavailableError);
  });

  test("the locator is the proof's own signed fields: an entry whose locator disagrees with the proof it hashes to is not accepted; the grammar is the proof's", async () => {
    const v = vectorTree();
    const store = new MemoryRecoveryStore();
    const { tree } = await writeTree(store, v);
    const [entry] = await recoverFromDigest(sha256(v.memberFile), fakeFetch(store));
    const fetch = fakeFetch(store, { proofs: [v.proof] });
    assert.ok(await fetchRecoveredProof(entry!, fetch, { trust: "none", extraSpecHashes: [v.specHash] }));
    assert.equal(await fetchRecoveredProof({ ...entry!, proof: { ...entry!.proof, counter: String(Number(entry!.proof.counter) + 1) } }, fetch, { trust: "none", extraSpecHashes: [v.specHash] }), null, "a counter that is not the proof's");
    assert.equal(await fetchRecoveredProof({ ...entry!, proof: { ...entry!.proof, epochId: bytesToBase64(new Uint8Array(32).fill(9)) } }, fetch, { trust: "none", extraSpecHashes: [v.specHash] }), null, "an epoch that is not the proof's");
    // The grammar: epochId canonical base64 of 32 bytes, counter decimal without a leading zero.
    const good = recoveryPlaintextFor(tree, 1, "hello.txt").plaintext;
    const parse = (p: unknown) => parseRecoveryPlaintext(utf8(JSON.stringify(p)));
    assert.ok(parse(good));
    assert.equal(parse({ ...good, proof: { ...good.proof, counter: "007" } }), null, "a leading zero");
    assert.equal(parse({ ...good, proof: { ...good.proof, counter: "" } }), null, "no digits");
    assert.ok(parse({ ...good, proof: { ...good.proof, counter: "0" } }), "zero itself");
    assert.equal(parse({ ...good, proof: { ...good.proof, epochId: good.proof.epochId.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") } }), null, "URL-safe or unpadded is not the proof's encoding");
    assert.equal(parse({ ...good, proof: { ...good.proof, epochId: bytesToBase64(new Uint8Array(31)) } }), null, "31 bytes");
  });

  test("a candidate that cannot be judged is unresolved, never negative: an unknown spec pin, an empty measurement policy", async () => {
    const v = vectorTree();
    const store = new MemoryRecoveryStore();
    await writeTree(store, v);
    const [entry] = await recoverFromDigest(sha256(v.memberFile), fakeFetch(store));
    const fetch = fakeFetch(store, { proofs: [v.proof] });
    // A proof that pins a spec this reader does not know, honestly re-signed with the vectors' published TEST key
    // (spec/tools/gen-vectors.mjs): the signature holds, the spec is foreign, the candidate is unresolved.
    const TEST_KEY = new Uint8Array(createHash("sha256").update("bitgraph spec vector key (TEST ONLY, NOT A BITGRAPH KEY)").digest());
    const foreign = JSON.parse(JSON.stringify(v.proof)) as typeof v.proof & { signer: { publicKeyB64: string; signatureB64: string }; environment: { enforcement: string; measurement: string } };
    foreign.attribution = { ...foreign.attribution, message: bytesToBase64(sha256(utf8("a spec this reader has never seen"))) };
    const body = { version: foreign.version, artifact: foreign.artifact, commit: foreign.commit, publicKeyB64: foreign.signer.publicKeyB64, enforcement: foreign.environment.enforcement, measurement: foreign.environment.measurement, attribution: foreign.attribution };
    foreign.signer.signatureB64 = bytesToBase64(await signAsync(canonicalize(body), TEST_KEY));
    const foreignEntry = { ...entry!, proofHash: computeProofHash(foreign as never) };
    await assert.rejects(fetchRecoveredProof(foreignEntry, fakeFetch(store, { proofs: [foreign as never] }), { trust: "none" }), /unresolved: .*spec/);
    // An empty policy judges nothing.
    await assert.rejects(fetchRecoveredProof(entry!, fetch, { trust: [], extraSpecHashes: [v.specHash] }), /measurement policy is empty/);
    // A policy naming an image the proof does not carry rejects (the TEST vector's stub attestation).
    assert.equal(await fetchRecoveredProof(entry!, fetch, { trust: ["ab".repeat(48)], extraSpecHashes: [v.specHash] }), null);
  });

  test("a proof route whose index is retired is unavailable, never 'not this file's recording'", async () => {
    const v = vectorTree();
    const store = new MemoryRecoveryStore();
    const { tree } = await writeTree(store, v);
    const [entry] = await recoverFromDigest(sha256(v.memberFile), fakeFetch(store));
    assert.ok(entry);
    const retired = async (u: string, init?: RequestInit) => (u.startsWith("/api/proofs/") ? new Response(JSON.stringify({ proofs: [], discovery: "retired", note: "a miss here is not a finding" }), { status: 200 }) : fakeFetch(store)(u, init));
    await assert.rejects(fetchRecoveredProof(entry!, retired, { trust: "none" }), RecoveryUnavailableError);
    // A plain empty answer from a live index is an answer: no such proof.
    assert.equal(await fetchRecoveredProof(entry!, fakeFetch(store, { proofs: [] }), { trust: "none" }), null);
    void tree;
  });
});
