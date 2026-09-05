// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * fuseSet() against a fake transport whose commit answer MINTS the proof from
 * the body it received, under the slot it handed out, with a local signer:
 * the returned proof therefore matches what the SDK sent and verifies for
 * real. Every refusal path runs, every happy path is compared against an
 * independent oracle, and every negative case runs against the real
 * verifier. Nothing here touches a ledger or a network.
 */

import { describe, test, before } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { signAsync } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import {
  getPlacement,
  canonicalize,
  canonicalSlotBody,
  computeSlotCommitment,
  buildSetManifest,
  parseSetManifest,
  fuseAttribution,
  verifyFuse,
  verifyFuseMember,
  bytesToBase64,
  bytesToHex,
  SET_METADATA_KEY,
} from "@mikeargento/bitgraph-verify";
import type { BitGraphProof, SlotAllocation, Attribution, SetMember, SetManifest } from "@mikeargento/bitgraph-verify";
import { makeKey, signBody, b64, utf8 } from "./audit-fixtures.js";
import type { ManualKey } from "./audit-fixtures.js";
import { fuse, fuseSet, builderFor, placementForBytes, fusedNamesFor, FuseError, MAX_SET_MEMBERS, digest, trailerBytesFor } from "../fuse.js";
import type { FuseSetProgress, FuseSetBytesMember, FuseSetLoadedMember, FuseSetHashedMember, FusedDigestInput } from "../fuse.js";
import type { FuseSetMember } from "../fuse.js";

const FIX = fileURLToPath(new URL("../../src/__tests__/fuse-fixtures/", import.meta.url));
const bytes = (name: string) => new Uint8Array(readFileSync(FIX + name));
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

const original = bytes("original.txt");
const png = bytes("image.png");
const note = utf8("a third member, plain text made for the set\n");
const unrelated = utf8("a file nobody recorded\n");

// The phase-1 fixtures fuse original.txt as trailer/1 and image.png as
// container/1, so these members declare those placements; the by-bytes
// default (placementForBytes) is asserted on its own in test 3.
const two = (): FuseSetBytesMember[] => [{ original, placement: "trailer/1" }, { original: png, placement: "container/1" }];

// ---------------------------------------------------------------------------
// Local signer: slots and proofs minted from a received commit body
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

/** The commit body the SDK sends, as the fake boundary receives it. */
interface CommitBody {
  digests: Array<{ digestB64: string; hashAlg: string }>;
  slotId: string;
  slot: SlotAllocation;
  chainId: string;
  attribution: Attribution;
  metadata?: Record<string, unknown>;
  agency?: unknown;
}

interface MintOptions {
  key: ManualKey;
  slot: SlotAllocation;
  /** The received body: its digest, attribution and metadata become the proof's. */
  body: CommitBody;
  commitCounter?: string;
  /** Attach the body's metadata under proof.metadata (default true). */
  withMetadata?: boolean;
  /** Override the signed attribution; null for none at all. */
  attribution?: Attribution | null;
  /** Override the artifact digest; the proof stays validly signed. */
  artifactDigestB64?: string;
}

/** A proof minted from a received body under `slot`: the digest is the artifact, the attribution is signed, the slot is consumed. */
async function mintFromBody(o: MintOptions): Promise<BitGraphProof> {
  const commit: BitGraphProof["commit"] = {
    nonceB64: o.slot.nonceB64,
    counter: o.commitCounter ?? (BigInt(o.slot.counter) + 4n).toString(),
    epochId: o.slot.epochId,
    slotCounter: o.slot.counter,
    slotHashB64: b64(sha256(canonicalize(canonicalSlotBody(o.slot)))),
  };
  (commit as unknown as Record<string, unknown>)["chainId"] = "bitgraph:main";
  const attribution = o.attribution === undefined ? o.body.attribution : o.attribution;
  const proof = await signBody(
    o.key,
    { hashAlg: "sha256", digestB64: o.artifactDigestB64 ?? o.body.digests[0]!.digestB64 },
    commit,
    "test-measurement-set",
    attribution === null ? undefined : { attribution },
  );
  proof.slotAllocation = o.slot;
  if (o.withMetadata !== false && o.body.metadata !== undefined) proof.metadata = structuredClone(o.body.metadata);
  return proof;
}

// ---------------------------------------------------------------------------
// Fake transport, in the fuse-sdk style
// ---------------------------------------------------------------------------

interface Call { path: string; body: unknown }
interface Answer { status: number; json: unknown }
type CommitAnswer = (calls: Call[], body: CommitBody) => Answer | Promise<Answer>;
type LookupAnswer = (calls: Call[]) => Answer | Promise<Answer>;
type AllocateAnswer = (calls: Call[]) => Answer;

/** A transport that hands out `slot` and answers the commit with `commit`; a lookup and an allocate answer are optional. */
function fakeTransport(slot: SlotAllocation, commit: CommitAnswer, lookup?: LookupAnswer, allocate?: AllocateAnswer) {
  const calls: Call[] = [];
  const f: typeof fetch = async (input, init) => {
    const url = String(input);
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });
    const reply = (r: Answer) => new Response(JSON.stringify(r.json), { status: r.status, headers: { "Content-Type": "application/json" } });
    if (path === "/api/fuse/allocate") return reply(allocate ? allocate(calls) : { status: 200, json: { slotId: slot.nonceB64, slot, chainId: "bitgraph:main" } });
    if (path === "/api/fuse/commit") return reply(await commit(calls, body as CommitBody));
    if (path.startsWith("/api/proofs/")) return reply(lookup ? await lookup(calls) : { status: 200, json: { proofs: [] } });
    return reply({ status: 404, json: { error: "no route" } });
  };
  return { calls, transport: { baseUrl: "https://example.test", fetch: f, recoveryAttempts: 2, recoveryDelayMs: 1 } };
}

/** The honest boundary: mints the proof from the received body under the slot it handed out. */
function honest(key: ManualKey, slot: SlotAllocation, mint: Omit<MintOptions, "key" | "slot" | "body"> = {}) {
  return fakeTransport(slot, async (_calls, body) => ({ status: 200, json: { proof: await mintFromBody({ key, slot, body, ...mint }) } }));
}

const allocates = (calls: Call[]) => calls.filter((c) => c.path === "/api/fuse/allocate");
const commits = (calls: Call[]) => calls.filter((c) => c.path === "/api/fuse/commit");
const toUrlSafe = (s: string) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ---------------------------------------------------------------------------
// The oracle: what the SDK must send, computed independently
// ---------------------------------------------------------------------------

interface Oracle { commitment: Uint8Array; fused: Uint8Array[]; rows: SetMember[]; manifest: Uint8Array; digestB64: string; sorted: SetMember[] }

/** The commitment from the slot, each member built by its placement, the canonical manifest and its digest. */
function oracle(slot: SlotAllocation, members: readonly FuseSetBytesMember[]): Oracle {
  const commitment = computeSlotCommitment(slot);
  const placementOf = (m: FuseSetBytesMember) => m.placement ?? placementForBytes(m.original);
  const fused = members.map((m) => getPlacement(placementOf(m))!.build({ original: m.original, commitment }));
  const rows = members.map((m, i) => ({ artifact: sha256(fused[i]!), origin: sha256(m.original), placement: placementOf(m) }));
  const manifest = buildSetManifest(commitment, rows);
  return { commitment, fused, rows, manifest, digestB64: bytesToBase64(sha256(manifest)), sorted: parseSetManifest(manifest)!.members };
}

const expectedBody = (slot: SlotAllocation, o: Oracle): CommitBody => ({
  digests: [{ digestB64: o.digestB64, hashAlg: "sha256" }],
  slotId: slot.nonceB64,
  slot,
  chainId: "bitgraph:main",
  attribution: { name: "bitgraph-fuse/1", title: "set/1" },
  metadata: { [SET_METADATA_KEY]: JSON.parse(dec(o.manifest)) as SetManifest },
});

let key!: ManualKey;
let slot!: SlotAllocation;
let other!: SlotAllocation;

before(async () => {
  key = await makeKey();
  slot = await allocateSlot(key, "10");
  other = await allocateSlot(key, "20");
});

// ---------------------------------------------------------------------------
// The beats
// ---------------------------------------------------------------------------

describe("fuseSet(): one slot, N files, the manifest as the artifact", () => {
  test("1. a trailer/1 and a container/1 member: one allocate, one commit, the whole body byte for byte against the oracle", async () => {
    const members = two();
    const o = oracle(slot, members);
    const { calls, transport } = honest(key, slot);
    await fuseSet(members, { transport });
    assert.equal(allocates(calls).length, 1);
    assert.equal(commits(calls).length, 1);
    const body = commits(calls)[0]!.body as Record<string, unknown>;
    assert.deepEqual(body, expectedBody(slot, o));
    assert.deepEqual(Object.keys(body), ["digests", "slotId", "slot", "chainId", "attribution", "metadata"]);
    assert.deepEqual(body.attribution, { name: "bitgraph-fuse/1", title: "set/1" });
    assert.ok(!("message" in (body.attribution as object)), "a set has no single origin");
    assert.ok(!("agency" in body));
    assert.deepEqual(body.metadata, { [SET_METADATA_KEY]: JSON.parse(dec(o.manifest)) });
    // The raw nonce rides only where the protocol needs it: the slot record and the slotId that names it.
    const { slot: _slot, slotId: _slotId, ...rest } = body;
    assert.ok(!JSON.stringify(rest).includes(slot.nonceB64));
  });

  test("2. the result: manifest bytes, digests, commitment, flags, and the manifest's own verification", async () => {
    const members = two();
    const o = oracle(slot, members);
    const r = await fuseSet(members, { transport: honest(key, slot).transport });
    assert.deepEqual(r.manifestBytes, o.manifest);
    assert.equal(r.artifactDigestB64, bytesToBase64(sha256(r.manifestBytes)));
    assert.equal(r.artifactDigestB64, r.proof.artifact.digestB64);
    assert.equal(r.artifactDigestB64, o.digestB64);
    assert.deepEqual(r.manifest, JSON.parse(dec(r.manifestBytes)));
    assert.equal(r.slotCommitmentB64, bytesToBase64(o.commitment));
    assert.equal(r.recovered, false);
    assert.equal(r.manifestEchoed, true);
    assert.equal(r.verification.category, "FUSED_DIRECT", r.verification.reason ?? "");
    assert.equal(r.verification.placement, "set/1");
    assert.equal(r.verification.originDigestB64, null);
    assert.equal(r.proof.attribution?.title, "set/1");
  });

  test("3. members come back in the caller's order, each with its manifest row and its names; with verifyMembers each is SET_MEMBER_DIRECT against explicit bytes", async () => {
    const members = two();
    members[0]!.name = "photo.jpg";
    const o = oracle(slot, members);
    const r = await fuseSet(members, { transport: honest(key, slot).transport, verifyMembers: true });
    assert.deepEqual(r.members.map((m) => m.index), [0, 1]);
    for (const m of r.members) {
      const row = o.rows[m.index]!;
      assert.equal(m.placement, row.placement);
      assert.equal(m.originDigestB64, bytesToBase64(row.origin));
      assert.equal(m.artifactDigestB64, bytesToBase64(row.artifact));
      assert.equal(m.manifestIndex, o.sorted.findIndex((s) => bytesToHex(s.artifact) === bytesToHex(row.artifact)));
      assert.equal(m.manifestIndex, m.verification!.set!.member!.index);
      assert.ok(!("fusedBytes" in m), "not kept by default");
      assert.equal(m.verification!.category, "SET_MEMBER_DIRECT", m.verification!.reason ?? "");
      assert.equal(m.verification!.set!.manifestSource, "argument");
      assert.equal(m.verification!.set!.member!.fusedDigestB64, m.artifactDigestB64);
      assert.equal(m.verification!.set!.memberCount, 2);
    }
    // Without verifyMembers the same rows come back bound by digest, and no verdict is invented.
    const plain = await fuseSet(members, { transport: honest(key, slot).transport });
    assert.deepEqual(plain.members.map((m) => [m.index, m.manifestIndex, m.placement, m.originDigestB64, m.artifactDigestB64]), r.members.map((m) => [m.index, m.manifestIndex, m.placement, m.originDigestB64, m.artifactDigestB64]));
    for (const m of plain.members) assert.ok(!("verification" in m), "no verifier verdict without verifyMembers");
    assert.deepEqual({ fusedName: r.members[0]!.fusedName, frameName: r.members[0]!.frameName }, fusedNamesFor("photo.jpg", "trailer/1"));
    assert.equal(r.members[1]!.fusedName, null);
    assert.equal(r.members[1]!.frameName, null);
    // The by-bytes default: PNG is trailer-safe, plain text goes into a container.
    const d = await fuseSet([{ original: png }, { original }], { transport: honest(key, slot).transport });
    assert.deepEqual(d.members.map((m) => m.placement), [placementForBytes(png), placementForBytes(original)]);
    assert.deepEqual(d.members.map((m) => m.placement), ["trailer/1", "container/2"]);
  });

  test("4. each original rebuilds its member (SET_MEMBER_FROM_ORIGIN); with the echo stripped and no explicit bytes nothing is bound", async () => {
    const members = two();
    const r = await fuseSet(members, { transport: honest(key, slot).transport });
    for (const m of r.members) {
      const v = await verifyFuseMember({ proof: r.proof, bytes: members[m.index]!.original, manifest: r.manifestBytes });
      assert.equal(v.category, "SET_MEMBER_FROM_ORIGIN", v.reason ?? "");
      assert.equal(v.set!.member!.index, m.manifestIndex);
      assert.equal(v.placement, m.placement);
    }
    const stripped = structuredClone(r.proof);
    delete stripped.metadata;
    const fused = getPlacement("trailer/1")!.build({ original, commitment: computeSlotCommitment(slot) });
    const unbound = await verifyFuseMember({ proof: stripped, bytes: fused });
    assert.equal(unbound.category, "INVALID_SET_MANIFEST");
    assert.equal(unbound.set, null);
    // Which is why manifestBytes is kept beside the proof.
    assert.equal((await verifyFuseMember({ proof: stripped, bytes: fused, manifest: r.manifestBytes })).category, "SET_MEMBER_DIRECT");
  });

  test("5. verifyFuse answers for the manifest and knows nothing about a member", async () => {
    const r = await fuseSet(two(), { transport: honest(key, slot).transport });
    const m = await verifyFuse({ proof: r.proof, bytes: r.manifestBytes });
    assert.equal(m.category, "FUSED_DIRECT", m.reason ?? "");
    assert.equal(m.placement, "set/1");
    const fused = getPlacement("trailer/1")!.build({ original, commitment: computeSlotCommitment(slot) });
    assert.equal((await verifyFuse({ proof: r.proof, bytes: fused })).category, "NO_MATCH");
  });

  test("6. an agency envelope passes through untouched, and is absent otherwise", async () => {
    const a = honest(key, slot);
    await fuseSet(two(), { transport: a.transport, agency: { x: 1 } });
    assert.deepEqual((commits(a.calls)[0]!.body as { agency?: unknown }).agency, { x: 1 });
    const b = honest(key, slot);
    await fuseSet(two(), { transport: b.transport });
    assert.ok(!("agency" in (commits(b.calls)[0]!.body as object)));
  });
});

// ---------------------------------------------------------------------------
// Refusals after the slot is held: nothing is committed
// ---------------------------------------------------------------------------

describe("fuseSet(): a bad member burns the slot and commits nothing", () => {
  test("7. a member whose builder drops the commitment is commitment-missing, naming the member; no commit, one allocate", async () => {
    const { calls, transport } = honest(key, slot);
    const members = two();
    members[1]!.builder = () => original;
    await assert.rejects(fuseSet(members, { transport }), (e: FuseError) => {
      assert.equal(e.code, "commitment-missing");
      assert.match(e.message, /^member 1:/);
      assert.equal(e.member, 1);
      assert.ok(!e.message.includes(slot.nonceB64));
      return true;
    });
    assert.equal(commits(calls).length, 0, "no commit was attempted");
    assert.equal(allocates(calls).length, 1);
  });

  test("8. a builder that throws, or returns something other than bytes, is builder-failed naming the member", async () => {
    const a = honest(key, slot);
    const throwing = two();
    throwing[0]!.builder = () => { throw new Error("disk full"); };
    await assert.rejects(fuseSet(throwing, { transport: a.transport }), (e: FuseError) => e.code === "builder-failed" && /^member 0: the builder threw: disk full/.test(e.message) && e.member === 0);
    assert.equal(commits(a.calls).length, 0);
    const b = honest(key, slot);
    const stringy = two();
    stringy[1]!.builder = (() => "not bytes") as never;
    await assert.rejects(fuseSet(stringy, { transport: b.transport }), (e: FuseError) => e.code === "builder-failed" && /^member 1: the builder must return a Uint8Array/.test(e.message) && e.member === 1);
    assert.equal(commits(b.calls).length, 0);
  });

  test("9. bytes that carry the commitment but embed another member's origin are builder-failed naming the member and the origin", async () => {
    const { calls, transport } = honest(key, slot);
    // Two trailer/1 members; member 1's builder hands back member 0's fused bytes, which carry c but embed member 0's original.
    const members: FuseSetBytesMember[] = [{ original, placement: "trailer/1" }, { original: note, placement: "trailer/1" }];
    members[1]!.builder = ({ commitment }) => getPlacement("trailer/1")!.build({ original, commitment });
    await assert.rejects(fuseSet(members, { transport }), (e: FuseError) => e.code === "builder-failed" && /member 1/.test(e.message) && /origin/.test(e.message) && e.member === 1);
    assert.equal(commits(calls).length, 0);
    assert.equal(allocates(calls).length, 1);
  });

  test("9b. container/1: bytes that declare the member's origin digest but carry other bytes are builder-failed naming the member; no commit", async () => {
    const { calls, transport } = honest(key, slot);
    const members: FuseSetBytesMember[] = [{ original, placement: "trailer/1" }, { original: png, placement: "container/1" }];
    // The payload names png's digest (so the declared origin matches) while the tar carries other bytes.
    members[1]!.builder = ({ commitment, originDigest }) => getPlacement("container/1")!.build({ original: utf8("not the member's original\n"), originDigest: originDigest!, commitment });
    await assert.rejects(fuseSet(members, { transport }), (e: FuseError) => e.code === "builder-failed" && /^member 1/.test(e.message) && /origin/.test(e.message) && e.member === 1);
    assert.equal(commits(calls).length, 0, "nothing was committed");
    assert.equal(allocates(calls).length, 1);
    // The mirror: a payload declaring another digest over the member's own bytes is refused the same way.
    const declared: FuseSetBytesMember[] = [{ original, placement: "trailer/1" }, { original: png, placement: "container/1" }];
    declared[1]!.builder = ({ commitment }) => getPlacement("container/1")!.build({ original: png, originDigest: sha256(unrelated), commitment });
    const b = honest(key, slot);
    await assert.rejects(fuseSet(declared, { transport: b.transport }), (e: FuseError) => e.code === "builder-failed" && e.member === 1);
    assert.equal(commits(b.calls).length, 0);
    // And the honest container/1 builder still passes both checks.
    const ok = await fuseSet([{ original, placement: "trailer/1" }, { original: png, placement: "container/1" }], { transport: honest(key, slot).transport, verifyMembers: true });
    assert.equal(ok.members[1]!.verification!.category, "SET_MEMBER_DIRECT");
  });
});

// ---------------------------------------------------------------------------
// Refusals before any request: no slot is burned
// ---------------------------------------------------------------------------

describe("fuseSet(): bad input is refused before any request", () => {
  test("10. the same original under the same placement twice names both members; under two placements it is two rows", async () => {
    const { calls, transport } = honest(key, slot);
    await assert.rejects(
      fuseSet([{ original, placement: "trailer/1" }, { original: png, placement: "container/1" }, { original, placement: "trailer/1" }], { transport }),
      (e: FuseError) => e.code === "bad-input" && /members 0 and 2/.test(e.message) && e.member === 2,
    );
    assert.equal(calls.length, 0, "no slot was burned");
    const r = await fuseSet([{ original, placement: "trailer/1" }, { original, placement: "container/1" }], { transport, verifyMembers: true });
    assert.equal(r.manifest.members.length, 2);
    assert.deepEqual(r.members.map((m) => m.placement), ["trailer/1", "container/1"]);
    assert.equal(r.members[0]!.originDigestB64, r.members[1]!.originDigestB64);
    assert.notEqual(r.members[0]!.artifactDigestB64, r.members[1]!.artifactDigestB64);
    for (const m of r.members) assert.equal(m.verification!.category, "SET_MEMBER_DIRECT");
  });

  test("11. an empty set and a set over the cap are refused; the cap runs before the duplicate check", async () => {
    const { calls, transport } = honest(key, slot);
    await assert.rejects(fuseSet([], { transport }), (e: FuseError) => e.code === "bad-input" && /at least one/.test(e.message));
    const same: FuseSetMember = { original, placement: "trailer/1" };
    await assert.rejects(
      fuseSet(new Array<FuseSetMember>(MAX_SET_MEMBERS + 1).fill(same), { transport }),
      (e: FuseError) => e.code === "bad-input" && /at most 2000 members \(got 2001\)/.test(e.message) && !/members 0 and 1/.test(e.message),
    );
    assert.equal(MAX_SET_MEMBERS, 2000);
    assert.equal(calls.length, 0);
  });

  test("12. a produced/1, set/1, unregistered, or non-bytes member is refused naming the member", async () => {
    const { calls, transport } = honest(key, slot);
    for (const id of ["produced/1", "set/1"]) {
      await assert.rejects(
        fuseSet([{ original, placement: "trailer/1" }, { original: png, placement: id as never }], { transport }),
        (e: FuseError) => e.code === "bad-input" && /^member 1: /.test(e.message) && e.message.includes(id) && e.member === 1,
      );
    }
    await assert.rejects(
      fuseSet([{ original, placement: "xmp/9" as never }], { transport }),
      (e: FuseError) => e.code === "bad-placement" && /^member 0: placement "xmp\/9" is not registered/.test(e.message) && e.member === 0,
    );
    await assert.rejects(
      fuseSet([{ original: "text" as never }], { transport }),
      (e: FuseError) => e.code === "bad-input" && /^member 0: original must be a Uint8Array/.test(e.message) && e.member === 0,
    );
    assert.equal(calls.length, 0);
  });

  test("12b. a null, undefined or missing member element is bad-input naming the member, never a bare TypeError", async () => {
    const { calls, transport } = honest(key, slot);
    const first: FuseSetMember = { original, placement: "trailer/1" };
    const sparse: FuseSetMember[] = [first];
    sparse.length = 2;
    for (const members of [[first, null], [first, undefined], sparse, [null]] as unknown as FuseSetMember[][]) {
      const expected = members.length === 1 ? 0 : 1;
      await assert.rejects(fuseSet(members, { transport }), (e: unknown) => {
        assert.ok(e instanceof FuseError, `not a FuseError: ${String(e)}`);
        assert.equal(e.code, "bad-input");
        assert.match(e.message, new RegExp(`^member ${expected}: original must be a Uint8Array`));
        assert.equal(e.member, expected);
        return true;
      });
    }
    assert.equal(calls.length, 0, "no slot was burned");
  });

  test("13. the member cap keeps a full manifest under half the parent's 1 MB body cap", () => {
    const rows: SetMember[] = Array.from({ length: MAX_SET_MEMBERS }, (_, i) => ({ artifact: sha256(utf8(`artifact ${i}`)), origin: sha256(utf8(`origin ${i}`)), placement: "container/1" }));
    const manifest = buildSetManifest(computeSlotCommitment(slot), rows);
    assert.ok(manifest.length + 4096 < 512 * 1024, `${manifest.length} bytes`);
  });
});

// ---------------------------------------------------------------------------
// The boundary: other slots, lost responses, refusals, restarts
// ---------------------------------------------------------------------------

describe("fuseSet(): the boundary", () => {
  test("14. a proof under a different slot is never labelled a set", async () => {
    const { transport } = fakeTransport(slot, async (_calls, body) => ({ status: 200, json: { proof: await mintFromBody({ key, slot: other, body }) } }));
    await assert.rejects(fuseSet(two(), { transport }), (e: FuseError) => e.code === "slot-mismatch");
  });

  test("15. a lost commit response is read back by the MANIFEST digest and matched on the held slot; nothing is re-allocated", async () => {
    const o = oracle(slot, two());
    const real = await mintFromBody({ key, slot, body: expectedBody(slot, o) });
    // The decoy commits the same digest under another slot: recovery must match the slot, not the digest alone.
    const decoy = await mintFromBody({ key, slot: other, body: expectedBody(slot, o) });
    const { calls, transport } = fakeTransport(
      slot,
      () => { throw new Error("socket hang up"); },
      () => ({ status: 200, json: { proofs: [{ proof: decoy }, { proof: real }] } }),
    );
    const r = await fuseSet(two(), { transport, verifyMembers: true });
    assert.equal(r.recovered, true);
    assert.deepEqual(r.proof, real);
    assert.equal(allocates(calls).length, 1);
    const lookup = calls.find((c) => c.path.startsWith("/api/proofs/"))!;
    assert.ok(lookup.path.includes(toUrlSafe(o.digestB64)), lookup.path);
    assert.equal(r.manifestEchoed, true);
    for (const m of r.members) assert.equal(m.verification!.category, "SET_MEMBER_DIRECT");
  });

  test("16. 409 slot-unavailable: read back when the ledger has the proof, else reported as slot-unavailable and never retried into a new slot", async () => {
    const o = oracle(slot, two());
    const real = await mintFromBody({ key, slot, body: expectedBody(slot, o) });
    const gone = () => ({ status: 409, json: { error: "gone", code: "slot-unavailable" } });
    const a = fakeTransport(slot, gone, () => ({ status: 200, json: { proofs: [{ proof: real }] } }));
    const r = await fuseSet(two(), { transport: a.transport });
    assert.equal(r.recovered, true);
    assert.deepEqual(r.proof, real);
    const b = fakeTransport(slot, gone);
    await assert.rejects(fuseSet(two(), { transport: b.transport }), (e: FuseError) => e.code === "slot-unavailable" && e.status === 409 && !e.message.includes(slot.nonceB64));
    assert.equal(allocates(b.calls).length, 1);
  });

  test("17. tee-restarting: on allocate nothing is committed; on commit the ledger is read back first, then reported", async () => {
    const restarting = () => ({ status: 503, json: { error: "restarting", code: "tee-restarting" } });
    const a = fakeTransport(slot, () => ({ status: 200, json: {} }), undefined, restarting);
    await assert.rejects(fuseSet(two(), { transport: a.transport }), (e: FuseError) => e.code === "tee-restarting" && e.status === 503);
    assert.equal(commits(a.calls).length, 0);
    const o = oracle(slot, two());
    const real = await mintFromBody({ key, slot, body: expectedBody(slot, o) });
    const b = fakeTransport(slot, restarting, () => ({ status: 200, json: { proofs: [{ proof: real }] } }));
    assert.equal((await fuseSet(two(), { transport: b.transport })).recovered, true);
    const c = fakeTransport(slot, restarting);
    await assert.rejects(fuseSet(two(), { transport: c.transport }), (e: FuseError) => e.code === "tee-restarting");
    assert.equal(allocates(c.calls).length, 1);
  });

  test("18. a slot off the anchored chain is refused; nothing is built or committed", async () => {
    const { calls, transport } = honest(key, { ...slot, chainId: "global" });
    await assert.rejects(fuseSet(two(), { transport }), (e: FuseError) => e.code === "allocate-failed" && /anchored chain/.test(e.message));
    assert.equal(commits(calls).length, 0);
  });
});

// ---------------------------------------------------------------------------
// The result and the verification at return
// ---------------------------------------------------------------------------

describe("fuseSet(): the result and the checks before it is returned", () => {
  test("19. keepFused returns each member's fused bytes; false and the default do not; the verifier's verdict only with verifyMembers", async () => {
    const members = two();
    const commitment = computeSlotCommitment(slot);
    const kept = await fuseSet(members, { transport: honest(key, slot).transport, keepFused: true, verifyMembers: true });
    for (const m of kept.members) {
      assert.deepEqual(m.fusedBytes, getPlacement(m.placement)!.build({ original: members[m.index]!.original, commitment }));
      assert.equal(m.verification!.category, "SET_MEMBER_DIRECT");
    }
    const keptOnly = await fuseSet(members, { transport: honest(key, slot).transport, keepFused: true });
    for (const m of keptOnly.members) {
      assert.deepEqual(m.fusedBytes, getPlacement(m.placement)!.build({ original: members[m.index]!.original, commitment }));
      assert.ok(!("verification" in m));
    }
    for (const opts of [{ keepFused: false }, {}]) {
      const r = await fuseSet(members, { transport: honest(key, slot).transport, ...opts });
      for (const m of r.members) {
        assert.ok(!("fusedBytes" in m));
        assert.ok(!("verification" in m));
      }
    }
  });

  test("20. a boundary that does not echo the manifest: success, manifestEchoed false, and with verifyMembers every member verified against the explicit bytes", async () => {
    const r = await fuseSet(two(), { transport: honest(key, slot, { withMetadata: false }).transport, verifyMembers: true });
    assert.equal(r.manifestEchoed, false);
    assert.equal(r.proof.metadata, undefined);
    assert.equal(r.verification.category, "FUSED_DIRECT");
    for (const m of r.members) {
      assert.equal(m.verification!.category, "SET_MEMBER_DIRECT", m.verification!.reason ?? "");
      assert.equal(m.verification!.set!.manifestSource, "argument");
    }
    const plain = await fuseSet(two(), { transport: honest(key, slot, { withMetadata: false }).transport });
    assert.equal(plain.manifestEchoed, false);
    assert.equal(plain.members.length, 2);
  });

  test("21. an echoed manifest that differs from the committed one is verification-failed; no result", async () => {
    const { transport } = fakeTransport(slot, async (_calls, body) => {
      const proof = await mintFromBody({ key, slot, body });
      const m = proof.metadata![SET_METADATA_KEY] as SetManifest;
      m.members[0]!.placement = m.members[0]!.placement === "trailer/1" ? "container/1" : "trailer/1";
      return { status: 200, json: { proof } };
    });
    await assert.rejects(fuseSet(two(), { transport }), (e: FuseError) => e.code === "verification-failed" && /echoes/.test(e.message));
  });

  test("22. a proof committing another digest, or signed under another title, is verification-failed", async () => {
    const a = honest(key, slot, { artifactDigestB64: bytesToBase64(sha256(unrelated)) });
    await assert.rejects(fuseSet(two(), { transport: a.transport }), (e: FuseError) => e.code === "verification-failed" && /NO_MATCH/.test(e.message) && /as a set/.test(e.message));
    const b = honest(key, slot, { attribution: fuseAttribution("trailer/1") });
    await assert.rejects(fuseSet(two(), { transport: b.transport }), (e: FuseError) => e.code === "verification-failed");
  });

  test("23. the 51st file against the real verifier: bytes carrying the commitment but listed nowhere are SET_NOT_MEMBER; unrelated bytes NO_MATCH", async () => {
    const r = await fuseSet(two(), { transport: honest(key, slot).transport });
    const stray = getPlacement("trailer/1")!.build({ original: unrelated, commitment: computeSlotCommitment(slot) });
    const s = await verifyFuseMember({ proof: r.proof, bytes: stray, manifest: r.manifestBytes });
    assert.equal(s.category, "SET_NOT_MEMBER", s.reason ?? "");
    assert.equal(s.set!.member, null);
    assert.match(s.reason!, /not among the 2 members/);
    const n = await verifyFuseMember({ proof: r.proof, bytes: unrelated, manifest: r.manifestBytes });
    assert.equal(n.category, "NO_MATCH");
  });
});

// ---------------------------------------------------------------------------
// fuse() regression and wiring
// ---------------------------------------------------------------------------

describe("wiring", () => {
  test("24. fuse() through the same transport still sends the placement and origin in the attribution and no metadata", async () => {
    const { calls, transport } = honest(key, slot);
    const r = await fuse(builderFor("trailer/1", original), { placement: "trailer/1", original, transport });
    assert.equal(r.verification.category, "FUSED_DIRECT", r.verification.reason ?? "");
    assert.equal(r.frame.type, "bitgraph-fuse/1");
    const body = commits(calls)[0]!.body as Record<string, unknown>;
    assert.deepEqual(body.attribution, { name: "bitgraph-fuse/1", title: "trailer/1", message: bytesToBase64(sha256(original)) });
    assert.ok(!("metadata" in body));
    assert.deepEqual(Object.keys(body), ["digests", "slotId", "slot", "chainId", "attribution"]);
  });

  test("25. test:core lists this file and the core index exports fuseSet and MAX_SET_MEMBERS", () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as { scripts: Record<string, string> };
    assert.ok(pkg.scripts["test:core"]!.split(" ").includes("dist/__tests__/fuse-set-sdk.test.js"));
    const index = readFileSync(fileURLToPath(new URL("../../src/index.ts", import.meta.url)), "utf8");
    assert.match(index, /export \{[^}]*\bfuseSet\b[^}]*\} from "\.\/fuse\.js"/);
    assert.match(index, /export \{[^}]*\bMAX_SET_MEMBERS\b[^}]*\} from "\.\/fuse\.js"/);
    assert.equal(typeof fuseSet, "function");
    assert.equal(MAX_SET_MEMBERS, 2000);
    // The verify-package types the set results are made of are reachable from the core entry.
    const typeExports = [...index.matchAll(/export type \{([^}]*)\} from "@mikeargento\/bitgraph-verify"/g)].flatMap((m) => m[1]!.split(",").map((s) => s.trim()));
    for (const name of ["SetManifest", "FuseMemberResult", "FuseVerifyResult", "FuseFrame", "PlacementId"]) assert.ok(typeExports.includes(name), `index.ts re-exports type ${name}`);
  });

  test("26. FUSE.md: Sets is its own subsection, the echo is stated per boundary, and the return-time binding and its costs are stated", () => {
    const doc = readFileSync(fileURLToPath(new URL("../../docs/fuse/FUSE.md", import.meta.url)), "utf8");
    const headings = [...doc.matchAll(/^(##+) (.+)$/gm)].map((m) => `${m[1]} ${m[2]}`);
    const sets = headings.indexOf("### Sets");
    assert.ok(sets >= 0, "a Sets subsection");
    assert.equal(headings[sets + 1], "### Harness", "the single-fuse harness copy sits under its own heading, not under Sets");
    assert.equal(headings[sets + 2], "## Ledger");
    const setsText = doc.slice(doc.indexOf("### Sets"), doc.indexOf("### Harness"));
    assert.ok(!setsText.includes("Bounded copy, verbatim"), "no bounded copy inside Sets");
    assert.ok(!/the parent and the enclave do echo/.test(doc), "the parent path does not echo the manifest");
    assert.match(setsText, /Enclave v6 .*keeps metadata on a held-slot commit/s);
    assert.match(setsText, /returns\s+`manifestEchoed:\s+true`/);
    assert.match(setsText, /drops\s+metadata\s+returns\s+`manifestEchoed:\s+false`/);
    assert.match(setsText, /bound to it by digest/);
    assert.match(setsText, /`verifyMembers: true`/);
    assert.match(setsText, /grows\s+with\s+the\s+square\s+of\s+the\s+member\s+count/);
    assert.match(setsText, /native SHA-256/);
    assert.match(setsText, /one fused copy/);
    assert.match(setsText, /`onProgress`/);
    assert.match(setsText, /after the commit, so the slot TTL is not\s+at risk/);
    assert.ok(!doc.includes("\u2014"), "no em dashes");
  });

  test("27. bitgraph-fuse set --keep refuses two inputs that would share a fused name before any request; without --keep they proceed", async () => {
    const { mkdtemp, mkdir, writeFile: write, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const cli = fileURLToPath(new URL("../fuse-cli.js", import.meta.url));
    const dir = await mkdtemp(join(tmpdir(), "bitgraph-set-cli-"));
    try {
      await mkdir(join(dir, "a"));
      await mkdir(join(dir, "b"));
      await write(join(dir, "a", "x.txt"), "one\n");
      await write(join(dir, "b", "x.txt"), "two\n");
      // Nothing listens on port 1: a request would fail as a network error, so exit 64 with the collision message proves no request was made.
      const flags = ["--out", join(dir, "out"), "--base-url", "http://127.0.0.1:1"];
      type Run = { code: number; stdout: string; stderr: string };
      const attempt = (args: string[]): Promise<Run> => run(process.execPath, [cli, ...args]).then((r) => ({ code: 0, ...r }), (e: Run) => e);
      const kept = await attempt(["set", join(dir, "a", "x.txt"), join(dir, "b", "x.txt"), "--keep", ...flags]);
      assert.equal(kept.code, 64, kept.stderr);
      assert.match(kept.stderr, /members 0 and 1 would both be written as x\.fused\.tar/);
      assert.ok(!/no fused proof was completed/.test(kept.stderr), "refused before fuseSet ran");
      const loose = await attempt(["set", join(dir, "a", "x.txt"), join(dir, "b", "x.txt"), ...flags]);
      assert.equal(loose.code, 1, loose.stderr);
      assert.match(loose.stderr, /no fused proof was completed \(network\)/, "without --keep the set reached the allocate request");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("fuseSet(): hashing and progress", () => {
  test("28. digest(): the native hasher and the library agree at every size, and the library answers when the platform has no hasher or refuses the input", async () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, 70_000, 1_000_003]) {
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i++) b[i] = (i * 7 + n) & 0xff;
      assert.equal(bytesToHex(await digest(b)), bytesToHex(sha256(b)), `size ${n}`);
    }
    const sample = utf8("a member hashed without WebCrypto\n");
    const want = bytesToHex(sha256(sample));
    const desc = Object.getOwnPropertyDescriptor(globalThis, "crypto")!;
    try {
      Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true, writable: true });
      assert.equal(bytesToHex(await digest(sample)), want, "no platform hasher: the library");
      Object.defineProperty(globalThis, "crypto", { value: { subtle: { digest: () => Promise.reject(new TypeError("refused")) } }, configurable: true, writable: true });
      assert.equal(bytesToHex(await digest(sample)), want, "a refusing platform hasher: the library");
    } finally {
      Object.defineProperty(globalThis, "crypto", desc);
    }
    assert.equal(bytesToHex(await digest(sample)), want, "restored");
  });

  test("29. onProgress: hash and fuse per member before and after the slot, commit 0 of 1 then 1 of 1, verify only with verifyMembers; a throwing hook changes nothing", async () => {
    const members: FuseSetMember[] = [...two(), { original: note, placement: "container/1" }];
    const seen: FuseSetProgress[] = [];
    const r = await fuseSet(members, { transport: honest(key, slot).transport, onProgress: (p) => seen.push({ ...p }) });
    assert.equal(r.members.length, 3);
    const of = (phase: FuseSetProgress["phase"]) => seen.filter((p) => p.phase === phase).map((p) => `${p.done}/${p.total}`);
    assert.deepEqual(of("hash"), ["1/3", "2/3", "3/3"]);
    assert.deepEqual(of("fuse"), ["1/3", "2/3", "3/3"]);
    assert.deepEqual(of("commit"), ["0/1", "1/1"]);
    assert.deepEqual(of("verify"), []);
    assert.deepEqual(seen.map((p) => p.phase), ["hash", "hash", "hash", "fuse", "fuse", "fuse", "commit", "commit"], "hash before the slot, fuse after it, then the commit");
    const verified: FuseSetProgress[] = [];
    await fuseSet(members, { transport: honest(key, slot).transport, verifyMembers: true, onProgress: (p) => verified.push({ ...p }) });
    assert.deepEqual(verified.filter((p) => p.phase === "verify").map((p) => `${p.done}/${p.total}`), ["1/3", "2/3", "3/3"]);
    assert.equal(verified.findIndex((p) => p.phase === "verify") > verified.findIndex((p) => p.phase === "commit" && p.done === 1), true, "verify after the commit");
    let calls = 0;
    const thrown = await fuseSet(members, { transport: honest(key, slot).transport, onProgress: () => { calls++; throw new Error("a hook that throws"); } });
    assert.equal(thrown.members.length, 3);
    assert.equal(calls, 8, "every report was attempted");
  });
});

describe("fuseSet(): loaded and hashed members", () => {
  /** The trailer/1 member finished from a hasher state, as a scanner does: hash the original once, keep the state, add the trailer later. */
  const savedState = (bytes: Uint8Array) => { const h = sha256.create(); h.update(bytes); return h; };
  const finish = (h: ReturnType<typeof sha256.create>, trailer: Uint8Array) => { const c = h.clone(); c.update(trailer); return c.digest(); };

  test("30. trailerBytesFor is the placement's own suffix: original followed by it hashes to the trailer/1 build, and a saved state finished with it agrees", () => {
    const commitment = computeSlotCommitment(slot);
    const t = trailerBytesFor(commitment);
    assert.equal(t.length, 48);
    assert.deepEqual(t.subarray(0, 8), utf8("BGFUSE01"));
    assert.deepEqual(t.subarray(8, 16), new Uint8Array(8));
    assert.deepEqual(t.subarray(16), commitment);
    for (const o of [original, png, note, new Uint8Array(0), new Uint8Array(55).fill(1), new Uint8Array(64).fill(2), new Uint8Array(1_000_003).fill(3)]) {
      const built = getPlacement("trailer/1")!.build({ original: o, commitment });
      assert.deepEqual(built.subarray(o.length), t, `suffix for ${o.length} bytes`);
      assert.deepEqual(finish(savedState(o), t), sha256(built), `finished state for ${o.length} bytes`);
    }
    assert.throws(() => trailerBytesFor(new Uint8Array(31)), (e: FuseError) => e.code === "bad-input");
  });

  test("31. a loaded member is read once, after the slot is held, checked against its named digest, and released unless kept", async () => {
    const { calls, transport } = honest(key, slot);
    const order: string[] = [];
    const wrapped = { ...transport, fetch: async (url: string, init?: RequestInit) => { order.push(new URL(url).pathname); return (transport.fetch as (u: string, i?: RequestInit) => Promise<Response>)(url, init); } } as unknown as typeof transport;
    let loads = 0;
    const loaded: FuseSetLoadedMember = { load: async () => { loads++; order.push("load"); return original; }, originDigest: sha256(original), placement: "trailer/1", name: "photo.jpg" };
    const r = await fuseSet([loaded, { original: png, placement: "container/1" }], { transport: wrapped });
    assert.equal(loads, 1);
    assert.ok(order.indexOf("load") > order.indexOf("/api/fuse/allocate"), "read after the slot is held");
    assert.ok(order.indexOf("load") < order.indexOf("/api/fuse/commit"), "read before the commit");
    const o = oracle(slot, [{ original, placement: "trailer/1" }, { original: png, placement: "container/1" }]);
    assert.equal(r.members[0]!.artifactDigestB64, bytesToBase64(o.rows[0]!.artifact));
    assert.equal(r.members[0]!.originDigestB64, bytesToBase64(sha256(original)));
    assert.equal(r.members[0]!.fusedName, fusedNamesFor("photo.jpg", "trailer/1").fusedName);
    assert.ok(!("fusedBytes" in r.members[0]!));
    assert.equal(commits(calls).length, 1);
    const kept = await fuseSet([{ ...loaded }], { transport: honest(key, slot).transport, keepFused: true });
    assert.deepEqual(kept.members[0]!.fusedBytes, getPlacement("trailer/1")!.build({ original, commitment: computeSlotCommitment(slot) }));
    // A wrong named digest burns the slot and commits nothing.
    const bad = honest(key, slot);
    await assert.rejects(fuseSet([{ load: () => original, originDigest: sha256(unrelated), placement: "trailer/1" }], { transport: bad.transport }), (e: FuseError) => e.code === "bad-input" && /^member 0: originDigest is not the SHA-256 of the loaded bytes/.test(e.message) && e.member === 0);
    assert.equal(commits(bad.calls).length, 0);
    assert.equal(allocates(bad.calls).length, 1);
    // A loader that throws, or returns something other than bytes, is load-failed naming the member.
    const thrown = honest(key, slot);
    await assert.rejects(fuseSet([{ load: () => { throw new Error("gone"); }, originDigest: sha256(original), placement: "trailer/1" }], { transport: thrown.transport }), (e: FuseError) => e.code === "load-failed" && /^member 0: load threw: gone/.test(e.message) && e.member === 0);
    assert.equal(commits(thrown.calls).length, 0);
    await assert.rejects(fuseSet([{ original, placement: "trailer/1" }, { load: (() => "text") as never, originDigest: sha256(original), placement: "container/1" }], { transport: honest(key, slot).transport }), (e: FuseError) => e.code === "load-failed" && /^member 1: load must return a Uint8Array/.test(e.message) && e.member === 1);
    // Without a placement or a digest nothing is requested.
    const quiet = honest(key, slot);
    await assert.rejects(fuseSet([{ load: () => original, originDigest: sha256(original) } as never], { transport: quiet.transport }), (e: FuseError) => e.code === "bad-input" && /^member 0: a loaded member names its placement/.test(e.message));
    await assert.rejects(fuseSet([{ load: () => original, placement: "trailer/1" } as never], { transport: quiet.transport }), (e: FuseError) => e.code === "bad-input" && /^member 0: a loaded member names its originDigest/.test(e.message));
    assert.equal(quiet.calls.length, 0);
  });

  test("32. a hashed member answers its fused digest for the held commitment and never shows its bytes; the row is what the real verifier finds", async () => {
    const { calls, transport } = honest(key, slot);
    const inputs: FusedDigestInput[] = [];
    const state = savedState(original);
    const hashed: FuseSetHashedMember = {
      originDigest: sha256(original),
      placement: "trailer/1",
      name: "photo.jpg",
      fusedDigest: (input) => { inputs.push(input); return finish(state, trailerBytesFor(input.commitment)); },
    };
    const r = await fuseSet([hashed, { original: png, placement: "container/1" }, { load: () => note, originDigest: sha256(note), placement: "container/1" }], { transport, keepFused: true });
    assert.equal(inputs.length, 1);
    const commitment = computeSlotCommitment(slot);
    assert.deepEqual(inputs[0]!.commitment, commitment);
    assert.equal(inputs[0]!.commitmentHex, bytesToHex(commitment));
    assert.equal(inputs[0]!.slot.nonceB64, slot.nonceB64);
    const built = getPlacement("trailer/1")!.build({ original, commitment });
    assert.equal(r.members[0]!.artifactDigestB64, bytesToBase64(sha256(built)), "the row is the hash of the placement's build");
    assert.ok(!("fusedBytes" in r.members[0]!), "nothing to keep for a hashed member");
    assert.ok("fusedBytes" in r.members[1]! && "fusedBytes" in r.members[2]!, "bytes and loaded members are kept");
    assert.equal(r.members.length, 3);
    assert.equal(r.manifest.members.length, 3);
    assert.equal(commits(calls).length, 1);
    // The real verifier reads the member from the bytes a reader would build, and from its original.
    const direct = await verifyFuseMember({ proof: r.proof, bytes: built, manifest: r.manifestBytes });
    assert.equal(direct.category, "SET_MEMBER_DIRECT", direct.reason ?? "");
    assert.equal(direct.set!.member!.index, r.members[0]!.manifestIndex);
    const fromOrigin = await verifyFuseMember({ proof: r.proof, bytes: original, manifest: r.manifestBytes });
    assert.equal(fromOrigin.category, "SET_MEMBER_FROM_ORIGIN", fromOrigin.reason ?? "");
    // verifyMembers refuses a hashed member before any request; a throwing or short answer is builder-failed naming the member.
    const quiet = honest(key, slot);
    await assert.rejects(fuseSet([hashed], { transport: quiet.transport, verifyMembers: true }), (e: FuseError) => e.code === "bad-input" && /^member 0: a hashed member cannot be verified in full/.test(e.message) && e.member === 0);
    assert.equal(quiet.calls.length, 0);
    const throwing = honest(key, slot);
    await assert.rejects(fuseSet([{ ...hashed, fusedDigest: () => { throw new Error("no state"); } }], { transport: throwing.transport }), (e: FuseError) => e.code === "builder-failed" && /^member 0: fusedDigest threw: no state/.test(e.message) && e.member === 0);
    assert.equal(commits(throwing.calls).length, 0);
    await assert.rejects(fuseSet([{ ...hashed, fusedDigest: () => new Uint8Array(31) }], { transport: honest(key, slot).transport }), (e: FuseError) => e.code === "builder-failed" && /^member 0: fusedDigest must return a 32-byte digest/.test(e.message));
    // The same original as a hashed member and as a bytes member under one placement is the duplicate it always was.
    await assert.rejects(fuseSet([hashed, { original, placement: "trailer/1" }], { transport: honest(key, slot).transport }), (e: FuseError) => e.code === "bad-input" && /^members 0 and 1 are the same original/.test(e.message));
  });

  test("33. progress counts every shape: hash before the slot for all three, fuse after it, one commit", async () => {
    const seen: FuseSetProgress[] = [];
    const state = savedState(original);
    await fuseSet([
      { originDigest: sha256(original), placement: "trailer/1", fusedDigest: ({ commitment }) => finish(state, trailerBytesFor(commitment)) },
      { load: () => note, originDigest: sha256(note), placement: "container/1" },
      { original: png, placement: "container/1" },
    ], { transport: honest(key, slot).transport, onProgress: (p) => seen.push({ ...p }) });
    assert.deepEqual(seen.map((p) => `${p.phase} ${p.done}/${p.total}`), ["hash 1/3", "hash 2/3", "hash 3/3", "fuse 1/3", "fuse 2/3", "fuse 3/3", "commit 0/1", "commit 1/1"]);
  });
});
