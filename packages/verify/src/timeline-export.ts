// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * Building a bitgraph-timeline-bundle/1 for a file from the timeline's records (the journal's lines: each proof, and
 * for a block read or the genesis record the file it binds).
 *
 * The builder chooses the bracket by the verifier's own rules (timeline-bundle.ts), reading the block files' labels
 * and the attestations' times, and cuts the run from the floor read to the ceiling read. Base first; Ethereum when
 * Base has no qualifying ceiling (Base down). The labels are the host's own word, so the builder only proposes:
 * verifyTimelineBundle with chain lookups is what settles the bracket, and a bundle whose labels lie fails there.
 *
 * Not ready yet (retryable) when the file has no qualifying ceiling read after it in the records given: a ceiling
 * needs a block stamped after the file, read within the lag limits, so a bundle can be made a few seconds after the
 * file is bound. A gap in the records (a lost record) cannot be bridged and is not retryable.
 */

import type { BitGraphProof } from "./types.js";
import { decodeNitroAttestation } from "./nitro.js";
import { verifyStretch } from "./stretch.js";
import { parseBlockReadFile, type BlockReadChain, type BlockReadFile } from "./block-read.js";
import { DEFAULT_LAG_LIMITS, TIMELINE_BUNDLE_FORMAT, type LagLimit, type TimelineBundle } from "./timeline-bundle.js";

/** One record of the timeline, as the parent's journal keeps it. */
export interface TimelineRecordLine {
  kind: "block" | "file" | "genesis";
  proof: BitGraphProof;
  blockFile?: string;
  genesisFile?: string;
}

export type BuildTimelineBundleResult =
  | { ok: true; bundle: TimelineBundle; chain: BlockReadChain; notes: string[] }
  | { ok: false; retryable: boolean; reason: string };

/** The attestation's own time, ms, read without verifying it (verifyTimelineBundle verifies it). Null when unreadable. */
export function attestationTimeMs(proof: BitGraphProof): number | null {
  const r = proof.environment?.attestation?.reportB64;
  if (typeof r !== "string") return null;
  try { return decodeNitroAttestation(r).doc.timestampMs; } catch { return null; }
}

export function buildTimelineBundle(args: {
  /** Records of the file's epoch around it, in any order. */
  lines: readonly TimelineRecordLine[];
  /** The file's payload count. */
  counter: string;
  /** The epoch's genesis record, wherever it is. */
  genesis?: TimelineRecordLine | null;
  lagLimits?: Partial<Record<BlockReadChain, LagLimit>>;
  /** For records whose attestation is not a Nitro document (the local harness). Default attestationTimeMs. */
  nitroTimeMs?: (proof: BitGraphProof) => number | null;
}): BuildTimelineBundleResult {
  const nitro = args.nitroTimeMs ?? attestationTimeMs;
  const limits = { ...DEFAULT_LAG_LIMITS, ...(args.lagLimits ?? {}) };
  const target = args.lines.find((l) => l.proof.commit?.counter === args.counter);
  if (!target) return { ok: false, retryable: false, reason: `no record at count ${args.counter} in the records given` };
  if (target.kind === "block") return { ok: false, retryable: false, reason: "that record is a block read, not a file" };
  const epochId = target.proof.commit?.epochId;
  const lines = args.lines
    .filter((l) => l.proof.commit?.epochId === epochId)
    .slice()
    .sort((a, b) => (BigInt(a.proof.commit.counter ?? "0") < BigInt(b.proof.commit.counter ?? "0") ? -1 : 1));
  const t = lines.findIndex((l) => l.proof.commit?.counter === args.counter);
  const fileMs = nitro(target.proof);
  if (fileMs === null) return { ok: false, retryable: false, reason: "the file's attestation time cannot be read" };

  const reads = new Map<number, BlockReadFile>();
  lines.forEach((l, i) => {
    if (l.kind === "block" && l.blockFile !== undefined) {
      const f = parseBlockReadFile(l.blockFile);
      if (f) reads.set(i, f);
    }
  });

  const pick = (chain: BlockReadChain): { floor: number; ceiling: number } | { floor: number | null; ceiling: null } => {
    let floor: number | null = null;
    for (const [i, f] of reads) {
      if (i >= t || f.chain !== chain || f.timestamp * 1000 > fileMs) continue;
      if (floor === null || f.number > reads.get(floor)!.number) floor = i;
    }
    if (floor === null) return { floor: null, ceiling: null };
    const lim = limits[chain];
    for (let i = t + 1; i < lines.length; i++) {
      const f = reads.get(i);
      if (!f || f.chain !== chain) continue;
      const at = nitro(lines[i]!.proof);
      if (at === null) continue;
      const lagS = (at - f.timestamp * 1000) / 1000;
      if (f.timestamp * 1000 > fileMs && f.number > reads.get(floor)!.number && lagS <= lim.maxS && lagS >= lim.minS) return { floor, ceiling: i };
    }
    return { floor, ceiling: null };
  };

  const notes: string[] = [];
  let chosen: { chain: BlockReadChain; floor: number; ceiling: number } | null = null;
  for (const chain of ["base", "ethereum"] as const) {
    const p = pick(chain);
    if (p.ceiling !== null) { chosen = { chain, floor: p.floor!, ceiling: p.ceiling }; break; }
    notes.push(p.floor === null ? `no ${chain} read before the file in these records` : `no qualifying ${chain} ceiling after the file yet`);
  }
  if (!chosen) return { ok: false, retryable: true, reason: `not ready: ${notes.join("; ")}` };
  if (chosen.chain !== "base") notes.unshift("bracketed on Ethereum: Base had no qualifying ceiling");
  else notes.length = 0;

  const run = lines.slice(chosen.floor, chosen.ceiling + 1);
  const s = verifyStretch(run.map((l) => l.proof));
  if (!s.ok) return { ok: false, retryable: false, reason: `the records are not one unbroken run: ${s.reasons[0]}` };

  const blockFiles: Record<string, string> = {};
  run.forEach((l, i) => { if (l.kind === "block" && l.blockFile !== undefined) blockFiles[String(i)] = l.blockFile; });
  const g = args.genesis;
  if (!g || g.kind !== "genesis" || g.genesisFile === undefined) notes.push("no genesis record for this epoch: the bundle cannot verify fully");
  const bundle: TimelineBundle = {
    format: TIMELINE_BUNDLE_FORMAT,
    proofs: run.map((l) => l.proof),
    target: t - chosen.floor,
    blockFiles,
    ...(g && g.kind === "genesis" && g.genesisFile !== undefined ? { genesis: { proof: g.proof, file: g.genesisFile } } : {}),
  };
  return { ok: true, bundle, chain: chosen.chain, notes };
}
