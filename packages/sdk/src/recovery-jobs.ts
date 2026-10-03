// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * Recovery work that outlives one command (2026-10-03).
 *
 * A tree's recovery entries are written after its proof, and anything can
 * stop them: a site that takes no writes yet, a lost connection, Ctrl-C. The
 * tree is made and permanent either way; what would be lost is the file's way
 * back to it without the export. So BEFORE the first write (and before the
 * export is written), the whole job is saved: the proof, the root document,
 * every leaf and name, which is the same data the owner's export carries,
 * plus the progress and salts the writer resumes from (recovery-write.ts,
 * RecoveryWriteState). The file lives at
 *
 *   $BITGRAPH_HOME/recovery/<proof hash, hex>.json     ($BITGRAPH_HOME defaults to ~/.bitgraph)
 *
 * and is removed only when every entry is kept or blocked. The next `record`
 * flushes what is pending first, inside a small time budget; `bitgraph
 * recovery flush` finishes the rest; `bitgraph recovery keep <export.json>`
 * makes a job from an owner's export (a tree recorded elsewhere, or one whose
 * job file is gone).
 *
 * Two processes never work the same job at once: a sibling <id>.lock is
 * created with O_EXCL and holds the pid and the time; a lock older than
 * LOCK_STALE_MS is stale (a killed process) and is taken over. State is
 * written to a temporary name and renamed, so a crash mid-write leaves the
 * previous state, never half a file.
 */

import { mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeRecoveryEntries, type RecoveryWriteOptions, type RecoveryWriteResult, type RecoveryWriteState } from "@mikeargento/bitgraph";
import { base64ToBytes, bytesToBase64, bytesToHex, computeProofHash, type BitGraphProof } from "@mikeargento/bitgraph-verify";
import type { ApiConfig } from "./api.js";

export const RECOVERY_JOB_FORMAT = "bitgraph-recovery-job/1" as const;
/** A lock this old belongs to a process that is gone. */
export const LOCK_STALE_MS = 10 * 60_000;
/** The time a record spends on its own tree's entries before leaving the rest to the job. */
export const RECORD_RECOVERY_BUDGET_MS = 90_000;
/** The time a record spends on OTHER pending jobs before its own work. */
export const FLUSH_ON_RECORD_BUDGET_MS = 20_000;

export interface RecoveryJobFile {
  format: typeof RECOVERY_JOB_FORMAT;
  /** Lowercase hex of the proof hash: one job per recording. */
  id: string;
  createdAt: string;
  updatedAt: string;
  /** The site the entries belong on. */
  baseUrl: string;
  proof: BitGraphProof;
  rootDocumentHex: string;
  leavesB64: string;
  names: Array<string | null> | null;
  /** One progress byte per member, base64, and the salts chosen so far (RecoveryWriteState). */
  state: { progressB64: string; salts: Record<string, string> };
  /** Runs so far, and why the last one left entries pending. */
  attempts: number;
  lastReason: string | null;
}

export interface RecoveryJobSummary {
  id: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  baseUrl: string;
  counter: string | null;
  count: number;
  attempts: number;
  lastReason: string | null;
}

export interface FlushResult {
  /** Jobs that were worked this call. */
  worked: Array<{ id: string; counter: string | null; result: RecoveryWriteResult }>;
  /** Jobs left pending: still here after this call (locked by another process, out of budget, or the site still refusing). */
  left: number;
}

/** Where jobs live: $BITGRAPH_HOME/recovery, else ~/.bitgraph/recovery. */
export function recoveryJobsDir(): string {
  const home = process.env["BITGRAPH_HOME"];
  return join(home !== undefined && home !== "" ? home : join(homedir(), ".bitgraph"), "recovery");
}

const jobPath = (id: string) => join(recoveryJobsDir(), `${id}.json`);
const lockPath = (id: string) => join(recoveryJobsDir(), `${id}.lock`);

export function recoveryJobId(proof: BitGraphProof): string {
  return bytesToHex(base64ToBytes(computeProofHash(proof))!);
}

function stateOf(job: RecoveryJobFile): RecoveryWriteState {
  return { progress: base64ToBytes(job.state.progressB64) ?? new Uint8Array(0), salts: { ...job.state.salts } };
}

function withState(job: RecoveryJobFile, state: RecoveryWriteState): RecoveryJobFile {
  return { ...job, state: { progressB64: bytesToBase64(state.progress), salts: { ...state.salts } }, updatedAt: new Date().toISOString() };
}

/** Write the job atomically: a temporary name, then a rename. */
export async function saveRecoveryJob(job: RecoveryJobFile): Promise<string> {
  return saveJob(job);
}

async function saveJob(job: RecoveryJobFile): Promise<string> {
  await mkdir(recoveryJobsDir(), { recursive: true, mode: 0o700 });
  const path = jobPath(job.id);
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(job), { mode: 0o600 });
  await rename(tmp, path);
  return path;
}

function parseJob(text: string): RecoveryJobFile | null {
  try {
    const j = JSON.parse(text) as RecoveryJobFile;
    if (j === null || typeof j !== "object" || j.format !== RECOVERY_JOB_FORMAT || typeof j.id !== "string" || typeof j.leavesB64 !== "string") return null;
    return j;
  } catch {
    return null;
  }
}

async function loadJob(id: string): Promise<RecoveryJobFile | null> {
  try {
    return parseJob(await readFile(jobPath(id), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Save a made tree as a pending job BEFORE its entries are written. A job
 * already there for this recording (a record interrupted after this point
 * and run again) is kept, with its progress.
 */
export async function registerRecoveryJob(
  made: { proof: unknown; rootDocumentHex: string; leavesB64: string; names?: ReadonlyArray<string | null | undefined> },
  config: Pick<ApiConfig, "baseUrl">,
): Promise<{ job: RecoveryJobFile; path: string }> {
  const proof = made.proof as BitGraphProof;
  const id = recoveryJobId(proof);
  const existing = await loadJob(id);
  if (existing !== null) return { job: existing, path: jobPath(id) };
  const now = new Date().toISOString();
  const job: RecoveryJobFile = {
    format: RECOVERY_JOB_FORMAT,
    id,
    createdAt: now,
    updatedAt: now,
    baseUrl: config.baseUrl,
    proof,
    rootDocumentHex: made.rootDocumentHex,
    leavesB64: made.leavesB64,
    names: made.names !== undefined ? made.names.map((n) => (typeof n === "string" && n.length > 0 ? n : null)) : null,
    state: { progressB64: "", salts: {} },
    attempts: 0,
    lastReason: null,
  };
  const path = await saveJob(job);
  return { job, path };
}

/** A job from an owner's export (bitgraph-export/1 with tree.leaves): the same data, for `bitgraph recovery keep`. */
export function jobFromOwnerExport(exportDoc: unknown, baseUrl: string): RecoveryJobFile {
  const e = exportDoc as { proof?: BitGraphProof; tree?: { rootDocument?: string; leaves?: string; names?: Array<string | null> } };
  if (e === null || typeof e !== "object" || e.proof === undefined || e.tree === undefined || typeof e.tree.rootDocument !== "string" || typeof e.tree.leaves !== "string") {
    throw new Error("not an owner's export: it needs proof, tree.rootDocument and tree.leaves (a member's export carries one leaf and cannot write the tree's entries)");
  }
  const now = new Date().toISOString();
  return {
    format: RECOVERY_JOB_FORMAT,
    id: recoveryJobId(e.proof),
    createdAt: now,
    updatedAt: now,
    baseUrl,
    proof: e.proof,
    rootDocumentHex: e.tree.rootDocument,
    leavesB64: e.tree.leaves,
    names: Array.isArray(e.tree.names) ? e.tree.names.map((n) => (typeof n === "string" && n.length > 0 ? n : null)) : null,
    state: { progressB64: "", salts: {} },
    attempts: 0,
    lastReason: null,
  };
}

/** Take the job's lock; null when another live process holds it. A stale lock is taken over. */
async function lock(id: string): Promise<(() => Promise<void>) | null> {
  await mkdir(recoveryJobsDir(), { recursive: true, mode: 0o700 });
  const path = lockPath(id);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await open(path, "wx", 0o600);
      await fh.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }));
      await fh.close();
      return async () => {
        await rm(path, { force: true });
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      let at = 0;
      try {
        at = Number((JSON.parse(await readFile(path, "utf8")) as { at?: unknown }).at) || 0;
      } catch {
        at = 0;
      }
      if (Date.now() - at < LOCK_STALE_MS) return null;
      // Stale: the process that held it is gone. Take it over, once.
      await rm(path, { force: true });
    }
  }
  return null;
}

export interface RunJobOptions {
  budgetMs?: number;
  fetch?: RecoveryWriteOptions["fetch"];
  retries?: number;
  backoffMs?: number;
  timeoutMs?: number;
}

/**
 * Work one job: write its pending entries from its saved state, saving the
 * state as it moves (a salt before its write, progress after every batch),
 * and remove the file when nothing is left. Null when another process holds
 * the job. Never throws: a failure is the result's reason, and the job stays.
 */
export async function runRecoveryJob(job: RecoveryJobFile, opts: RunJobOptions = {}): Promise<RecoveryWriteResult | null> {
  const unlock = await lock(job.id);
  if (unlock === null) return null;
  let current = job;
  try {
    const result = await writeRecoveryEntries(
      {
        proof: job.proof as never,
        rootDocument: Uint8Array.from(Buffer.from(job.rootDocumentHex, "hex")),
        leavesBytes: Uint8Array.from(Buffer.from(job.leavesB64, "base64")),
        ...(job.names !== null ? { names: job.names } : {}),
      },
      {
        baseUrl: job.baseUrl,
        state: stateOf(job),
        ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
        ...(opts.budgetMs !== undefined ? { budgetMs: opts.budgetMs } : {}),
        ...(opts.retries !== undefined ? { retries: opts.retries } : {}),
        ...(opts.backoffMs !== undefined ? { backoffMs: opts.backoffMs } : {}),
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        onState: async (state) => {
          current = withState(current, state);
          await saveJob(current);
        },
      },
    );
    if (result.done) {
      await rm(jobPath(job.id), { force: true });
    } else {
      current = { ...withState(current, result.state), attempts: current.attempts + 1, lastReason: result.reason };
      await saveJob(current);
    }
    return result;
  } catch (e) {
    const reason = `recovery entries were not written: ${e instanceof Error ? e.message : String(e)}`;
    try {
      await saveJob({ ...current, attempts: current.attempts + 1, lastReason: reason });
    } catch {
      /* the job file is as it was */
    }
    const progress = stateOf(current).progress;
    return { entries: 0, kept: 0, written: 0, alreadyThere: 0, salted: 0, blocked: 0, pending: 0, reason, state: { progress, salts: { ...current.state.salts } }, done: false };
  } finally {
    await unlock();
  }
}

/** Every pending job, oldest first. */
export async function listRecoveryJobs(): Promise<RecoveryJobSummary[]> {
  let names: string[];
  try {
    names = await readdir(recoveryJobsDir());
  } catch {
    return [];
  }
  const out: RecoveryJobSummary[] = [];
  for (const name of names) {
    if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
    const job = await loadJob(name.slice(0, -5));
    if (job === null) continue;
    out.push({
      id: job.id,
      path: jobPath(job.id),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      baseUrl: job.baseUrl,
      counter: job.proof.commit?.counter ?? null,
      count: Math.floor((base64ToBytes(job.leavesB64)?.length ?? 0) / 65),
      attempts: job.attempts,
      lastReason: job.lastReason,
    });
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/**
 * Work every pending job for this site, oldest first, inside one budget. A
 * job the site refuses (writes off) ends the flush: the others would be
 * refused too. Never throws.
 */
export async function flushRecoveryJobs(config: Pick<ApiConfig, "baseUrl">, opts: RunJobOptions & { budgetMs?: number } = {}): Promise<FlushResult> {
  const deadline = Date.now() + (opts.budgetMs ?? FLUSH_ON_RECORD_BUDGET_MS);
  const out: FlushResult = { worked: [], left: 0 };
  const jobs = (await listRecoveryJobs()).filter((j) => j.baseUrl === config.baseUrl);
  let stop = false;
  for (const summary of jobs) {
    const remaining = deadline - Date.now();
    if (stop || remaining <= 0) {
      out.left++;
      continue;
    }
    const job = await loadJob(summary.id);
    if (job === null) continue;
    const result = await runRecoveryJob(job, { ...opts, budgetMs: remaining });
    if (result === null) {
      out.left++;
      continue;
    }
    out.worked.push({ id: job.id, counter: job.proof.commit?.counter ?? null, result });
    if (!result.done) {
      out.left++;
      if (result.reason !== null && /is not taking recovery writes yet/.test(result.reason)) stop = true;
    }
  }
  return out;
}
