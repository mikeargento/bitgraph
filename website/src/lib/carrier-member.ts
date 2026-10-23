/**
 * A tree member's BitGraphed file (bitgraph-carrier/4, spec/CARRIER-4.md):
 * the pure half, kept apart from carrier-site's fetching so it can be tested
 * without a browser.
 *
 * In a tree/1 BitGraph the signed digest names the tree's root document, so a
 * member's file carries, after its committed bytes, the root document and the
 * member's evidence (export/1's one-file tree part) beside the proof and its
 * floor and ceilings. Nothing is assembled on a guess: the bytes are rebuilt
 * or taken as the leaf's committed bytes, checked against the leaf, and the
 * leaf against the signed root (verifyTreeMember), before a block is written.
 *
 * Which files can carry a block at all follows the rules already in force:
 * the formats trailer/1 appends to (fuse-placement), a container placement's
 * tar, and the formats the BitGraphed file has always carried (PDF, ZIP-based
 * files under the block limit, MP4 and QuickTime). A file kept as is in any
 * other format (text, SVG, JSON, XML, HTML) would break, so it travels with
 * its export instead.
 */

import { sha256 } from "@noble/hashes/sha256";
import { placementForBytes } from "@mikeargento/bitgraph";
import {
  assembleCarrierV4Payload, buildCarrier, bytesToHex, carrierBlockSize, CARRIER_BLOCK_ZIP_LIMIT, committedBytesFor, parseTreeMemberEvidence,
  TREE_MEMBER_CATEGORIES, verifyTreeMember,
  type BitGraphProof, type CarrierPayload, type CarrierProof, type CarrierCeilingInTime, type CarrierSettlement, type TreeMemberEvidence,
} from "@mikeargento/bitgraph-verify";

/** The parts every BitGraphed file shares, as carrier-site's assembleProofEvidence vets them. */
export interface MemberCarrierParts {
  proof: CarrierProof;
  floor: CarrierPayload["floor"];
  ceiling: CarrierPayload["ceiling"];
  ceilingInTime: CarrierCeilingInTime;
  settlement?: CarrierSettlement;
}

export type MemberCarrierFormat =
  | { ok: true; kind: "trailer-safe" | "tar" | "pdf" | "zip" | "mp4" }
  | { ok: false; reason: string };

const at = (b: Uint8Array, sig: number[], offset = 0): boolean => b.length >= offset + sig.length && sig.every((v, i) => b[offset + i] === v);

/** ISO base media brands of MP4 and QuickTime, the two a trailing block was tested on. */
const MP4_BRANDS = new Set(["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "M4A ", "qt  "]);

/**
 * Whether this member's committed bytes can carry a block after their end.
 * `head` is the first bytes of the file in hand: a placed leaf's committed
 * bytes start as the original does (trailer/1) or are a tar (containers), so
 * the original's head decides as well as the committed bytes' would.
 */
export function memberCarrierFormat(head: Uint8Array, placement: string): MemberCarrierFormat {
  if (placement === "container/1" || placement === "container/2") return { ok: true, kind: "tar" };
  if (placementForBytes(head.subarray(0, Math.min(head.length, 64))) === "trailer/1") return { ok: true, kind: "trailer-safe" };
  if (at(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { ok: true, kind: "pdf" };
  if (at(head, [0x50, 0x4b, 0x03, 0x04])) return { ok: true, kind: "zip" };
  if (at(head, [0x66, 0x74, 0x79, 0x70], 4) && head.length >= 12 && MP4_BRANDS.has(String.fromCharCode(...head.subarray(8, 12)))) return { ok: true, kind: "mp4" };
  return { ok: false, reason: "This file was kept as is, and a proof block after its end would break its kind of file (text, SVG, JSON, XML, HTML and others are read to the end), so it travels with its export instead." };
}

/** The member's BitGraphed file name: photo.jpg → photo.bitgraph.jpg; a container leaf is a tar: notes.txt → notes.txt.bitgraph.tar. */
export function memberCarrierFileName(fileName: string, placement: string): string {
  const base = placement === "container/1" || placement === "container/2"
    ? (/\.tar$/i.test(fileName) ? fileName : `${fileName}.tar`)
    : fileName;
  if (/\.bitgraph(\.[^.]+)?$/i.test(base)) return base;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? `${base.slice(0, dot)}.bitgraph${base.slice(dot)}` : `${base}.bitgraph`;
}

/**
 * The leaf's committed bytes from the file in hand: the file itself when it
 * hashes to the leaf's artifact (a leaf kept as is, or the committed bytes
 * dropped), or the committed bytes rebuilt from the original under the
 * leaf's placement and the tree's commitment. Null when the file is neither.
 */
export function memberCommittedBytes(fileBytes: Uint8Array, evidence: unknown, commitment: Uint8Array): Uint8Array | null {
  const ev = parseTreeMemberEvidence(evidence);
  if (ev === null) return null;
  const digest = sha256(fileBytes);
  if (bytesToHex(digest) === bytesToHex(ev.leaf.artifact)) return fileBytes;
  if (ev.leaf.placement === 0x00 || bytesToHex(digest) !== bytesToHex(ev.leaf.origin)) return null;
  const rebuilt = committedBytesFor(ev.leaf.placement, fileBytes, commitment);
  return bytesToHex(sha256(rebuilt)) === bytesToHex(ev.leaf.artifact) ? rebuilt : null;
}

export interface MemberCarrier {
  bytes: Uint8Array;
  fileName: string;
  payload: CarrierPayload;
  /** Whether the openssl attestation witness is inside (left out only to keep a ZIP-based file under its limit). */
  witness: boolean;
  placement: string;
  floorCovers: "content" | "record";
}

/**
 * One member's BitGraphed file, from the file in hand, the tree (its bound
 * root document and commitment), the member's evidence and the vetted parts.
 * Throws with a sentence when the file is not that member, the member is not
 * in the signed tree, or the format cannot carry a block.
 */
export async function assembleMemberCarrier(input: {
  fileBytes: Uint8Array;
  fileName: string;
  proof: BitGraphProof;
  rootDocument: Uint8Array;
  commitment: Uint8Array;
  evidence: TreeMemberEvidence;
  parts: MemberCarrierParts;
}): Promise<MemberCarrier> {
  const committed = memberCommittedBytes(input.fileBytes, input.evidence, input.commitment);
  if (committed === null) throw new Error("this file is not the tree member its evidence names; refusing to build a BitGraphed file around it");
  const check = await verifyTreeMember({ proof: input.proof, bytes: committed, member: input.evidence, rootDocument: input.rootDocument });
  if (!(TREE_MEMBER_CATEGORIES as readonly string[]).includes(check.category) || check.member === null) {
    throw new Error(`the member does not verify against this proof (${check.reason}); refusing to build a BitGraphed file around it`);
  }
  const placement = check.member.placement;
  const format = memberCarrierFormat(committed.subarray(0, 64), placement);
  if (!format.ok) throw new Error(format.reason);
  const tree = { rootDocument: bytesToHex(input.rootDocument), member: input.evidence };
  let payload = assembleCarrierV4Payload({ ...input.parts, tree });
  let witness = payload.attestation !== undefined;
  if (format.kind === "zip" && carrierBlockSize(payload) > CARRIER_BLOCK_ZIP_LIMIT) {
    payload = assembleCarrierV4Payload({ ...input.parts, tree, withAttestationWitness: false });
    witness = false;
    if (carrierBlockSize(payload) > CARRIER_BLOCK_ZIP_LIMIT) {
      throw new Error(`the proof block (${carrierBlockSize(payload)} bytes) would pass the 64 KiB a ZIP-based file can carry after its end record; keep the export beside the file instead`);
    }
  }
  return {
    bytes: buildCarrier(committed, payload),
    fileName: memberCarrierFileName(input.fileName, placement),
    payload,
    witness,
    placement,
    floorCovers: check.floorCovers === "record" ? "record" : "content",
  };
}
