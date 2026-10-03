// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * tree/1: every BitGraph is a Merkle tree under one position (2026-10-03).
 *
 * One format from one file to 1,000,000. Each file is a fixed 65-byte LEAF
 * (placement code, artifact digest, origin digest); the leaves, sorted by
 * artifact digest, form an RFC 6962 tree (fuse-merkle.ts, the same rules the
 * ceiling uses); and the committed artifact is a fixed 84-byte ROOT DOCUMENT
 * (domain, count, root, commitment) whose SHA-256 the enclave signs. A single
 * file is a tree of one: an empty path, the root equal to its leaf hash.
 *
 * The signed attribution is { name: "bitgraph-fuse/2", title: "tree/1",
 * message: base64 SHA-256 of the SPEC this proof follows }. The origin lives
 * in the leaf, which frees the message to pin the spec; a verifier accepts
 * only spec hashes it already knows (KNOWN_TREE_SPEC_HASHES).
 *
 * What each part proves, kept apart on purpose:
 *   - A member's leaf and path prove that leaf is in the committed tree. They
 *     say nothing about the other leaves, so sorting and uniqueness are checked
 *     only where the whole list is seen (producers, verifyTreeLeaves).
 *   - Placements 0x01 to 0x03 carry the commitment, so the COMMITTED bytes were
 *     finished after the floor block. The original inside them has no floor.
 *   - Placement 0x00 (as is) carries nothing: the file existed by the commit,
 *     and nothing bounds it from below. "Existed by" only.
 *
 * Byte layouts (all integers big-endian, all digests raw 32 bytes):
 *   leaf          = placement (1) || artifact (32) || origin (32)              65 bytes
 *   leaf hash     = SHA-256(0x00 || leaf)
 *   node hash     = SHA-256(0x01 || left || right)
 *   root document = "bitgraph-tree/1" 0x00 (16) || count u32 (4) || root (32) || commitment (32)   84 bytes
 */

import { sha256 } from "@noble/hashes/sha256";
import { merkleLeafHash, merkleRootFromPath, MerkleTree } from "./fuse-merkle.js";
import {
  base64ToBytes,
  bytesEqual,
  bytesToBase64,
  bytesToHex,
  commitmentForProof,
  FUSE2_ATTRIBUTION_NAME,
  fuseVersionOfName,
  getPlacement,
  hexToBytes,
  PLACEMENTS,
} from "./fuse.js";
import { spanOf, type FuseSpan } from "./fuse-verify.js";
import { verifyProofIntegrity } from "./verifier.js";
import type { Attribution, BitGraphProof, VerificationPolicy } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TREE_PLACEMENT_ID = "tree/1" as const;
export const TREE_PROFILE = "bitgraph-tree/1" as const;

/** "bitgraph-tree/1" followed by one zero byte: 16 bytes. */
export const TREE_DOMAIN: Uint8Array = (() => {
  const label = new TextEncoder().encode(TREE_PROFILE);
  const out = new Uint8Array(label.length + 1);
  out.set(label, 0);
  return out;
})();

export const TREE_LEAF_BYTES = 65;
export const TREE_ROOT_DOCUMENT_BYTES = 84;
/** The most leaves one tree lists. A stated limit; the layout allows up to 2^32 - 1. */
export const MAX_TREE_LEAVES = 1_000_000;

/** proof.metadata key carrying the root document as lowercase hex. Unsigned; bound only by hashing to the signed digest. */
export const TREE_METADATA_KEY = TREE_PROFILE;

/**
 * The spec hashes this verifier knows: base64 SHA-256 of each SPEC.md
 * version. A tree/1 proof's signed attribution.message must be one of them.
 * Appending a revised spec here is how a verifier learns it; nothing is ever
 * removed, so every proof made under an earlier spec keeps verifying.
 */
export const KNOWN_TREE_SPEC_HASHES: readonly string[] = Object.freeze([
  // SPEC.md v1 (spec/SPEC.md). Written by spec/pin-hash.mjs. Once a proof pins it, it never changes: a later spec is added beside it.
  "eGk7DAW++juG09vWCFBZPoLCihY4EIFde1r8QfNwlKc=",
]);

/** Placement codes: the first byte of a leaf. */
export const LEAF_AS_IS = 0x00;
export const LEAF_PLACEMENTS: Readonly<Record<number, "as-is" | "trailer/1" | "container/1" | "container/2">> = Object.freeze({
  0x00: "as-is",
  0x01: "trailer/1",
  0x02: "container/1",
  0x03: "container/2",
});

export function leafCodeOf(placement: string): number | null {
  for (const [code, id] of Object.entries(LEAF_PLACEMENTS)) if (id === placement) return Number(code);
  return null;
}

// ---------------------------------------------------------------------------
// Leaves
// ---------------------------------------------------------------------------

export interface TreeLeaf {
  /** 0x00 as is, 0x01 trailer/1, 0x02 container/1, 0x03 container/2. */
  placement: number;
  /** SHA-256 of the committed bytes (for 0x00, the file itself). */
  artifact: Uint8Array;
  /** SHA-256 of the file as dropped (for 0x00, equal to artifact). */
  origin: Uint8Array;
}

function checkLeaf(l: TreeLeaf): void {
  if (!(l.placement in LEAF_PLACEMENTS)) throw new TypeError(`leaf placement code 0x${l.placement.toString(16).padStart(2, "0")} is not registered`);
  if (l.artifact.length !== 32 || l.origin.length !== 32) throw new TypeError("leaf digests are 32 bytes");
  if (l.placement === LEAF_AS_IS && !bytesEqual(l.artifact, l.origin)) throw new TypeError("an as-is leaf's artifact and origin are the same digest");
}

export function encodeTreeLeaf(l: TreeLeaf): Uint8Array {
  checkLeaf(l);
  const out = new Uint8Array(TREE_LEAF_BYTES);
  out[0] = l.placement;
  out.set(l.artifact, 1);
  out.set(l.origin, 33);
  return out;
}

/** Strict: 65 bytes, a registered code, and for 0x00 artifact = origin. Null otherwise. */
export function decodeTreeLeaf(bytes: Uint8Array): TreeLeaf | null {
  if (bytes.length !== TREE_LEAF_BYTES) return null;
  const leaf: TreeLeaf = { placement: bytes[0]!, artifact: bytes.slice(1, 33), origin: bytes.slice(33, 65) };
  try {
    checkLeaf(leaf);
  } catch {
    return null;
  }
  return leaf;
}

export function treeLeafHash(l: TreeLeaf): Uint8Array {
  return merkleLeafHash(encodeTreeLeaf(l));
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length && i < b.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}

/** Tree order: strictly ascending by artifact digest. Throws on an empty list, too many leaves, a bad leaf or a duplicate artifact. */
export function sortTreeLeaves(leaves: readonly TreeLeaf[]): TreeLeaf[] {
  if (leaves.length === 0) throw new TypeError("a tree lists at least one leaf");
  if (leaves.length > MAX_TREE_LEAVES) throw new TypeError(`a tree lists at most ${MAX_TREE_LEAVES} leaves`);
  for (const l of leaves) checkLeaf(l);
  const sorted = [...leaves].sort((a, b) => compareBytes(a.artifact, b.artifact));
  for (let i = 1; i < sorted.length; i++) {
    if (bytesEqual(sorted[i]!.artifact, sorted[i - 1]!.artifact)) throw new TypeError(`duplicate leaf artifact digest ${bytesToHex(sorted[i]!.artifact)}`);
  }
  return sorted;
}

export interface BuiltTree {
  sorted: TreeLeaf[];
  leafHashes: Uint8Array[];
  root: Uint8Array;
  tree: MerkleTree;
}

export function buildTree(leaves: readonly TreeLeaf[]): BuiltTree {
  const sorted = sortTreeLeaves(leaves);
  const leafHashes = sorted.map(treeLeafHash);
  const tree = new MerkleTree(leafHashes);
  return { sorted, leafHashes, root: tree.root, tree };
}

// ---------------------------------------------------------------------------
// Root document
// ---------------------------------------------------------------------------

export function buildTreeRootDocument(commitment: Uint8Array, count: number, root: Uint8Array): Uint8Array {
  if (commitment.length !== 32 || root.length !== 32) throw new TypeError("commitment and root are 32 bytes");
  if (!Number.isInteger(count) || count < 1 || count > MAX_TREE_LEAVES) throw new TypeError(`count must be an integer from 1 to ${MAX_TREE_LEAVES}`);
  const out = new Uint8Array(TREE_ROOT_DOCUMENT_BYTES);
  out.set(TREE_DOMAIN, 0);
  new DataView(out.buffer).setUint32(16, count, false);
  out.set(root, 20);
  out.set(commitment, 52);
  return out;
}

/** Strict: 84 bytes, the domain, a count from 1 to MAX_TREE_LEAVES. Null otherwise. */
export function parseTreeRootDocument(bytes: Uint8Array): { count: number; root: Uint8Array; commitment: Uint8Array } | null {
  if (bytes.length !== TREE_ROOT_DOCUMENT_BYTES) return null;
  if (!bytesEqual(bytes.subarray(0, 16), TREE_DOMAIN)) return null;
  const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16, false);
  if (count < 1 || count > MAX_TREE_LEAVES) return null;
  return { count, root: bytes.slice(20, 52), commitment: bytes.slice(52, 84) };
}

/** The root document a proof carries in its unsigned metadata, as bytes; null when absent or malformed hex. */
export function readTreeMetadata(proof: BitGraphProof): Uint8Array | null {
  const v = proof.metadata?.[TREE_METADATA_KEY];
  if (typeof v !== "string") return null;
  return hexToBytes(v);
}

// ---------------------------------------------------------------------------
// The signed marker
// ---------------------------------------------------------------------------

/** The attribution a producer sends for a tree/1 commit. specHash is the 32-byte SHA-256 of the SPEC.md the producer follows. */
export function treeAttribution(specHash: Uint8Array): Attribution {
  if (specHash.length !== 32) throw new TypeError("the spec hash is 32 bytes");
  return { name: FUSE2_ATTRIBUTION_NAME, title: TREE_PLACEMENT_ID, message: bytesToBase64(specHash) };
}

/** The current spec hash a producer pins, as raw bytes. Throws while the spec hash is still a placeholder. */
export function currentTreeSpecHash(): Uint8Array {
  const latest = KNOWN_TREE_SPEC_HASHES[KNOWN_TREE_SPEC_HASHES.length - 1]!;
  const b = base64ToBytes(latest);
  if (b === null || b.length !== 32) throw new Error("the tree/1 spec hash has not been set");
  return b;
}

export function isTreeProof(proof: { attribution?: unknown } | null | undefined): boolean {
  const a = (proof as { attribution?: { title?: unknown } } | null | undefined)?.attribution;
  return a?.title === TREE_PLACEMENT_ID;
}

// ---------------------------------------------------------------------------
// A member's evidence, and the owner's full list
// ---------------------------------------------------------------------------

/** One member's evidence as JSON: its leaf (lowercase hex, 130 chars), its index, the tree size, and its sibling path from the leaf up. */
export interface TreeMemberEvidence {
  index: number;
  count: number;
  leaf: string;
  path: string[];
}

export function buildTreeMemberEvidence(leaf: TreeLeaf, index: number, count: number, path: readonly Uint8Array[]): TreeMemberEvidence {
  if (!Number.isInteger(index) || !Number.isInteger(count) || count < 1 || index < 0 || index >= count) throw new RangeError("member index out of range");
  return {
    index,
    count,
    leaf: bytesToHex(encodeTreeLeaf(leaf)),
    path: path.map((p) => {
      if (p.length !== 32) throw new TypeError("a path node is 32 bytes");
      return bytesToHex(p);
    }),
  };
}

/** Strict read: exactly the four keys, integers in range, a valid leaf, 32-byte lowercase-hex path nodes. Null on any deviation. Unbound. */
export function parseTreeMemberEvidence(value: unknown): { leaf: TreeLeaf; index: number; count: number; path: Uint8Array[] } | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join(",") !== "count,index,leaf,path") return null;
  const { count, index } = v;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > MAX_TREE_LEAVES) return null;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= count) return null;
  if (typeof v["leaf"] !== "string") return null;
  const leafBytes = hexToBytes(v["leaf"]);
  if (leafBytes === null) return null;
  const leaf = decodeTreeLeaf(leafBytes);
  if (leaf === null) return null;
  if (!Array.isArray(v["path"])) return null;
  const path: Uint8Array[] = [];
  for (const n of v["path"] as unknown[]) {
    if (typeof n !== "string") return null;
    const b = hexToBytes(n);
    if (b === null || b.length !== 32) return null;
    path.push(b);
  }
  return { leaf, index, count, path };
}

/** The root a member's leaf and path reach, or null when the path does not fit the index and count. */
export function treeRootFromMember(leaf: TreeLeaf, index: number, count: number, path: readonly Uint8Array[]): Uint8Array | null {
  return merkleRootFromPath(treeLeafHash(leaf), index, count, path);
}

/** The owner's list: every leaf in tree order, concatenated (count x 65 bytes). */
export function encodeTreeLeaves(sorted: readonly TreeLeaf[]): Uint8Array {
  const out = new Uint8Array(sorted.length * TREE_LEAF_BYTES);
  sorted.forEach((l, i) => out.set(encodeTreeLeaf(l), i * TREE_LEAF_BYTES));
  return out;
}

export function decodeTreeLeaves(bytes: Uint8Array): TreeLeaf[] | null {
  if (bytes.length === 0 || bytes.length % TREE_LEAF_BYTES !== 0) return null;
  const out: TreeLeaf[] = [];
  for (let o = 0; o < bytes.length; o += TREE_LEAF_BYTES) {
    const l = decodeTreeLeaf(bytes.subarray(o, o + TREE_LEAF_BYTES));
    if (l === null) return null;
    out.push(l);
  }
  return out;
}

export interface TreeLeavesCheck {
  ok: boolean;
  reason?: string;
  count?: number;
}

/**
 * The whole list against a root document: the count matches, the leaves are
 * strictly ascending by artifact digest with no duplicate, every leaf is
 * valid, and the rebuilt root equals the document's. This is the only check
 * that establishes ordering and uniqueness; a single member's path cannot.
 */
export function verifyTreeLeaves(rootDocument: Uint8Array, leavesBytes: Uint8Array): TreeLeavesCheck {
  const doc = parseTreeRootDocument(rootDocument);
  if (doc === null) return { ok: false, reason: "the root document is not a tree/1 root document" };
  const leaves = decodeTreeLeaves(leavesBytes);
  if (leaves === null) return { ok: false, reason: "the leaves are not a whole number of valid 65-byte leaves" };
  if (leaves.length !== doc.count) return { ok: false, reason: `the list holds ${leaves.length} leaves; the root document states ${doc.count}` };
  for (let i = 1; i < leaves.length; i++) {
    const c = compareBytes(leaves[i - 1]!.artifact, leaves[i]!.artifact);
    if (c === 0) return { ok: false, reason: `duplicate artifact digest at leaves ${i - 1} and ${i}` };
    if (c > 0) return { ok: false, reason: `leaves ${i - 1} and ${i} are out of order` };
  }
  const root = new MerkleTree(leaves.map(treeLeafHash)).root;
  if (!bytesEqual(root, doc.root)) return { ok: false, reason: "the leaves do not rebuild the committed root" };
  return { ok: true, count: doc.count };
}

// ---------------------------------------------------------------------------
// Committed bytes for a leaf
// ---------------------------------------------------------------------------

/** The committed bytes a placement makes from an original. For 0x00 the original is the committed bytes. */
export function committedBytesFor(code: number, original: Uint8Array, commitment: Uint8Array): Uint8Array {
  const id = LEAF_PLACEMENTS[code];
  if (id === undefined) throw new TypeError("unregistered leaf placement code");
  if (id === "as-is") return original;
  const p = getPlacement(id)!;
  return p.build({ original, originDigest: sha256(original), commitment });
}

/** A leaf for an original under a placement and a commitment. */
export function leafFor(code: number, original: Uint8Array, commitment: Uint8Array): { leaf: TreeLeaf; committed: Uint8Array } {
  const committed = committedBytesFor(code, original, commitment);
  const origin = sha256(original);
  return { leaf: { placement: code, artifact: code === LEAF_AS_IS ? origin : sha256(committed), origin }, committed };
}

// ---------------------------------------------------------------------------
// Verifying a member
// ---------------------------------------------------------------------------

export type TreeCategory =
  | "TREE_MEMBER_DIRECT"
  | "TREE_MEMBER_FROM_ORIGIN"
  | "TREE_MEMBER_AS_IS"
  | "TREE_PATH_VALID"
  | "TREE_ROOT_VALID"
  | "TREE_MEMBERSHIP_UNPROVEN"
  | "NO_MATCH"
  | "RECONSTRUCTION_MISMATCH"
  | "INVALID_ORIGIN"
  | "INVALID_TREE_PATH"
  | "INVALID_TREE_ROOT"
  | "INVALID_SLOT_COMMITMENT"
  | "INVALID_TREE_MARKER"
  | "UNKNOWN_SPEC"
  | "INVALID_UNDERLYING_PROOF"
  | "NOT_TREE";

/** The categories that mean the supplied file is a member of the committed tree. */
export const TREE_MEMBER_CATEGORIES: readonly TreeCategory[] = ["TREE_MEMBER_DIRECT", "TREE_MEMBER_FROM_ORIGIN", "TREE_MEMBER_AS_IS"];

export interface TreeVerifyOptions {
  proof: BitGraphProof;
  /** The file in hand: the original or the committed bytes. Omit to check the proof, the root and the path alone. */
  bytes?: Uint8Array;
  /** The member's evidence (TreeMemberEvidence JSON). Omit to check the proof and the root alone. */
  member?: unknown;
  /** The 84-byte root document; when omitted it is read from proof.metadata. */
  rootDocument?: Uint8Array | null;
  trustAnchors?: VerificationPolicy;
  /** Spec hashes (base64) to accept in addition to KNOWN_TREE_SPEC_HASHES. */
  extraSpecHashes?: readonly string[];
  /** Skip the proof's own checks (only when the caller already ran them on this exact proof). */
  proofAlreadyVerified?: boolean;
}

export interface TreeVerifyResult {
  category: TreeCategory;
  /** One sentence: what was established, or why not. */
  reason: string;
  proof: { valid: boolean; reason?: string };
  /** The spec hash the proof pins (base64), when it has one. */
  specHashB64: string | null;
  /** Present once the root document is bound to the signed digest and to the slot. */
  tree: { count: number; rootHex: string; commitmentHex: string } | null;
  /** Present once the member's path reaches the bound root. */
  member: { index: number; count: number; placement: string; artifactHex: string; originHex: string } | null;
  /**
   * What the floor covers for THIS file. "committed-bytes": the committed bytes
   * were finished after the floor block (the original inside them has no floor).
   * "none": an as-is leaf; the file existed by the commit, with no lower bound.
   */
  floorCovers: "committed-bytes" | "none" | null;
  span: FuseSpan | null;
}

export async function verifyTreeMember(opts: TreeVerifyOptions): Promise<TreeVerifyResult> {
  const { proof } = opts;
  const span = proof?.commit ? spanOf(proof) : null;
  const base = (category: TreeCategory, reason: string, extra: Partial<TreeVerifyResult> = {}): TreeVerifyResult => ({
    category, reason, proof: { valid: false }, specHashB64: null, tree: null, member: null, floorCovers: null, span, ...extra,
  });

  if (!isTreeProof(proof)) return base("NOT_TREE", "the proof's signed title is not tree/1");

  // 1. The proof itself.
  let proofResult: { valid: boolean; reason?: string } = { valid: true };
  if (!opts.proofAlreadyVerified) {
    const v = await verifyProofIntegrity({ proof, ...(opts.trustAnchors ? { trustAnchors: opts.trustAnchors } : {}) });
    proofResult = v.valid ? { valid: true } : { valid: false, ...(v.reason ? { reason: v.reason } : {}) };
    if (!v.valid) return base("INVALID_UNDERLYING_PROOF", `the proof does not verify (${v.reason ?? "invalid"})`, { proof: proofResult });
  }

  // 2. The signed marker: fuse/2 (the floor is bound) and a known spec.
  const a = proof.attribution!;
  if (fuseVersionOfName(a.name) !== 2) return base("INVALID_TREE_MARKER", "a tree/1 proof must be marked bitgraph-fuse/2, which binds the floor block into the commitment", { proof: proofResult });
  const specBytes = typeof a.message === "string" ? base64ToBytes(a.message) : null;
  if (specBytes === null || specBytes.length !== 32) return base("INVALID_TREE_MARKER", "a tree/1 proof must pin its spec: the signed message is the base64 SHA-256 of SPEC.md", { proof: proofResult });
  const specHashB64 = a.message as string;
  const known = new Set([...KNOWN_TREE_SPEC_HASHES, ...(opts.extraSpecHashes ?? [])]);
  if (!known.has(specHashB64)) return base("UNKNOWN_SPEC", `the proof follows a spec this verifier does not know (${specHashB64})`, { proof: proofResult, specHashB64 });

  // 3. The commitment, from the proof's own slot record and signed floor block.
  if (!proof.slotAllocation) return base("INVALID_SLOT_COMMITMENT", "the proof carries no slot record, so no commitment can be recomputed", { proof: proofResult, specHashB64 });
  let commitment: Uint8Array;
  try {
    commitment = commitmentForProof(proof, proof.slotAllocation);
  } catch (e) {
    return base("INVALID_SLOT_COMMITMENT", `the commitment could not be recomputed: ${(e as Error).message}`, { proof: proofResult, specHashB64 });
  }

  // 4. The root document: hashes to the signed digest, carries this commitment.
  const docBytes = opts.rootDocument ?? readTreeMetadata(proof);
  if (docBytes === null || docBytes === undefined) return base("INVALID_TREE_ROOT", "no root document is in hand (neither supplied nor in the proof's metadata)", { proof: proofResult, specHashB64 });
  const doc = parseTreeRootDocument(docBytes);
  if (doc === null) return base("INVALID_TREE_ROOT", "the root document is not 84 bytes of tree/1", { proof: proofResult, specHashB64 });
  const signed = base64ToBytes(proof.artifact.digestB64);
  if (signed === null || !bytesEqual(sha256(docBytes), signed)) return base("INVALID_TREE_ROOT", "the root document does not hash to the signed artifact digest", { proof: proofResult, specHashB64 });
  if (!bytesEqual(doc.commitment, commitment)) return base("INVALID_SLOT_COMMITMENT", "the root document's commitment is not the one recomputed from the proof's slot record and floor block", { proof: proofResult, specHashB64 });
  const tree = { count: doc.count, rootHex: bytesToHex(doc.root), commitmentHex: bytesToHex(commitment) };

  // 5. The member's path to that root.
  if (opts.member === undefined || opts.member === null) {
    if (opts.bytes !== undefined && carriesCommitment(opts.bytes, commitment)) {
      return base("TREE_MEMBERSHIP_UNPROVEN", "these bytes carry this position's commitment, so they were finished after the floor block, but no member evidence is in hand to show they are in the tree", { proof: proofResult, specHashB64, tree });
    }
    if (opts.bytes !== undefined) return base("NO_MATCH", "no member evidence is in hand and the bytes carry no commitment to this position", { proof: proofResult, specHashB64, tree });
    return base("TREE_ROOT_VALID", `the proof is valid and commits a tree of ${doc.count} leaves`, { proof: proofResult, specHashB64, tree });
  }
  const ev = parseTreeMemberEvidence(opts.member);
  if (ev === null) return base("INVALID_TREE_PATH", "the member evidence is not well-formed tree/1 evidence", { proof: proofResult, specHashB64, tree });
  if (ev.count !== doc.count) return base("INVALID_TREE_PATH", `the evidence names a tree of ${ev.count} leaves; the root document states ${doc.count}`, { proof: proofResult, specHashB64, tree });
  const reached = treeRootFromMember(ev.leaf, ev.index, ev.count, ev.path);
  if (reached === null || !bytesEqual(reached, doc.root)) return base("INVALID_TREE_PATH", "the leaf and path do not recompute the committed root", { proof: proofResult, specHashB64, tree });
  const placementId = LEAF_PLACEMENTS[ev.leaf.placement]!;
  const member = { index: ev.index, count: ev.count, placement: placementId, artifactHex: bytesToHex(ev.leaf.artifact), originHex: bytesToHex(ev.leaf.origin) };
  const ok = { proof: proofResult, specHashB64, tree, member };

  if (opts.bytes === undefined) return base("TREE_PATH_VALID", `leaf ${ev.index} of ${ev.count} is in the committed tree; no file was checked`, ok);

  // 6. The file against the leaf.
  const fileDigest = sha256(opts.bytes);
  if (bytesEqual(fileDigest, ev.leaf.artifact)) {
    if (ev.leaf.placement === LEAF_AS_IS) {
      return base("TREE_MEMBER_AS_IS", `this file is leaf ${ev.index} of ${ev.count}, recorded as is: it existed by the commit, and nothing bounds it from below`, { ...ok, floorCovers: "none" });
    }
    const located = getPlacement(placementId)!.locate(opts.bytes);
    if (located === null || !bytesEqual(located.commitment, commitment)) {
      return base("INVALID_SLOT_COMMITMENT", `the bytes match leaf ${ev.index} but are not a valid ${placementId} carrying this position's commitment (its structure, the original's digest or the commitment does not hold)`, ok);
    }
    const embedded = located.originDigest ?? (located.originalBytes !== undefined ? sha256(located.originalBytes) : undefined);
    if (embedded !== undefined && !bytesEqual(embedded, ev.leaf.origin)) {
      return base("INVALID_ORIGIN", "the origin inside the committed bytes does not match the leaf's origin", ok);
    }
    return base("TREE_MEMBER_DIRECT", `these are the committed bytes of leaf ${ev.index} of ${ev.count}; they were finished after the floor block`, { ...ok, floorCovers: "committed-bytes" });
  }
  if (bytesEqual(fileDigest, ev.leaf.origin) && ev.leaf.placement !== LEAF_AS_IS) {
    const rebuilt = committedBytesFor(ev.leaf.placement, opts.bytes, commitment);
    if (!bytesEqual(sha256(rebuilt), ev.leaf.artifact)) {
      return base("RECONSTRUCTION_MISMATCH", `this file is leaf ${ev.index}'s origin, but placing the commitment in it does not reproduce the committed digest`, ok);
    }
    return base("TREE_MEMBER_FROM_ORIGIN", `this file rebuilds the committed bytes of leaf ${ev.index} of ${ev.count}; the committed bytes were finished after the floor block, and this original existed by the commit`, { ...ok, floorCovers: "committed-bytes" });
  }
  // The evidence holds (its path reaches the root), so the member is known; the file is not it.
  if (carriesCommitment(opts.bytes, commitment)) {
    return base("TREE_MEMBERSHIP_UNPROVEN", "these bytes carry this position's commitment, but the evidence in hand describes a different leaf", ok);
  }
  return base("NO_MATCH", "the file is neither this leaf's committed bytes nor its origin", ok);
}

function carriesCommitment(bytes: Uint8Array, commitment: Uint8Array): boolean {
  for (const p of PLACEMENTS) {
    if (p.id === "produced/1") continue;
    const located = p.locate(bytes);
    if (located !== null && bytesEqual(located.commitment, commitment)) return true;
  }
  return false;
}
