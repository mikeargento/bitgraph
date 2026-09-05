// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * BitGraph Sets, phase 1: the set manifest codec, the set/1 placement,
 * verifyFuse compatibility, and verifyFuseMember on locally signed set
 * proofs. Every negative vector runs against the real verifier. Fixtures
 * are minted with a local signer only: a 32-byte nonce (the commitment
 * needs one), a slot body signed with the same key, commit.slotHashB64
 * bound to it, the manifest as the artifact, fuseAttribution("set/1")
 * inside the signed body, and the parsed manifest attached OUTSIDE it.
 */

import { describe, test, before } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { signAsync } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import {
  PLACEMENTS,
  getPlacement,
  canonicalize,
  canonicalSlotBody,
  computeSlotCommitment,
  buildFusePayload,
  parseFusePayload,
  buildSetManifest,
  parseSetManifest,
  readSetMetadata,
  fuseAttribution,
  verifyFuse,
  verifyFuseMember,
  resetEpochLinkState,
  bytesToBase64,
  base64ToBytes,
  bytesToHex,
  hexToBytes,
  bytesEqual,
  SET_METADATA_KEY,
  SET_PLACEMENT_ID,
} from "@mikeargento/bitgraph-verify";
import type {
  BitGraphProof,
  SlotAllocation,
  Attribution,
  SetMember,
  SetManifest,
  FuseMemberOptions,
  FuseMemberResult,
  FuseVerifyResult,
} from "@mikeargento/bitgraph-verify";
import { makeKey, signBody, b64, utf8 } from "./audit-fixtures.js";
import type { ManualKey } from "./audit-fixtures.js";

const FIX = fileURLToPath(new URL("../../src/__tests__/fuse-fixtures/", import.meta.url));
const bytes = (name: string) => new Uint8Array(readFileSync(FIX + name));
const proofOf = (name: string) => JSON.parse(readFileSync(FIX + name, "utf8")) as BitGraphProof;

interface Vec { commitmentHex: string; fusedDigestB64: string; originDigestB64: string }
const V = JSON.parse(readFileSync(FIX + "vectors.json", "utf8")) as { synthetic: { commitmentHex: string }; trailerFixture: Vec; containerFixture: Vec };

const original = bytes("original.txt");
const png = bytes("image.png");
const note = utf8("a third member, plain text made for the set\n");
const bOnly = utf8("a file that belongs to set B alone\n");
const unrelated = utf8("a file nobody recorded\n");

const trailer = getPlacement("trailer/1")!;
const container = getPlacement("container/1")!;
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const asObject = (m: Uint8Array) => JSON.parse(dec(m)) as SetManifest;
const compact = (o: unknown) => enc(JSON.stringify(o));
const digestField = (d: Uint8Array) => ({ algorithm: "sha256" as const, digest: bytesToHex(d) });

// ---------------------------------------------------------------------------
// Local signer: slots, set proofs, sets
// ---------------------------------------------------------------------------

const EPOCH = bytesToBase64(new Uint8Array(32).fill(0x5e));

/** A slot record signed by `key`, with a 32-byte nonce and the anchored chain. */
async function allocateSlot(key: ManualKey, counter: string): Promise<SlotAllocation> {
  const body = {
    version: "bitgraph/slot/1" as const,
    nonceB64: b64(crypto.getRandomValues(new Uint8Array(32))),
    counter,
    epochId: EPOCH,
    publicKeyB64: key.publicKeyB64,
    chainId: "bitgraph:main",
  };
  return { ...body, signatureB64: b64(await signAsync(canonicalize(body), key.privateKey)) };
}

interface MintOptions {
  key: ManualKey;
  slot: SlotAllocation;
  commitCounter: string;
  manifestBytes: Uint8Array;
  /** Attach the parsed manifest under proof.metadata (default true). */
  withMetadata?: boolean;
  /** The signed attribution; default fuseAttribution("set/1"); null for none at all. */
  attribution?: Attribution | null;
  /** Override the artifact digest; the proof stays validly signed. */
  artifactDigestB64?: string;
}

/** A set proof: the manifest is the artifact, set/1 is the signed title, the slot is consumed. */
async function mintSetProof(o: MintOptions): Promise<BitGraphProof> {
  const commit: BitGraphProof["commit"] = {
    nonceB64: o.slot.nonceB64,
    counter: o.commitCounter,
    epochId: o.slot.epochId,
    slotCounter: o.slot.counter,
    slotHashB64: b64(sha256(canonicalize(canonicalSlotBody(o.slot)))),
  };
  (commit as unknown as Record<string, unknown>)["chainId"] = "bitgraph:main";
  const attribution = o.attribution === undefined ? fuseAttribution("set/1") : o.attribution;
  const proof = await signBody(
    o.key,
    { hashAlg: "sha256", digestB64: o.artifactDigestB64 ?? b64(sha256(o.manifestBytes)) },
    commit,
    "test-measurement-set",
    attribution === null ? undefined : { attribution },
  );
  proof.slotAllocation = o.slot;
  if (o.withMetadata !== false) proof.metadata = { [SET_METADATA_KEY]: JSON.parse(dec(o.manifestBytes)) as SetManifest };
  return proof;
}

type ByteExact = "trailer/1" | "container/1";
interface Fused { name: string; original: Uint8Array; placement: ByteExact; bytes: Uint8Array; row: SetMember }
interface SetFixture {
  key: ManualKey;
  slot: SlotAllocation;
  commitCounter: string;
  commitment: Uint8Array;
  fused: Fused[];
  rows: SetMember[];
  manifest: Uint8Array;
  /** The rows as the manifest lists them: ascending by artifact digest. */
  sorted: SetMember[];
  proof: BitGraphProof;
}

function fuseWith(commitment: Uint8Array, original: Uint8Array, placement: ByteExact, name: string): Fused {
  const fused = getPlacement(placement)!.build({ original, commitment });
  return { name, original, placement, bytes: fused, row: { artifact: sha256(fused), origin: sha256(original), placement } };
}

async function makeSet(o: {
  slotCounter: string;
  commitCounter: string;
  files: (commitment: Uint8Array) => Array<[Uint8Array, ByteExact, string]>;
  key?: ManualKey;
}): Promise<SetFixture> {
  const key = o.key ?? (await makeKey());
  const slot = await allocateSlot(key, o.slotCounter);
  const commitment = computeSlotCommitment(slot);
  const fused = o.files(commitment).map(([orig, placement, name]) => fuseWith(commitment, orig, placement, name));
  const rows = fused.map((f) => f.row);
  const manifest = buildSetManifest(commitment, rows);
  const proof = await mintSetProof({ key, slot, commitCounter: o.commitCounter, manifestBytes: manifest });
  return { key, slot, commitCounter: o.commitCounter, commitment, fused, rows, manifest, sorted: parseSetManifest(manifest)!.members, proof };
}

const byName = (s: SetFixture, name: string) => s.fused.find((f) => f.name === name)!;
const sortedIndex = (s: SetFixture, f: Fused) => s.sorted.findIndex((r) => bytesEqual(r.artifact, f.row.artifact));
/** A fresh proof under set `s`'s slot and key, committing `manifestBytes` (or anything else). */
const mintUnder = (s: SetFixture, manifestBytes: Uint8Array, extra: Partial<MintOptions> = {}) =>
  mintSetProof({ key: s.key, slot: s.slot, commitCounter: s.commitCounter, manifestBytes, ...extra });
/** Clone a proof and mutate its (unsigned) metadata manifest in place. */
function withMetadata(proof: BitGraphProof, mutate: (m: SetManifest) => void): BitGraphProof {
  const p = structuredClone(proof);
  mutate(p.metadata![SET_METADATA_KEY] as SetManifest);
  return p;
}

let A!: SetFixture;
let B!: SetFixture;

before(async () => {
  A = await makeSet({
    slotCounter: "10",
    commitCounter: "14",
    files: () => [[original, "trailer/1", "original.txt"], [png, "container/1", "image.png"], [note, "trailer/1", "note.txt"]],
  });
  B = await makeSet({
    slotCounter: "3",
    commitCounter: "4",
    files: () => [[original, "trailer/1", "original.txt"], [bOnly, "container/1", "b-only.txt"]],
  });
});

// Every verifyFuseMember result produced in this file, for the invariants at the end.
const collected: Array<{ proof: BitGraphProof; bytes: Uint8Array; result: FuseMemberResult }> = [];
type Extra = Partial<Pick<FuseMemberOptions, "manifest" | "trustAnchors" | "maxPositions">>;
async function member(proof: BitGraphProof, file: Uint8Array, extra: Extra = {}): Promise<FuseMemberResult> {
  resetEpochLinkState();
  const result = await verifyFuseMember({ proof, bytes: file, ...extra });
  collected.push({ proof, bytes: file, result });
  return result;
}
async function fuse(proof: BitGraphProof, file: Uint8Array, extra: Partial<Parameters<typeof verifyFuse>[0]> = {}): Promise<FuseVerifyResult> {
  resetEpochLinkState();
  return verifyFuse({ proof, bytes: file, ...extra });
}

// ---------------------------------------------------------------------------
// Codec
// ---------------------------------------------------------------------------

/** Pinned: the two-member manifest over the synthetic slot of vectors.json. */
const PINNED_MANIFEST =
  '{"members":[{"artifact":{"algorithm":"sha256","digest":"7e4bd8972297bd71323bebe73839a276bf5c57b5fa9cfd6737617c3723600400"},"origin":{"algorithm":"sha256","digest":"2e824794554ffb36fdfa7a1c0b207ec958bb26b1dad54cebeff35358938e4327"},"placement":"trailer/1"},{"artifact":{"algorithm":"sha256","digest":"de5319f187580c1093f57e4b0578380aa500aee44f2938902ec4d6aeef5fff64"},"origin":{"algorithm":"sha256","digest":"497790947d4666760ce38f3c00e852c71fdb66cae849bae8e9ede352719e1581"},"placement":"container/1"}],"placement":"set/1","slotCommitment":{"algorithm":"sha256","digest":"0e658007a8aaecce318b2f594581b880e8ecc34af0ff54cd0c85624b42cb94b7"},"type":"bitgraph-fuse/1"}';
const PINNED_MANIFEST_SHA256_HEX = "0dc745cac9b6be669b97018feecd2e9e6e92d73af9de051f4b9d87791f0ace3d";

describe("codec: buildSetManifest", () => {
  const vecRow = (v: Vec, placement: string): SetMember => ({ artifact: base64ToBytes(v.fusedDigestB64)!, origin: base64ToBytes(v.originDigestB64)!, placement });

  test("1. pinned bytes over the synthetic slot: rows ascending by artifact, fixed key order, no whitespace", () => {
    const c = hexToBytes(V.synthetic.commitmentHex)!;
    const built = buildSetManifest(c, [vecRow(V.containerFixture, "container/1"), vecRow(V.trailerFixture, "trailer/1")]);
    assert.equal(dec(built), PINNED_MANIFEST);
    assert.equal(bytesToHex(sha256(built)), PINNED_MANIFEST_SHA256_HEX);
    assert.equal(dec(buildSetManifest(c, [vecRow(V.trailerFixture, "trailer/1"), vecRow(V.containerFixture, "container/1")])), PINNED_MANIFEST);
    const o = asObject(built);
    assert.deepEqual(Object.keys(o), ["members", "placement", "slotCommitment", "type"]);
    assert.deepEqual(Object.keys(o.members[0]!), ["artifact", "origin", "placement"]);
    assert.ok(o.members[0]!.artifact.digest < o.members[1]!.artifact.digest, "ascending by artifact hex");
    assert.doesNotMatch(dec(built), /\s/);
    assert.equal(o.placement, "set/1");
    assert.equal(o.type, "bitgraph-fuse/1");
  });

  test("2. the same members in every input order give identical bytes and digest", () => {
    const rows = A.rows;
    const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    const first = buildSetManifest(A.commitment, rows);
    for (const order of orders) {
      const built = buildSetManifest(A.commitment, order.map((i) => rows[i]!));
      assert.deepEqual(built, first);
      assert.equal(bytesToHex(sha256(built)), bytesToHex(sha256(first)));
    }
    assert.deepEqual(first, A.manifest);
  });

  test("3. refuses a duplicate artifact, an empty list, wrong lengths, a bad placement, and a nested set", () => {
    const [r0, r1] = A.rows as [SetMember, SetMember, SetMember];
    assert.throws(() => buildSetManifest(A.commitment, [r0, r1, { ...r0, origin: r1.origin }]), /duplicate/);
    assert.throws(() => buildSetManifest(A.commitment, []), /at least one/);
    assert.throws(() => buildSetManifest(A.commitment, [{ ...r0, artifact: new Uint8Array(31) }]), /32 bytes/);
    assert.throws(() => buildSetManifest(A.commitment, [{ ...r0, origin: new Uint8Array(31) }]), /32 bytes/);
    assert.throws(() => buildSetManifest(new Uint8Array(33), [r0]), /32 bytes/);
    assert.throws(() => buildSetManifest(A.commitment, [{ ...r0, placement: "xmp" }]), /placement/);
    assert.throws(() => buildSetManifest(A.commitment, [{ ...r0, placement: "set/1" }]), /set/);
  });
});

describe("codec: parseSetManifest", () => {
  test("4. canonical bytes round-trip commitment and rows byte for byte, twice", () => {
    for (let i = 0; i < 2; i++) {
      const parsed = parseSetManifest(A.manifest)!;
      assert.ok(parsed);
      assert.deepEqual(parsed.commitment, A.commitment);
      assert.equal(parsed.members.length, 3);
      assert.deepEqual(buildSetManifest(parsed.commitment, parsed.members), A.manifest);
      for (const row of A.rows) {
        const found = parsed.members.find((m) => bytesEqual(m.artifact, row.artifact))!;
        assert.deepEqual(found.origin, row.origin);
        assert.equal(found.placement, row.placement);
      }
    }
  });

  test("5. whitespace: pretty-printed JSON and a trailing newline are refused", () => {
    assert.equal(parseSetManifest(enc(JSON.stringify(asObject(A.manifest), null, 2))), null, "pretty");
    assert.equal(parseSetManifest(enc(dec(A.manifest) + "\n")), null, "trailing newline");
  });

  test("6. key order: reordered top-level keys and reordered row keys are refused", () => {
    const o = asObject(A.manifest);
    const top = { type: o.type, slotCommitment: o.slotCommitment, placement: o.placement, members: o.members };
    assert.equal(parseSetManifest(compact(top)), null, "top level");
    const row = o.members[0]!;
    const rows = [{ origin: row.origin, artifact: row.artifact, placement: row.placement }, ...o.members.slice(1)];
    assert.equal(parseSetManifest(compact({ ...o, members: rows })), null, "row");
  });

  test("7. duplicate keys: a repeated top-level type and a repeated row placement are refused", () => {
    const text = dec(A.manifest);
    assert.equal(parseSetManifest(enc(text.replace('"type":"bitgraph-fuse/1"', '"type":"bitgraph-fuse/1","type":"bitgraph-fuse/1"'))), null, "type");
    const firstPlacement = /"placement":"(trailer|container)\/1"/.exec(text)![0];
    assert.equal(parseSetManifest(enc(text.replace(firstPlacement, `${firstPlacement},${firstPlacement}`))), null, "row placement");
  });

  test("8. digests: uppercase hex, 63- and 65-char hex, and other algorithm spellings are refused", () => {
    const text = dec(A.manifest);
    assert.equal(parseSetManifest(enc(text.replace(/"digest":"([0-9a-f]{8})/, (_m, h: string) => `"digest":"${h.toUpperCase()}`))), null, "uppercase");
    const o = asObject(A.manifest);
    const short = structuredClone(o); short.members[0]!.artifact.digest = short.members[0]!.artifact.digest.slice(0, 63);
    assert.equal(parseSetManifest(compact(short)), null, "63 chars");
    const long = structuredClone(o); long.members[0]!.origin.digest = `${long.members[0]!.origin.digest}0`;
    assert.equal(parseSetManifest(compact(long)), null, "65 chars");
    const upper = structuredClone(o); (upper.slotCommitment as { algorithm: string }).algorithm = "SHA256";
    assert.equal(parseSetManifest(compact(upper)), null, "SHA256");
    const dashed = structuredClone(o); (dashed.members[1]!.artifact as { algorithm: string }).algorithm = "sha-256";
    assert.equal(parseSetManifest(compact(dashed)), null, "sha-256");
  });

  test("9. shape: extra keys, a missing origin, members as an object or empty, a BOM, and invalid UTF-8 are refused", () => {
    const o = asObject(A.manifest);
    assert.equal(parseSetManifest(compact({ ...o, extra: 1 })), null, "extra top-level key");
    assert.equal(parseSetManifest(compact({ ...o, members: [{ ...o.members[0]!, extra: 1 }, ...o.members.slice(1)] })), null, "extra row key");
    const { origin: _o, ...noOrigin } = o.members[0]!;
    assert.equal(parseSetManifest(compact({ ...o, members: [noOrigin, ...o.members.slice(1)] })), null, "row missing origin");
    assert.equal(parseSetManifest(compact({ ...o, members: {} })), null, "members as object");
    assert.equal(parseSetManifest(compact({ ...o, members: [] })), null, "members empty");
    assert.equal(parseSetManifest(new Uint8Array([0xef, 0xbb, 0xbf, ...A.manifest])), null, "BOM");
    assert.equal(parseSetManifest(new Uint8Array([0xff, 0xfe])), null, "invalid UTF-8");
  });

  test("10. rows: descending order and a repeated artifact digest are refused", () => {
    const o = asObject(A.manifest);
    assert.equal(parseSetManifest(compact({ ...o, members: [...o.members].reverse() })), null, "descending");
    assert.equal(parseSetManifest(compact({ ...o, members: [o.members[0]!, o.members[0]!, o.members[1]!] })), null, "repeated artifact");
  });

  test("11. identity: another type, another set version, or a nested set is refused; an unregistered placement parses", () => {
    const o = asObject(A.manifest);
    assert.equal(parseSetManifest(compact({ ...o, type: "bitgraph-fuse/2" })), null, "type");
    assert.equal(parseSetManifest(compact({ ...o, placement: "set/2" })), null, "set/2");
    assert.equal(parseSetManifest(compact({ ...o, members: [{ ...o.members[0]!, placement: "set/1" }, ...o.members.slice(1)] })), null, "nested set");
    const xmp = buildSetManifest(A.commitment, [{ ...A.rows[0]!, placement: "xmp/9" }]);
    const parsed = parseSetManifest(xmp)!;
    assert.ok(parsed, "syntax is valid; registration is a verify-time question");
    assert.equal(parsed.members[0]!.placement, "xmp/9");
  });

  test("12. cross-shape: a produced/1 payload is not a set manifest and a set manifest is not a payload", () => {
    assert.equal(parseSetManifest(bytes("produced-origin.json")), null);
    assert.equal(parseSetManifest(bytes("produced-bare.json")), null);
    assert.equal(parseSetManifest(buildFusePayload(A.commitment)), null);
    assert.equal(parseFusePayload(A.manifest), null);
    assert.equal(parseFusePayload(enc(PINNED_MANIFEST)), null);
  });
});

// ---------------------------------------------------------------------------
// Registry and metadata
// ---------------------------------------------------------------------------

describe("registry and metadata", () => {
  test("13. PLACEMENTS is unchanged; set/1 resolves through getPlacement as Form C, not byte-exact, locate-only", () => {
    assert.deepEqual(PLACEMENTS.map((p) => p.id), ["trailer/1", "container/1", "container/2", "produced/1"]);
    const set1 = getPlacement("set/1")!;
    assert.ok(set1);
    assert.equal(set1.id, SET_PLACEMENT_ID);
    assert.equal(set1.form, "C");
    assert.equal(set1.byteExact, false);
    assert.throws(() => set1.build({ commitment: A.commitment }), /buildSetManifest/);
    const located = set1.locate(A.manifest)!;
    assert.deepEqual(located, { commitment: A.commitment }, "exactly the commitment, nothing else");
    assert.equal(set1.locate(bytes("produced-bare.json")), null);
    assert.equal(set1.locate(bytes("fused-trailer.bin")), null);
    assert.equal(set1.locate(original), null);
    // set/2 resolves the same way: Form C, locate-only, and equally absent from the undeclared scan.
    const set2 = getPlacement("set/2")!;
    assert.equal(set2.form, "C");
    assert.equal(set2.byteExact, false);
    assert.equal(set2.locate(A.manifest), null, "a set/1 manifest is not a set/2 root document");
    assert.equal(getPlacement("set/3"), undefined);
  });

  test("14. readSetMetadata re-canonicalizes a plain object and returns null for anything else", async () => {
    const o = asObject(A.manifest);
    const shuffled = { type: o.type, slotCommitment: o.slotCommitment, placement: o.placement, members: o.members.map((r) => ({ placement: r.placement, origin: r.origin, artifact: r.artifact })) };
    const p = structuredClone(A.proof);
    p.metadata = { [SET_METADATA_KEY]: shuffled };
    assert.deepEqual(readSetMetadata(p), A.manifest);
    const absent = structuredClone(A.proof); delete absent.metadata;
    assert.equal(readSetMetadata(absent), null, "no metadata");
    const other = structuredClone(A.proof); other.metadata = { somethingElse: 1 };
    assert.equal(readSetMetadata(other), null, "key absent");
    const str = structuredClone(A.proof); str.metadata = { [SET_METADATA_KEY]: dec(A.manifest) };
    assert.equal(readSetMetadata(str), null, "a string");
    const arr = structuredClone(A.proof); arr.metadata = { [SET_METADATA_KEY]: [o] };
    assert.equal(readSetMetadata(arr), null, "an array");
    const nul = structuredClone(A.proof); nul.metadata = { [SET_METADATA_KEY]: null };
    assert.equal(readSetMetadata(nul), null, "null");
  });
});

// ---------------------------------------------------------------------------
// verifyFuse compatibility
// ---------------------------------------------------------------------------

describe("verifyFuse on set proofs and every existing fixture", () => {
  test("15. the manifest bytes of a set proof verify FUSED_DIRECT under set/1 with one floor statement", async () => {
    const r = await fuse(A.proof, A.manifest);
    assert.equal(r.category, "FUSED_DIRECT", r.reason ?? "");
    assert.equal(r.placement, "set/1");
    assert.equal(r.marker?.source, "attribution");
    assert.equal(r.marker?.placement, "set/1");
    assert.equal(r.statements.length, 1);
    assert.match(r.statements[0]!, /could not feasibly have been finalized before their signed slot allocation at position 10/);
    assert.equal(r.span?.positions, "4");
    assert.equal(r.originDigestB64, null, "a set has no single origin");
  });

  test("16. a member's fused bytes and a member's original are NO_MATCH to verifyFuse: it knows nothing about members", async () => {
    for (const f of A.fused) {
      assert.equal((await fuse(A.proof, f.bytes)).category, "NO_MATCH", f.name);
      assert.equal((await fuse(A.proof, f.original)).category, "NO_MATCH", `${f.name} original`);
    }
  });

  test("17. every existing fuse fixture keeps its category", async () => {
    const cases: Array<[string, Uint8Array, string]> = [
      ["recorded.proof.json", original, "RECORDED"],
      ["trailer.proof.json", bytes("fused-trailer.bin"), "FUSED_DIRECT"],
      ["container.proof.json", bytes("fused-container.tar"), "FUSED_DIRECT"],
      ["produced-origin.proof.json", bytes("produced-origin.json"), "FUSED_DIRECT"],
      ["produced-bare.proof.json", bytes("produced-bare.json"), "FUSED_DIRECT"],
      ["trailer-undeclared.proof.json", bytes("fused-trailer-undeclared.bin"), "FUSED_DIRECT"],
      ["wrong-slot.proof.json", bytes("fused-wrong-slot.bin"), "INVALID_SLOT_COMMITMENT"],
      ["unregistered.proof.json", bytes("fused-unregistered.bin"), "UNDETERMINED_PLACEMENT"],
      ["trailer.proof.json", original, "FUSED_FROM_ORIGIN"],
      ["container.proof.json", png, "FUSED_FROM_ORIGIN"],
      ["produced-origin.proof.json", original, "RECONSTRUCTION_MISMATCH"],
      ["unregistered.proof.json", original, "UNDETERMINED_PLACEMENT"],
      ["wrong-slot.proof.json", original, "RECONSTRUCTION_MISMATCH"],
      ["trailer.proof.json", unrelated, "NO_MATCH"],
      ["container.proof.json", bytes("fused-trailer.bin"), "NO_MATCH"],
    ];
    for (const [name, file, expected] of cases) {
      const r = await fuse(proofOf(name), file);
      assert.equal(r.category, expected, `${name}: ${r.reason ?? ""}`);
    }
  });

  test("18. a manifest carrying another slot's commitment, committed under proof A, is INVALID_SLOT_COMMITMENT", async () => {
    const foreign = buildSetManifest(B.commitment, A.rows);
    const proof = await mintUnder(A, foreign);
    const r = await fuse(proof, foreign);
    assert.equal(r.category, "INVALID_SLOT_COMMITMENT");
    assert.equal(r.placement, "set/1");
    assert.equal(r.proof.valid, true);
  });
});

// ---------------------------------------------------------------------------
// verifyFuseMember: positive members
// ---------------------------------------------------------------------------

describe("verifyFuseMember: members", () => {
  test("19. each fused member is SET_MEMBER_DIRECT with its row, its sorted index, and the floor statement of the manifest", async () => {
    const floor = (await fuse(A.proof, A.manifest)).statements[0]!;
    for (const f of A.fused) {
      const r = await member(A.proof, f.bytes);
      assert.equal(r.category, "SET_MEMBER_DIRECT", `${f.name}: ${r.reason ?? ""}`);
      assert.equal(r.placement, f.placement);
      assert.equal(r.originDigestB64, bytesToBase64(f.row.origin));
      assert.equal(r.artifactDigestB64, A.proof.artifact.digestB64);
      assert.equal(r.slotCommitmentB64, bytesToBase64(A.commitment));
      assert.ok(r.set);
      assert.equal(r.set!.manifestSource, "metadata");
      assert.equal(r.set!.memberCount, 3);
      assert.equal(r.set!.manifestDigestB64, r.artifactDigestB64);
      assert.ok(r.set!.member);
      assert.equal(r.set!.member!.index, sortedIndex(A, f));
      assert.equal(r.set!.member!.placement, f.placement);
      assert.equal(r.set!.member!.fusedDigestB64, r.fileDigestB64);
      assert.equal(r.set!.member!.originDigestB64, bytesToBase64(f.row.origin));
      assert.match(r.statements[0]!, new RegExp(`member ${sortedIndex(A, f) + 1} of 3 listed in the set manifest committed at position 14`));
      assert.match(r.statements.join(" "), /position 10/);
      assert.match(r.statements.join(" "), /position 14/);
      assert.equal(r.statements.at(-1), floor, "byte-identical to verifyFuse's floor statement");
      assert.equal(r.statements.length, 3, "membership, origin consistency, floor");
      assert.match(r.statements[1]!, /origin digest that matches the set manifest; the original itself was not supplied and was not checked/);
      assert.equal(r.reason, null);
      assert.equal(r.span?.positions, "4");
      assert.equal(r.marker?.placement, "set/1");
    }
  });

  test("20. an original rebuilds its member: SET_MEMBER_FROM_ORIGIN with the row's placement", async () => {
    const t = await member(A.proof, original);
    assert.equal(t.category, "SET_MEMBER_FROM_ORIGIN", t.reason ?? "");
    assert.equal(t.placement, "trailer/1");
    assert.match(t.statements[0]!, /rebuilds member \d+ of 3/);
    assert.equal(t.statements.length, 2);
    assert.equal(t.originDigestB64, bytesToBase64(sha256(original)));
    assert.equal(t.set!.member!.index, sortedIndex(A, byName(A, "original.txt")));
    const c = await member(A.proof, png);
    assert.equal(c.category, "SET_MEMBER_FROM_ORIGIN", c.reason ?? "");
    assert.equal(c.placement, "container/1");
    assert.match(c.statements[0]!, /rebuilds member \d+ of 3/);
    const n = await member(A.proof, note);
    assert.equal(n.category, "SET_MEMBER_FROM_ORIGIN");
    assert.equal(n.placement, "trailer/1");
  });

  test("21. the manifest as an explicit argument stands in for stripped metadata, and wins when both are present", async () => {
    const f = byName(A, "image.png");
    const stripped = structuredClone(A.proof);
    delete stripped.metadata;
    const fromArgument = await member(stripped, f.bytes, { manifest: A.manifest });
    assert.equal(fromArgument.category, "SET_MEMBER_DIRECT", fromArgument.reason ?? "");
    assert.equal(fromArgument.set!.manifestSource, "argument");
    const both = await member(A.proof, f.bytes, { manifest: A.manifest });
    assert.deepEqual(both, fromArgument);
    const fromMetadata = await member(A.proof, f.bytes);
    assert.equal(fromMetadata.set!.manifestSource, "metadata");
    assert.deepEqual({ ...fromMetadata, set: { ...fromMetadata.set!, manifestSource: "argument" } }, fromArgument);
  });

  test("22. one original fused two ways is two members; the original reports the first row in manifest order", async () => {
    const twice = await makeSet({ slotCounter: "20", commitCounter: "22", files: () => [[original, "trailer/1", "t"], [original, "container/1", "c"]] });
    for (const f of twice.fused) {
      const r = await member(twice.proof, f.bytes);
      assert.equal(r.category, "SET_MEMBER_DIRECT", `${f.name}: ${r.reason ?? ""}`);
      assert.equal(r.placement, f.placement);
    }
    const r = await member(twice.proof, original);
    assert.equal(r.category, "SET_MEMBER_FROM_ORIGIN", r.reason ?? "");
    assert.equal(r.set!.memberCount, 2);
    assert.equal(r.set!.member!.index, 0, "the first row in manifest order");
    assert.equal(r.placement, twice.sorted[0]!.placement);
    assert.equal(r.set!.member!.placement, twice.sorted[0]!.placement);
  });

  test("23. the again case: a fused file listed only as the ORIGIN of a further member is an origin, never a stray", async () => {
    const again = await makeSet({
      slotCounter: "30",
      commitCounter: "32",
      files: (c) => [[trailer.build({ original, commitment: c }), "trailer/1", "again"], [png, "container/1", "image.png"]],
    });
    const oPrime = byName(again, "again").original;
    assert.ok(trailer.locate(oPrime), "O' itself carries the commitment");
    const r = await member(again.proof, oPrime);
    assert.equal(r.category, "SET_MEMBER_FROM_ORIGIN", r.reason ?? "");
    assert.notEqual(r.category, "SET_NOT_MEMBER");
    assert.equal(r.placement, "trailer/1");
    const direct = await member(again.proof, byName(again, "again").bytes);
    assert.equal(direct.category, "SET_MEMBER_DIRECT");
  });
});

// ---------------------------------------------------------------------------
// The stray (mandatory)
// ---------------------------------------------------------------------------

describe("verifyFuseMember: the 51st file", () => {
  const stray51 = () => trailer.build({ original: unrelated, commitment: trailer.locate(byName(A, "original.txt").bytes)!.commitment });

  test("24. unlisted bytes carrying c read off a member: SET_NOT_MEMBER with the two-part reason and no rendered floor", async () => {
    const r = await member(A.proof, stray51());
    assert.equal(r.category, "SET_NOT_MEMBER", r.reason ?? "");
    assert.equal(r.placement, "trailer/1");
    assert.ok(r.set, "the manifest was bound");
    assert.equal(r.set!.member, null);
    assert.equal(r.set!.memberCount, 3);
    assert.deepEqual(r.statements, []);
    assert.match(r.reason!, /made after that slot existed/);
    assert.match(r.reason!, /not among the 3 members/);
    assert.match(r.reason!, /committed at position 14/);
    assert.match(r.reason!, /slot allocated at position 10/);
    assert.match(r.reason!, /does not cover them/);
    assert.equal(r.proof.valid, true);
    assert.equal(r.originDigestB64, null);
  });

  test("25. the same construction as container/1 and as a produced/1 payload", async () => {
    const asContainer = await member(A.proof, container.build({ original: unrelated, commitment: A.commitment }));
    assert.equal(asContainer.category, "SET_NOT_MEMBER", asContainer.reason ?? "");
    assert.equal(asContainer.placement, "container/1");
    assert.match(asContainer.reason!, /made after that slot existed/);
    assert.match(asContainer.reason!, /not among the 3 members/);
    for (const payload of [buildFusePayload(A.commitment), buildFusePayload(A.commitment, sha256(unrelated))]) {
      const asProduced = await member(A.proof, payload);
      assert.equal(asProduced.category, "SET_NOT_MEMBER", asProduced.reason ?? "");
      assert.equal(asProduced.placement, "produced/1");
      assert.match(asProduced.reason!, /made after that slot existed/);
      assert.match(asProduced.reason!, /not among the 3 members/);
      assert.deepEqual(asProduced.statements, []);
    }
  });

  test("26. the span policy reports on the stray without changing its category", async () => {
    const r = await member(A.proof, stray51(), { maxPositions: 0 });
    assert.equal(r.category, "SET_NOT_MEMBER");
    assert.equal(r.policy.spanExceeded, true);
    assert.equal(r.policy.maxPositions, "0");
  });
});

// ---------------------------------------------------------------------------
// Foreign set and transplants
// ---------------------------------------------------------------------------

describe("verifyFuseMember: foreign set and transplants", () => {
  test("27. a member of another set is NO_MATCH naming a different slot; the shared original is a member of each set separately", async () => {
    const bMember = byName(B, "original.txt");
    const aMember = byName(A, "original.txt");
    assert.ok(!bytesEqual(bMember.bytes, aMember.bytes), "the two sets fuse the same original under different slots");
    const bUnderA = await member(A.proof, bMember.bytes);
    assert.equal(bUnderA.category, "NO_MATCH", bUnderA.reason ?? "");
    assert.match(bUnderA.reason!, /different slot/);
    assert.ok(bUnderA.set, "A's manifest was bound; the bytes are simply not A's");
    const aUnderB = await member(B.proof, aMember.bytes);
    assert.equal(aUnderB.category, "NO_MATCH");
    assert.match(aUnderB.reason!, /different slot/);
    const underA = await member(A.proof, original);
    assert.equal(underA.category, "SET_MEMBER_FROM_ORIGIN");
    assert.equal(underA.set!.memberCount, 3);
    const underB = await member(B.proof, original);
    assert.equal(underB.category, "SET_MEMBER_FROM_ORIGIN");
    assert.equal(underB.set!.memberCount, 2);
  });

  test("28. transplant: B's member listed in a manifest signed under slot A is INVALID_SLOT_COMMITMENT, listed but on a different slot", async () => {
    const bMember = byName(B, "original.txt");
    const transplanted = buildSetManifest(A.commitment, [...A.rows, { artifact: bMember.row.artifact, origin: bMember.row.origin, placement: "trailer/1" }]);
    const proof = await mintUnder(A, transplanted);
    const r = await member(proof, bMember.bytes);
    assert.equal(r.category, "INVALID_SLOT_COMMITMENT", r.reason ?? "");
    assert.ok(r.set, "the manifest was bound");
    assert.equal(r.set!.member, null);
    assert.equal(r.set!.memberCount, 4);
    assert.match(r.reason!, /listed/);
    assert.match(r.reason!, /different slot/);
    assert.match(r.reason!, /membership without the floor is not a member verdict/);
    assert.equal(r.placement, "trailer/1");
    assert.deepEqual(r.statements, []);
    // Honest A's own members are unaffected by the extra row.
    assert.equal((await member(proof, byName(A, "note.txt").bytes)).category, "SET_MEMBER_DIRECT");
  });

  test("29. membership-only: a manifest that lists an unfused file's digest is refused for want of the floor", async () => {
    const listedPlain = buildSetManifest(A.commitment, [{ artifact: sha256(original), origin: sha256(original), placement: "trailer/1" }, ...A.rows]);
    const proof = await mintUnder(A, listedPlain);
    const r = await member(proof, original);
    assert.equal(r.category, "INVALID_SLOT_COMMITMENT", r.reason ?? "");
    assert.match(r.reason!, /no trailer\/1 commitment/);
    assert.match(r.reason!, /membership without the floor/);
    assert.ok(r.set);
    assert.equal(r.set!.member, null);
    assert.equal(r.placement, "trailer/1");
  });

  test("30. a row whose origin contradicts what the fused bytes embed is INVALID_ORIGIN_ATTRIBUTION; the wrongly listed origin cannot rebuild", async () => {
    const pngContainer = byName(A, "image.png");
    const noteTrailer = byName(A, "note.txt");
    const lying = buildSetManifest(A.commitment, [
      { artifact: pngContainer.row.artifact, origin: sha256(original), placement: "container/1" },
      { artifact: noteTrailer.row.artifact, origin: sha256(png), placement: "trailer/1" },
    ]);
    const proof = await mintUnder(A, lying);
    const c = await member(proof, pngContainer.bytes);
    assert.equal(c.category, "INVALID_ORIGIN_ATTRIBUTION", c.reason ?? "");
    assert.match(c.reason!, /origin digest listed for this member does not match the origin inside the fused bytes/);
    assert.equal(c.placement, "container/1");
    assert.equal(c.set!.member, null);
    const t = await member(proof, noteTrailer.bytes);
    assert.equal(t.category, "INVALID_ORIGIN_ATTRIBUTION", t.reason ?? "");
    assert.equal(t.placement, "trailer/1");
    const o = await member(proof, original);
    assert.equal(o.category, "RECONSTRUCTION_MISMATCH", o.reason ?? "");
    assert.match(o.reason!, /rebuilding container\/1 from this file/);
    const p = await member(proof, png);
    assert.equal(p.category, "RECONSTRUCTION_MISMATCH", p.reason ?? "");
    assert.match(p.reason!, /rebuilding trailer\/1 from this file/);
  });

  test("31. a listed origin whose rebuild does not reproduce the row, or whose placement is not byte-exact, is RECONSTRUCTION_MISMATCH", async () => {
    const wrong = buildSetManifest(A.commitment, [{ artifact: sha256(utf8("not the trailer")), origin: sha256(original), placement: "trailer/1" }]);
    const r = await member(await mintUnder(A, wrong), original);
    assert.equal(r.category, "RECONSTRUCTION_MISMATCH", r.reason ?? "");
    assert.equal(r.placement, "trailer/1");
    assert.match(r.reason!, /does not reproduce the listed member digest/);
    const produced = buildSetManifest(A.commitment, [{ artifact: sha256(buildFusePayload(A.commitment, sha256(original))), origin: sha256(original), placement: "produced/1" }]);
    const p = await member(await mintUnder(A, produced), original);
    assert.equal(p.category, "RECONSTRUCTION_MISMATCH", p.reason ?? "");
    assert.equal(p.placement, "produced/1");
  });
});

// ---------------------------------------------------------------------------
// Manifest binding failures
// ---------------------------------------------------------------------------

describe("verifyFuseMember: manifest binding", () => {
  const stray51 = () => trailer.build({ original: unrelated, commitment: A.commitment });

  test("32. metadata with the stray appended as a row is INVALID_SET_MANIFEST for the stray and for a genuine member alike", async () => {
    const stray = stray51();
    const tampered = withMetadata(A.proof, (m) => {
      m.members.push({ artifact: digestField(sha256(stray)), origin: digestField(sha256(unrelated)), placement: "trailer/1" });
      m.members.sort((x, y) => (x.artifact.digest < y.artifact.digest ? -1 : 1));
    });
    const s = await member(tampered, stray);
    assert.equal(s.category, "INVALID_SET_MANIFEST", s.reason ?? "");
    assert.notEqual(s.category, "SET_MEMBER_DIRECT");
    assert.equal(s.proof.valid, true);
    assert.equal(s.set, null);
    assert.match(s.reason!, /does not hash to the committed artifact digest/);
    const g = await member(tampered, byName(A, "original.txt").bytes);
    assert.equal(g.category, "INVALID_SET_MANIFEST");
    assert.equal(g.proof.valid, true);
    assert.equal(g.set, null);
  });

  test("33. a removed row, reordered rows, a changed placement, a changed digest, or an uppercased digest: INVALID_SET_MANIFEST", async () => {
    const genuine = byName(A, "note.txt").bytes;
    const variants: Array<[string, (m: SetManifest) => void]> = [
      ["row removed", (m) => { m.members.pop(); }],
      ["rows reordered", (m) => { m.members.reverse(); }],
      ["placement changed", (m) => { m.members[0]!.placement = m.members[0]!.placement === "trailer/1" ? "container/1" : "trailer/1"; }],
      ["digest changed", (m) => { m.members[1]!.origin.digest = bytesToHex(sha256(unrelated)); }],
      ["digest uppercased", (m) => { m.members[2]!.artifact.digest = m.members[2]!.artifact.digest.toUpperCase(); }],
      ["commitment changed", (m) => { m.slotCommitment.digest = bytesToHex(B.commitment); }],
    ];
    for (const [label, mutate] of variants) {
      const r = await member(withMetadata(A.proof, mutate), genuine);
      assert.equal(r.category, "INVALID_SET_MANIFEST", label);
      assert.equal(r.set, null, label);
      assert.equal(r.proof.valid, true, label);
    }
  });

  test("34. metadata with shuffled object keys but identical content is laundered by re-canonicalization", async () => {
    const o = asObject(A.manifest);
    const p = structuredClone(A.proof);
    p.metadata = { [SET_METADATA_KEY]: { type: o.type, slotCommitment: o.slotCommitment, placement: o.placement, members: o.members.map((r) => ({ placement: r.placement, origin: { digest: r.origin.digest, algorithm: r.origin.algorithm }, artifact: r.artifact })) } };
    const r = await member(p, byName(A, "image.png").bytes);
    assert.equal(r.category, "SET_MEMBER_DIRECT", r.reason ?? "");
    assert.equal(r.set!.manifestSource, "metadata");
  });

  test("35. no metadata, or a JSON string under the key, is INVALID_SET_MANIFEST naming the key", async () => {
    const bare = await mintUnder(A, A.manifest, { withMetadata: false });
    const r = await member(bare, byName(A, "original.txt").bytes);
    assert.equal(r.category, "INVALID_SET_MANIFEST");
    assert.match(r.reason!, /bitgraph-fuse\/1/);
    assert.match(r.reason!, /none supplied/);
    assert.equal(r.set, null);
    const str = structuredClone(A.proof);
    str.metadata = { [SET_METADATA_KEY]: dec(A.manifest) };
    const s = await member(str, byName(A, "original.txt").bytes);
    assert.equal(s.category, "INVALID_SET_MANIFEST");
    assert.match(s.reason!, /bitgraph-fuse\/1/);
  });

  test("36. a hash match never rescues encoding: pretty-printed bytes signed as the artifact are not canonical", async () => {
    const pretty = enc(JSON.stringify(asObject(A.manifest), null, 2));
    const proof = await mintUnder(A, pretty);
    assert.equal(proof.artifact.digestB64, bytesToBase64(sha256(pretty)));
    const r = await member(proof, byName(A, "original.txt").bytes, { manifest: pretty });
    assert.equal(r.category, "INVALID_SET_MANIFEST");
    assert.match(r.reason!, /not canonical/);
    assert.equal(r.set, null);
    const viaMetadata = await member(proof, byName(A, "original.txt").bytes);
    assert.equal(viaMetadata.category, "INVALID_SET_MANIFEST", "the re-canonicalized metadata no longer hashes to the pretty artifact");
    assert.match(viaMetadata.reason!, /does not hash/);
  });

  test("37. explicit bytes win: bad explicit bytes are refused despite correct metadata; correct explicit bytes rescue tampered metadata", async () => {
    const genuine = byName(A, "note.txt").bytes;
    const text = dec(A.manifest);
    const bad: Array<[string, Uint8Array]> = [
      ["duplicate keys", enc(text.replace('"type":"bitgraph-fuse/1"', '"type":"bitgraph-fuse/1","type":"bitgraph-fuse/1"'))],
      ["uppercase hex", enc(text.replace(/"digest":"([0-9a-f]{8})/, (_m, h: string) => `"digest":"${h.toUpperCase()}`))],
      ["whitespace", enc(JSON.stringify(asObject(A.manifest), null, 1))],
    ];
    for (const [label, explicit] of bad) {
      const r = await member(A.proof, genuine, { manifest: explicit });
      assert.equal(r.category, "INVALID_SET_MANIFEST", label);
      assert.match(r.reason!, /not canonical/, label);
      assert.equal(r.set, null, label);
    }
    const foreign = await member(A.proof, genuine, { manifest: B.manifest });
    assert.equal(foreign.category, "INVALID_SET_MANIFEST");
    assert.match(foreign.reason!, /does not hash to the committed artifact digest/);
    const tampered = withMetadata(A.proof, (m) => { m.members.pop(); });
    assert.equal((await member(tampered, genuine)).category, "INVALID_SET_MANIFEST");
    const rescued = await member(tampered, genuine, { manifest: A.manifest });
    assert.equal(rescued.category, "SET_MEMBER_DIRECT", rescued.reason ?? "");
    assert.equal(rescued.set!.manifestSource, "argument");
  });

  test("38. a manifest carrying another commitment, signed as the artifact, is INVALID_SLOT_COMMITMENT for every member", async () => {
    const foreign = buildSetManifest(B.commitment, A.rows);
    const proof = await mintUnder(A, foreign);
    for (const f of A.fused) {
      const r = await member(proof, f.bytes);
      assert.equal(r.category, "INVALID_SLOT_COMMITMENT", f.name);
      assert.match(r.reason!, /committed set manifest/);
      assert.equal(r.set, null, "never bound");
      assert.equal(r.proof.valid, true);
      const o = await member(proof, f.original);
      assert.equal(o.category, "INVALID_SLOT_COMMITMENT", `${f.name} original`);
    }
  });

  test("39. the manifest bytes themselves are NO_MATCH here: verifyFuse answers for the manifest", async () => {
    const r = await member(A.proof, A.manifest);
    assert.equal(r.category, "NO_MATCH");
    assert.match(r.reason!, /verifyFuse/);
    assert.ok(r.set, "the manifest was bound before the answer");
    assert.equal(r.set!.member, null);
  });
});

// ---------------------------------------------------------------------------
// Proof-level failures
// ---------------------------------------------------------------------------

describe("verifyFuseMember: the proof", () => {
  test("40. a set proof without its slot record is INVALID_SLOT_COMMITMENT", async () => {
    const p = structuredClone(A.proof);
    delete p.slotAllocation;
    const r = await member(p, byName(A, "original.txt").bytes);
    assert.equal(r.category, "INVALID_SLOT_COMMITMENT", r.reason ?? "");
    assert.equal(r.proof.valid, true);
    assert.match(r.reason!, /no slot record/);
    assert.equal(r.set, null);
  });

  test("41. a proof not marked set/1 is INVALID_SET_MANIFEST; the fused name with no title is refused, and verifyFuse agrees on its manifest", async () => {
    const genuine = byName(A, "original.txt").bytes;
    const titled = await mintUnder(A, A.manifest, { attribution: fuseAttribution("trailer/1") });
    const t = await member(titled, genuine);
    assert.equal(t.category, "INVALID_SET_MANIFEST");
    assert.match(t.reason!, /not marked set\/1/);
    assert.equal(t.set, null);
    const none = await mintUnder(A, A.manifest, { attribution: null });
    const n = await member(none, genuine);
    assert.equal(n.category, "INVALID_SET_MANIFEST");
    assert.match(n.reason!, /not marked set\/1/);
    for (const name of ["trailer.proof.json", "recorded.proof.json"]) {
      const r = await member(proofOf(name), bytes("fused-trailer.bin"));
      assert.equal(r.category, "INVALID_SET_MANIFEST", name);
      assert.match(r.reason!, /not marked set\/1/);
      assert.equal(r.proof.valid, true, name);
    }
    // The fused name with no title: set/1 is not in the undeclared scan, so
    // verifyFuse finds no commitment in the manifest and reports
    // INVALID_SLOT_COMMITMENT. The member verifier must not admit members
    // of a proof whose manifest verifyFuse rejects: the two agree.
    const undeclared = await mintUnder(A, A.manifest, { attribution: { name: "bitgraph-fuse/1" } });
    const uf = await fuse(undeclared, A.manifest);
    assert.equal(uf.category, "INVALID_SLOT_COMMITMENT");
    assert.equal(uf.marker?.placement, null);
    for (const file of [genuine, byName(A, "original.txt").original, byName(A, "image.png").bytes]) {
      const u = await member(undeclared, file);
      assert.equal(u.category, "INVALID_SET_MANIFEST", u.reason ?? "");
      assert.match(u.reason!, /not marked set\/1/);
      assert.equal(u.marker?.placement, null);
      assert.equal(u.set, null);
    }
  });

  test("49. a set marker never carries an origin: fuseAttribution refuses one, and a hand-built set/1 marker with an origin is INVALID_SET_MANIFEST", async () => {
    const o = byName(A, "original.txt");
    assert.throws(() => fuseAttribution("set/1", new Uint8Array(32)), /no single origin/);
    assert.throws(() => fuseAttribution("set/1", sha256(o.original)), /no single origin/);
    assert.doesNotThrow(() => fuseAttribution("set/1"));
    assert.doesNotThrow(() => fuseAttribution("trailer/1", sha256(o.original)));
    // An out-of-profile producer signs the origin of a listed member into a set/1 marker.
    const withOrigin: Attribution = { name: "bitgraph-fuse/1", title: "set/1", message: b64(sha256(o.original)) };
    const proof = await mintUnder(A, A.manifest, { attribution: withOrigin });
    assert.equal((await fuse(proof, A.manifest)).category, "FUSED_DIRECT");
    for (const file of [o.original, o.bytes, byName(A, "image.png").bytes]) {
      const r = await member(proof, file);
      assert.equal(r.category, "INVALID_SET_MANIFEST", r.reason ?? "");
      assert.match(r.reason!, /no single origin/);
      assert.equal(r.proof.valid, true);
      assert.equal(r.set, null);
      assert.equal(r.marker?.placement, "set/1");
    }
  });

  test("42. tampering with the signed proof or the slot record is INVALID_UNDERLYING_PROOF and never downgrades; a trust policy applies", async () => {
    const genuine = byName(A, "original.txt").bytes;
    const cases: Array<[string, (p: BitGraphProof) => void]> = [
      ["counter", (p) => { p.commit.counter = "15"; }],
      ["attribution.title", (p) => { p.attribution!.title = "trailer/1"; }],
      ["artifact digest", (p) => { p.artifact.digestB64 = bytesToBase64(sha256(unrelated)); }],
      ["slot nonce", (p) => { p.slotAllocation!.nonceB64 = bytesToBase64(new Uint8Array(32)); }],
      ["signature", (p) => { p.signer.signatureB64 = bytesToBase64(new Uint8Array(64)); }],
    ];
    for (const [label, mutate] of cases) {
      const p = structuredClone(A.proof);
      mutate(p);
      const r = await member(p, genuine);
      assert.equal(r.category, "INVALID_UNDERLYING_PROOF", label);
      assert.equal(r.proof.valid, false, label);
      assert.deepEqual(r.statements, [], label);
      assert.equal(r.set, null, label);
      assert.ok(r.reason, label);
    }
    const policy = await member(A.proof, genuine, { trustAnchors: { allowedMeasurements: ["00".repeat(48)] } });
    assert.equal(policy.category, "INVALID_UNDERLYING_PROOF");
    assert.match(policy.reason!, /measurement/i);
    const allowed = await member(A.proof, genuine, { trustAnchors: { allowedMeasurements: ["test-measurement-set"], requireSlot: true } });
    assert.equal(allowed.category, "SET_MEMBER_DIRECT");
  });

  test("43. an unregistered row placement is UNDETERMINED_PLACEMENT for that member and its origin only", async () => {
    const noteTrailer = byName(A, "note.txt");
    const xmp = buildSetManifest(A.commitment, [byName(A, "original.txt").row, byName(A, "image.png").row, { ...noteTrailer.row, placement: "xmp/9" }]);
    const proof = await mintUnder(A, xmp);
    const direct = await member(proof, noteTrailer.bytes);
    assert.equal(direct.category, "UNDETERMINED_PLACEMENT", direct.reason ?? "");
    assert.match(direct.reason!, /xmp\/9/);
    assert.equal(direct.placement, null);
    assert.equal(direct.set!.member, null);
    const origin = await member(proof, note);
    assert.equal(origin.category, "UNDETERMINED_PLACEMENT", origin.reason ?? "");
    assert.match(origin.reason!, /xmp\/9/);
    assert.equal((await member(proof, byName(A, "original.txt").bytes)).category, "SET_MEMBER_DIRECT");
    assert.equal((await member(proof, byName(A, "image.png").bytes)).category, "SET_MEMBER_DIRECT");
    assert.equal((await member(proof, png)).category, "SET_MEMBER_FROM_ORIGIN");
  });

  test("44. unrelated bytes and a member with a flipped commitment bit are NO_MATCH; a flipped content bit is the 51st file", async () => {
    const r = await member(A.proof, unrelated);
    assert.equal(r.category, "NO_MATCH");
    assert.match(r.reason!, /neither a listed member nor a listed original/);
    const f = byName(A, "original.txt").bytes.slice();
    f[f.length - 1] = f[f.length - 1]! ^ 1; // a commitment byte
    const c = await member(A.proof, f);
    assert.equal(c.category, "NO_MATCH");
    assert.match(c.reason!, /different slot/);
    // A content bit flipped leaves the trailer intact: the bytes still carry c
    // and are listed nowhere, which is byte for byte the 51st-file shape. The
    // two-part verdict is mandatory there, so it cannot be NO_MATCH.
    const content = byName(A, "original.txt").bytes.slice();
    content[3] = content[3]! ^ 1;
    const s = await member(A.proof, content);
    assert.equal(s.category, "SET_NOT_MEMBER");
    assert.match(s.reason!, /made after that slot existed/);
    assert.match(s.reason!, /not among the 3 members/);
  });
});

// ---------------------------------------------------------------------------
// Invariants and wiring
// ---------------------------------------------------------------------------

describe("invariants and wiring", () => {
  test("47. the span policy on a member reports separately and never changes the category", async () => {
    const f = byName(A, "image.png");
    const r = await member(A.proof, f.bytes, { maxPositions: 0 });
    assert.equal(r.category, "SET_MEMBER_DIRECT");
    assert.equal(r.policy.spanExceeded, true);
    assert.equal(r.policy.maxPositions, "0");
    const ok = await member(A.proof, f.bytes, { maxPositions: 1_000_000 });
    assert.equal(ok.policy.spanExceeded, false);
    assert.equal(ok.policy.maxPositions, "1000000");
    const o = await member(A.proof, png, { maxPositions: 3 });
    assert.equal(o.category, "SET_MEMBER_FROM_ORIGIN");
    assert.equal(o.policy.spanExceeded, true);
  });

  test("45. over every result in this file: member iff member category; bound implies the signed digest; statements only on members; shape parity", async () => {
    assert.ok(collected.length > 80, `collected ${collected.length} results`);
    const memberCategories = new Set(["SET_MEMBER_DIRECT", "SET_MEMBER_FROM_ORIGIN"]);
    let members = 0;
    for (const { proof, bytes: file, result: r } of collected) {
      const isMember = memberCategories.has(r.category);
      if (isMember) members++;
      assert.equal(r.set !== null && r.set.member !== null, isMember, `${r.category}: set.member`);
      if (r.set !== null) assert.equal(r.set.manifestDigestB64, r.artifactDigestB64, `${r.category}: bound digest`);
      if (!isMember) assert.deepEqual(r.statements, [], `${r.category}: statements`);
      else assert.ok(r.statements.length >= 2, `${r.category}: statements`);
      if (r.category === "SET_NOT_MEMBER") assert.ok(r.set !== null && r.set.member === null && r.reason !== null);
      if (r.category === "INVALID_UNDERLYING_PROOF") assert.equal(r.set, null);
      resetEpochLinkState();
      const shape = await verifyFuse({ proof, bytes: file });
      assert.deepEqual(Object.keys(r).filter((k) => k !== "set"), Object.keys(shape), `${r.category}: field parity with verifyFuse`);
    }
    assert.ok(members >= 20, `${members} member verdicts`);
  });

  test("46. structural guard: each member category string is a value exactly once in dist/fuse-member.js, inside memberResult", () => {
    const src = readFileSync(fileURLToPath(new URL("../../packages/verify/dist/fuse-member.js", import.meta.url)), "utf8");
    for (const name of ["SET_MEMBER_DIRECT", "SET_MEMBER_FROM_ORIGIN"]) {
      const quoted = src.match(new RegExp(`"${name}"`, "g")) ?? [];
      assert.equal(quoted.length, 1, name);
    }
    const memberResult = src.indexOf("const memberResult = ");
    assert.ok(memberResult >= 0);
    assert.ok(src.indexOf('"SET_MEMBER_DIRECT"') > memberResult);
    assert.ok(src.indexOf('"SET_MEMBER_FROM_ORIGIN"') > memberResult);
    assert.ok(!src.includes("export function admit"), "admit is module-private");
    assert.ok(!src.includes("export function bindSetManifest"), "bindSetManifest is module-private");
  });

  test("48. test:core lists this file", () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as { scripts: Record<string, string> };
    assert.ok(pkg.scripts["test:core"]!.split(" ").includes("dist/__tests__/fuse-set.test.js"));
  });
});
