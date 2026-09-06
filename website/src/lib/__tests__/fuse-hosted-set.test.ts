/**
 * The hosted set path, offline: a stub boundary that signs slots and proofs
 * with the core package's test fixtures and runs the site's REAL commit-route
 * manifest validation, the library's open and commit as the route calls them,
 * the caller's half (assemble each new file from its recipe and hash it), and
 * the published verifier over everything that came back, negative cases
 * included. No network, no ledger.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { signAsync } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToBase64, canonicalize, canonicalSlotBody, computeSlotCommitment, getPlacement, parseSetManifest, readSetMetadata, verifyFuse, verifyFuseMember } from "@mikeargento/bitgraph-verify";
// The core package's own signing fixtures; a relative path, since the package's exports map does not list them.
import { makeKey, signBody, b64 } from "../../../node_modules/@mikeargento/bitgraph/dist/__tests__/audit-fixtures.js";
import { validateSetCommit } from "../fuse-set.ts";
import {
  HostedFuseError,
  assemble,
  commitHosted,
  commitHostedSet,
  decodeToken,
  groupCommitEntries,
  openHosted,
  openHostedSet,
  setManifestFor,
  type OpenInput,
  type SetEntry,
} from "../mcp/fuse-hosted.ts";

const digestOf = (b: Uint8Array) => new Uint8Array(createHash("sha256").update(b).digest());
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EPOCH = bytesToBase64(new Uint8Array(32).fill(0x5e));

// ── the stub boundary ──
let key: Awaited<ReturnType<typeof makeKey>>;
let counter = 100n;
const slots = new Map<string, Record<string, unknown>>();
const consumed = new Set<string>();
const calls: string[] = [];
const commitBodies: Array<Record<string, unknown>> = [];
const realFetch = globalThis.fetch;

async function allocate(): Promise<Record<string, unknown>> {
  counter += 2n;
  const body = { version: "bitgraph/slot/1", nonceB64: b64(randomBytes(32)), counter: String(counter), epochId: EPOCH, publicKeyB64: key.publicKeyB64, chainId: "bitgraph:main" };
  const slot = { ...body, signatureB64: b64(await signAsync(canonicalize(body), key.privateKey)) };
  slots.set(slot.nonceB64, slot);
  return slot;
}

async function commit(body: Record<string, unknown>): Promise<Response> {
  const slot = slots.get(String(body.slotId));
  if (!slot) return Response.json({ error: "unknown slot" }, { status: 400 });
  if (consumed.has(slot.nonceB64 as string)) return Response.json({ error: "the slot is no longer available", code: "slot-unavailable" }, { status: 409 });
  const attr = body.attribution as { title: string; message?: string };
  const digests = body.digests as Array<{ digestB64: string }>;
  const digestB64 = digests[0]!.digestB64;
  // The site's own route runs this before the boundary sees a set.
  if (attr.title === "set/1" || body.metadata !== undefined) {
    const v = await validateSetCommit({ title: attr.title, message: attr.message, metadata: body.metadata, digestB64, slot: slot as never });
    if (!v.ok) return Response.json({ error: v.error }, { status: v.status });
  }
  consumed.add(slot.nonceB64 as string);
  commitBodies.push(body);
  const c = { nonceB64: slot.nonceB64, counter: (BigInt(slot.counter as string) + 1n).toString(), epochId: slot.epochId, slotCounter: slot.counter, slotHashB64: b64(sha256(canonicalize(canonicalSlotBody(slot as never)))), chainId: "bitgraph:main" };
  const proof = await signBody(key, { hashAlg: "sha256", digestB64 }, c, "test-measurement-set", { attribution: body.attribution });
  proof.slotAllocation = slot;
  if (body.metadata !== undefined) proof.metadata = structuredClone(body.metadata);
  return Response.json({ proof });
}

before(async () => {
  key = await makeKey();
  process.env.BITGRAPH_API_URL = "https://stub.test";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.pathname);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (url.pathname === "/api/fuse/allocate") {
      const slot = await allocate();
      return Response.json({ slotId: slot.nonceB64, slot, chainId: "bitgraph:main" });
    }
    if (url.pathname === "/api/fuse/commit") return commit(body);
    if (url.pathname.startsWith("/api/proofs/digest/")) return Response.json({ proofs: [] });
    return Response.json({ error: "no route " + url.pathname }, { status: 404 });
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
  delete process.env.BITGRAPH_API_URL;
});

function fileInput(name: string, bytes: Uint8Array): OpenInput {
  return { name, size: bytes.length, digestB64: bytesToBase64(digestOf(bytes)), head: bytes.subarray(0, Math.min(16, bytes.length)) };
}

const originals = [
  { name: "a.png", bytes: new Uint8Array([...PNG, ...randomBytes(2000)]) },
  { name: "b.png", bytes: new Uint8Array([...PNG, ...randomBytes(70000)]) },
  { name: "c.txt", bytes: new Uint8Array([...Buffer.from("plain text "), ...randomBytes(511)]) },
  { name: "d.txt", bytes: new Uint8Array([...Buffer.from("more text "), ...randomBytes(4096)]) },
  { name: "e.pdf", bytes: new Uint8Array([...Buffer.from("%PDF-1.7\n"), ...randomBytes(12345)]) },
  { name: "empty.txt", bytes: new Uint8Array(0) },
];

test("open N files → ONE slot, every token names it and says set; recipes are the placement's own build", async () => {
  calls.length = 0;
  const opened = await openHostedSet(originals.map((o) => fileInput(o.name, o.bytes)));
  assert.equal(calls.filter((p) => p === "/api/fuse/allocate").length, 1, "one allocation for the set");
  assert.equal(opened.members.length, originals.length);
  const commitment = computeSlotCommitment(opened.slot);
  for (let i = 0; i < originals.length; i++) {
    const m = opened.members[i]!;
    const state = decodeToken(m.token);
    assert.ok(state, "the token decodes");
    assert.equal(state.set, true);
    assert.equal(state.slot.nonceB64, opened.slot.nonceB64, "every member shares the slot");
    assert.equal(state.origin.name, originals[i]!.name);
    const built = assemble(m.recipe, originals[i]!.bytes);
    const placement = getPlacement(m.state.placement)!;
    assert.deepEqual(built, placement.build({ original: originals[i]!.bytes, originDigest: digestOf(originals[i]!.bytes), commitment }), `${originals[i]!.name}: the recipe assembles to the placement's build`);
  }
  assert.deepEqual(opened.members.map((m) => m.state.placement), ["trailer/1", "trailer/1", "container/2", "container/2", "container/2", "container/2"]);
});

test("commit N members → one manifest, one commit, one proof verified against it; every member verifies with the published verifier; strays do not", async () => {
  calls.length = 0;
  commitBodies.length = 0;
  const opened = await openHostedSet(originals.map((o) => fileInput(o.name, o.bytes)));
  const commitment = computeSlotCommitment(opened.slot);
  // The caller's half: build each new file from its recipe and hash it.
  const newFiles = opened.members.map((m, i) => assemble(m.recipe, originals[i]!.bytes));
  const entries: SetEntry[] = opened.members.map((m, i) => ({ state: m.state, artifactDigestB64: bytesToBase64(digestOf(newFiles[i]!)) }));
  const c = await commitHostedSet(entries);
  assert.equal(calls.filter((p) => p === "/api/fuse/commit").length, 1, "one commit for the set");
  assert.equal(c.count, originals.length);
  assert.equal(c.manifestEchoed, true);
  assert.equal(c.recovered, false);
  const body = commitBodies[0]!;
  assert.deepEqual(body.attribution, { name: "bitgraph-fuse/1", title: "set/1" }, "the set marker carries no origin");
  assert.equal((body.digests as Array<{ digestB64: string }>)[0]!.digestB64, c.artifactDigestB64, "the manifest's digest is what is committed");
  // The whole verifier over what came back.
  const v = await verifyFuse({ proof: c.proof as never, bytes: c.manifestBytes });
  assert.equal(v.category, "FUSED_DIRECT");
  assert.equal(v.placement, "set/1");
  assert.deepEqual(readSetMetadata(c.proof as never), c.manifestBytes, "the proof carries the manifest bytes");
  const parsed = parseSetManifest(c.manifestBytes)!;
  for (let i = 0; i < originals.length; i++) {
    const fromOrigin = await verifyFuseMember({ proof: c.proof as never, bytes: originals[i]!.bytes });
    assert.equal(fromOrigin.category, "SET_MEMBER_FROM_ORIGIN", `${originals[i]!.name}: ${fromOrigin.category} ${fromOrigin.reason ?? ""}`);
    assert.equal(fromOrigin.set?.member?.index, c.rowOf[i], `${originals[i]!.name}: the verifier's row is the reported row`);
    assert.equal(fromOrigin.set?.member?.fusedDigestB64, entries[i]!.artifactDigestB64);
    assert.equal(bytesToBase64(parsed.members[c.rowOf[i]!]!.artifact), entries[i]!.artifactDigestB64, "the manifest row lists the caller's digest");
    const direct = await verifyFuseMember({ proof: c.proof as never, bytes: newFiles[i]! });
    assert.equal(direct.category, "SET_MEMBER_DIRECT", `${originals[i]!.name}: ${direct.category} ${direct.reason ?? ""}`);
  }
  // A file fused under the same commitment that was never committed is not a member; stray bytes match nothing.
  const stray = new Uint8Array([...PNG, ...randomBytes(500)]);
  const strayFused = getPlacement("trailer/1")!.build({ original: stray, originDigest: digestOf(stray), commitment });
  assert.equal((await verifyFuseMember({ proof: c.proof as never, bytes: strayFused })).category, "SET_NOT_MEMBER");
  assert.equal((await verifyFuseMember({ proof: c.proof as never, bytes: stray })).category, "NO_MATCH");
  // A member left out of the commit cannot join afterwards: the slot is consumed.
  await assert.rejects(commitHostedSet([entries[0]!]), (err: HostedFuseError) => err.code === "slot-unavailable");
});

test("a subset commits as the set; the same bytes twice are one row; mixed slots are refused", async () => {
  const opened = await openHostedSet(originals.slice(0, 3).map((o) => fileInput(o.name, o.bytes)));
  const entries: SetEntry[] = opened.members.slice(0, 2).map((m, i) => ({ state: m.state, artifactDigestB64: bytesToBase64(digestOf(assemble(m.recipe, originals[i]!.bytes))) }));
  const built = await setManifestFor([...entries, entries[1]!]);
  assert.equal(built.count, 2, "a duplicate digest is one row");
  assert.equal(built.rowOf[1], built.rowOf[2]);
  const c = await commitHostedSet(entries);
  assert.equal(c.count, 2);
  const other = await openHostedSet(originals.slice(3).map((o) => fileInput(o.name, o.bytes)));
  await assert.rejects(setManifestFor([entries[0]!, { state: other.members[0]!.state, artifactDigestB64: entries[0]!.artifactDigestB64 }]), /same slot/);
});

test("groupCommitEntries: set tokens group by slot, single-file tokens stand alone", async () => {
  const a = await openHostedSet(originals.slice(0, 2).map((o) => fileInput(o.name, o.bytes)));
  const b = await openHostedSet(originals.slice(2, 4).map((o) => fileInput(o.name, o.bytes)));
  const solo = await openHosted(fileInput("e.pdf", originals[4]!.bytes));
  assert.equal(solo.state.set, undefined, "a single file's token is not a set token");
  const d = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const groups = groupCommitEntries([
    { position: 0, state: a.members[0]!.state, artifactDigestB64: d },
    { position: 1, state: solo.state, artifactDigestB64: d },
    { position: 2, state: b.members[1]!.state, artifactDigestB64: d },
    { position: 3, state: a.members[1]!.state, artifactDigestB64: d },
  ]);
  assert.equal(groups.sets.length, 2);
  assert.deepEqual(groups.sets[0]!.entries.map((e) => e.position), [0, 3]);
  assert.deepEqual(groups.sets[1]!.entries.map((e) => e.position), [2]);
  assert.deepEqual(groups.solos.map((e) => e.position), [1]);
});

test("a single file still fuses on its own: origin in the marker, a Frame, FUSED_DIRECT", async () => {
  calls.length = 0;
  const original = originals[0]!.bytes;
  const opened = await openHosted(fileInput("solo.png", original));
  const newFile = assemble(opened.recipe, original);
  const c = await commitHosted(opened.state, bytesToBase64(digestOf(newFile)));
  assert.equal(calls.filter((p) => p === "/api/fuse/commit").length, 1);
  assert.equal(c.proof.attribution?.title, "trailer/1");
  assert.equal(c.proof.attribution?.message, bytesToBase64(digestOf(original)));
  const v = await verifyFuse({ proof: c.proof as never, bytes: newFile });
  assert.equal(v.category, "FUSED_DIRECT", `${v.category} ${v.reason ?? ""}`);
  assert.ok(c.frame, "a Frame for the single file");
});
