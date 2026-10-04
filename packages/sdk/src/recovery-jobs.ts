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
 * job file is gone). The file's name carries the proof hash AND a tag of the
 * site the entries belong on: the same proof kept on two sites is two jobs,
 * and one site's progress is never counted for the other.
 *
 * Two processes do not work the same job at once: a sibling .lock is created
 * with O_EXCL and holds a random token; the process holding it touches it as
 * it works, and a lock untouched for LOCK_STALE_MS is stale (a killed or
 * frozen process) and is taken over. The token fences the old holder: it
 * touches, saves and releases only while the lock still carries its token,
 * so a holder that wakes after a takeover stops instead of overwriting the
 * new holder's state or removing its lock. The new holder reads the job from
 * disk again after taking the lock, never working an older snapshot. State
 * is written to a temporary name and renamed, so a crash mid-write leaves the
 * previous state, never half a file. A job whose saved list no longer
 * rebuilds its root is set aside as <name>.broken.json: never retried, never
 * lost, and reported (pendingMembersFor) so a record knows a recording it
 * cannot read happened.
 *
 * The jobs are also what a record consults before calling a file new: a
 * member of a tree made here whose entries are not written yet is on record,
 * and the store does not know it yet (pendingMembersFor).
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { recoveryDigestOf, recoveryPlaintextFor, recoverySidesOf, recoveryTreeFrom, writeRecoveryEntries, type RecoverySide, type RecoveryWriteOptions, type RecoveryWriteResult, type RecoveryWriteState } from "@mikeargento/bitgraph";
import { base64ToBytes, bytesToBase64, bytesToHex, computeProofHash, type BitGraphProof, type TreeMemberEvidence } from "@mikeargento/bitgraph-verify";
import type { ApiConfig } from "./api.js";

export const RECOVERY_JOB_FORMAT = "bitgraph-recovery-job/1" as const;
/** A lock untouched this long belongs to a process that is gone. */
export const LOCK_STALE_MS = 10 * 60_000;
/** A working process touches its lock this often. */
export const LOCK_TOUCH_MS = 30_000;

/** Base URLs compare without trailing slashes. */
export const normalizeBaseUrl = (u: string): string => u.replace(/\/+$/, "");
/** The time a record spends on its own tree's entries before leaving the rest to the job: the proof and the export are already delivered, the caller waits this long at most. */
export const RECORD_RECOVERY_BUDGET_MS = 30_000;
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

/** The site's tag in a job's file name: the first 16 hex of SHA-256 over its normalized base URL. */
export const siteTag = (baseUrl: string): string => bytesToHex(new Uint8Array(createHash("sha256").update(normalizeBaseUrl(baseUrl)).digest())).slice(0, 16);
const jobName = (id: string, baseUrl: string) => `${id}.${siteTag(baseUrl)}`;
const jobPath = (id: string, baseUrl: string) => join(recoveryJobsDir(), `${jobName(id, baseUrl)}.json`);
const lockPath = (id: string, baseUrl: string) => join(recoveryJobsDir(), `${jobName(id, baseUrl)}.lock`);
const JOB_FILE = /^([0-9a-f]{64})\.([0-9a-f]{16})\.json$/;
const BROKEN_FILE = /^([0-9a-f]{64})\.([0-9a-f]{16})\.broken\.json$/;

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
  const path = jobPath(job.id, job.baseUrl);
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

async function loadJob(id: string, baseUrl: string): Promise<RecoveryJobFile | null> {
  try {
    return parseJob(await readFile(jobPath(id, baseUrl), "utf8"));
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
  const existing = await loadJob(id, config.baseUrl);
  if (existing !== null) return { job: existing, path: jobPath(id, config.baseUrl) };
  const now = new Date().toISOString();
  const job: RecoveryJobFile = {
    format: RECOVERY_JOB_FORMAT,
    id,
    createdAt: now,
    updatedAt: now,
    baseUrl: normalizeBaseUrl(config.baseUrl),
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
    baseUrl: normalizeBaseUrl(baseUrl),
    proof: e.proof,
    rootDocumentHex: e.tree.rootDocument,
    leavesB64: e.tree.leaves,
    names: Array.isArray(e.tree.names) ? e.tree.names.map((n) => (typeof n === "string" && n.length > 0 ? n : null)) : null,
    state: { progressB64: "", salts: {} },
    attempts: 0,
    lastReason: null,
  };
}

/** The lock is no longer this process's: another took it over. Nothing more is saved or written. */
export class LockLostError extends Error {
  constructor() {
    super("another process took over this recovery job");
    this.name = "LockLostError";
  }
}

/**
 * Take the job's lock; null when another live process holds it. Staleness is
 * the file's modification time (never its contents, which a process may not
 * have written yet): the holder touches it every LOCK_TOUCH_MS, and a lock
 * untouched for LOCK_STALE_MS is taken over, once. The lock carries a random
 * token; `held()` is whether the file still carries ours, and touch and
 * release do nothing once it does not.
 */
async function lock(id: string, baseUrl: string): Promise<{ release: () => Promise<void>; touch: () => Promise<void>; held: () => Promise<boolean> } | null> {
  await mkdir(recoveryJobsDir(), { recursive: true, mode: 0o700 });
  const path = lockPath(id, baseUrl);
  const token = randomBytes(16).toString("hex");
  const held = async (): Promise<boolean> => {
    try {
      return (JSON.parse(await readFile(path, "utf8")) as { token?: unknown }).token === token;
    } catch {
      return false;
    }
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await open(path, "wx", 0o600);
      await fh.writeFile(JSON.stringify({ pid: process.pid, at: Date.now(), token }));
      await fh.close();
      return {
        held,
        release: async () => {
          if (await held()) await rm(path, { force: true });
        },
        touch: async () => {
          if (!(await held())) return;
          const now = new Date();
          await utimes(path, now, now).catch(() => undefined);
        },
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      let touched = Date.now();
      try {
        touched = (await stat(path)).mtimeMs;
      } catch {
        // Gone between the open and the stat: try again.
        continue;
      }
      if (Date.now() - touched < LOCK_STALE_MS) return null;
      // Stale: the process that held it is gone. Take it over, once.
      await rm(path, { force: true });
    }
  }
  return null;
}

/** Errors that mean the job's data itself is wrong: retrying cannot help. */
const isBrokenTree = (e: unknown): boolean => e instanceof Error && (e.name === "RecoveryInputError" || /does not rebuild|not a valid|not a tree|root document/i.test(e.message));

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
  const lk = await lock(job.id, job.baseUrl);
  if (lk === null) return null;
  // Under the lock, the job as it is on disk now, never the caller's snapshot: another process may have moved it.
  let current = (await loadJob(job.id, job.baseUrl)) ?? job;
  job = current;
  const touching = setInterval(() => void lk.touch(), LOCK_TOUCH_MS);
  let lost = false;
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
          // Fenced: a holder that lost its lock saves nothing and stops.
          if (!(await lk.held())) {
            lost = true;
            throw new LockLostError();
          }
          current = withState(current, state);
          await saveJob(current);
          await lk.touch();
        },
      },
    );
    if (!(await lk.held())) throw new LockLostError();
    if (result.done) {
      await rm(jobPath(job.id, job.baseUrl), { force: true });
    } else {
      current = { ...withState(current, result.state), attempts: current.attempts + 1, lastReason: result.reason };
      await saveJob(current);
    }
    return result;
  } catch (e) {
    if (lost || e instanceof LockLostError) {
      const progress = stateOf(current).progress;
      return { entries: 0, kept: 0, written: 0, alreadyThere: 0, salted: 0, blocked: 0, pending: 0, reason: "another process took over this job; it finishes it", state: { progress, salts: { ...current.state.salts } }, done: false };
    }
    const reason = `recovery entries were not written: ${e instanceof Error ? e.message : String(e)}`;
    try {
      await saveJob({ ...current, attempts: current.attempts + 1, lastReason: reason });
      // Data that cannot be worked (its list no longer rebuilds its root) is set aside, named, never retried, and reported.
      if (isBrokenTree(e)) await rename(jobPath(job.id, job.baseUrl), join(recoveryJobsDir(), `${jobName(job.id, job.baseUrl)}.broken.json`));
    } catch {
      /* the job file is as it was */
    }
    const progress = stateOf(current).progress;
    return { entries: 0, kept: 0, written: 0, alreadyThere: 0, salted: 0, blocked: 0, pending: 0, reason, state: { progress, salts: { ...current.state.salts } }, done: false };
  } finally {
    clearInterval(touching);
    await lk.release();
  }
}

export interface PendingMember {
  job: RecoveryJobFile;
  leafIndex: number;
  /** Which digest of the leaf matched: the original's, the committed bytes', or the one digest of an as-is leaf. */
  side: RecoverySide;
  evidence: TreeMemberEvidence;
  rootDocumentHex: string;
  name: string | null;
}

export interface PendingMembers {
  /** Standard base64 digest to the pending members whose original or committed bytes it is. */
  members: Map<string, PendingMember[]>;
  /** Jobs set aside as broken for this site: recordings that happened whose damaged lists no longer say which files they covered. While any exists, no file's history here is known. */
  broken: string[];
}

/**
 * The members of pending jobs (trees made here whose entries are not all
 * written) whose original or committed bytes have one of these digests, for
 * the site at `baseUrl`. Such a file is on record whatever the store says: a
 * record consults this before calling a file new. Throws when the jobs cannot
 * be read: an unreadable history is not an empty one.
 */
export async function pendingMembersFor(digestsB64: readonly string[], baseUrl: string): Promise<PendingMembers> {
  const out: PendingMembers = { members: new Map(), broken: await brokenRecoveryJobs(baseUrl) };
  if (digestsB64.length === 0) return out;
  const wanted = new Set(digestsB64);
  for (const summary of await listRecoveryJobs()) {
    if (summary.baseUrl !== normalizeBaseUrl(baseUrl)) continue;
    const job = await loadJob(summary.id, summary.baseUrl);
    if (job === null) continue;
    let tree;
    try {
      tree = recoveryTreeFrom({ proof: job.proof as never, rootDocument: Uint8Array.from(Buffer.from(job.rootDocumentHex, "hex")), leavesBytes: Uint8Array.from(Buffer.from(job.leavesB64, "base64")) });
    } catch {
      // Its list does not rebuild its root: the next run sets it aside as broken; until then it is history that cannot be read.
      out.broken.push(summary.path);
      continue;
    }
    for (let i = 0; i < tree.count; i++) {
      for (const side of recoverySidesOf(tree, i)) {
        const d = Buffer.from(recoveryDigestOf(tree, i, side)).toString("base64");
        if (!wanted.has(d)) continue;
        const { plaintext } = recoveryPlaintextFor(tree, i, job.names?.[i] ?? null);
        const list = out.members.get(d) ?? [];
        list.push({ job, leafIndex: i, side, evidence: plaintext.member, rootDocumentHex: plaintext.rootDocument, name: plaintext.name ?? null });
        out.members.set(d, list);
      }
    }
  }
  return out;
}

/** The names of jobs set aside as broken (their saved list no longer rebuilds the root), for the site at `baseUrl` when given. Throws when the directory cannot be read. */
export async function brokenRecoveryJobs(baseUrl?: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(recoveryJobsDir());
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const tag = baseUrl !== undefined ? siteTag(baseUrl) : null;
  return names.filter((n) => {
    const m = BROKEN_FILE.exec(n);
    return m !== null && (tag === null || m[2] === tag);
  }).map((n) => join(recoveryJobsDir(), n));
}

/** Every pending job, oldest first. Throws when the directory exists and cannot be read. */
export async function listRecoveryJobs(): Promise<RecoveryJobSummary[]> {
  let names: string[];
  try {
    names = await readdir(recoveryJobsDir());
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const out: RecoveryJobSummary[] = [];
  for (const name of names) {
    const m = JOB_FILE.exec(name);
    if (m === null) continue;
    let job: RecoveryJobFile | null;
    try {
      job = parseJob(await readFile(join(recoveryJobsDir(), name), "utf8"));
    } catch {
      job = null;
    }
    if (job === null || siteTag(job.baseUrl) !== m[2]) continue;
    out.push({
      id: job.id,
      path: jobPath(job.id, job.baseUrl),
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
  let jobs: RecoveryJobSummary[];
  try {
    jobs = (await listRecoveryJobs()).filter((j) => j.baseUrl === normalizeBaseUrl(config.baseUrl));
  } catch {
    return out;
  }
  let stop = false;
  for (const summary of jobs) {
    const remaining = deadline - Date.now();
    if (stop || remaining <= 0) {
      out.left++;
      continue;
    }
    const job = await loadJob(summary.id, summary.baseUrl);
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
