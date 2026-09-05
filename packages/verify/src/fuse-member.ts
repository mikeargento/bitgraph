// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * BitGraph Sets, phase 1: verifying ONE MEMBER of a set.
 *
 * A set is N files fused under ONE slot. The committed artifact is the
 * canonical set manifest (placement set/1, see fuse.ts) and every member's
 * fused bytes carry the set's commitment via the member's own placement.
 * verifyFuse answers for the manifest; this module answers for a member.
 *
 * Given a proof whose signed attribution declares set/1 and a file:
 *   1. Verify the proof as an ordinary bitgraph/1 proof. Fail: stop.
 *   2. Recompute the commitment c from the proof's own slot record.
 *   3. Bind the manifest: strict parse, hash equal to the SIGNED artifact
 *      digest, commitment equal to c. proof.metadata is unsigned, so no row
 *      is read from it before this binding holds.
 *   4. Hash equals a listed member's artifact digest: the bytes ARE the
 *      member; locate c in them per the row's placement, compare.
 *   5. Hash equals a listed origin: rebuild that member from this file, c
 *      and the row's placement; the rebuilt hash must equal the row.
 *   6. Neither, yet a registered placement locates exactly c in the bytes:
 *      the bytes were made after the slot existed but are not part of the
 *      committed set. Otherwise NO_MATCH: the proof proves nothing about them.
 *
 * INSEPARABILITY. A verifier that checks only the floor accepts the "51st
 * file" (read c off any member, staple it to new content); one that checks
 * only membership gives no floor. Here the two cannot be called apart:
 * membership is tested only against a BoundSet, a list sealed to the signed
 * artifact and to the proof's own slot; the floor and the membership run
 * together inside admit(); and the only function able to emit a member
 * category takes the Admitted token that admit() alone produces, and
 * re-asserts both checks before it does. Nothing exported yields a verdict
 * fragment: parseSetManifest returns rows and a commitment, readSetMetadata
 * returns bytes, set/1.locate returns only the commitment.
 */

import { sha256 } from "@noble/hashes/sha256";
import { verifyProofIntegrity } from "./verifier.js";
import type { BitGraphProof, VerificationPolicy } from "./types.js";
import {
  base64ToBytes,
  bytesEqual,
  bytesToBase64,
  bytesToHex,
  computeSlotCommitment,
  getPlacement,
  PLACEMENTS,
  parseSetManifest,
  readFuseAttribution,
  readSetMetadata,
  SET_METADATA_KEY,
  SET_PLACEMENT_ID,
  type Located,
  type Placement,
  type SetMember,
} from "./fuse.js";
import { floorStatement, spanOf, type FuseSpan, type FuseVerifyResult } from "./fuse-verify.js";

export type FuseMemberCategory =
  | "SET_MEMBER_DIRECT"
  | "SET_MEMBER_FROM_ORIGIN"
  | "SET_NOT_MEMBER"
  | "RECONSTRUCTION_MISMATCH"
  | "INVALID_SET_MANIFEST"
  | "INVALID_SLOT_COMMITMENT"
  | "INVALID_ORIGIN_ATTRIBUTION"
  | "INVALID_UNDERLYING_PROOF"
  | "UNDETERMINED_PLACEMENT"
  | "NO_MATCH";

export interface FuseSetEvidence {
  /** Where the manifest bytes came from: the proof's metadata, or the caller's argument. */
  manifestSource: "metadata" | "argument";
  /** SHA-256 of the bound manifest bytes; equals artifactDigestB64 once bound. */
  manifestDigestB64: string;
  memberCount: number;
  /** The matched row. Non-null ONLY on the two member categories. */
  member: { index: number; placement: string; fusedDigestB64: string; originDigestB64: string } | null;
}

export interface FuseMemberOptions {
  proof: BitGraphProof;
  bytes: Uint8Array;
  /** Canonical set manifest bytes; when given they replace proof.metadata as the source and are never silently replaced by it. */
  manifest?: Uint8Array | null;
  trustAnchors?: VerificationPolicy;
  /** Refuse to accept a span wider than this many positions (M - N). Never affects validity categories. */
  maxPositions?: bigint | number;
}

/** Every FuseVerifyResult field keeps its name and type; `set` is the one added block. */
export type FuseMemberResult = Omit<FuseVerifyResult, "category"> & {
  category: FuseMemberCategory;
  /** Non-null ONLY once the manifest is bound (strict parse, hash, commitment). */
  set: FuseSetEvidence | null;
};

// ---------------------------------------------------------------------------
// Inseparability tokens (module-private, never exported)
// ---------------------------------------------------------------------------

declare const boundBrand: unique symbol;
declare const admittedBrand: unique symbol;

/**
 * A member list sealed to the signed artifact digest and to the proof's own
 * slot. Produced only by bindSetManifest. There is no function that looks a
 * digest up in an unbound manifest.
 */
interface BoundSet {
  readonly [boundBrand]: true;
  readonly source: "metadata" | "argument";
  readonly digestB64: string;
  readonly commitment: Uint8Array;
  readonly rows: readonly SetMember[];
  /** Lowercase hex of a row's artifact digest to its index. */
  readonly byArtifact: ReadonlyMap<string, number>;
  /** Lowercase hex of an origin digest to the indices listing it, in manifest order. */
  readonly byOrigin: ReadonlyMap<string, readonly number[]>;
}

/** Produced only by admit(): the bytes are a listed member AND carry the set's commitment. */
interface Admitted {
  readonly [admittedBrand]: true;
  readonly bound: BoundSet;
  readonly index: number;
  readonly row: SetMember;
  readonly placement: Placement;
  readonly located: Located;
  /** True when the fused bytes embed an origin digest that was compared with the row. */
  readonly originCompared: boolean;
}

interface Unbound {
  readonly category: "INVALID_SET_MANIFEST" | "INVALID_SLOT_COMMITMENT";
  readonly reason: string;
}

interface Refusal {
  readonly category: "INVALID_SLOT_COMMITMENT" | "INVALID_ORIGIN_ATTRIBUTION" | "UNDETERMINED_PLACEMENT";
  readonly placement: string | null;
  readonly reason: string;
}

/**
 * The only constructor of a BoundSet. In order: strict parse, SHA-256 of the
 * bytes equal to the SIGNED artifact digest, manifest commitment equal to the
 * commitment recomputed from the proof's own slot record.
 */
function bindSetManifest(proof: BitGraphProof, commitment: Uint8Array, bytes: Uint8Array, source: "metadata" | "argument"): BoundSet | Unbound {
  const manifest = parseSetManifest(bytes);
  if (manifest === null) {
    return { category: "INVALID_SET_MANIFEST", reason: "the set manifest is not canonical bitgraph-fuse/1 set/1 bytes" };
  }
  const digest = sha256(bytes);
  const artifact = base64ToBytes(proof.artifact.digestB64);
  if (artifact === null || !bytesEqual(digest, artifact)) {
    return { category: "INVALID_SET_MANIFEST", reason: "the set manifest does not hash to the committed artifact digest" };
  }
  if (!bytesEqual(manifest.commitment, commitment)) {
    return { category: "INVALID_SLOT_COMMITMENT", reason: "the commitment in the committed set manifest does not match the proof's slot record" };
  }
  const byArtifact = new Map<string, number>();
  const byOrigin = new Map<string, number[]>();
  manifest.members.forEach((row, index) => {
    byArtifact.set(bytesToHex(row.artifact), index);
    const origin = bytesToHex(row.origin);
    byOrigin.set(origin, [...(byOrigin.get(origin) ?? []), index]);
  });
  const bound: Omit<BoundSet, typeof boundBrand> = { source, digestB64: bytesToBase64(digest), commitment, rows: manifest.members, byArtifact, byOrigin };
  return bound as BoundSet;
}

/**
 * The one place both checks run together. (a) Membership: the bytes hash to
 * this row's artifact digest and the row belongs to the bound list. (b) The
 * floor: the commitment located in the bytes per the row's placement equals
 * the bound commitment. (c) Origin consistency: any origin the fused bytes
 * embed agrees with the row. The direct path (supplied bytes) and the origin
 * path (rebuilt bytes) both come through here; there is no second
 * implementation.
 */
function admit(bound: BoundSet, fusedBytes: Uint8Array, row: SetMember): Admitted | Refusal {
  const index = bound.byArtifact.get(bytesToHex(row.artifact));
  if (index === undefined || bound.rows[index] !== row || !bytesEqual(sha256(fusedBytes), row.artifact)) {
    // Unreachable through verifyFuseMember, which admits only a row it found
    // by this digest; kept so no refactor can admit without the check.
    throw new Error("admit: the bytes are not the listed member");
  }
  const placement = getPlacement(row.placement);
  if (placement === undefined) {
    return { category: "UNDETERMINED_PLACEMENT", placement: null, reason: `placement "${row.placement}" is not registered; the commitment cannot be located` };
  }
  const located = placement.locate(fusedBytes);
  if (located === null) {
    return {
      category: "INVALID_SLOT_COMMITMENT",
      placement: placement.id,
      reason: `listed in the committed set manifest, but no ${placement.id} commitment is found in the bytes; membership without the floor is not a member verdict`,
    };
  }
  if (!bytesEqual(located.commitment, bound.commitment)) {
    return {
      category: "INVALID_SLOT_COMMITMENT",
      placement: placement.id,
      reason: "listed in the committed set manifest, but the bytes carry a commitment to a different slot; membership without the floor is not a member verdict",
    };
  }
  const embedded = located.originDigest ?? (located.originalBytes !== undefined ? sha256(located.originalBytes) : undefined);
  let originCompared = false;
  if (embedded !== undefined) {
    if (!bytesEqual(embedded, row.origin)) {
      return { category: "INVALID_ORIGIN_ATTRIBUTION", placement: placement.id, reason: "the origin digest listed for this member does not match the origin inside the fused bytes" };
    }
    originCompared = true;
  }
  const admitted: Omit<Admitted, typeof admittedBrand> = { bound, index, row, placement, located, originCompared };
  return admitted as Admitted;
}

/** The stray's two-part reason: made after the slot, yet not in the committed set. */
function strayReason(span: FuseSpan | null, memberCount: number): string {
  const slot = span !== null ? `the slot allocated at position ${span.slotCounter}` : "its slot";
  const commit = span !== null ? `committed at position ${span.commitCounter}` : "at its commit";
  return `these bytes carry the commitment of ${slot}, so they were made after that slot existed, but their digest is not among the ${memberCount} members listed in the set manifest ${commit}; the set proof does not cover them`;
}

export async function verifyFuseMember(opts: FuseMemberOptions): Promise<FuseMemberResult> {
  const { proof, bytes } = opts;
  const fileDigest = sha256(bytes);
  const fileDigestB64 = bytesToBase64(fileDigest);
  const artifactDigestB64 = proof?.artifact?.digestB64 ?? "";

  // Result constructors are split by type: base() cannot name a member
  // category, and memberResult() is the only function that can.
  type NonMemberCategory = Exclude<FuseMemberCategory, "SET_MEMBER_DIRECT" | "SET_MEMBER_FROM_ORIGIN">;
  const base = (category: NonMemberCategory, extra: Partial<FuseMemberResult>, reason: string | null): FuseMemberResult => ({
    category,
    proof: extra.proof ?? { valid: true },
    marker: extra.marker ?? null,
    placement: extra.placement ?? null,
    fileDigestB64,
    artifactDigestB64,
    originDigestB64: extra.originDigestB64 ?? null,
    slotCommitmentB64: extra.slotCommitmentB64 ?? null,
    span: extra.span ?? null,
    policy: extra.policy ?? { spanExceeded: false, maxPositions: null },
    statements: extra.statements ?? [],
    reason,
    set: extra.set ?? null,
  });

  // 1. The underlying proof.
  const integrity = await verifyProofIntegrity(
    opts.trustAnchors !== undefined ? { proof, trustAnchors: opts.trustAnchors } : { proof },
  );
  if (!integrity.valid) {
    const reason = integrity.reason ?? "proof failed verification";
    return base("INVALID_UNDERLYING_PROOF", { proof: { valid: false, reason } }, reason);
  }

  // 2. The marker: signed fused, with the placement set/1 DECLARED. An
  //    undeclared title is refused so that this verifier and verifyFuse
  //    agree on one proof: set/1 is not in the undeclared scan, so verifyFuse
  //    finds no commitment in an undeclared set's manifest and reports
  //    INVALID_SLOT_COMMITMENT; admitting its members here would contradict
  //    that verdict. A set/1 marker carrying an origin digest is out of
  //    profile (a set has no single origin) and is refused as well.
  const marker = readFuseAttribution(proof);
  const span = spanOf(proof);
  const maxPositions = opts.maxPositions === undefined ? null : BigInt(opts.maxPositions);
  const policy = {
    spanExceeded: maxPositions !== null && span !== null && BigInt(span.positions) > maxPositions,
    maxPositions: maxPositions === null ? null : maxPositions.toString(),
  };
  const common = { proof: { valid: true }, marker, span, policy };
  if (marker === null || marker.placement !== SET_PLACEMENT_ID) {
    return base("INVALID_SET_MANIFEST", common, "the proof is not marked set/1; verifyFuse answers for this proof");
  }
  if (marker.originDigest !== undefined) {
    return base("INVALID_SET_MANIFEST", common, "the proof is marked set/1 but its signed attribution names an origin digest; a set has no single origin");
  }

  // 3. The commitment, from the proof's own slot record.
  const slot = proof.slotAllocation;
  if (slot === undefined) {
    return base("INVALID_SLOT_COMMITMENT", common, "the proof carries no slot record, so no commitment can be recomputed");
  }
  let commitment: Uint8Array;
  try {
    commitment = computeSlotCommitment(slot);
  } catch (err) {
    return base("INVALID_SLOT_COMMITMENT", common, `commitment could not be recomputed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const slotCommitmentB64 = bytesToBase64(commitment);
  const withSlot = { ...common, slotCommitmentB64 };

  // 4. Bind the manifest. An explicit argument replaces the metadata source
  //    and is never silently replaced by it.
  const explicit = opts.manifest === undefined || opts.manifest === null ? null : opts.manifest;
  const metadata = explicit === null ? readSetMetadata(proof) : null;
  const source = explicit !== null ? { bytes: explicit, from: "argument" as const } : metadata !== null ? { bytes: metadata, from: "metadata" as const } : null;
  if (source === null) {
    return base("INVALID_SET_MANIFEST", withSlot, `no set manifest: none under proof.metadata["${SET_METADATA_KEY}"] and none supplied`);
  }
  const bound = bindSetManifest(proof, commitment, source.bytes, source.from);
  if ("category" in bound) return base(bound.category, withSlot, bound.reason);
  const evidence = (member: FuseSetEvidence["member"]): FuseSetEvidence => ({
    manifestSource: bound.source,
    manifestDigestB64: bound.digestB64,
    memberCount: bound.rows.length,
    member,
  });
  const withSet = { ...withSlot, set: evidence(null) };

  // The only producer of a member category. It re-executes both checks on
  // the token before answering, so a verdict cannot become true by token
  // forgery or by an edit that reorders the steps above.
  const memberResult = (admitted: Admitted, path: "direct" | "origin"): FuseMemberResult => {
    const { index, row, placement, located } = admitted;
    if (admitted.bound !== bound || !bytesEqual(located.commitment, bound.commitment)) {
      throw new Error("verifyFuseMember: floor re-assertion failed");
    }
    if (bound.byArtifact.get(bytesToHex(row.artifact)) !== index || bound.rows[index] !== row) {
      throw new Error("verifyFuseMember: membership re-assertion failed");
    }
    const count = bound.rows.length;
    const statements: string[] = [];
    if (span !== null) {
      if (path === "direct") {
        statements.push(`These exact fused bytes are member ${index + 1} of ${count} listed in the set manifest committed at position ${span.commitCounter}.`);
        if (admitted.originCompared) {
          statements.push("The fused bytes carry an origin digest that matches the set manifest; the original itself was not supplied and was not checked.");
        }
      } else {
        statements.push(
          `The supplied original rebuilds member ${index + 1} of ${count} of the committed set byte for byte, so these exact original bytes existed no later than commit position ${span.commitCounter}.`,
        );
      }
      statements.push(floorStatement(span));
    }
    return {
      category: path === "direct" ? "SET_MEMBER_DIRECT" : "SET_MEMBER_FROM_ORIGIN",
      proof: { valid: true },
      marker,
      placement: placement.id,
      fileDigestB64,
      artifactDigestB64,
      originDigestB64: bytesToBase64(row.origin),
      slotCommitmentB64,
      span,
      policy,
      statements,
      reason: null,
      set: evidence({ index, placement: placement.id, fusedDigestB64: bytesToBase64(row.artifact), originDigestB64: bytesToBase64(row.origin) }),
    };
  };

  // 5. The bytes are the committed manifest itself: verifyFuse answers for it.
  if (fileDigestB64 === artifactDigestB64) {
    return base("NO_MATCH", withSet, "these bytes are the committed set manifest itself, not a member; verifyFuse answers for the manifest");
  }

  // 6. Direct path: the bytes hash to a listed member. Authoritative when it
  //    applies: its failure is the verdict, with no fall-through.
  const fileHex = bytesToHex(fileDigest);
  const directIndex = bound.byArtifact.get(fileHex);
  if (directIndex !== undefined) {
    const row = bound.rows[directIndex]!;
    const verdict = admit(bound, bytes, row);
    if ("category" in verdict) {
      return base(verdict.category, { ...withSet, placement: verdict.placement, originDigestB64: bytesToBase64(row.origin) }, verdict.reason);
    }
    return memberResult(verdict, "direct");
  }

  // 7. Origin path: the bytes hash to a listed origin. This runs before any
  //    stray verdict: a fused file listed only as the origin of a further
  //    member is an origin here, not a stray.
  const originRows = bound.byOrigin.get(fileHex);
  if (originRows !== undefined) {
    const unregistered: string[] = [];
    const candidates: string[] = [];
    for (const index of originRows) {
      const row = bound.rows[index]!;
      const p = getPlacement(row.placement);
      if (p === undefined) {
        unregistered.push(row.placement);
        continue;
      }
      candidates.push(p.id);
      if (!p.byteExact) continue;
      let rebuilt: Uint8Array;
      try {
        rebuilt = p.build({ original: bytes, originDigest: fileDigest, commitment });
      } catch {
        continue;
      }
      if (!bytesEqual(sha256(rebuilt), row.artifact)) continue;
      const verdict = admit(bound, rebuilt, row);
      if ("category" in verdict) {
        return base(verdict.category, { ...withSet, placement: verdict.placement, originDigestB64: fileDigestB64 }, verdict.reason);
      }
      return memberResult(verdict, "origin");
    }
    if (candidates.length === 0) {
      return base(
        "UNDETERMINED_PLACEMENT",
        { ...withSet, originDigestB64: fileDigestB64 },
        `placement "${unregistered.join('", "')}" is not registered; the fused bytes cannot be rebuilt`,
      );
    }
    return base(
      "RECONSTRUCTION_MISMATCH",
      { ...withSet, placement: candidates[0] ?? null, originDigestB64: fileDigestB64 },
      `rebuilding ${candidates.join(" or ")} from this file and the proof's slot record does not reproduce the listed member digest`,
    );
  }

  // 8. Stray scan: bytes that carry this slot's commitment yet are listed
  //    nowhere. Made after the slot, not part of the committed set: the
  //    two-part verdict, with no rendered floor.
  for (const p of PLACEMENTS) {
    const l = p.locate(bytes);
    if (l === null) continue;
    if (bytesEqual(l.commitment, commitment)) {
      return base("SET_NOT_MEMBER", { ...withSet, placement: p.id, statements: [] }, strayReason(span, bound.rows.length));
    }
    return base("NO_MATCH", withSet, "these bytes carry a commitment to a different slot; the proof proves nothing about them");
  }
  return base("NO_MATCH", withSet, "this file is neither a listed member nor a listed original and carries no commitment to this slot; the proof proves nothing about it");
}
