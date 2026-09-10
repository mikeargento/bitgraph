// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Where a proof goes when it could not be written where it belonged.
 *
 * ⚠️ THIS IS THE ONE LOSS THAT CANNOT BE RECOMPUTED BY LOOKING AGAIN. Every
 * other kind of pending work in this app is derivable: what is left to record
 * is "the files the index has not recorded", which is answered by looking at
 * the folder. But a position, once consumed, is gone, and a proof that was
 * minted and not written is a consumed position with no evidence, which is
 * exactly the loss the hosted ledger used to absorb on our behalf.
 *
 * So the moment a write fails, the proof is put somewhere else, and the
 * failure is said out loud. It is never logged and swallowed.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic, type EvidenceWriteError } from "./evidence.js";
import { rescueDir as defaultRescueDir } from "./app-paths.js";

export const RESCUE_VERSION = "bitgraph-rescue/1";

export interface RescueFile {
  version: typeof RESCUE_VERSION;
  /** Where the evidence was meant to go. */
  intendedPath: string;
  /** Why it did not. */
  reason: string;
  /** This machine's clock. Not evidence. */
  writtenAt: string;
  /** The evidence itself, proof and all. Copying this file to intendedPath is the whole repair. */
  evidence: unknown;
}

/**
 * Keep the proof and answer where it was kept.
 *
 * The rescue file is the evidence file, whole: repairing the fault is copying
 * it back to `intendedPath`. If even this write fails there is nothing left to
 * try, and the throw reaches the caller rather than being smoothed over.
 */
export async function rescue(err: EvidenceWriteError, dir?: string): Promise<string> {
  const into = dir ?? defaultRescueDir();
  await mkdir(into, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(into, `${stamp}-${safe(err.evidence.position.epochId)}-${err.evidence.position.counter}.json`);
  const file: RescueFile = {
    version: RESCUE_VERSION,
    intendedPath: err.path,
    reason: err.message,
    writtenAt: new Date().toISOString(),
    evidence: err.evidence,
  };
  await writeJsonAtomic(path, file);
  return path;
}

function safe(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12) || "epoch";
}
