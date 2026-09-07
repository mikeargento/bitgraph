// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * `check`: what a bundle establishes about the recordings it holds, said
 * plainly, offline, in the Player's three values.
 *
 * This is a SPEC section 8 convenience: a distinct subcommand that never
 * touches evaluation semantics. It asks no rule-author question ("was A
 * before B"); it asks the reader's question ("is this recording sound, and
 * what bounds it"), over the audit pipeline's canonical interpretation of
 * the bundle, and answers per line with TRUE, FALSE, or UNDETERMINED.
 *
 * The vocabulary, and the line it lives or dies on:
 *
 *   TRUE          evidence in hand establishes the property.
 *   FALSE         evidence in hand CONTRADICTS the property: bytes that do
 *                 not hash to the digest they sit beside, a signature that
 *                 fails, an attestation whose user_data is not this proof, a
 *                 block header that does not hash to its anchor's block hash,
 *                 two recordings that cannot both be right.
 *   UNDETERMINED  the evidence does not decide. Missing bytes, a missing
 *                 witness, an environment that cannot run a check, a
 *                 measurement this verifier does not know. Absence is never
 *                 a verdict, and this command never degrades a failed or
 *                 missing check into a FALSE (project rule: a failed read is
 *                 never a verdict).
 *
 * The overall result is the strong-Kleene `all` over every line the report
 * emits: each recording's lines, each anchor's lines, and each structural
 * contradiction. Ethereum BOUNDS are reported descriptively per recording
 * and never enter the conjunction: a bundle without an anchor has an
 * unbounded recording, not an unsound one. A witness that is PRESENT and
 * fails is a contradiction and does enter.
 *
 * Excerpt honesty. A single export is an excerpt of a chain: its recording
 * links to a predecessor that is not in the bundle, and the counter
 * positions between its anchors are absent. The audit reports those as
 * anomalies because it is built to audit whole epochs; here they are
 * expected and are reported as notes, never as verdicts. Real
 * contradictions (collisions, forks, malformed links, signer changes)
 * still surface as FALSE.
 *
 * Enclave identity. An attestation proves that SOME AWS Nitro enclave
 * running code with the attested PCR0 signed this proof's key. Whether
 * that PCR0 is a published BitGraph enclave measurement is a fact this
 * verifier carries as DECLARED knowledge (KNOWN_ENCLAVE_MEASUREMENTS, from
 * server/commit-service/reproducible-build/PINS.md). A measurement outside
 * that list is UNDETERMINED, never FALSE: it is beyond what this build of
 * the verifier knows, which is exactly how an offline verifier should age.
 *
 * Determinism. The report contains no wall-clock time, no machine path, and
 * no run-local value; bundle-relative entry paths are bundle content and
 * are allowed. Same bundle bytes, same report bytes.
 */

import type {
  AnchorRecord,
  AuditResult,
  ChainAnomaly,
  IngestResult,
  ObservedProof,
  ProofAttestationRecord,
  SegmentBound,
  TemporalSegment,
} from "@mikeargento/bitgraph-audit";
import { auditIngest, AUDIT_VERSION, streamArtifactsByHash } from "@mikeargento/bitgraph-audit";
import { readFuseAttribution, verifyFuse, base64ToBytes, bytesToHex, resetEpochLinkState } from "@mikeargento/bitgraph-verify";
import type { FuseVerifyResult } from "@mikeargento/bitgraph-verify";
import type { ThreeValued } from "./types.js";
import { kleeneAll } from "./logic.js";
import { PLAYER_VERSION } from "./verdict.js";

// ---------------------------------------------------------------------------
// Declared knowledge: published enclave measurements
// ---------------------------------------------------------------------------

/**
 * Published BitGraph enclave PCR0 measurements, per PINS.md, oldest first.
 * Each remains correct for proofs minted during its own period; a proof
 * carries its own measurement, so nothing here needs to be "current" for
 * an old proof to check. Lowercase hex, exactly as attestations report.
 */
export const KNOWN_ENCLAVE_MEASUREMENTS: ReadonlyArray<{ pcr0: string; label: string; period: string }> = [
  {
    pcr0: "8530a6399399c4f23d89f5a1faa2e8bf2e09a5959f117070fca08148377f92c902c695fc926c17f67f35f110327dca92",
    label: "genesis",
    period: "2026-05-15 to 2026-06-27",
  },
  {
    pcr0: "bb9dd158703603ec222fe565495ceaa7edc08f665da5c1cddad91442ac2211731390267036d79deb720d13fb704f648a",
    label: "enclave v2 (reproducible)",
    period: "2026-06-27 to 2026-07-05",
  },
  {
    pcr0: "e2fccbae77ee40aac4830e84f195e05d69eb4547bbd961f4d3459feba10807140424aca42ad03810354982598c86b9cb",
    label: "enclave v4 (reproducible)",
    period: "2026-07-05 to 2026-07-29",
  },
  {
    pcr0: "6483cedffed74680ffb287507744a398b288c3fb943eb3f2e4fe889f8b60b3d575ad8942350360b69a1bd7bf713df27f",
    label: "enclave v5 (reproducible)",
    period: "2026-07-29 to 2026-09-05",
  },
  {
    pcr0: "cd8ba52d340fb1be78610b59953ded2ceca23be1cfcc7ab504a26b8fdcd7ba92090f49e28a32d008df046ec4212f77bf",
    label: "enclave v6 (reproducible)",
    period: "2026-09-05 to 2026-09-06",
  },
  {
    pcr0: "394c3cf515651dc27187d85e4716c12dfeb99c1227f1fe0eacfaa427d80018e1a28ebba9469e99c7936601f901d74e1d",
    label: "enclave v7 (reproducible, authenticated anchors)",
    period: "2026-09-06 to 2026-09-07",
  },
  {
    pcr0: "eccfc1c78006f4b74f929c992785575c908a0f60eca08ff638cd6c0842f993f182ebb002457b8ef3e732a6a10805c72b",
    label: "enclave v8 (reproducible, authenticated anchors and the floor gate)",
    period: "2026-09-07 onward",
  },
];

// ---------------------------------------------------------------------------
// Report types: bitgraph-check/1
// ---------------------------------------------------------------------------

/** One checked property, three-valued, with a plain-language reason. */
export interface CheckLine {
  name: "file" | "signature" | "attestation" | "enclave" | "witness" | "contradiction" | "fused";
  result: ThreeValued;
  detail: string;
}

/** A verified Ethereum bound on a recording, from a witness in the bundle. */
export interface CheckBound {
  blockNumber?: string;
  blockHash: string;
  /** Unix seconds from the verified block header. */
  timestamp: number;
  anchorProofHash: string;
  evidence: "chain-link" | "counter-order";
  weaker: boolean;
}

export interface CheckBounds {
  status: "lower-bounded-with-following-anchor" | "lower-bounded" | "upper-bounded" | "unanchored";
  notBefore?: CheckBound;
  notAfter?: CheckBound;
  detail: string;
}

/**
 * The wall-clock floor of a fused artifact: the last verified anchored
 * block preceding its SLOT counter in the same epoch chain. Counter-order
 * evidence by construction (no hash path reaches a slot record), reported
 * with the same "genuine block" assumption as every other bound.
 */
export interface CheckFloor {
  blockNumber?: string;
  blockHash: string;
  /** Unix seconds from the verified block header. */
  timestamp: number;
  anchorProofHash: string;
  evidence: "counter-order";
}

/** What the bundle establishes about a recording marked fused (profile bitgraph-fuse/1, working name). */
export interface CheckFused {
  category: FuseVerifyResult["category"] | "NO_EVIDENCE";
  placement: string | null;
  originDigestB64: string | null;
  /** Which bytes in the bundle the commitment check ran against. */
  evidence: "fused-bytes" | "original" | null;
  /** The bounded statements, carrying the floor clause when a floor exists. */
  statements: string[];
  floor: CheckFloor | null;
  floorDetail: string;
  /** The causal span [N, M]. */
  span: { slotCounter: string; commitCounter: string; positions: string } | null;
}

/** A non-anchor recording in the bundle. */
export interface CheckRecording {
  proofHash: string;
  digestB64: string;
  epochId?: string;
  chainId: string;
  counter?: string;
  slotCounter?: string;
  publicKeyB64?: string;
  /** Bundle-relative path of the matched artifact, when its bytes were present. */
  filePath?: string;
  lines: CheckLine[];
  /** Kleene all over `lines`. */
  result: ThreeValued;
  bounds: CheckBounds;
  /** Present exactly when the proof's signed attribution marks it fused. */
  fused?: CheckFused;
}

/** An Ethereum anchor recording in the bundle. */
export interface CheckAnchor {
  proofHash: string;
  epochId?: string;
  chainId: string;
  counter?: string;
  blockNumber?: string;
  blockHash?: string;
  /** Bundle-relative path of the witness file, when one matched this anchor. */
  witnessPath?: string;
  lines: CheckLine[];
  result: ThreeValued;
}

export interface CheckReport {
  check: "bitgraph-check/1";
  result: ThreeValued;
  /** One-sentence plain-language conclusion, deterministic. */
  summary: string;
  recordings: CheckRecording[];
  anchors: CheckAnchor[];
  /** Structural findings the bundle contradicts itself on. Every entry is FALSE. */
  contradictions: CheckLine[];
  /** Informational: excerpt gaps, unmatched files, duplicates. Never verdicts. */
  notes: string[];
  /** What no offline check can establish, stated rather than implied. */
  notChecked: string[];
  evaluator: { name: "bitgraph-player"; version: string; audit: string };
  network: "none";
}

export interface CheckOptions {
  /**
   * False when the environment cannot run the attestation's ECDSA P-384
   * verification (no WebCrypto). Attestation lines are then UNDETERMINED
   * with that reason instead of a false FALSE. Defaults to true.
   */
  webCryptoAvailable?: boolean;
  /**
   * Fuse evidence by proofHash: the verifyFuse result over the fused bytes
   * (preferred) or the original, whichever the bundle holds. checkIngest
   * collects this from the bundle; embedders may supply it.
   */
  fuseEvidence?: ReadonlyMap<string, FuseVerifyResult>;
  /** Content hashes (hex) of files that served as the original of a fused recording; not "unmatched". */
  fuseOriginHexes?: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Anomaly classification for excerpts
// ---------------------------------------------------------------------------

/**
 * Codes that mean "the bundle is an excerpt", not "the chain is wrong":
 * a recording whose predecessor is not supplied, positions between the
 * supplied recordings that are not supplied, an epoch link whose other end
 * is not supplied. Reported as notes. Everything else classifyAnomalies
 * emits is a contradiction among the supplied proofs and surfaces as FALSE.
 */
const EXCERPT_NORMAL_CODES: ReadonlySet<string> = new Set([
  "unexplained-counter-positions",
  "chain-break-missing",
  "epochlink-terminal-missing",
  "epochlink-dangling",
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check an already-ingested bundle: runs the audit's pure tail (no
 * filesystem, no network) and builds the report. Both the CLI and the
 * browser page call this, so they cannot drift.
 */
export async function checkIngest(ingest: IngestResult, options?: CheckOptions): Promise<CheckReport> {
  let opts = options;
  const audit = await auditIngest(ingest, { startedAt: "" });
  if (opts?.fuseEvidence === undefined) {
    const collected = await collectFuseEvidence(ingest);
    opts = { ...opts, fuseEvidence: collected.evidence, fuseOriginHexes: collected.originHexes };
  }
  return buildCheckReport(audit, opts);
}

/**
 * For every proof marked fused, find the bytes the check can run against:
 * the committed (fused) bytes if the bundle holds them, else the original
 * named by the signed origin digest. Runs after the audit pass and resets
 * the verify library's epoch-link state around its own verifications.
 */
async function collectFuseEvidence(
  ingest: IngestResult
): Promise<{ evidence: Map<string, FuseVerifyResult>; originHexes: Set<string> }> {
  const evidence = new Map<string, FuseVerifyResult>();
  const originHexes = new Set<string>();
  const wanted: Array<{ proof: ObservedProof; artifactHex: string | null; originHex: string | null }> = [];
  const hexes = new Set<string>();
  for (const proof of ingest.proofs) {
    const marker = readFuseAttribution(proof.proof);
    if (marker === null) continue;
    const artifactBytes = base64ToBytes(proof.proof.artifact.digestB64);
    const artifactHex = artifactBytes !== null ? bytesToHex(artifactBytes) : null;
    const originHex = marker.originDigest !== undefined ? bytesToHex(marker.originDigest) : null;
    wanted.push({ proof, artifactHex, originHex });
    if (artifactHex !== null) hexes.add(artifactHex);
    if (originHex !== null) hexes.add(originHex);
  }
  if (wanted.length === 0) return { evidence, originHexes };
  const bytesByHex = new Map<string, Uint8Array>();
  for await (const artifact of streamArtifactsByHash(ingest, hexes)) {
    if (!bytesByHex.has(artifact.sha256Hex)) bytesByHex.set(artifact.sha256Hex, artifact.bytes);
  }
  resetEpochLinkState();
  try {
    for (const w of wanted) {
      const direct = w.artifactHex !== null ? bytesByHex.get(w.artifactHex) : undefined;
      const original = w.originHex !== null ? bytesByHex.get(w.originHex) : undefined;
      if (original !== undefined && w.originHex !== null) originHexes.add(w.originHex);
      const bytes = direct ?? original;
      if (bytes === undefined) continue;
      evidence.set(w.proof.proofHash, await verifyFuse({ proof: w.proof.proof, bytes }));
    }
  } finally {
    resetEpochLinkState();
  }
  return { evidence, originHexes };
}

/** The pure report builder over an AuditResult. */
export function buildCheckReport(audit: AuditResult, options?: CheckOptions): CheckReport {
  const webCrypto = options?.webCryptoAvailable ?? true;
  const anchorByHash = new Map<string, AnchorRecord>(audit.anchors.anchors.map((a) => [a.proofHash, a]));
  const attestationByHash = new Map<string, ProofAttestationRecord>(
    audit.attestations.records.map((r) => [r.proofHash, r])
  );
  const segmentByHash = new Map<string, TemporalSegment>();
  for (const segment of audit.temporal.segments) {
    for (const hash of segment.memberProofHashes) segmentByHash.set(hash, segment);
  }
  const witnessOutcomesByAnchor = new Map<string, typeof audit.witnesses.outcomes>();
  for (const outcome of audit.witnesses.outcomes) {
    if (outcome.anchorProofHash === undefined) continue;
    const list = witnessOutcomesByAnchor.get(outcome.anchorProofHash) ?? [];
    list.push(outcome);
    witnessOutcomesByAnchor.set(outcome.anchorProofHash, list);
  }
  const artifactPathByProof = new Map<string, string>();
  for (const artifact of audit.ingest.artifacts) {
    for (const hash of artifact.matchedProofHashes) {
      if (!artifactPathByProof.has(hash) && artifact.paths[0] !== undefined) {
        artifactPathByProof.set(hash, artifact.paths[0]);
      }
    }
  }

  const recordings: CheckRecording[] = [];
  const anchors: CheckAnchor[] = [];

  for (const proof of audit.ingest.proofs) {
    const anchor = anchorByHash.get(proof.proofHash);
    if (anchor !== undefined) {
      anchors.push(buildAnchor(proof, anchor, witnessOutcomesByAnchor.get(proof.proofHash) ?? []));
    } else {
      recordings.push(
        buildRecording(
          proof,
          attestationByHash.get(proof.proofHash),
          segmentByHash.get(proof.proofHash),
          artifactPathByProof.get(proof.proofHash),
          webCrypto,
          options?.fuseEvidence,
          anchorByHash
        )
      );
    }
  }

  sortByPosition(recordings);
  sortByPosition(anchors);
  const contradictions = collectContradictions(audit);
  const notes = collectNotes(audit, recordings, anchors, options?.fuseOriginHexes);
  const notChecked = collectNotChecked(anchors.length > 0);

  const allLines: ThreeValued[] = [
    ...recordings.map((r) => r.result),
    ...anchors.map((a) => a.result),
    ...contradictions.map((c) => c.result),
  ];
  const result: ThreeValued = allLines.length === 0 ? "UNDETERMINED" : kleeneAll(allLines);

  return {
    check: "bitgraph-check/1",
    result,
    summary: summarize(result, recordings, anchors, contradictions),
    recordings,
    anchors,
    contradictions,
    notes,
    notChecked,
    evaluator: { name: "bitgraph-player", version: PLAYER_VERSION, audit: AUDIT_VERSION },
    network: "none",
  };
}

/**
 * Causal display order: by epoch id, then commit counter as an integer.
 * Entries without a parseable counter keep observation order after those
 * with one. Deterministic, and it puts the before-anchor before the
 * after-anchor regardless of file names.
 */
function sortByPosition<T extends { epochId?: string; counter?: string }>(items: T[]): void {
  const key = (x: T): [string, bigint | undefined] => [
    x.epochId ?? "",
    x.counter !== undefined && /^[0-9]+$/.test(x.counter) ? BigInt(x.counter) : undefined,
  ];
  items.sort((a, b) => {
    const [ae, ac] = key(a);
    const [be, bc] = key(b);
    if (ae !== be) return ae < be ? -1 : 1;
    if (ac === undefined || bc === undefined) return ac === undefined ? (bc === undefined ? 0 : 1) : -1;
    return ac < bc ? -1 : ac > bc ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// Recordings
// ---------------------------------------------------------------------------

function buildRecording(
  proof: ObservedProof,
  attestation: ProofAttestationRecord | undefined,
  segment: TemporalSegment | undefined,
  filePath: string | undefined,
  webCrypto: boolean,
  fuseEvidence?: ReadonlyMap<string, FuseVerifyResult>,
  anchorByHash?: ReadonlyMap<string, AnchorRecord>
): CheckRecording {
  const lines: CheckLine[] = [];
  const v = proof.verification;
  const digestB64 = proof.proof.artifact.digestB64;

  // file: the bytes in hand hash to the recorded digest.
  if (v?.tier === "full") {
    lines.push({
      name: "file",
      result: v.status === "verified" || v.status === "failed" ? "TRUE" : "UNDETERMINED",
      detail:
        v.status === "verified" || v.status === "failed"
          ? `${filePath ?? "the matched file"} hashes to the recorded digest ${digestB64}`
          : `no file in this bundle hashes to the recorded digest ${digestB64}`,
    });
  } else {
    lines.push({
      name: "file",
      result: "UNDETERMINED",
      detail: `no file in this bundle hashes to the recorded digest ${digestB64}; the recording cannot be bound to bytes in hand`,
    });
  }

  // signature: the proof body verifies (structure, slot binding, Ed25519).
  // At full tier a matched artifact always hashes to the digest (matching
  // is content-addressed), so a full-tier failure is a signature or
  // structure failure, never a digest mismatch.
  if (v === undefined) {
    lines.push({ name: "signature", result: "UNDETERMINED", detail: "the proof was not verified" });
  } else if (v.status === "failed") {
    lines.push({
      name: "signature",
      result: "FALSE",
      detail: `the proof does not verify: ${v.reason ?? "unspecified failure"}`,
    });
  } else {
    lines.push({
      name: "signature",
      result: "TRUE",
      detail: `Ed25519 signature and slot binding verify under signer key ${shortB64(proof.publicKeyB64)}`,
    });
  }

  // attestation: the AWS Nitro document validates, is bound to THIS proof
  // (user_data), and attests the PCR0 the signed body declares.
  const att = attestationLine(attestation, webCrypto);
  lines.push(att.line);

  // enclave: the attested PCR0 is a published BitGraph measurement.
  lines.push(enclaveLine(att.attestedPcr0, att.line.result));


  // fused: the proof's signed attribution marks a fused artifact (profile
  // bitgraph-fuse/1). The commitment check runs over the fused bytes, or
  // over the original by reconstruction; its floor is the last verified
  // anchor preceding the SLOT, not the commit.
  const marker = readFuseAttribution(proof.proof);
  let fused: CheckFused | undefined;
  if (marker !== null) {
    const floor = fusedFloor(segment, anchorByHash, proof.slotCounter, proof.chainId);
    const built = fusedLine(marker.placement, marker.originDigest !== undefined ? proof.proof.attribution?.message ?? null : null, fuseEvidence?.get(proof.proofHash), floor, proof);
    lines.push(built.line);
    fused = built.fused;
  }

  const result = kleeneAll(lines.map((l) => l.result));

  return {
    proofHash: proof.proofHash,
    digestB64,
    ...(proof.epochId !== undefined ? { epochId: proof.epochId } : {}),
    chainId: proof.chainId,
    ...(proof.counter !== undefined ? { counter: proof.counter } : {}),
    ...(proof.slotCounter !== undefined ? { slotCounter: proof.slotCounter } : {}),
    ...(proof.publicKeyB64 !== undefined ? { publicKeyB64: proof.publicKeyB64 } : {}),
    ...(filePath !== undefined && v?.tier === "full" ? { filePath } : {}),
    lines,
    result,
    bounds: boundsFor(segment),
    ...(fused !== undefined ? { fused } : {}),
  };
}

/**
 * The fused floor: among the segment's verified not-before anchors, those
 * whose commit counter precedes the SLOT counter, tightest last (largest
 * block number, else latest timestamp). Null when no verified anchor
 * precedes the slot in its epoch chain.
 */
export const ANCHORED_CHAIN = "bitgraph:main";

export function fusedFloor(
  segment: TemporalSegment | undefined,
  anchorByHash: ReadonlyMap<string, AnchorRecord> | undefined,
  slotCounter: string | undefined,
  chainId: string = ANCHORED_CHAIN
): CheckFloor | null {
  // Anchors exist only on the anchored chain and the anchor index carries no
  // chain segment, so a slot on any other chain compares to nothing.
  if (chainId !== ANCHORED_CHAIN) return null;
  if (segment === undefined || anchorByHash === undefined || slotCounter === undefined || !/^[0-9]+$/.test(slotCounter)) return null;
  const slot = BigInt(slotCounter);
  let best: SegmentBound | undefined;
  for (const b of segment.lowerBounds) {
    if (b.kind !== "not-before") continue;
    const anchor = anchorByHash.get(b.anchorProofHash);
    if (anchor === undefined || anchor.counter === undefined || !/^[0-9]+$/.test(anchor.counter)) continue;
    if (BigInt(anchor.counter) >= slot) continue;
    if (best === undefined) { best = b; continue; }
    const bn = b.blockNumber !== undefined ? BigInt(b.blockNumber) : BigInt(b.timestamp);
    const bb = best.blockNumber !== undefined ? BigInt(best.blockNumber) : BigInt(best.timestamp);
    if (bn > bb) best = b;
  }
  if (best === undefined) return null;
  return {
    ...(best.blockNumber !== undefined ? { blockNumber: best.blockNumber } : {}),
    blockHash: best.blockHash,
    timestamp: best.timestamp,
    anchorProofHash: best.anchorProofHash,
    evidence: "counter-order",
  };
}

const FLOOR_UNDETERMINED = "floor undetermined: no anchor precedes this slot in its epoch";

function floorClause(floor: CheckFloor): string {
  const block = floor.blockNumber !== undefined ? `#${floor.blockNumber}` : floor.blockHash;
  return `anchored block ${block} (${new Date(floor.timestamp * 1000).toISOString()})`;
}

function fusedLine(
  placement: string | null,
  originMessage: string | null,
  ev: FuseVerifyResult | undefined,
  floor: CheckFloor | null,
  proof: ObservedProof
): { line: CheckLine; fused: CheckFused } {
  const slot = proof.slotCounter ?? "?";
  const where = placement !== null ? ` (placement ${placement})` : " (placement undeclared)";
  const floorDetail = floor !== null
    ? `assembled after ${floorClause(floor)}, the last verified anchor preceding slot ${slot} in this epoch`
    : proof.chainId !== ANCHORED_CHAIN
      ? `floor undetermined: the slot is on chain "${proof.chainId}", not the anchored chain`
      : FLOOR_UNDETERMINED;
  const span = ev?.span !== undefined && ev.span !== null
    ? { slotCounter: ev.span.slotCounter, commitCounter: ev.span.commitCounter, positions: ev.span.positions }
    : proof.slotCounter !== undefined && proof.counter !== undefined
      ? { slotCounter: proof.slotCounter, commitCounter: proof.counter, positions: (BigInt(proof.counter) - BigInt(proof.slotCounter)).toString() }
      : null;
  const statements = (ev?.statements ?? []).map((s) =>
    floor !== null ? s.replace(`at position ${slot},`, `at position ${slot}, which followed ${floorClause(floor)},`) : s
  );
  const base = (category: CheckFused["category"], evidence: CheckFused["evidence"]): CheckFused => ({
    category,
    placement: ev?.placement ?? placement,
    originDigestB64: ev?.originDigestB64 ?? originMessage,
    evidence,
    statements,
    floor,
    floorDetail,
    span,
  });
  if (ev === undefined) {
    return {
      line: { name: "fused", result: "UNDETERMINED", detail: `marked fused${where}, but neither the fused bytes nor ${originMessage !== null ? "the original" : "an original"} is in this bundle, so the commitment to slot ${slot} cannot be checked` },
      fused: base("NO_EVIDENCE", null),
    };
  }
  const evidence: CheckFused["evidence"] = ev.category === "FUSED_FROM_ORIGIN" || (ev.fileDigestB64 !== ev.artifactDigestB64 && ev.category !== "NO_MATCH") ? "original" : "fused-bytes";
  switch (ev.category) {
    case "FUSED_DIRECT":
      return { line: { name: "fused", result: "TRUE", detail: `the fused bytes carry the commitment to slot ${slot}${where}` }, fused: base(ev.category, "fused-bytes") };
    case "FUSED_FROM_ORIGIN":
      return { line: { name: "fused", result: "TRUE", detail: `the original rebuilds the committed fused bytes${where}; they carry the commitment to slot ${slot}` }, fused: base(ev.category, "original") };
    case "INVALID_SLOT_COMMITMENT":
      return { line: { name: "fused", result: "FALSE", detail: `the fused bytes do not carry the commitment to this proof's slot ${slot}: ${ev.reason ?? ""}` }, fused: base(ev.category, evidence) };
    case "INVALID_ORIGIN_ATTRIBUTION":
      return { line: { name: "fused", result: "FALSE", detail: `the declared origin contradicts the origin inside the fused bytes: ${ev.reason ?? ""}` }, fused: base(ev.category, evidence) };
    case "RECONSTRUCTION_MISMATCH":
      return { line: { name: "fused", result: "FALSE", detail: `the file matching the declared origin does not rebuild the committed fused bytes: ${ev.reason ?? ""}` }, fused: base(ev.category, "original") };
    case "UNDETERMINED_PLACEMENT":
      return { line: { name: "fused", result: "UNDETERMINED", detail: `${ev.reason ?? "the placement is not registered"}; this verifier cannot check the commitment` }, fused: base(ev.category, evidence) };
    case "INVALID_UNDERLYING_PROOF":
      return { line: { name: "fused", result: "UNDETERMINED", detail: "not checked: the proof itself does not verify (see the signature line)" }, fused: base(ev.category, evidence) };
    default:
      return { line: { name: "fused", result: "UNDETERMINED", detail: `the commitment could not be checked: ${ev.reason ?? ev.category}` }, fused: base(ev.category, evidence) };
  }
}

function attestationLine(
  record: ProofAttestationRecord | undefined,
  webCrypto: boolean
): { line: CheckLine; attestedPcr0?: string | undefined } {
  if (record === undefined || !record.documentPresent) {
    return {
      line: {
        name: "attestation",
        result: "UNDETERMINED",
        detail: "no attestation document in this proof",
      },
    };
  }
  if (!webCrypto) {
    return {
      line: {
        name: "attestation",
        result: "UNDETERMINED",
        detail:
          "attestation not checked: this environment cannot verify ECDSA P-384 (no WebCrypto); open the verifier from a file or https page, or run bitgraph-play check",
      },
    };
  }
  if (!record.documentValidated) {
    return {
      line: {
        name: "attestation",
        result: "FALSE",
        detail: `attestation document does not validate: ${record.validationFailure ?? "unspecified failure"}`,
      },
    };
  }
  if (record.userDataBoundToProof !== true) {
    return {
      line: {
        name: "attestation",
        result: "FALSE",
        detail: "attestation document validates but its user_data is not this proof: the document belongs to some other proof",
      },
      attestedPcr0: record.attestedPcr0,
    };
  }
  if (record.pcr0MatchesDeclared !== true) {
    return {
      line: {
        name: "attestation",
        result: "FALSE",
        detail: `attestation validates and binds this proof, but its PCR0 ${shortHex(record.attestedPcr0)} is not the measurement the signed body declares ${shortHex(record.declaredMeasurement)}`,
      },
      attestedPcr0: record.attestedPcr0,
    };
  }
  return {
    line: {
      name: "attestation",
      result: "TRUE",
      detail: `AWS Nitro attestation validates to the AWS root, binds this exact proof (user_data), and attests PCR0 ${shortHex(record.attestedPcr0)}`,
    },
    attestedPcr0: record.attestedPcr0,
  };
}


function enclaveLine(attestedPcr0: string | undefined, attestationResult: ThreeValued): CheckLine {
  if (attestationResult !== "TRUE" || attestedPcr0 === undefined) {
    return {
      name: "enclave",
      result: "UNDETERMINED",
      detail: "enclave identity rests on a validated attestation, which this recording does not have here",
    };
  }
  const known = KNOWN_ENCLAVE_MEASUREMENTS.find((m) => m.pcr0 === attestedPcr0.toLowerCase());
  if (known === undefined) {
    return {
      name: "enclave",
      result: "UNDETERMINED",
      detail: `PCR0 ${shortHex(attestedPcr0)} is not among the BitGraph enclave measurements this verifier knows (player ${PLAYER_VERSION}); compare it against the measurements published at bitgraph.ing/docs/self-host-tee`,
    };
  }
  return {
    name: "enclave",
    result: "TRUE",
    detail: `PCR0 ${shortHex(attestedPcr0)} is the published BitGraph ${known.label} measurement (${known.period})`,
  };
}

function boundsFor(segment: TemporalSegment | undefined): CheckBounds {
  if (segment === undefined) {
    return { status: "unanchored", detail: "no verified Ethereum anchor bounds this recording in this bundle" };
  }
  const lower = tightest(segment.lowerBounds, "not-before");
  const upper = tightest(segment.upperBounds, "not-after");
  const notBefore = lower === undefined ? undefined : toBound(lower);
  const notAfter = upper === undefined ? undefined : toBound(upper);
  const status: CheckBounds["status"] =
    notBefore !== undefined && notAfter !== undefined
      ? "lower-bounded-with-following-anchor"
      : notBefore !== undefined
        ? "lower-bounded"
        : notAfter !== undefined
          ? "upper-bounded"
          : "unanchored";
  const detail =
    status === "unanchored"
      ? "no verified Ethereum anchor bounds this recording in this bundle"
      : `recorded ${boundsPhrase(status, notBefore, notAfter)}`;
  return {
    status,
    ...(notBefore !== undefined ? { notBefore } : {}),
    ...(notAfter !== undefined ? { notAfter } : {}),
    detail,
  };
}

/**
 * "after Ethereum block A; precedes an anchor that consumed block B", shared by bounds.detail and the summary.
 * The following anchor is deliberately NOT rendered as "before block B": a proof precedes the anchor's
 * commit, and block B's timestamp bounds that commit from below, not the proof from above. Reading it as
 * a ceiling assumes the anchor consumed a recently published block. An inbound anchor cannot carry a
 * proof of an upper bound, so the phrase says what the evidence supports and names the assumption.
 */
function boundsPhrase(
  status: CheckBounds["status"],
  notBefore: CheckBound | undefined,
  notAfter: CheckBound | undefined
): string {
  switch (status) {
    case "lower-bounded-with-following-anchor":
      return (
        `after Ethereum block ${blockRef(notBefore as CheckBound)} (header verified in this bundle); precedes an anchor that consumed block ${blockRef(notAfter as CheckBound)} (header verified), an anchor-latency assumption rather than an upper bound on this recording` +
        weakerSuffix((notBefore as CheckBound).weaker || (notAfter as CheckBound).weaker)
      );
    case "lower-bounded":
      return `after Ethereum block ${blockRef(notBefore as CheckBound)} (header verified in this bundle); no verified upper bound here` + weakerSuffix((notBefore as CheckBound).weaker);
    case "upper-bounded":
      return `before Ethereum block ${blockRef(notAfter as CheckBound)} (header verified in this bundle); no verified lower bound here` + weakerSuffix((notAfter as CheckBound).weaker);
    default:
      return "with no verified Ethereum bound in this bundle";
  }
}

/**
 * The tightest bound of a kind: for not-before the LARGEST block number
 * (latest verified anchor known to precede), for not-after the SMALLEST.
 * Ties resolve by preferring chain-link evidence over counter-order.
 */
function tightest(bounds: SegmentBound[], kind: "not-before" | "not-after"): SegmentBound | undefined {
  const ofKind = bounds.filter((b) => b.kind === kind);
  if (ofKind.length === 0) return undefined;
  const sorted = [...ofKind].sort((a, b) => {
    const an = a.blockNumber !== undefined ? BigInt(a.blockNumber) : BigInt(a.timestamp);
    const bn = b.blockNumber !== undefined ? BigInt(b.blockNumber) : BigInt(b.timestamp);
    if (an !== bn) return kind === "not-before" ? (an > bn ? -1 : 1) : an < bn ? -1 : 1;
    if (a.weaker !== b.weaker) return a.weaker ? 1 : -1;
    return 0;
  });
  return sorted[0];
}

function toBound(b: SegmentBound): CheckBound {
  return {
    ...(b.blockNumber !== undefined ? { blockNumber: b.blockNumber } : {}),
    blockHash: b.blockHash,
    timestamp: b.timestamp,
    anchorProofHash: b.anchorProofHash,
    evidence: b.evidence,
    weaker: b.weaker,
  };
}

/** The headline form of the bounds: one clause, no qualifiers (those live in bounds.detail). */
function shortBoundsPhrase(b: CheckBounds): string {
  switch (b.status) {
    case "lower-bounded-with-following-anchor":
      return `after Ethereum block ${blockRef(b.notBefore as CheckBound)}, then an anchor at block ${blockRef(b.notAfter as CheckBound)}`;
    case "lower-bounded":
      return `after Ethereum block ${blockRef(b.notBefore as CheckBound)}`;
    case "upper-bounded":
      return `before Ethereum block ${blockRef(b.notAfter as CheckBound)}`;
    default:
      return "with no Ethereum bound in this bundle";
  }
}

function blockRef(b: CheckBound): string {
  return b.blockNumber !== undefined ? b.blockNumber : b.blockHash;
}

function weakerSuffix(weaker: boolean): string {
  return weaker
    ? "; ordered by counter position within the epoch, since the recordings between are not in this bundle"
    : "";
}

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

function buildAnchor(
  proof: ObservedProof,
  anchor: AnchorRecord,
  outcomes: Array<{ witnessPath: string; verified: boolean; detail?: string; reason?: string; blockNumber?: string }>
): CheckAnchor {
  const lines: CheckLine[] = [];
  const v = proof.verification;
  if (v === undefined) {
    lines.push({ name: "signature", result: "UNDETERMINED", detail: "the anchor proof was not verified" });
  } else if (v.status === "failed") {
    lines.push({
      name: "signature",
      result: "FALSE",
      detail: `the anchor proof does not verify: ${v.reason ?? "unspecified failure"}`,
    });
  } else {
    lines.push({
      name: "signature",
      result: "TRUE",
      detail: `anchor proof verifies under signer key ${shortB64(proof.publicKeyB64)}`,
    });
  }

  // witness: present and verified is TRUE; present and failing is FALSE;
  // absent is not a line (absence is not a verdict) and shows in bounds.
  let witnessPath: string | undefined;
  if (outcomes.length > 0) {
    const verified = outcomes.find((o) => o.verified);
    if (verified !== undefined) {
      witnessPath = verified.witnessPath;
      lines.push({
        name: "witness",
        result: "TRUE",
        detail: `block header ${verified.witnessPath} hashes (keccak-256) to the anchored block hash${anchor.blockNumber !== undefined ? ` of block ${anchor.blockNumber}` : ""}`,
      });
    } else {
      const first = outcomes[0] as { witnessPath: string; detail?: string; reason?: string };
      witnessPath = first.witnessPath;
      lines.push({
        name: "witness",
        result: "FALSE",
        detail: `block header ${first.witnessPath} contradicts this anchor: ${first.detail ?? first.reason ?? "witness verification failed"}`,
      });
    }
  }

  return {
    proofHash: proof.proofHash,
    ...(proof.epochId !== undefined ? { epochId: proof.epochId } : {}),
    chainId: proof.chainId,
    ...(proof.counter !== undefined ? { counter: proof.counter } : {}),
    ...(anchor.blockNumber !== undefined ? { blockNumber: anchor.blockNumber } : {}),
    ...(anchor.blockHash !== undefined ? { blockHash: anchor.blockHash } : {}),
    ...(witnessPath !== undefined ? { witnessPath } : {}),
    lines,
    result: kleeneAll(lines.map((l) => l.result)),
  };
}

// ---------------------------------------------------------------------------
// Contradictions, notes, not-checked
// ---------------------------------------------------------------------------

function collectContradictions(audit: AuditResult): CheckLine[] {
  const out: CheckLine[] = [];
  const seen = new Set<string>();
  const push = (detail: string): void => {
    if (seen.has(detail)) return;
    seen.add(detail);
    out.push({ name: "contradiction", result: "FALSE", detail });
  };

  for (const anomaly of audit.anomalies.anomalies as ChainAnomaly[]) {
    if (EXCERPT_NORMAL_CODES.has(anomaly.code)) continue;
    push(`${anomaly.code}: ${anomaly.message}`);
  }
  for (const divergence of audit.anomalies.divergences) {
    push(`${divergence.kind}: ${divergence.explanation}`);
  }
  for (const anomaly of audit.authorities.anomalies) {
    push(`${anomaly.code}: ${anomaly.message}`);
  }
  // Witness files that matched no anchor, or that are malformed, are
  // supplied evidence that fails; witness outcomes bound to an anchor are
  // already on that anchor's line.
  for (const finding of audit.witnesses.findings) {
    if (finding.code === "witness-unmatched" || finding.code === "witness-malformed" || finding.code === "witness-rlp-invalid") {
      push(`${finding.code}: ${finding.message}`);
    }
  }
  // An embedded proofHash that does not match the recomputed one: the
  // stored proof file was altered after the ledger wrote it, or is not
  // what it claims.
  for (const finding of audit.ingest.findings) {
    if (finding.code === "proofhash-mismatch") {
      push(`${finding.code}: ${finding.message}${finding.path !== undefined ? ` (${finding.path})` : ""}`);
    }
  }
  return out;
}

function collectNotes(audit: AuditResult, recordings: CheckRecording[], anchors: CheckAnchor[], fuseOriginHexes?: ReadonlySet<string>): string[] {
  const notes: string[] = [];

  // Excerpt gaps, said once, plainly.
  let missingPositions = 0n;
  let predecessorsAbsent = 0;
  for (const anomaly of audit.anomalies.anomalies as ChainAnomaly[]) {
    if (anomaly.code === "unexplained-counter-positions") {
      const count = (anomaly.details as { count?: string } | undefined)?.count;
      if (count !== undefined && /^[0-9]+$/.test(count)) missingPositions += BigInt(count);
    } else if (anomaly.code === "chain-break-missing") {
      predecessorsAbsent += anomaly.proofHashes.length;
    }
  }
  if (missingPositions > 0n) {
    notes.push(
      `${missingPositions} causal position${missingPositions === 1n ? "" : "s"} between the earliest and latest recording here ${missingPositions === 1n ? "is" : "are"} not in this bundle: normal for an export, which is an excerpt of the chain; a full-epoch audit checks them`
    );
  }
  if (predecessorsAbsent > 0) {
    notes.push(
      `${predecessorsAbsent} recording${predecessorsAbsent === 1 ? "" : "s"} link${predecessorsAbsent === 1 ? "s" : ""} to a predecessor that is not in this bundle: normal for an export`
    );
  }

  // Files that match no recording: the human hint for an edited file or a
  // wrong drop, without claiming which.
  const originals = audit.ingest.artifacts.filter((a) => a.matchedProofHashes.length === 0 && fuseOriginHexes?.has(a.sha256Hex) === true);
  if (originals.length > 0) {
    notes.push(
      `${originals.length} file${originals.length === 1 ? "" : "s"} in this bundle ${originals.length === 1 ? "is" : "are"} the original of a fused recording: ${originals.slice(0, 5).map((a) => a.paths[0] ?? "(unnamed)").join(", ")}${originals.length > 5 ? ", …" : ""}. The original itself receives only the ceiling (it existed no later than the commit); the fused bytes receive the interval`
    );
  }
  const unmatched = audit.ingest.artifacts.filter((a) => a.matchedProofHashes.length === 0 && fuseOriginHexes?.has(a.sha256Hex) !== true);
  if (unmatched.length > 0 && recordings.length > 0) {
    const listed = unmatched
      .slice(0, 5)
      .map((a) => `${a.paths[0] ?? "(unnamed)"} (sha256:${a.sha256Hex.slice(0, 16)}…)`)
      .join(", ");
    notes.push(
      `${unmatched.length} file${unmatched.length === 1 ? "" : "s"} in this bundle match${unmatched.length === 1 ? "es" : ""} no recording here: ${listed}${unmatched.length > 5 ? ", …" : ""}. If ${unmatched.length === 1 ? "it" : "one of them"} was meant to be a recorded file, its bytes differ from what was recorded`
    );
  }

  // Anchors with no witness: their bounds are not established here.
  const anchorsWithoutWitness = anchors.filter((a) => a.witnessPath === undefined);
  if (anchorsWithoutWitness.length > 0) {
    notes.push(
      `${anchorsWithoutWitness.length} Ethereum anchor${anchorsWithoutWitness.length === 1 ? "" : "s"} in this bundle ha${anchorsWithoutWitness.length === 1 ? "s" : "ve"} no block-header witness file, so ${anchorsWithoutWitness.length === 1 ? "its" : "their"} block hash${anchorsWithoutWitness.length === 1 ? " is" : "es are"} not verified here and no bound is derived from ${anchorsWithoutWitness.length === 1 ? "it" : "them"}`
    );
  }

  for (const rec of audit.ingest.unsupportedVersions) {
    notes.push(`${rec.path} is proof-shaped but its version "${rec.version}" is not bitgraph/1; it was not checked`);
  }
  const c = audit.ingest.counts;
  if (c.exactDuplicates > 0 || c.semanticDuplicates > 0) {
    notes.push(
      `${c.exactDuplicates + c.semanticDuplicates} duplicate proof file${c.exactDuplicates + c.semanticDuplicates === 1 ? "" : "s"} collapsed to one recording each`
    );
  }
  if (audit.ingest.manifest !== undefined) {
    for (const finding of audit.ingest.findings) {
      if (typeof finding.code === "string" && finding.code.startsWith("manifest-")) {
        notes.push(`${finding.code}: ${finding.message}`);
      }
    }
  }
  if (recordings.length === 0 && anchors.length === 0) {
    notes.push("no BitGraph proofs were found in this bundle");
  }
  return notes;
}

function collectNotChecked(hasAnchors: boolean): string[] {
  const out: string[] = [];
  if (hasAnchors) {
    out.push(
      "whether the anchored Ethereum blocks are canonical: their headers are recomputed here, but canonicality needs an Ethereum node or a block explorer"
    );
  }
  out.push(
    "whether the public ledger holds these exact recordings at these positions: this is an offline check; drop the file on bitgraph.ing to compare against the ledger"
  );
  out.push("whether an epoch key was later quarantined: that is published outside any bundle");
  return out;
}

// ---------------------------------------------------------------------------
// Summary sentence
// ---------------------------------------------------------------------------

function summarize(
  result: ThreeValued,
  recordings: CheckRecording[],
  anchors: CheckAnchor[],
  contradictions: CheckLine[]
): string {
  if (recordings.length === 0 && anchors.length === 0) {
    return "UNDETERMINED: no BitGraph proofs were found in this bundle.";
  }
  const n = recordings.length;
  const noun = `${n} recording${n === 1 ? "" : "s"}`;
  if (result === "TRUE") {
    const first = recordings[0];
    if (n === 1 && first !== undefined) {
      const where = first.counter !== undefined ? ` at position ${first.counter}${first.epochId !== undefined ? ` of epoch ${shortB64(first.epochId)}` : ""}` : "";
      return `TRUE: this file was recorded${where}, ${shortBoundsPhrase(first.bounds)}.`;
    }
    return `TRUE: ${noun} verified: files match, signatures and attestations hold, enclave measurements published${anchors.length > 0 ? ", Ethereum bounds verified from block headers in the bundle" : ""}.`;
  }
  if (result === "FALSE") {
    const failing = [
      ...recordings.flatMap((r) => r.lines.filter((l) => l.result === "FALSE").map((l) => `${l.name}: ${l.detail}`)),
      ...anchors.flatMap((a) => a.lines.filter((l) => l.result === "FALSE").map((l) => `${l.name}: ${l.detail}`)),
      ...contradictions.map((c) => c.detail),
    ];
    return `FALSE: evidence in this bundle contradicts itself. ${failing[0] ?? ""}`.trim();
  }
  const open = [
    ...recordings.flatMap((r) => r.lines.filter((l) => l.result === "UNDETERMINED").map((l) => l.detail)),
    ...anchors.flatMap((a) => a.lines.filter((l) => l.result === "UNDETERMINED").map((l) => l.detail)),
  ];
  return `UNDETERMINED: nothing here contradicts the ${noun}, but the evidence does not fully decide. ${open[0] ?? ""}`.trim();
}

// ---------------------------------------------------------------------------
// Text rendering (the CLI's stdout; the browser page renders the same
// report shape into DOM, reusing every detail string verbatim)
// ---------------------------------------------------------------------------

export function renderCheckText(report: CheckReport): string {
  const out: string[] = [];
  const mark = (r: ThreeValued): string => (r === "TRUE" ? "TRUE " : r === "FALSE" ? "FALSE" : "UNDET");
  out.push(report.summary);
  out.push("");
  report.recordings.forEach((rec, i) => {
    out.push(
      `Recording ${i + 1}${rec.filePath !== undefined ? `: ${rec.filePath}` : ""}  [${rec.result}]`
    );
    out.push(`  digest    ${rec.digestB64}`);
    if (rec.counter !== undefined) {
      out.push(`  position  ${rec.counter}${rec.epochId !== undefined ? `  epoch ${rec.epochId}` : ""}`);
    }
    for (const line of rec.lines) out.push(`  ${mark(line.result)}  ${pad(line.name, 12)} ${line.detail}`);
    out.push(`  bounds      ${rec.bounds.detail}`);
    if (rec.fused !== undefined) {
      out.push(`  fused floor ${rec.fused.floorDetail}`);
      if (rec.fused.span !== null) out.push(`  fused span  slot ${rec.fused.span.slotCounter} to commit ${rec.fused.span.commitCounter} (${rec.fused.span.positions} positions)`);
      for (const s of rec.fused.statements) out.push(`  statement   ${s}`);
    }
    out.push("");
  });
  report.anchors.forEach((a, i) => {
    out.push(
      `Ethereum anchor ${i + 1}${a.blockNumber !== undefined ? `: block ${a.blockNumber}` : ""}${a.counter !== undefined ? ` at position ${a.counter}` : ""}  [${a.result}]`
    );
    for (const line of a.lines) out.push(`  ${mark(line.result)}  ${pad(line.name, 12)} ${line.detail}`);
    out.push("");
  });
  if (report.contradictions.length > 0) {
    out.push("Contradictions");
    for (const c of report.contradictions) out.push(`  FALSE  ${c.detail}`);
    out.push("");
  }
  if (report.notes.length > 0) {
    out.push("Notes");
    for (const n of report.notes) out.push(`  - ${n}`);
    out.push("");
  }
  out.push("Not checked (no offline check can establish these)");
  for (const n of report.notChecked) out.push(`  - ${n}`);
  out.push("");
  out.push(`Result: ${report.result}   (bitgraph-player ${report.evaluator.version}, bitgraph-audit ${report.evaluator.audit}, network: none)`);
  return out.join("\n") + "\n";
}

/** Deterministic JSON bytes for the report: two-space indent, one trailing newline. */
export function serializeCheckReport(report: CheckReport): string {
  return JSON.stringify(report, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function shortB64(s: string | undefined): string {
  if (s === undefined) return "(none)";
  return s.length > 12 ? `${s.slice(0, 12)}…` : s;
}

function shortHex(s: string | undefined): string {
  if (s === undefined) return "(none)";
  return s.length > 16 ? `${s.slice(0, 16)}…` : s;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
