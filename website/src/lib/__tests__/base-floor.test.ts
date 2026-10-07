/**
 * The Base floor on the site (enclave v10, bitgraph-fuse/3), offline:
 *   - the site's commitment/3 against the vector the v10 harness enclave minted
 *   - validateTreeCommit: fuse/3 under SPEC v2 with a Base floor is accepted;
 *     a marker that disagrees with its spec, or with the floor named, is refused
 *   - the commit route's floor helpers: the floor a body names, the floor the
 *     returned proof signs (a different one is refused), the no-base-floor refusal
 *   - making a tree of one against a stub boundary that hands out a Base floor,
 *     and its export, whose floor header comes from the new route
 *   - the floor-header route's check (a wrong hash or number serves nothing)
 *   - the package README for a Base floor, and the folder check's base-floor/ file
 * Ethereum-floor behaviour is the existing suites' (fuse2, tree1-*, package-readme).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha256";
import {
  TREE_METADATA_KEY,
  TREE_SPEC_V1_HASH,
  TREE_SPEC_V2_HASH,
  buildTreeRootDocument,
  bytesToBase64,
  bytesToHex,
  evmHexToBytes,
  verifyExport,
  type BitGraphProof,
  type SlotAllocation,
} from "@mikeargento/bitgraph-verify";
import { computeCommitmentFor } from "../fuse-commitment.ts";
import { FUSE3_ATTRIBUTION_NAME, baseFloorOf, boundFloorOf, isBaseFloorMark, isFuseName, isNoBaseFloorRefusal, signedFloorMatchesBound } from "../fuse-core.ts";
import { TREE_KEY, bindTree, buildTreeExport, fetchSpecFor, fetchTreeEvidence, markerForSpec, memberTree, specFileFor, validateTreeCommit } from "../fuse-tree.ts";
import { makeTree } from "../fuse-tree-make.ts";
import { checkSavedFloorHeader, baseFloorKey, parseFloorHeaderQuery, readBaseFloorHeader } from "../floor-header.ts";
import { packageReadme, floorHeaderFile, PKG_BASE_FLOOR_FILE, type ReadmeInput } from "../package-layout.ts";
import { baseFloorHeaderVerdict } from "../folder-check.ts";
import { BASE_FLOOR, BASE_FLOOR_HEADER_HEX, SPEC_BYTES, SPEC_V2_BYTES, digestB64, makeStub, utf8 } from "./tree1-helpers.ts";

const FIX = new URL("../../../../src/__tests__/fuse3-fixtures/", import.meta.url);
const vec = JSON.parse(readFileSync(new URL("trailer3.vector.json", FIX), "utf8"));
const made3 = JSON.parse(readFileSync(new URL("made3.proof.json", FIX), "utf8")) as Record<string, unknown> & { commit: Record<string, unknown> };
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

/* ── commitment/3 ── */

test("the site's commitment/3 equals the v10 enclave's vector, and a bare hash stays commitment/2", () => {
  assert.equal(hex(computeCommitmentFor(vec.slot, { blockHash: vec.floorBlockHash, chain: "base" })), vec.commitmentHex);
  assert.equal(hex(computeCommitmentFor(vec.slot, vec.floorBlockHash, "base")), vec.commitmentHex);
  assert.equal(hex(computeCommitmentFor(vec.slot, vec.floorBlockHash)), vec.fuse2CommitmentHex, "a hash with no chain is an Ethereum anchor's, as before v10");
  assert.equal(hex(computeCommitmentFor(vec.slot, null)), vec.fuse1CommitmentHex);
});

test("the Base floor mark and the fuse/3 name are recognised; malformed marks are not", () => {
  assert.ok(isFuseName(FUSE3_ATTRIBUTION_NAME));
  assert.ok(isBaseFloorMark(made3.commit.slotFloor));
  assert.ok(isBaseFloorMark(BASE_FLOOR));
  assert.ok(!isBaseFloorMark({ ...BASE_FLOOR, chain: "ethereum" }));
  assert.ok(!isBaseFloorMark({ ...BASE_FLOOR, evmChainId: 1 }));
  assert.ok(!isBaseFloorMark({ ...BASE_FLOOR, blockHash: BASE_FLOOR.blockHash.toUpperCase().replace("0X", "0x") }));
  assert.ok(!isBaseFloorMark({ ...BASE_FLOOR, blockTimestamp: "1" }));
  assert.deepEqual(baseFloorOf(made3), { blockNumber: BASE_FLOOR.blockNumber, blockHash: BASE_FLOOR.blockHash, blockTimestamp: BASE_FLOOR.blockTimestamp });
  assert.equal(baseFloorOf({ commit: { ...made3.commit, slotAnchor: { counter: "1", blockNumber: 1, blockHash: "0x" + "ab".repeat(32) } } }), null, "a proof signing both floors is read as neither");
});

/* ── validateTreeCommit under fuse/3 ── */

const filled = (n: number, seed: number) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + seed) & 0xff; return b; };
const slot = { version: "bitgraph/slot/1", nonceB64: bytesToBase64(filled(32, 7)), counter: "10", epochId: bytesToBase64(filled(32, 5)), publicKeyB64: bytesToBase64(filled(32, 1)), chainId: "bitgraph:main", signatureB64: bytesToBase64(filled(64, 2)) } as unknown as SlotAllocation;
const commitment3 = computeCommitmentFor(slot, BASE_FLOOR);
const rootDoc3 = buildTreeRootDocument(commitment3, 3, filled(32, 99));
const good3 = {
  name: FUSE3_ATTRIBUTION_NAME,
  message: TREE_SPEC_V2_HASH,
  metadata: { [TREE_KEY]: bytesToHex(rootDoc3) },
  digestB64: bytesToBase64(sha256(rootDoc3)),
  slot,
  floorBlockHash: BASE_FLOOR.blockHash,
  floorChain: "base" as "base" | "ethereum" | undefined,
};

test("each spec pins its marker: SPEC v1 fuse/2, SPEC v2 fuse/3, and each is served from its own path", () => {
  assert.equal(markerForSpec(TREE_SPEC_V1_HASH), "bitgraph-fuse/2");
  assert.equal(markerForSpec(TREE_SPEC_V2_HASH), "bitgraph-fuse/3");
  assert.equal(markerForSpec(digestB64(utf8("no such spec"))), null);
  assert.deepEqual(specFileFor(TREE_SPEC_V1_HASH), { path: "/spec/SPEC.md", name: "SPEC.md" });
  assert.deepEqual(specFileFor(TREE_SPEC_V2_HASH), { path: "/spec/SPEC-v2.md", name: "SPEC-v2.md" });
  assert.equal(digestB64(SPEC_V2_BYTES), TREE_SPEC_V2_HASH, "public/spec/SPEC-v2.md is the v2 the verifier pins");
});

test("validateTreeCommit accepts fuse/3 under SPEC v2 with the Base floor the allocation returned", () => {
  const v = validateTreeCommit(good3);
  assert.ok(v.ok, v.ok ? "" : v.error);
  assert.equal(v.count, 3);
});

test("validateTreeCommit refuses a marker that disagrees with its spec or with the floor named", () => {
  const commitment2 = computeCommitmentFor(slot, BASE_FLOOR.blockHash);
  const rootDoc2 = buildTreeRootDocument(commitment2, 3, filled(32, 99));
  const as2 = { metadata: { [TREE_KEY]: bytesToHex(rootDoc2) }, digestB64: bytesToBase64(sha256(rootDoc2)) };
  const cases: Array<[string, Partial<typeof good3>, RegExp]> = [
    ["fuse/3 under SPEC v1", { message: TREE_SPEC_V1_HASH }, /defines tree\/1 under "bitgraph-fuse\/2"/],
    ["fuse/2 under SPEC v2, Ethereum floor", { name: "bitgraph-fuse/2", floorChain: "ethereum", ...as2 }, /defines tree\/1 under "bitgraph-fuse\/3"/],
    ["fuse/3 naming an Ethereum anchor", { floorChain: "ethereum" }, /does not match the marker/],
    ["fuse/2 naming a Base floor", { name: "bitgraph-fuse/2", message: TREE_SPEC_V1_HASH, ...as2 }, /does not match the marker/],
    ["fuse/3 without its floor", { floorBlockHash: null as unknown as string }, /body\.floor/],
    ["fuse/3 with another Base block", { floorBlockHash: "0x" + "cd".repeat(32) }, /commitment is not this position's/],
    ["a fuse/2 commitment under the fuse/3 marker", { ...as2 }, /commitment is not this position's/],
  ];
  for (const [label, change, why] of cases) {
    const v = validateTreeCommit({ ...good3, ...change });
    assert.equal(v.ok, false, label);
    if (!v.ok) assert.match(v.error, why, `${label}: ${v.error}`);
  }
});

test("bindTree refuses a tree whose marker disagrees with the spec it pins", () => {
  const p = { attribution: { name: FUSE3_ATTRIBUTION_NAME, title: "tree/1", message: TREE_SPEC_V1_HASH } };
  const r = bindTree(p);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /under bitgraph-fuse\/2, not bitgraph-fuse\/3/);
});

/* ── The commit route's floor helpers ── */

test("the floor a commit names: body.floor for fuse/3, body.anchor for fuse/2, nothing for fuse/1", () => {
  const anchor = { counter: "5", blockNumber: 1, blockHash: "0x" + "ab".repeat(32) };
  const f3 = boundFloorOf(FUSE3_ATTRIBUTION_NAME, { floor: BASE_FLOOR });
  assert.ok(f3.ok && f3.bound?.chain === "base");
  const f3anchor = boundFloorOf(FUSE3_ATTRIBUTION_NAME, { anchor });
  assert.ok(!f3anchor.ok && /body\.floor/.test(f3anchor.error), "fuse/3 does not take an Ethereum anchor");
  const f2 = boundFloorOf("bitgraph-fuse/2", { anchor });
  assert.ok(f2.ok && f2.bound?.chain === "ethereum");
  const f2base = boundFloorOf("bitgraph-fuse/2", { floor: BASE_FLOOR });
  assert.ok(!f2base.ok && /body\.anchor/.test(f2base.error), "fuse/2 does not take a Base floor");
  const f1 = boundFloorOf("bitgraph-fuse/1", { floor: BASE_FLOOR });
  assert.ok(f1.ok && f1.bound === null);
});

test("after the enclave answers: the proof must sign the Base floor the file bound, or the route refuses", () => {
  const bound = { chain: "base" as const, mark: BASE_FLOOR };
  assert.equal(signedFloorMatchesBound(made3, bound), true);
  // Negative: another Base block signed.
  const other = { ...made3, commit: { ...made3.commit, slotFloor: { ...BASE_FLOOR, blockHash: "0x" + "5a".repeat(32) } } };
  assert.equal(signedFloorMatchesBound(other, bound), false);
  // Negative: an Ethereum anchor signed where a Base floor was bound.
  const { slotFloor: _drop, ...noFloor } = made3.commit;
  void _drop;
  const eth = { ...made3, commit: { ...noFloor, slotAnchor: { counter: "1", blockNumber: 2, blockHash: BASE_FLOOR.blockHash } } };
  assert.equal(signedFloorMatchesBound(eth, bound), false);
  // Negative: both floors signed (ambiguous).
  const both = { ...made3, commit: { ...made3.commit, slotAnchor: { counter: "1", blockNumber: 2, blockHash: "0x" + "ab".repeat(32) } } };
  assert.equal(signedFloorMatchesBound(both, bound), false);
  // fuse/2 the same way round.
  assert.equal(signedFloorMatchesBound(eth, { chain: "ethereum", mark: { counter: "1", blockNumber: 2, blockHash: BASE_FLOOR.blockHash } }), true);
  assert.equal(signedFloorMatchesBound(made3, { chain: "ethereum", mark: { counter: "1", blockNumber: 2, blockHash: BASE_FLOOR.blockHash } }), false);
  assert.equal(signedFloorMatchesBound(undefined, bound), false);
});

test("the enclave's no-base-floor refusal is recognised (the site answers it as a retryable restart)", () => {
  assert.equal(isNoBaseFloorRefusal({ error: "no-base-floor: an allocation on bitgraph:main must carry the newest Base block header, ..." }), true);
  assert.equal(isNoBaseFloorRefusal({ error: "Failed to allocate slot: no-base-floor: ..." }), true);
  assert.equal(isNoBaseFloorRefusal({ error: "Rate limit exceeded" }), false);
  assert.equal(isNoBaseFloorRefusal(null), false);
});

/* ── Making and exporting against a Base-floor boundary ── */

test("a tree of one on a v10 boundary: fuse/3, SPEC v2, body.floor, and an export whose floor is the Base header", async () => {
  const stub = await makeStub({ baseFloor: true });
  const original = utf8("one file on a Base floor\n");
  const made = await makeTree([{ file: new Blob([original.slice()]), name: "note.txt", digestB64: digestB64(original), placement: null, state: null }], { transport: { fetch: stub.fetch } });
  const body = stub.commits[0]!;
  assert.equal((body.attribution as { name: string }).name, FUSE3_ATTRIBUTION_NAME);
  assert.equal((body.attribution as { message: string }).message, TREE_SPEC_V2_HASH);
  assert.deepEqual(body.floor, BASE_FLOOR);
  assert.equal(body.anchor, undefined, "a Base floor is never sent as an anchor");
  assert.ok(bindTree(made.proof).ok);
  assert.equal((made.proof.commit as { slotFloor?: unknown }).slotFloor !== undefined, true);

  const evidence = await fetchTreeEvidence(made.proof, { fetch: stub.fetch });
  assert.equal(evidence.floor?.chain, "base");
  assert.equal(evidence.floor?.header, BASE_FLOOR_HEADER_HEX.toLowerCase());
  assert.ok(stub.calls.includes("/api/proofs/floor-header"));
  assert.ok(!stub.calls.includes("/api/proofs/witness"), "no Ethereum witness is asked for a Base floor");
  const built = await buildTreeExport(made.proof, memberTree(made.rootDocument, made.evidenceOf(0)), evidence);
  const r = await verifyExport(built.exp, { file: original });
  assert.equal(r.claims.find((c) => c.id === "floor.header")?.result, "TRUE");
  assert.equal(r.times.floor?.chain, "base");

  // The spec beside it is the one the proof pins: SPEC v2, never v1 under the right name.
  const spec = await fetchSpecFor(TREE_SPEC_V2_HASH, { fetch: stub.fetch });
  assert.deepEqual(spec, SPEC_V2_BYTES);
  assert.deepEqual(await fetchSpecFor(TREE_SPEC_V1_HASH, { fetch: stub.fetch }), SPEC_BYTES);
});

test("a boundary that signs a different Base floor than it handed out: refused, nothing called made", async () => {
  const stub = await makeStub({ baseFloor: true, signOtherFloor: true });
  const original = utf8("bound to one floor, signed under another\n");
  await assert.rejects(
    makeTree([{ file: new Blob([original.slice()]), name: "x.txt", digestB64: digestB64(original), placement: null, state: null }], { transport: { fetch: stub.fetch } }),
    /different floor/,
  );
});

test("an allocation that returns two floors is refused before anything is bound", async () => {
  const stub = await makeStub({ baseFloor: true });
  const inner = stub.fetch;
  const both = (async (input: string | URL | Request, init?: RequestInit) => {
    const res = await inner(input, init);
    if (String(input).endsWith("/api/fuse/allocate")) {
      const j = await res.json() as Record<string, unknown>;
      return Response.json({ ...j, anchor: { counter: "1", blockNumber: 1, blockHash: "0x" + "ab".repeat(32) } });
    }
    return res;
  }) as typeof fetch;
  const original = utf8("two floors\n");
  await assert.rejects(
    makeTree([{ file: new Blob([original.slice()]), name: "x.txt", digestB64: digestB64(original), placement: null, state: null }], { transport: { fetch: both } }),
    /two floors/,
  );
  assert.equal(stub.commits.length, 0);
});

/* ── The floor-header route ── */

test("the floor-header route serves a saved header only when it hashes to the block asked for", async () => {
  const bytes = evmHexToBytes(BASE_FLOOR_HEADER_HEX);
  const ok = checkSavedFloorHeader(bytes, BASE_FLOOR.blockNumber, BASE_FLOOR.blockHash);
  assert.deepEqual(ok, { chain: "base", blockNumber: BASE_FLOOR.blockNumber, blockHash: BASE_FLOOR.blockHash, blockTimestamp: BASE_FLOOR.blockTimestamp, header: BASE_FLOOR_HEADER_HEX.toLowerCase() });
  // Negatives: another hash, another number, a damaged header.
  assert.equal(checkSavedFloorHeader(bytes, BASE_FLOOR.blockNumber, "0x" + "00".repeat(32)), null, "wrong hash");
  assert.equal(checkSavedFloorHeader(bytes, BASE_FLOOR.blockNumber + 1, BASE_FLOOR.blockHash), null, "wrong number");
  const damaged = bytes.slice(); damaged[40] = damaged[40]! ^ 1;
  assert.equal(checkSavedFloorHeader(damaged, BASE_FLOOR.blockNumber, BASE_FLOOR.blockHash), null, "damaged bytes");
  assert.equal(checkSavedFloorHeader(new Uint8Array([1, 2, 3]), BASE_FLOOR.blockNumber, BASE_FLOOR.blockHash), null, "not a header");

  // The key the parent writes, and the read through it.
  assert.equal(baseFloorKey(52271417, BASE_FLOOR.blockHash), `base-floors/000052271417-${BASE_FLOOR.blockHash}.rlp`);
  const asked: string[] = [];
  const store = async (key: string) => { asked.push(key); return key === baseFloorKey(BASE_FLOOR.blockNumber, BASE_FLOOR.blockHash) ? bytes : null; };
  assert.equal((await readBaseFloorHeader(BASE_FLOOR.blockNumber, BASE_FLOOR.blockHash, store))?.blockTimestamp, BASE_FLOOR.blockTimestamp);
  assert.equal(await readBaseFloorHeader(BASE_FLOOR.blockNumber, "0x" + "11".repeat(32), store), null, "absent: 404");
  // A saved object under the asked key whose bytes are another block's: never served.
  const lying = async () => bytes;
  assert.equal(await readBaseFloorHeader(BASE_FLOOR.blockNumber, "0x" + "11".repeat(32), lying), null);
  await assert.rejects(readBaseFloorHeader(1, BASE_FLOOR.blockHash, async () => { throw new Error("S3 down"); }), /S3 down/, "an unreadable ledger is not an absent header");
});

test("the floor-header query is checked before anything is read", () => {
  assert.deepEqual(parseFloorHeaderQuery({ chain: "base", block: "52271417", hash: BASE_FLOOR.blockHash.toUpperCase().replace("0X", "0x") }), { ok: true, blockNumber: 52271417, blockHash: BASE_FLOOR.blockHash });
  for (const q of [
    { chain: "ethereum", block: "1", hash: BASE_FLOOR.blockHash },
    { chain: null, block: "1", hash: BASE_FLOOR.blockHash },
    { chain: "base", block: "0", hash: BASE_FLOOR.blockHash },
    { chain: "base", block: "-1", hash: BASE_FLOOR.blockHash },
    { chain: "base", block: "1e3", hash: BASE_FLOOR.blockHash },
    { chain: "base", block: "1", hash: "0x1234" },
    { chain: "base", block: "1", hash: null },
  ]) assert.equal(parseFloorHeaderQuery(q).ok, false, JSON.stringify(q));
});

/* ── The package ── */

const readmeBase: ReadmeInput = {
  recordName: "BitGraph #12",
  epochId: "e",
  proofUrl: "https://bitgraph.ing/proof/x",
  committedPath: "committed/a.txt",
  originalPath: "original/a.txt",
  carrierPath: "bitgraphed-file/a.bitgraph.txt",
  committedSha256Hex: "ab",
  originalSha256Hex: "cd",
  recordedIso: "2026-10-06T19:30:00.000Z",
  floor: { block: 52271417, iso: "2026-10-06T19:29:41.000Z", chain: "base" },
  ceilingInTime: { block: 52271430, iso: "2026-10-06T19:30:07.000Z", txHash: "0xfeed", reportedStatus: "safe" },
  settlement: null,
  ceilingInPosition: { anchorCounter: "13", block: 1, iso: null },
  pcr0: "p",
  enclaveTag: "enclave-v10",
  writer: "0xw",
  hasAnchorsBefore: false,
  hasAnchorsAfter: false,
  hasBaseFloorHeader: true,
  versions: { verify: "1.17.0", audit: "0.10.0", sdk: "0.5.0" },
};

test("the README for a Base floor: the claim, the floor step and the explorer name Base; no ceiling in position, no anchors", () => {
  const r = packageReadme(readmeBase);
  assert.match(r, /were finished after Base block 52,271,417 \(2026-10-06 19:29:41 UTC\) and existed by Base block 52,271,430/);
  assert.match(r, /could not be computed before that Base block's hash existed/);
  assert.match(r, /1\. Floor in time\n   Base block 52,271,417, 2026-10-06 19:29:41 UTC\. The enclave fixed this block when the position opened/);
  assert.match(r, /- base-floor\/\n  The floor block's header: Base block 52,271,417/);
  assert.match(r, /https:\/\/basescan\.org\/block\/52271417 and https:\/\/basescan\.org\/block\/52271430/);
  assert.match(r, /the proof, the floor block's header and the Base ceiling packed inside/);
  assert.doesNotMatch(r, /Ceiling in position/, "no anchor follows a Base floor, even if a caller passes one");
  assert.doesNotMatch(r, /ethereum-anchors|Ethereum anchors|etherscan\.io\/block\/52271417|Ethereum block 52/);
  assert.doesNotMatch(r, /[–—]/, "no dashes");
  // The floor header file the package carries, as bitgraph-audit reads it.
  assert.equal(PKG_BASE_FLOOR_FILE, "base-floor/floor-header.json");
  assert.deepEqual(floorHeaderFile(BASE_FLOOR, BASE_FLOOR_HEADER_HEX), { version: "bitgraph-floor-header/1", chain: "base", evmChainId: 8453, blockNumber: BASE_FLOOR.blockNumber, blockHash: BASE_FLOOR.blockHash, blockTimestamp: BASE_FLOOR.blockTimestamp, header: BASE_FLOOR_HEADER_HEX.toLowerCase() });
});

test("the folder check reads base-floor/: the signed floor's header holds, any other is a failure", async () => {
  const proof = made3 as unknown as Parameters<typeof baseFloorHeaderVerdict>[0];
  const file = (doc: unknown) => new File([JSON.stringify(doc)], "floor-header.json");
  const good = await baseFloorHeaderVerdict(proof, file(floorHeaderFile(BASE_FLOOR, BASE_FLOOR_HEADER_HEX)));
  assert.deepEqual(good, { ok: true, timestamp: BASE_FLOOR.blockTimestamp });
  const bytes = evmHexToBytes(BASE_FLOOR_HEADER_HEX); bytes[40] = bytes[40]! ^ 1;
  const tampered = await baseFloorHeaderVerdict(proof, file({ ...floorHeaderFile(BASE_FLOOR, BASE_FLOOR_HEADER_HEX), header: bytesToHex(bytes) }));
  assert.equal(tampered.ok, false);
  const notAHeader = await baseFloorHeaderVerdict(proof, file({ version: "something-else" }));
  assert.equal(notAHeader.ok, false);
  // A Base floor header beside a proof with an Ethereum floor: the folder claims a floor the proof does not sign.
  const { slotFloor: _f, ...ethCommit } = made3.commit;
  void _f;
  const ethProof = { ...made3, commit: { ...ethCommit, slotAnchor: { counter: "1", blockNumber: 2, blockHash: "0x" + "ab".repeat(32) } } } as unknown as Parameters<typeof baseFloorHeaderVerdict>[0];
  assert.equal((await baseFloorHeaderVerdict(ethProof, file(floorHeaderFile(BASE_FLOOR, BASE_FLOOR_HEADER_HEX)))).ok, false);
});

void TREE_METADATA_KEY;
void ({} as BitGraphProof);
