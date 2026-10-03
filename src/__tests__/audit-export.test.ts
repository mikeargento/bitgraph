// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * bitgraph-export/1 through the audit.
 *
 * Ingest finds an export by its format field wherever it sits (a directory,
 * a .tar, a .tar.gz, or in memory); the export is never an artifact, and the
 * proof it carries joins the proof analysis. Each export is checked with
 * verifyExport once per covered file (matched by SHA-256 to a leaf's
 * committed bytes or original), or once without a file; the JSON and
 * Markdown reports carry the verdict, every claim with what it rests on, the
 * covered files and the three time claims apart; an export with a FALSE
 * claim sets exit bit 1.
 *
 * Fixtures are tree/1 proofs signed with fresh test keys (makeKey and
 * signBody from audit-fixtures), pinned to the current SPEC.md hash
 * (currentTreeSpecHash, so the CLI needs no extra spec), with a synthetic
 * floor header whose keccak-256 is the signed floor block hash. A test key's
 * proof carries no AWS Nitro attestation, and verifyExport reads a missing
 * attestation as FALSE (attestation.signature): every export here therefore
 * has exactly that one FALSE claim when nothing else is wrong, and fails the
 * audit. Each test asserts the other claims one by one; the exit-flag test
 * covers the TRUE and UNDETERMINED paths on the computed result directly.
 *
 * Settlement: the live vector (spec/vectors/output-root-1.json) settles a
 * real Base ceiling transaction whose payload root covers a real proof. A
 * test-key proof cannot sit under that root, so the vector can only be bound
 * negatively here (it settles a different Base block than the export's
 * ceiling: ceiling.ethereum FALSE). Every other export uses a pending
 * settlement, and one carries a synthetic Base ceiling, written with a
 * throwaway secp256k1 writer key, to show the Base time held provisional.
 */

import { describe, it, before, after } from "node:test";
import * as assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { signAsync } from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { keccak_256 } from "@noble/hashes/sha3";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  CEILING_VERSION,
  LEAF_AS_IS,
  MerkleTree,
  TREE_METADATA_KEY,
  buildExport,
  buildTree,
  buildTreeMemberEvidence,
  buildTreeRootDocument,
  bytesEqual,
  bytesToBase64,
  bytesToHex,
  canonicalSlotBody,
  canonicalize,
  ceilingLeaf,
  computeChainHash,
  computeProofHash,
  computeSlotCommitment2,
  currentTreeSpecHash,
  encodeCeilingPayload,
  encodeTreeLeaves,
  evmBytesToHex,
  evmHexToBytes,
  keccak256,
  leafFor,
  merkleLeafHash,
  rlpEncode,
  treeAttribution,
  txTrieProof,
  verifyExport,
} from "@mikeargento/bitgraph-verify";
import type {
  BitGraphExport,
  BitGraphProof,
  CeilingSidecar,
  OutputRootSettlement,
  RlpItem,
  SlotAllocation,
  TreeLeaf,
} from "@mikeargento/bitgraph-verify";
import {
  DEFAULT_INGEST_LIMITS,
  auditIngest,
  buildJsonReport,
  buildMarkdownReport,
  computeExitFlags,
  exportRunClaims,
  ingestBundle,
  ingestEntries,
  runAudit,
} from "@mikeargento/bitgraph-audit";
import type { AuditResult, ExportCheck, ExportRun } from "@mikeargento/bitgraph-audit";
import {
  b64,
  healthyPairs,
  makeCounterChain,
  makeEthereumHeader,
  makeKey,
  makeTar,
  makeTempDir,
  proofJson,
  signBody,
  utf8,
  writeBundleDir,
  type ManualKey,
} from "./audit-fixtures.js";

const EM_DASH = "\u2014";
const CLI_PATH = fileURLToPath(new URL("../../packages/audit/dist/cli.js", import.meta.url));
const OUTPUT_ROOT_VECTOR = fileURLToPath(new URL("../../spec/vectors/output-root-1.json", import.meta.url));

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  const spawned = spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf8" });
  return { status: spawned.status ?? -1, stdout: spawned.stdout ?? "", stderr: spawned.stderr ?? "" };
}

// ---------------------------------------------------------------------------
// tree/1 fixtures
// ---------------------------------------------------------------------------

const FLOOR_NUMBER = 25_000_000;
const FLOOR_TIME = 1_790_000_000;
const floorHeader = makeEthereumHeader({ blockNumber: FLOOR_NUMBER, timestamp: FLOOR_TIME });
const FLOOR_HASH = `0x${Buffer.from(keccak_256(floorHeader.headerBytes)).toString("hex")}`;
const FLOOR = { blockNumber: FLOOR_NUMBER, blockHash: FLOOR_HASH, header: floorHeader.headerRlpHex };
const EPOCH = b64(sha256(utf8("audit export test epoch")));
const PENDING = { ceiling: { status: "pending" as const }, settlement: { status: "pending" as const } };

interface MemberSpec {
  name: string;
  original: Uint8Array;
  code: number;
}

interface Member extends MemberSpec {
  committed: Uint8Array;
  leaf: TreeLeaf;
}

interface World {
  key: ManualKey;
  slot: SlotAllocation;
  commitment: Uint8Array;
  members: Member[];
  sorted: TreeLeaf[];
  tree: MerkleTree;
  rootDoc: Uint8Array;
  proof: BitGraphProof;
  proofHash: string;
  chainHash: string;
  indexOf(m: Member): number;
  memberExport(m: Member, parts?: Partial<Pick<BitGraphExport, "floor" | "ceiling" | "settlement">>): BitGraphExport;
  ownerExport(parts?: Partial<Pick<BitGraphExport, "floor" | "ceiling" | "settlement">>): BitGraphExport;
}

async function allocateSlot(key: ManualKey, counter: string, epochId: string): Promise<SlotAllocation> {
  const body = {
    version: "bitgraph/slot/1" as const,
    nonceB64: b64(crypto.getRandomValues(new Uint8Array(32))),
    counter,
    epochId,
    publicKeyB64: key.publicKeyB64,
    chainId: "bitgraph:main",
  };
  return { ...body, signatureB64: b64(await signAsync(canonicalize(body), key.privateKey)) };
}

/** A tree/1 BitGraph over the given files: one position, one signed root document. */
async function makeWorld(
  specs: MemberSpec[],
  o: { key?: ManualKey; epochId?: string; slotCounter?: string; commitCounter?: string; prevB64?: string; measurement?: string } = {}
): Promise<World> {
  const key = o.key ?? (await makeKey());
  const slot = await allocateSlot(key, o.slotCounter ?? "1", o.epochId ?? EPOCH);
  const commitment = computeSlotCommitment2(slot, FLOOR_HASH);
  const members: Member[] = specs.map((s) => ({ ...s, ...leafFor(s.code, s.original, commitment) }));
  const built = buildTree(members.map((m) => m.leaf));
  const rootDoc = buildTreeRootDocument(commitment, built.sorted.length, built.root);
  const commit: BitGraphProof["commit"] = {
    nonceB64: slot.nonceB64,
    counter: o.commitCounter ?? "2",
    epochId: slot.epochId,
    slotCounter: slot.counter,
    slotHashB64: b64(sha256(canonicalize(canonicalSlotBody(slot)))),
    slotAnchor: { counter: "0", blockNumber: FLOOR_NUMBER, blockHash: FLOOR_HASH },
    ...(o.prevB64 !== undefined ? { prevB64: o.prevB64 } : {}),
  };
  (commit as unknown as Record<string, unknown>)["chainId"] = "bitgraph:main";
  const proof = await signBody(
    key,
    { hashAlg: "sha256", digestB64: b64(sha256(rootDoc)) },
    commit,
    o.measurement ?? "test-measurement-tree1",
    { attribution: treeAttribution(currentTreeSpecHash()) }
  );
  proof.slotAllocation = slot;
  proof.metadata = { [TREE_METADATA_KEY]: bytesToHex(rootDoc) };

  const indexOf = (m: Member) => built.sorted.findIndex((l) => bytesEqual(l.artifact, m.leaf.artifact));
  const nameOf = (l: TreeLeaf) => members.find((m) => bytesEqual(m.leaf.artifact, l.artifact))!.name;
  return {
    key,
    slot,
    commitment,
    members,
    sorted: built.sorted,
    tree: built.tree,
    rootDoc,
    proof,
    proofHash: computeProofHash(proof),
    chainHash: computeChainHash(proof),
    indexOf,
    memberExport: (m, parts = {}) => {
      const k = indexOf(m);
      return buildExport({
        proof,
        tree: { rootDocument: bytesToHex(rootDoc), member: buildTreeMemberEvidence(m.leaf, k, built.sorted.length, built.tree.path(k)) },
        floor: FLOOR,
        ...PENDING,
        ...parts,
      });
    },
    ownerExport: (parts = {}) =>
      buildExport({
        proof,
        tree: {
          rootDocument: bytesToHex(rootDoc),
          leaves: bytesToBase64(encodeTreeLeaves(built.sorted)),
          names: built.sorted.map(nameOf),
        },
        floor: FLOOR,
        ...PENDING,
        ...parts,
      }),
  };
}

const exportJson = (e: unknown): string => JSON.stringify(e, null, 1);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const flipHex = (hex: string, at: number): string => hex.slice(0, at) + (hex[at] === "0" ? "1" : "0") + hex.slice(at + 1);

const ONE = (): MemberSpec[] => [{ name: "photo.jpg", original: utf8("a photograph, as bytes\n"), code: 0x01 }];
const FIVE = (): MemberSpec[] => [
  { name: "a-trailer.txt", original: utf8("first file, trailer placement\n"), code: 0x01 },
  { name: "b-container.txt", original: utf8("second file, container/1\n"), code: 0x02 },
  { name: "c-container2.txt", original: utf8("third file, container/2\n"), code: 0x03 },
  { name: "d-trailer.txt", original: utf8("fourth file, trailer again\n"), code: 0x01 },
  { name: "e-as-is.bin", original: utf8("recorded exactly as it is\n"), code: LEAF_AS_IS },
];

function claimOf(check: ExportCheck, run: ExportRun, id: string) {
  return exportRunClaims(check, run).find((c) => c.id === id);
}

function resultOf(check: ExportCheck, run: ExportRun, id: string): string | undefined {
  return claimOf(check, run, id)?.result;
}

/** A run as verifyExport returned it: its whole claim list put back together, its reasons, and the export's time claims. */
function verifierPart(check: ExportCheck, run: ExportRun) {
  const claims = exportRunClaims(check, run);
  return {
    verdict: run.verdict,
    reasons: claims.filter((c) => c.result === "FALSE" || c.result === "UNDETERMINED").map((c) => `${c.id}: ${c.detail}`),
    claims,
    member: run.member,
    times: check.times,
    reading: run.reading,
  };
}

async function direct(e: unknown, bytes?: Uint8Array) {
  const r = await verifyExport(e, bytes !== undefined ? { bytes } : {});
  return { verdict: r.verdict, reasons: r.reasons, claims: r.claims, member: r.member, times: r.times, reading: r.reading };
}

// ---------------------------------------------------------------------------
// A synthetic Base ceiling for a tree/1 proof (throwaway writer key)
// ---------------------------------------------------------------------------

function u(n: bigint | number): Uint8Array {
  let h = BigInt(n).toString(16);
  if (h === "0") return new Uint8Array(0);
  if (h.length % 2) h = `0${h}`;
  return evmHexToBytes(h);
}

function makeBaseCeiling(proof: BitGraphProof, at: { blockNumber: number; timestamp: number }): { sidecar: CeilingSidecar; writer: string } {
  const priv = secp256k1.utils.randomSecretKey();
  const writer = evmBytesToHex(keccak256(secp256k1.getPublicKey(priv, false).slice(1)).slice(12));
  const proofHash = computeProofHash(proof);
  const others = [1, 2, 3, 4].map((i) => merkleLeafHash(sha256(new Uint8Array([i]))));
  const leaves = [others[0]!, others[1]!, ceilingLeaf(proofHash), others[2]!, others[3]!];
  const tree = new MerkleTree(leaves);
  const payload = encodeCeilingPayload({ root: tree.root, prev: new Uint8Array(32), firstPos: 1n, lastPos: 2n });
  const fields: RlpItem[] = [u(8453), u(0), u(1_000_000), u(2_000_000_000), u(30_000), evmHexToBytes(writer), u(0), payload, []];
  const hash = keccak256(new Uint8Array([0x02, ...rlpEncode(fields)]));
  const sig = secp256k1.sign(hash, priv, { prehash: false, format: "recovered" });
  const r = BigInt(evmBytesToHex(sig.slice(1, 33)));
  const s = BigInt(evmBytesToHex(sig.slice(33, 65)));
  const raw = new Uint8Array([0x02, ...rlpEncode([...fields, u(sig[0]!), u(r), u(s)])]);
  const block = [evmHexToBytes("0x7e0102"), evmHexToBytes("0x02c0ffee"), raw, evmHexToBytes("0x01aabbcc")];
  const txIndex = 2;
  const { root: txRoot, proof: inclusion } = txTrieProof(block, txIndex);
  const z32 = new Uint8Array(32);
  const header = rlpEncode([
    z32, z32, new Uint8Array(20), z32, txRoot, z32, new Uint8Array(256), u(0), u(at.blockNumber), u(30_000_000),
    u(21_000), u(at.timestamp), new Uint8Array(0), z32, new Uint8Array(8), u(1000),
  ]);
  const sidecar: CeilingSidecar = {
    version: CEILING_VERSION,
    proofHash,
    leafIndex: 2,
    leafCount: 5,
    merklePath: tree.path(2).map(evmBytesToHex),
    root: evmBytesToHex(tree.root),
    anchor: {
      chainId: 8453,
      writer,
      txHash: evmBytesToHex(keccak256(raw)),
      rawTx: evmBytesToHex(raw),
      payload: evmBytesToHex(payload),
      blockNumber: at.blockNumber,
      blockHash: evmBytesToHex(keccak256(header)),
      blockTimestamp: at.timestamp,
      blockHeader: evmBytesToHex(header),
      txIndex,
      txInclusionProof: inclusion.map(evmBytesToHex),
    },
    status: "included",
    statusObserved: { included: "2026-10-03T00:00:00.000Z", safe: null, finalized: null },
    floor: null,
    settlement: null,
  };
  return { sidecar, writer };
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

describe("audit: exports (bitgraph-export/1)", () => {
  const tempDirs: string[] = [];
  const bundle = async (files: Record<string, Uint8Array | string>): Promise<string> => {
    const dir = await makeTempDir("bitgraph-audit-export-");
    tempDirs.push(dir);
    await writeBundleDir(dir, files);
    return dir;
  };
  after(async () => {
    for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
  });

  let one: World;
  let five: World;
  before(async () => {
    one = await makeWorld(ONE());
    five = await makeWorld(FIVE());
  });

  const onlyCheck = (r: AuditResult): ExportCheck => {
    assert.equal(r.exports?.checks.length, 1);
    return r.exports!.checks[0]!;
  };

  it("a member export with its original: every claim reported as verifyExport states it; only the attestation fails", async () => {
    const m = one.members[0]!;
    const exp = one.memberExport(m);
    const dir = await bundle({ "exports/photo.export.json": exportJson(exp), "files/photo.jpg": m.original });
    const r = await runAudit(dir);

    // Ingest: found by structure, never an artifact; its proof joins the proof analysis.
    assert.equal(r.ingest.exports?.length, 1);
    assert.equal(r.ingest.exports![0]!.status, "ok");
    assert.equal(r.ingest.exports![0]!.proofHash, one.proofHash);
    assert.equal(r.ingest.counts.exports, 1);
    assert.deepEqual(r.ingest.artifacts.map((a) => a.paths), [["files/photo.jpg"]]);
    const observed = r.ingest.proofs.find((p) => p.proofHash === one.proofHash);
    assert.ok(observed, "the export's proof is an observed proof");
    assert.deepEqual(observed.sources.map((s) => s.path), ["exports/photo.export.json"]);
    assert.equal(observed.verification?.status, "artifact-unavailable", "its artifact is the root document, not a bundle file");
    assert.equal(r.reconstruction.partitions.length, 1);
    assert.equal(r.anomalies.anomalies.length, 0);

    const e = onlyCheck(r);
    assert.equal(e.status, "checked");
    assert.equal(e.kind, "member");
    assert.equal(e.proofHash, one.proofHash);
    assert.equal(e.files.length, 1);
    assert.deepEqual(e.files[0], {
      sha256Hex: bytesToHex(sha256(m.original)),
      paths: ["files/photo.jpg"],
      byteLength: m.original.length,
      leafIndex: 0,
      placement: "trailer/1",
      matchedAs: "original",
    });
    assert.equal(e.runs.length, 1);
    const run = e.runs[0]!;
    assert.deepEqual(run.file, e.files[0]);
    assert.deepEqual(run.claims, [], "with one run, every claim is the export's");

    // Claim by claim.
    for (const [id, want] of Object.entries({
      format: "TRUE",
      "proof.signature": "TRUE",
      "attestation.signature": "FALSE",
      "spec.pin": "TRUE",
      "tree.root": "TRUE",
      "tree.member": "TRUE",
      "bytes.member": "TRUE",
      "bytes.floor": "TRUE",
      "floor.header": "TRUE",
      "ceiling.base": "NOT_CARRIED",
      "ceiling.ethereum": "NOT_CARRIED",
      "confirmed.floor": "UNDETERMINED",
    })) {
      assert.equal(resultOf(e, run, id), want, id);
    }
    assert.match(claimOf(e, run, "attestation.signature")!.detail, /carries no aws-nitro attestation/);
    assert.match(claimOf(e, run, "bytes.member")!.detail, /^TREE_MEMBER_FROM_ORIGIN/);
    assert.equal(claimOf(e, run, "confirmed.floor")!.level, "confirmed");
    assert.equal(claimOf(e, run, "proof.signature")!.restsOn, "Ed25519");
    assert.deepEqual(e.failedClaims, ["attestation.signature"]);
    assert.equal(e.verdict, "FALSE");
    assert.equal(run.floorCovers, "committed-bytes");
    assert.equal(run.member?.index, 0);
    assert.equal(run.member?.count, 1);

    // The three time claims, apart.
    assert.deepEqual(e.times, {
      floor: { blockNumber: FLOOR_NUMBER, blockHash: FLOOR_HASH, blockTimestamp: FLOOR_TIME },
      ceilingBase: null,
      ceilingEthereum: null,
    });

    // The audit reports exactly what the verifier says for that file.
    assert.deepEqual(verifierPart(e, run), await direct(exp, m.original));

    // A FALSE claim fails the audit the way a bad proof does: bit 1, and nothing else here.
    assert.deepEqual(computeExitFlags(r), { verificationFailures: true, chainAnomaliesOrDivergences: false, code: 1 });

    // JSON: the export, its summary counts, and no proof body or signature.
    const report = buildJsonReport(r);
    assert.equal(report.exports?.checks[0]?.path, "exports/photo.export.json");
    assert.deepEqual(report.summary.exports, { files: 1, verdictTrue: 0, verdictFalse: 1, verdictUndetermined: 0, rejected: 0, coveredFilesChecked: 1 });
    const json = JSON.stringify(report, null, 2);
    assert.ok(!json.includes('"signatureB64"'), "no signature leaks into the report");
    assert.ok(!json.includes(EM_DASH));

    // Markdown: the verdict, the covered file, every claim, the three time claims.
    const md = buildMarkdownReport(r);
    assert.ok(!md.includes(EM_DASH));
    assert.ok(md.includes("### Exports (bitgraph-export/1)"));
    assert.ok(md.includes("- FALSE `exports/photo.export.json`: member export of a tree of 1 leaf; 1 covered file in this bundle. FALSE claims: `attestation.signature`."));
    assert.ok(md.includes("#### Export `exports/photo.export.json`: FALSE"));
    assert.ok(md.includes("| `files/photo.jpg` |"));
    assert.ok(md.includes("Time claims, each on its own evidence and never merged:"));
    assert.ok(md.includes(`- Floor: Ethereum block 25,000,000, mined at ${FLOOR_TIME} (`));
    assert.ok(md.includes("- Ceiling on Base: not established (`ceiling.base` NOT_CARRIED: ceiling pending"));
    assert.ok(md.includes("- Ceiling on Ethereum: not established (`ceiling.ethereum` NOT_CARRIED: settlement pending"));
    for (const c of exportRunClaims(e, run)) assert.ok(md.includes(`| \`${c.id}\` | ${c.result} | ${c.level} |`), `claim row ${c.id}`);
    assert.ok(md.includes("The floor covers the committed bytes; an original inside them has no floor of its own."));
  });

  it("the same export with the committed bytes instead of the original", async () => {
    const m = one.members[0]!;
    const exp = one.memberExport(m);
    const dir = await bundle({ "photo.export.json": exportJson(exp), "photo.bitgraph.jpg": m.committed });
    const e = onlyCheck(await runAudit(dir));
    assert.equal(e.files[0]!.matchedAs, "committed-bytes");
    const run = e.runs[0]!;
    assert.equal(resultOf(e, run, "bytes.member"), "TRUE");
    assert.match(claimOf(e, run, "bytes.member")!.detail, /^TREE_MEMBER_DIRECT/);
    assert.equal(run.floorCovers, "committed-bytes");
    assert.deepEqual(e.failedClaims, ["attestation.signature"]);
    assert.deepEqual(verifierPart(e, run), await direct(exp, m.committed));
  });

  it("the owner's export with 5 files: one run per file, equal to verifyExport on the export as given", async () => {
    const exp = five.ownerExport();
    const files: Record<string, Uint8Array | string> = { "bitgraph-2-test.export.json": exportJson(exp) };
    // Three originals and two committed files; the as-is file is both.
    for (const [i, m] of five.members.entries()) files[`folder/${m.name}`] = i % 2 === 0 ? m.original : m.committed;
    const r = await runAudit(await bundle(files));
    const e = onlyCheck(r);
    assert.equal(e.kind, "owner");
    assert.equal(e.runMode, "member-from-list");
    assert.equal(e.files.length, 5);
    assert.deepEqual(e.files.map((f) => f.paths[0]), five.members.map((m) => `folder/${m.name}`), "sorted by path");
    assert.equal(e.runs.length, 5);
    for (const [i, m] of five.members.entries()) {
      const f = e.files[i]!;
      const run = e.runs[i]!;
      assert.equal(f.leafIndex, five.indexOf(m), m.name);
      assert.equal(f.nameInExport, m.name, "the export's (unsigned) name for the leaf");
      assert.equal(f.matchedAs, m.code === LEAF_AS_IS ? "as-is" : i % 2 === 0 ? "original" : "committed-bytes", m.name);
      assert.equal(resultOf(e, run, "tree.leaves"), "TRUE", m.name);
      assert.equal(resultOf(e, run, "tree.member"), "TRUE", m.name);
      assert.equal(resultOf(e, run, "bytes.member"), "TRUE", m.name);
      assert.equal(run.floorCovers, m.code === LEAF_AS_IS ? "none" : "committed-bytes", m.name);
      // The list-derived run is the as-given run, claim for claim, in order.
      assert.deepEqual(verifierPart(e, run), await direct(exp, i % 2 === 0 ? m.original : m.committed), m.name);
    }
    assert.deepEqual(e.failedClaims, ["attestation.signature"]);
    assert.equal(e.verdict, "FALSE");
    assert.equal(computeExitFlags(r).code, 1);
    // Stated once: what every run says alike. Per run: what is about its file, with its place in the list.
    assert.deepEqual(e.claims.map((c) => c.id), [
      "format", "proof.signature", "attestation.signature", "tree.leaves", "spec.pin", "tree.root",
      "floor.header", "ceiling.base", "ceiling.ethereum", "confirmed.floor",
    ]);
    for (const run of e.runs) {
      assert.deepEqual(run.claims.map((c) => [c.id, c.position]), [["tree.member", 6], ["bytes.member", 7], ["bytes.floor", 8]]);
    }

    const md = buildMarkdownReport(r);
    assert.ok(md.includes("the owner's export (the whole list) of a tree of 5 leaves; 5 covered files in this bundle"));
    assert.ok(md.includes("Claims, the same in every run:"));
    assert.ok(md.includes("Claims that differ by file:"));
    assert.ok(md.includes("| `folder/e-as-is.bin` | `bytes.member` | TRUE |"));
    assert.ok(md.includes("- `folder/e-as-is.bin`: FALSE. Recorded as is: the file existed by the commit, and nothing bounds it from below."));
    assert.equal(buildJsonReport(r).summary.exports?.coveredFilesChecked, 5);
  });

  it("a tampered file, with the export's leaf edited to match it: the leaf no longer reaches the signed root (FALSE)", async () => {
    const m = one.members[0]!;
    const tampered = utf8("a photograph, as bytes, retouched\n");
    const exp = clone(one.memberExport(m));
    // Point the leaf's origin at the tampered bytes: the file now matches by digest.
    const leafHex = exp.tree.member!.leaf;
    exp.tree.member!.leaf = leafHex.slice(0, 66) + bytesToHex(sha256(tampered));
    const r = await runAudit(await bundle({ "photo.export.json": exportJson(exp), "photo.jpg": tampered }));
    const e = onlyCheck(r);
    assert.equal(e.files.length, 1, "matched by the edited digest");
    const run = e.runs[0]!;
    assert.equal(resultOf(e, run, "tree.root"), "TRUE");
    assert.equal(resultOf(e, run, "tree.member"), "FALSE");
    assert.match(claimOf(e, run, "tree.member")!.detail, /do not recompute the committed root/);
    assert.equal(e.verdict, "FALSE");
    assert.ok(e.failedClaims.includes("tree.member"));
    assert.equal(computeExitFlags(r).code & 1, 1);
    assert.deepEqual(verifierPart(e, run), await direct(exp, tampered));
  });

  it("committed bytes the tree lists that the placement rule does not make from the original: bytes.member FALSE", async () => {
    // The producer listed a trailer's committed digest under container/1: the
    // original is matched by its digest, but rebuilding fails.
    const key = await makeKey();
    const slot = await allocateSlot(key, "1", EPOCH);
    const commitment = computeSlotCommitment2(slot, FLOOR_HASH);
    const original = utf8("committed by trailer, listed as container\n");
    const trailer = leafFor(0x01, original, commitment).committed;
    const lying: TreeLeaf = { placement: 0x02, artifact: sha256(trailer), origin: sha256(original) };
    const built = buildTree([lying]);
    const rootDoc = buildTreeRootDocument(commitment, 1, built.root);
    const commit: BitGraphProof["commit"] = {
      nonceB64: slot.nonceB64,
      counter: "2",
      epochId: slot.epochId,
      slotCounter: slot.counter,
      slotHashB64: b64(sha256(canonicalize(canonicalSlotBody(slot)))),
      slotAnchor: { counter: "0", blockNumber: FLOOR_NUMBER, blockHash: FLOOR_HASH },
    };
    (commit as unknown as Record<string, unknown>)["chainId"] = "bitgraph:main";
    const proof = await signBody(key, { hashAlg: "sha256", digestB64: b64(sha256(rootDoc)) }, commit, "test-measurement-tree1", {
      attribution: treeAttribution(currentTreeSpecHash()),
    });
    proof.slotAllocation = slot;
    const exp = buildExport({ proof, tree: { rootDocument: bytesToHex(rootDoc), member: buildTreeMemberEvidence(lying, 0, 1, []) }, floor: FLOOR, ...PENDING });
    const r = await runAudit(await bundle({ "x.export.json": exportJson(exp), "x.txt": original }));
    const c1 = onlyCheck(r);
    const run = c1.runs[0]!;
    assert.equal(resultOf(c1, run, "tree.member"), "TRUE");
    assert.equal(resultOf(c1, run, "bytes.member"), "FALSE");
    assert.match(claimOf(c1, run, "bytes.member")!.detail, /^RECONSTRUCTION_MISMATCH/);
    assert.equal(computeExitFlags(r).code & 1, 1);
  });

  it("a tampered file and an untouched export: the file is not covered, so the export is checked without one", async () => {
    // Matching is by SHA-256 only. A changed file matches no leaf; it stays an
    // ordinary artifact, and the export's claims about its file read NOT_CARRIED.
    const m = one.members[0]!;
    const r = await runAudit(await bundle({ "photo.export.json": exportJson(one.memberExport(m)), "photo.jpg": utf8("retouched\n") }));
    const e = onlyCheck(r);
    assert.equal(e.files.length, 0);
    assert.equal(e.runs[0]!.file, null);
    assert.equal(resultOf(e, e.runs[0]!, "bytes.member"), "NOT_CARRIED");
    assert.equal(r.ingest.artifacts.length, 1);
  });

  it("a broken path: tree.member FALSE, and the audit fails", async () => {
    const m = five.members[1]!;
    const exp = clone(five.memberExport(m));
    exp.tree.member!.path[0] = flipHex(exp.tree.member!.path[0]!, 0);
    const r = await runAudit(await bundle({ "member.export.json": exportJson(exp), "b.txt": m.original }));
    const e = onlyCheck(r);
    const run = e.runs[0]!;
    assert.equal(resultOf(e, run, "tree.root"), "TRUE");
    assert.equal(resultOf(e, run, "tree.member"), "FALSE");
    assert.equal(resultOf(e, run, "bytes.member"), "UNDETERMINED");
    assert.deepEqual(e.failedClaims, ["attestation.signature", "tree.member"]);
    assert.equal(e.verdict, "FALSE");
    assert.equal(computeExitFlags(r).code, 1);
    const md = buildMarkdownReport(r);
    assert.ok(md.includes("FALSE claims: `attestation.signature`, `tree.member`."));
  });

  it("an export without its file: the file's claims are NOT_CARRIED and add no failure", async () => {
    const m = five.members[2]!;
    const exp = five.memberExport(m);
    const alone = onlyCheck(await runAudit(await bundle({ "member.export.json": exportJson(exp) })));
    assert.equal(alone.files.length, 0);
    assert.equal(alone.runs.length, 1);
    const run = alone.runs[0]!;
    assert.equal(run.file, null);
    assert.equal(resultOf(alone, run, "tree.member"), "TRUE", "the path is checked without the file");
    assert.equal(resultOf(alone, run, "bytes.member"), "NOT_CARRIED");
    assert.equal(resultOf(alone, run, "bytes.floor"), undefined);
    assert.equal(run.floorCovers, null);
    assert.deepEqual(verifierPart(alone, run), await direct(exp));
    // The same export with its file fails on exactly the same claims: the absence added none.
    const withFile = onlyCheck(await runAudit(await bundle({ "member.export.json": exportJson(exp), "c.txt": m.original })));
    assert.deepEqual(alone.failedClaims, withFile.failedClaims);
    assert.deepEqual(alone.failedClaims, ["attestation.signature"]);
    // The owner's export alone: one run without a file.
    const owner = onlyCheck(await runAudit(await bundle({ "owner.export.json": exportJson(five.ownerExport()) })));
    assert.equal(owner.runs.length, 1);
    assert.equal(owner.runs[0]!.file, null);
    assert.equal(resultOf(owner, owner.runs[0]!, "tree.leaves"), "TRUE");
    assert.equal(resultOf(owner, owner.runs[0]!, "bytes.member"), "NOT_CARRIED");
    assert.equal(owner.runMode, undefined);
  });

  it("a bundle mixing legacy proofs and an export: both reported, and the export's proof joins the legacy chain", async () => {
    const chain = await makeCounterChain({ epochId: "epoch-export-mixed", pairs: healthyPairs(2), chainId: "bitgraph:main", payloadPrefix: "mixed" });
    const world = await makeWorld(FIVE().slice(0, 2), {
      key: chain.key,
      epochId: "epoch-export-mixed",
      slotCounter: "5",
      commitCounter: "6",
      prevB64: chain.proofs[1]!.chainHash,
      measurement: "test-measurement-chain",
    });
    const dir = await bundle({
      "proofs/legacy-0.json": proofJson(chain.proofs[0]!.proof),
      "proofs/legacy-1.json": proofJson(chain.proofs[1]!.proof),
      "artifacts/legacy-0.bin": chain.proofs[0]!.bytes,
      "artifacts/legacy-1.bin": chain.proofs[1]!.bytes,
      "exports/tree.export.json": exportJson(world.ownerExport()),
      "files/a-trailer.txt": world.members[0]!.original,
      "files/b-container.txt": world.members[1]!.committed,
    });
    const r = await runAudit(dir);
    // Legacy proofs: fully verified. The export's proof: observed, in the same partition, linked.
    assert.equal(r.verification.verified, 2);
    assert.equal(r.verification.artifactUnavailable, 1);
    assert.equal(r.reconstruction.partitions.length, 1);
    const partition = r.reconstruction.partitions[0]!;
    assert.equal(partition.memberProofHashes.length, 3);
    assert.ok(partition.memberProofHashes.includes(world.proofHash));
    assert.equal(partition.components.length, 1, "one connected chain: the tree/1 proof extends the legacy ones");
    assert.equal(r.anomalies.anomalies.length, 0);
    assert.equal(r.authorities.anomalies.length, 0);
    // The export: both files covered and checked.
    const e = onlyCheck(r);
    assert.equal(e.runs.length, 2);
    for (const run of e.runs) assert.equal(resultOf(e, run, "bytes.member"), "TRUE");
    assert.deepEqual(computeExitFlags(r), { verificationFailures: true, chainAnomaliesOrDivergences: false, code: 1 });
    // Both kinds in both reports.
    const report = buildJsonReport(r);
    assert.equal(report.proofs.length, 3);
    assert.equal(report.exports?.checks.length, 1);
    assert.equal(report.partitions[0]?.intact, true);
    const md = buildMarkdownReport(r);
    assert.ok(md.includes("Chain intact: yes"));
    assert.ok(md.includes("Fully verified (artifact bytes present and matched) | 2 |"));
    assert.ok(md.includes("#### Export `exports/tree.export.json`: FALSE"));
  });

  it("the export's proof is held to the same anomaly rules: a counter it shares with a legacy proof is a collision", async () => {
    const chain = await makeCounterChain({ epochId: "epoch-export-collide", pairs: healthyPairs(2), chainId: "bitgraph:main", payloadPrefix: "collide" });
    const world = await makeWorld(ONE(), {
      key: chain.key,
      epochId: "epoch-export-collide",
      slotCounter: "3",
      commitCounter: "4",
      prevB64: chain.proofs[0]!.chainHash,
      measurement: "test-measurement-chain",
    });
    const r = await runAudit(
      await bundle({
        "proofs/legacy-0.json": proofJson(chain.proofs[0]!.proof),
        "proofs/legacy-1.json": proofJson(chain.proofs[1]!.proof),
        "exports/tree.export.json": exportJson(world.ownerExport()),
      })
    );
    const codes = r.anomalies.anomalies.map((a) => a.code);
    assert.ok(codes.includes("counter-collision"), codes.join(","));
    assert.ok(r.anomalies.divergences.some((d) => d.parties.some((p) => p.proofHash === world.proofHash)));
    assert.equal(computeExitFlags(r).code, 3);
  });

  it("a ceiling on Base is reported as its own time claim, provisional; a settlement for another Base block is FALSE", async () => {
    const m = one.members[0]!;
    const { sidecar, writer } = makeBaseCeiling(one.proof, { blockNumber: 30_000_000, timestamp: 1_790_000_600 });
    const withCeiling = one.memberExport(m, { ceiling: sidecar });
    const r = await runAudit(await bundle({ "photo.export.json": exportJson(withCeiling), "photo.jpg": m.original }), { ceilings: { writer } });
    const e = onlyCheck(r);
    const run = e.runs[0]!;
    assert.equal(resultOf(e, run, "ceiling.base"), "TRUE", claimOf(e, run, "ceiling.base")?.detail);
    assert.equal(resultOf(e, run, "ceiling.ethereum"), "NOT_CARRIED");
    assert.equal(resultOf(e, run, "confirmed.ceiling.base"), "UNDETERMINED");
    assert.deepEqual(e.times.ceilingBase, { blockNumber: 30_000_000, blockHash: sidecar.anchor!.blockHash, blockTimestamp: 1_790_000_600, provisional: true });
    assert.ok(e.times.floor, "the floor stays its own claim");
    assert.equal(e.times.ceilingEthereum, null);
    assert.deepEqual(e.failedClaims, ["attestation.signature"]);
    const md = buildMarkdownReport(r);
    assert.ok(md.includes("- Ceiling on Base: the record existed by Base block 30,000,000, at 1790000600 ("));
    assert.ok(md.includes("PROVISIONAL: this time holds once the block is checked against Base, which this offline audit does not do."));
    assert.ok(md.includes("- Floor: Ethereum block 25,000,000"));
    assert.ok(md.includes("- Ceiling on Ethereum: not established"));

    // Without the writer pinned, the ceiling is from an unknown writer: FALSE.
    const unpinned = onlyCheck(await runAudit(await bundle({ "photo.export.json": exportJson(withCeiling), "photo.jpg": m.original })));
    assert.equal(resultOf(unpinned, unpinned.runs[0]!, "ceiling.base"), "FALSE");

    // The live settlement vector settles a different Base block than this ceiling.
    const vector = JSON.parse(readFileSync(OUTPUT_ROOT_VECTOR, "utf8")) as { settlement: OutputRootSettlement };
    const settled = one.memberExport(m, { ceiling: sidecar, settlement: vector.settlement });
    const s = onlyCheck(await runAudit(await bundle({ "photo.export.json": exportJson(settled), "photo.jpg": m.original }), { ceilings: { writer } }));
    assert.equal(resultOf(s, s.runs[0]!, "ceiling.ethereum"), "FALSE");
    assert.match(claimOf(s, s.runs[0]!, "ceiling.ethereum")!.detail, /different Base block/);
    assert.ok(s.failedClaims.includes("ceiling.ethereum"));
    assert.equal(s.times.ceilingEthereum, null);
  });

  it("an embedder's own lookups reach the confirmed claims; a refuted block fails the export (the CLI never looks up)", async () => {
    const m = one.members[0]!;
    const { sidecar, writer } = makeBaseCeiling(one.proof, { blockNumber: 30_000_001, timestamp: 1_790_000_612 });
    const dir = await bundle({ "photo.export.json": exportJson(one.memberExport(m, { ceiling: sidecar })), "photo.jpg": m.original });
    const yes = onlyCheck(
      await runAudit(dir, {
        ceilings: { writer },
        exports: { lookups: { ethereumBlockHash: async () => FLOOR_HASH, baseBlockHash: async () => sidecar.anchor!.blockHash } },
      })
    );
    assert.equal(resultOf(yes, yes.runs[0]!, "confirmed.floor"), "TRUE");
    assert.equal(resultOf(yes, yes.runs[0]!, "confirmed.ceiling.base"), "TRUE");
    assert.equal(yes.times.ceilingBase?.provisional, false);
    const no = await runAudit(dir, { ceilings: { writer }, exports: { lookups: { ethereumBlockHash: async () => `0x${"00".repeat(32)}` } } });
    const refuted = onlyCheck(no);
    assert.equal(resultOf(refuted, refuted.runs[0]!, "confirmed.floor"), "FALSE");
    assert.ok(refuted.failedClaims.includes("confirmed.floor"));
    assert.equal(refuted.verdict, "FALSE");
  });

  it("a malformed ceiling fails closed instead of passing silently", async () => {
    // A ceiling whose root is not a string. The verifier used to throw here; it now
    // returns ceiling.base FALSE, and the audit's own fail-closed path stays for any
    // throw that remains.
    const m = one.members[0]!;
    const hostile = clone(one.memberExport(m)) as unknown as Record<string, unknown>;
    hostile["ceiling"] = { version: CEILING_VERSION, proofHash: one.proofHash, leafIndex: 0, leafCount: 1, merklePath: [], root: 123, anchor: {}, status: "included" };
    const direct = await verifyExport(hostile, { bytes: m.original });
    assert.equal(direct.claims.find((c) => c.id === "ceiling.base")?.result, "FALSE");
    const r = await runAudit(await bundle({ "photo.export.json": exportJson(hostile), "photo.jpg": m.original }));
    const e = onlyCheck(r);
    assert.equal(e.verdict, "FALSE");
    assert.ok(e.failedClaims.includes("ceiling.base"), JSON.stringify(e.failedClaims));
    assert.equal(computeExitFlags(r).code & 1, 1);
  });

  it("an owner's list that fails: files checked as given, within the budget; the rest listed as unchecked", async () => {
    const exp = clone(five.ownerExport());
    const list = Buffer.from(exp.tree.leaves!, "base64");
    exp.tree.leaves = Buffer.concat([list.subarray(65, 130), list.subarray(0, 65), list.subarray(130)]).toString("base64");
    const files: Record<string, Uint8Array | string> = { "owner.export.json": exportJson(exp) };
    for (const m of five.members) files[m.name] = m.original;
    const dir = await bundle(files);
    const all = onlyCheck(await runAudit(dir));
    assert.equal(all.runMode, "as-given");
    assert.equal(all.runs.length, 5);
    for (const run of all.runs) assert.equal(resultOf(all, run, "tree.leaves"), "FALSE");
    assert.ok(all.failedClaims.includes("tree.leaves"));
    assert.equal(all.unchecked, undefined);
    // A budget of two whole-list rebuilds: two runs, three files listed as not checked one by one.
    const capped = onlyCheck(await runAudit(dir, { exports: { asGivenLeafBudget: 10 } }));
    assert.equal(capped.runs.length, 2);
    assert.equal(capped.unchecked?.length, 3);
    assert.match(capped.unchecked![0]!.reason, /budget of 10 rebuilt leaves ran out/);
    assert.equal(capped.verdict, "FALSE");
    const md = buildMarkdownReport(await runAudit(dir, { exports: { asGivenLeafBudget: 10 } }));
    assert.ok(md.includes(", 2 checked one by one."));
  });

  it("malformed and unsupported export files: reported, never artifacts, and they fail the audit", async () => {
    const r = await runAudit(
      await bundle({
        "bad.export.json": JSON.stringify({ format: "bitgraph-export/1", proof: one.proof }),
        "future.export.json": JSON.stringify({ format: "bitgraph-export/2", anything: true }),
      })
    );
    assert.equal(r.ingest.artifacts.length, 0);
    assert.equal(r.ingest.proofs.length, 0, "a rejected export's proof does not join the analysis");
    const byPath = new Map(r.exports!.checks.map((c) => [c.path, c]));
    assert.equal(byPath.get("bad.export.json")?.status, "malformed");
    assert.equal(byPath.get("future.export.json")?.status, "unsupported-format");
    for (const c of r.exports!.checks) assert.equal(c.verdict, "UNDETERMINED");
    const codes = r.ingest.findings.map((f) => f.code).sort();
    assert.deepEqual(codes, ["export-malformed", "export-unsupported-format"]);
    assert.deepEqual(computeExitFlags(r), { verificationFailures: true, chainAnomaliesOrDivergences: false, code: 1 });
    const report = buildJsonReport(r);
    assert.equal(report.summary.exports?.rejected, 2);
    assert.equal(report.summary.anomalyCountsByCode["export-malformed"], 1);
    const md = buildMarkdownReport(r);
    assert.ok(md.includes("NOT CHECKED `bad.export.json`"));
    assert.ok(md.includes("#### Export `future.export.json`: NOT CHECKED"));
    assert.ok(md.includes("| `export-unsupported-format` | 1 |"));
  });

  it("exports are found in a .tar and a .tar.gz exactly as in a directory, and in memory", async () => {
    const exp = five.ownerExport();
    const entries: Array<{ name: string; content: Uint8Array | string }> = [{ name: "pkg/out/owner.export.json", content: exportJson(exp) }];
    for (const m of five.members) entries.push({ name: `pkg/files/${m.name}`, content: m.original });
    const files: Record<string, Uint8Array | string> = {};
    for (const en of entries) files[en.name.replace(/^pkg\//, "")] = en.content;
    const fromDir = await runAudit(await bundle(files));
    const tarDir = await makeTempDir("bitgraph-audit-export-tar-");
    tempDirs.push(tarDir);
    const tar = makeTar(entries);
    await writeFile(join(tarDir, "bundle.tar"), tar);
    await writeFile(join(tarDir, "bundle.tar.gz"), gzipSync(tar));
    const fromTar = await runAudit(join(tarDir, "bundle.tar"));
    const fromTgz = await runAudit(join(tarDir, "bundle.tar.gz"));
    const memory = await auditIngest(
      await ingestEntries(Object.entries(files).map(([path, content]) => ({ path, open: () => (typeof content === "string" ? utf8(content) : content) }))),
      { startedAt: "" }
    );
    const shape = (r: AuditResult) => r.exports!.checks.map((c) => ({ path: c.path, verdict: c.verdict, files: c.files, runs: c.runs }));
    assert.equal(fromTar.ingest.strippedRootPrefix, "pkg");
    assert.deepEqual(shape(fromTar), shape(fromDir));
    assert.deepEqual(shape(fromTgz), shape(fromDir));
    assert.deepEqual(shape(memory), shape(fromDir));
    assert.equal(fromDir.exports!.checks[0]!.runs.length, 5);
  });

  it("an export and the same proof as proof.json: one observed proof, the second copy a benign duplicate", async () => {
    const m = one.members[0]!;
    const r = await runAudit(await bundle({ "proof.json": proofJson(one.proof), "photo.export.json": exportJson(one.memberExport(m)), "photo.jpg": m.original }));
    assert.equal(r.ingest.proofs.length, 1);
    assert.equal(r.ingest.proofs[0]!.sources.length, 2);
    assert.equal(r.ingest.counts.semanticDuplicates, 1);
    assert.equal(onlyCheck(r).proofHash, one.proofHash);
  });

  it("exit flags: an export sets bit 1 only when FALSE or rejected; TRUE and UNDETERMINED set nothing", async () => {
    const m = one.members[0]!;
    const r = await runAudit(await bundle({ "photo.export.json": exportJson(one.memberExport(m)), "photo.jpg": m.original }));
    const check = onlyCheck(r);
    const withCheck = (patch: Partial<ExportCheck>): AuditResult => ({ ...r, exports: { checks: [{ ...check, ...patch }] } });
    assert.equal(computeExitFlags(withCheck({ verdict: "TRUE", failedClaims: [] })).code, 0);
    assert.equal(computeExitFlags(withCheck({ verdict: "UNDETERMINED", failedClaims: [] })).code, 0);
    assert.equal(computeExitFlags(withCheck({ verdict: "FALSE" })).code, 1);
    assert.equal(computeExitFlags(withCheck({ verdict: "UNDETERMINED", status: "malformed" })).code, 1);
    assert.equal(computeExitFlags({ ...r, exports: { checks: [] } }).code, 0);
    const { exports: _omit, ...older } = r;
    assert.equal(computeExitFlags(older as AuditResult).code, 0, "a result from before this stage existed");
  });

  it("an owner's export past the 8 MiB JSON cap is still found and checked; past the export cap it is reported, not ignored", async () => {
    // 100,000 as-is leaves: the list alone is 6.5 MB, 8.7 MB as base64 (the ordinary JSON cap is 8 MiB).
    const key = await makeKey();
    const slot = await allocateSlot(key, "1", EPOCH);
    const commitment = computeSlotCommitment2(slot, FLOOR_HASH);
    const leaves: TreeLeaf[] = [];
    for (let i = 0; i < 100_000; i++) {
      const d = sha256(utf8(`as-is file ${i}`));
      leaves.push({ placement: LEAF_AS_IS, artifact: d, origin: d });
    }
    const built = buildTree(leaves);
    const rootDoc = buildTreeRootDocument(commitment, built.sorted.length, built.root);
    const commit: BitGraphProof["commit"] = {
      nonceB64: slot.nonceB64,
      counter: "2",
      epochId: slot.epochId,
      slotCounter: slot.counter,
      slotHashB64: b64(sha256(canonicalize(canonicalSlotBody(slot)))),
      slotAnchor: { counter: "0", blockNumber: FLOOR_NUMBER, blockHash: FLOOR_HASH },
    };
    (commit as unknown as Record<string, unknown>)["chainId"] = "bitgraph:main";
    const proof = await signBody(key, { hashAlg: "sha256", digestB64: b64(sha256(rootDoc)) }, commit, "test-measurement-tree1", {
      attribution: treeAttribution(currentTreeSpecHash()),
    });
    proof.slotAllocation = slot;
    const text = exportJson(
      buildExport({ proof, tree: { rootDocument: bytesToHex(rootDoc), leaves: bytesToBase64(encodeTreeLeaves(built.sorted)) }, floor: FLOOR, ...PENDING })
    );
    assert.ok(text.length > 8 * 1024 * 1024, `export is ${text.length} bytes`);
    const plainLarge = JSON.stringify({ note: "x".repeat(9 * 1024 * 1024) });
    const dir = await bundle({ "big.export.json": text, "large-note.json": plainLarge, "as-is-7.bin": utf8("as-is file 7") });

    const r = await runAudit(dir);
    const e = onlyCheck(r);
    assert.equal(e.status, "checked");
    assert.equal(e.kind, "owner");
    assert.equal(resultOf(e, e.runs[0]!, "tree.leaves"), "TRUE");
    assert.equal(e.files.length, 1, "the one leaf whose file is in the bundle");
    assert.equal(resultOf(e, e.runs[0]!, "bytes.member"), "TRUE");
    assert.deepEqual(r.ingest.artifacts.map((a) => a.paths[0]).sort(), ["as-is-7.bin", "large-note.json"], "ordinary large JSON stays an artifact");

    // In a tar the size is declared up front: decided on the opening bytes.
    const tarDir = await makeTempDir("bitgraph-audit-export-bigtar-");
    tempDirs.push(tarDir);
    await writeFile(join(tarDir, "big.tar"), makeTar([{ name: "big.export.json", content: text }, { name: "large-note.json", content: plainLarge }]));
    const t = await runAudit(join(tarDir, "big.tar"));
    assert.equal(onlyCheck(t).status, "checked");
    assert.equal(t.ingest.artifacts.length, 1);

    // Past the export cap: reported as too large, never an artifact, and the audit fails.
    for (const path of [dir, join(tarDir, "big.tar")]) {
      const small = await auditIngest(await ingestBundle(path, { ...DEFAULT_INGEST_LIMITS, maxExportJsonBytes: 1024 * 1024 }), { startedAt: "" });
      const c = onlyCheck(small);
      assert.equal(c.status, "too-large", path);
      assert.equal(c.format, "bitgraph-export/1");
      assert.ok(small.ingest.findings.some((f) => f.code === "export-too-large" && f.path === "big.export.json"));
      assert.ok(!small.ingest.artifacts.some((a) => a.paths.includes("big.export.json")));
      assert.equal(computeExitFlags(small).code & 1, 1);
    }
  });

  it("is deterministic across runs once runMetadata is stripped", async () => {
    const files: Record<string, Uint8Array | string> = { "owner.export.json": exportJson(five.ownerExport()) };
    for (const m of five.members) files[m.name] = m.committed;
    const dir = await bundle(files);
    const a = buildJsonReport(await runAudit(dir));
    const b = buildJsonReport(await runAudit(dir));
    const { runMetadata: _a, ...restA } = a;
    const { runMetadata: _b, ...restB } = b;
    assert.equal(JSON.stringify(restA), JSON.stringify(restB));
  });
});

describe("bitgraph-audit CLI: exports", () => {
  const tempDirs: string[] = [];
  after(async () => {
    for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
  });
  const dirWith = async (files: Record<string, Uint8Array | string>): Promise<string> => {
    const dir = await makeTempDir("bitgraph-audit-export-cli-");
    tempDirs.push(dir);
    await writeBundleDir(dir, files);
    return dir;
  };

  it("prints each export's verdict and its three time claims, and exits 1 on a FALSE claim", async () => {
    const world = await makeWorld(FIVE());
    const files: Record<string, Uint8Array | string> = { "owner.export.json": exportJson(world.ownerExport()) };
    for (const m of world.members) files[`files/${m.name}`] = m.original;
    const dir = await dirWith(files);
    const out = await makeTempDir("bitgraph-audit-export-cli-out-");
    tempDirs.push(out);
    const run = runCli([dir, "--out", out]);
    assert.equal(run.status, 1, run.stderr);
    assert.ok(run.stdout.includes("export FALSE owner.export.json: owner, 5 of 5 covered files checked; FALSE: attestation.signature"), run.stdout);
    assert.ok(run.stdout.includes(`  floor: committed bytes finished after Ethereum block ${FLOOR_NUMBER} (mined 2026-09-21T14:13:20.000Z)`), run.stdout);
    assert.ok(run.stdout.includes("  ceiling on Base: not established (NOT_CARRIED: ceiling pending"), run.stdout);
    assert.ok(run.stdout.includes("  ceiling on Ethereum: not established (NOT_CARRIED: settlement pending"), run.stdout);
    assert.ok(run.stdout.includes("exit 1: verification failures"));
    const report = JSON.parse(readFileSync(join(out, "audit-report.json"), "utf8")) as { exports?: { checks: ExportCheck[] }; summary: { exit: { code: number } } };
    assert.equal(report.exports?.checks[0]?.runs.length, 5);
    assert.equal(report.summary.exit.code, 1);
    const md = readFileSync(join(out, "audit-report.md"), "utf8");
    assert.ok(md.includes("#### Export `owner.export.json`: FALSE"));
    assert.ok(!md.includes(EM_DASH));
  });

  it("a Base ceiling from the declared writer prints as provisional", async () => {
    const world = await makeWorld(ONE());
    const m = world.members[0]!;
    const { sidecar, writer } = makeBaseCeiling(world.proof, { blockNumber: 30_000_002, timestamp: 1_790_000_624 });
    const dir = await dirWith({ "photo.export.json": exportJson(world.memberExport(m, { ceiling: sidecar })), "photo.jpg": m.original });
    const out = await makeTempDir("bitgraph-audit-export-cli-out-");
    tempDirs.push(out);
    const run = runCli([dir, "--out", out, "--ceiling-writer", writer]);
    assert.equal(run.status, 1, run.stderr);
    assert.ok(run.stdout.includes("  ceiling on Base: existed by Base block 30000002 (2026-09-21T14:23:44.000Z), provisional until checked against Base"), run.stdout);
  });

  it("a malformed export fails the run and is named", async () => {
    const dir = await dirWith({ "bad.export.json": JSON.stringify({ format: "bitgraph-export/1" }) });
    const out = await makeTempDir("bitgraph-audit-export-cli-out-");
    tempDirs.push(out);
    const run = runCli([dir, "--out", out]);
    assert.equal(run.status, 1, run.stderr);
    assert.ok(run.stdout.includes("export NOT CHECKED bad.export.json:"), run.stdout);
  });

  it("--help documents exports and their exit bit", () => {
    const run = runCli(["--help"]);
    assert.equal(run.status, 0);
    assert.ok(run.stdout.includes("Exports (bitgraph-export/1) anywhere in the bundle are found by their"));
    assert.ok(run.stdout.includes("an export (bitgraph-export/1) with any FALSE claim"));
    assert.ok(!run.stdout.includes(EM_DASH));
  });
});
