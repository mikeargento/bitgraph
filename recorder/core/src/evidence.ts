// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * The file a make ends in, beside the file it is about.
 *
 * ⚠️ THE .bitgraph FILES ARE THE AUTHORITY. The index is an index; deleting it
 * costs a rescan and nothing else.
 *
 * ## Why a set member's proof is not inside its own evidence file
 *
 * A proof is ~7.4 KB. A set of 48,000 photos is ONE position sharing ONE
 * proof, so writing the proof into all 48,000 evidence files is 355 MB of the
 * same bytes repeated. The same arithmetic already ruled out per-member
 * anchors (18.5 KB x 48,000 = 887 MB) and per-member rows in the browser's
 * bitgraphs.json. It rules this out too, before taste gets a say.
 *
 * So the proof is stored once, under positions/<epoch>/<counter>/, and a set
 * member's evidence names it. A solo make has nothing to share with, and its
 * proof sits inline where it is most useful: one file you can send someone.
 *
 * A reader handles both in three lines, and `materialize()` below turns any
 * member's evidence into the inline form on demand. That is the same doctrine
 * as the fused bytes themselves: virtual, rebuilt when asked, never written
 * out just in case.
 *
 * ## What is NOT in here
 *
 * No path, no folder name, no machine name. Evidence is reunited with its file
 * by CONTENT, by re-hashing what is in front of you. A path stored here would
 * be a second source of truth that goes stale the moment anyone renames
 * anything, and the name that IS here is advisory for a human reading the file
 * alone.
 */

import { open, mkdir, rename, readFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BitGraphProof, PlacementId } from "@mikeargento/bitgraph-verify";

export const EVIDENCE_VERSION = "bitgraph-evidence/1";

/** A position: the epoch AND the counter. The counter alone repeats every day. */
export interface EvidencePosition {
  epochId: string;
  counter: string;
}

export interface EvidenceMember {
  /** This row's index in the committed manifest. */
  index: number;
  /** How many files share this position. */
  count: number;
  /**
   * set/2 only, and REQUIRED there: the member's own evidence as the SDK
   * builds it (its row, its leaf index, the set's count, the sibling path up
   * to the root). A set/2 proof commits to a root, not a list, so this is the
   * only thing that puts this file inside that set. Without it the position is
   * unreachable for this file, and no amount of rescanning brings it back.
   */
  memberProof?: unknown;
}

/** Where this file's proof is: in here, or once, beside. */
export type EvidenceProof =
  | { kind: "inline"; proof: BitGraphProof }
  | {
      kind: "beside";
      /** POSIX-relative, from the BitGraphs folder this file lives in. */
      proof: string;
      /** The committed set manifest, whose digest IS the proof's artifact. */
      manifest: string;
    };

export interface Evidence {
  version: typeof EVIDENCE_VERSION;
  /** Advisory. Matching is by content; this is so a human knows what they are looking at. */
  file: { name: string; bytes: number };
  placement: PlacementId;
  /** SHA-256 of the original bytes on disk, standard base64. */
  originDigestB64: string;
  /** SHA-256 of the fused bytes, which are virtual. This is the artifact the position holds. */
  artifactDigestB64: string;
  position: EvidencePosition;
  /** Absent for a solo make. */
  set?: "set/1" | "set/2";
  /** Absent for a solo make. */
  member?: EvidenceMember;
  proof: EvidenceProof;
  /**
   * ⚠️ THIS MACHINE'S CLOCK, AND NOT EVIDENCE. Nothing verifies against it. The
   * record's actual bounds are the Ethereum anchors reached through the proof.
   * It is here so a person reading one of these months later knows which make
   * it came from.
   */
  writtenAt: string;
}

/**
 * A write that did not land.
 *
 * ⚠️ The write is the commit's completion, not a step after it. A proof that
 * was minted and not written is a consumed position with no evidence, which is
 * the exact loss the hosted ledger used to absorb. This carries the proof so a
 * caller can retry or queue it; it must never be logged and swallowed.
 */
export class EvidenceWriteError extends Error {
  readonly path: string;
  readonly evidence: Evidence;
  constructor(path: string, evidence: Evidence, cause: unknown) {
    super(`could not write ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "EvidenceWriteError";
    this.path = path;
    this.evidence = evidence;
    this.cause = cause;
  }
}

/**
 * Write JSON so that it is either fully there or not there at all.
 *
 * Temp file in the same directory, fsync the bytes, rename over the target,
 * fsync the directory so the rename itself survives a power cut. A plain
 * writeFile can leave a truncated proof behind, and a truncated proof reads as
 * a corrupt one, which accuses the holder of something that did not happen.
 */
export async function writeJsonAtomic(path: string, value: unknown, durable = true): Promise<void> {
  await writeBytesAtomic(path, new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`), durable);
}

/**
 * Write bytes so that the file is either fully there or not there at all.
 *
 * ⚠️ `durable` IS NOT AN OPTIMISATION KNOB, IT IS THE FAN-OUT'S LICENCE.
 *
 * A durable write costs two fsyncs: the bytes, then the directory the rename
 * landed in. On a set of 30,000 members that is 60,000 fsyncs and it MEASURED
 * at 320 seconds, against 15 for everything else the make does put together.
 *
 * It is only spent where losing the file loses something. The proof, the
 * committed artifact and members.jsonl are written durably ONCE, under the
 * position, BEFORE any evidence is fanned out; every one of those 30,000
 * evidence files is derivable from members.jsonl, so a crash mid-fan-out costs
 * a repair pass and nothing else. Those go out non-durably and their
 * directories are flushed once at the end.
 *
 * The rename is still atomic either way, so nothing ever reads a half file.
 */
export async function writeBytesAtomic(path: string, bytes: Uint8Array, durable = true): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.tmp`);
  try {
    const fh = await open(tmp, "wx");
    try {
      await fh.writeFile(bytes);
      if (durable) await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  if (durable) await syncDir(dir);
}

/** Flush a directory, so the renames inside it survive a power cut. */
export async function syncDir(dir: string): Promise<void> {
  const dh = await open(dir, "r");
  try {
    await dh.sync();
  } finally {
    await dh.close();
  }
}

export async function writeEvidence(path: string, evidence: Evidence, durable = true): Promise<void> {
  try {
    await writeJsonAtomic(path, evidence, durable);
  } catch (err) {
    throw new EvidenceWriteError(path, evidence, err);
  }
}

/** Read one back, or null when this is not one. */
export async function readEvidence(path: string): Promise<Evidence | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  return parseEvidence(text);
}

export function parseEvidence(text: string): Evidence | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const e = v as Partial<Evidence>;
  if (e.version !== EVIDENCE_VERSION) return null;
  if (typeof e.originDigestB64 !== "string" || typeof e.artifactDigestB64 !== "string") return null;
  if (e.position === undefined || typeof e.position.epochId !== "string" || typeof e.position.counter !== "string") return null;
  if (e.proof === undefined || (e.proof.kind !== "inline" && e.proof.kind !== "beside")) return null;
  return e as Evidence;
}
