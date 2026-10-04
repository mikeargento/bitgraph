// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * Recovery entries for record (2026-10-03): the same sealed entries the drop
 * box keeps (SPEC section 13), so a file made here is found again from its
 * bytes alone, wherever it is dropped next.
 *
 * A tree member is never indexed by its plain hash, so the ledger's silence is
 * not "new". Before a record calls a file fresh, its entries are asked for,
 * every file, a thousand addresses a request (recoverFromDigests). An entry
 * counts only when its proof is found and the file is verified as that member
 * from its own bytes, streamed, whatever its size; a squatted entry or a
 * proof that is not there leaves the file new.
 *
 * A failed read is never a verdict, in either direction: a file whose lookup
 * did not complete (the store could not be read, the answer was malformed) is
 * UNKNOWN, and the record refuses to make it unless asked with `again`,
 * because a member of an earlier tree would look exactly like it (SPEC
 * section 13).
 *
 * Trees made here whose entries are not written yet (recovery-jobs.ts) are
 * consulted too: their members are on record, and the store does not know it
 * yet. The job holds the proof, so the file is verified against it from its
 * own bytes without any network.
 *
 * After a make, every member's entries are written. That happens after the
 * proof is in hand and never stands in its way; the job is saved first
 * (recovery-jobs.ts), so a site that does not take writes yet, a lost
 * connection or Ctrl-C leaves the entries pending on disk, not lost, and the
 * result says why. The next record finishes them.
 */

import { TREE_MEMBER_CATEGORIES, hexToBytes, verifyTreeMember } from "@mikeargento/bitgraph-verify";
import { fetchRecoveredProof, recoverFromDigests, writeRecoveryEntries, type RecoveryTrust, type RecoveryWriteOptions, type RecoveryWriteResult } from "@mikeargento/bitgraph";
import type { ApiConfig } from "./api.js";
import { mapConcurrent } from "./encoding.js";
import { RECORD_RECOVERY_BUDGET_MS, pendingMembersFor, registerRecoveryJob, runRecoveryJob } from "./recovery-jobs.js";
import { fileSource, type ScannedFile } from "./scan.js";
import type { BitGraphProof, SetMemberView } from "./types.js";

/** A position a file was verified into through its recovery entry: always a tree member. */
export interface RecoveredRow {
  proof: BitGraphProof;
  member: SetMemberView;
  tree: true;
}

export interface RecoveryLookup {
  /** Standard base64 digest to every tree position the file was verified into. */
  found: Map<string, RecoveredRow[]>;
  /** Standard base64 digest to why its lookup did not complete: whether the file is already in a tree is unknown, and it is not made without `again`. */
  unknown: Map<string, string>;
  /** unknown.size. */
  failed: number;
}

export type { RecoveryWriteResult };

/** A tree's recovery result, with the pending job's file when entries are left to write (null once every entry is kept or blocked). */
export type KeptRecovery = RecoveryWriteResult & { job: string | null };

const EMPTY_STATE = () => ({ progress: new Uint8Array(0), salts: {} as Record<string, string> });

/** Which proofs a recovery lookup accepts: BitGraph's published images (the default), or the signature and tree alone (BITGRAPH_RECOVERY_TRUST=none, a test seam). */
export function recoveryTrustFromEnv(): RecoveryTrust {
  return process.env["BITGRAPH_RECOVERY_TRUST"] === "none" ? "none" : "published";
}

export interface LookupOptions {
  trust?: RecoveryTrust;
}

/** Ask the recovery entries of files the ledger does not know: every file, a thousand addresses a request, and this machine's own pending jobs. */
export async function lookupRecovered(files: readonly ScannedFile[], config: Pick<ApiConfig, "baseUrl">, opts: LookupOptions = {}): Promise<RecoveryLookup> {
  const out: RecoveryLookup = { found: new Map(), unknown: new Map(), failed: 0 };
  if (files.length === 0) return out;
  const trust = opts.trust ?? recoveryTrustFromEnv();
  const lookup = { baseUrl: config.baseUrl };
  const digests = files.map((f) => Uint8Array.from(Buffer.from(f.digestB64, "base64")));
  // This machine's own history first. A history that cannot be read, or a job
  // set aside as broken (a recording happened; its damaged list no longer says
  // which files), leaves EVERY file unknown: nothing is called new over it.
  let historyProblem: string | null = null;
  let pending = new Map<string, Awaited<ReturnType<typeof pendingMembersFor>>["members"] extends Map<string, infer V> ? V : never>();
  try {
    const p = await pendingMembersFor(files.map((f) => f.digestB64), config.baseUrl);
    pending = p.members;
    if (p.broken.length > 0) historyProblem = `a saved recovery job of this machine is damaged (${p.broken.join(", ")}); repair it with bitgraph recovery keep <owner export>, or remove it on purpose`;
  } catch (e) {
    historyProblem = `this machine's pending recovery jobs could not be read (${e instanceof Error ? e.message : String(e)})`;
  }
  if (historyProblem !== null) {
    for (const f of files) out.unknown.set(f.digestB64, historyProblem);
    out.failed = out.unknown.size;
    return out;
  }
  const answers = await recoverFromDigests(digests, undefined, lookup);
  await mapConcurrent(files, 4, async (file, k) => {
    const a = answers[k]!;
    const local = pending.get(file.digestB64) ?? [];
    // A member of a tree made here, its entries still pending: verified against the job's own proof, from the file's bytes.
    const rows: RecoveredRow[] = [];
    if (local.length > 0) {
      try {
        const source = await fileSource(file.path);
        for (const m of local) {
          const rootDocument = hexToBytes(m.rootDocumentHex);
          if (rootDocument === null) continue;
          const check = await verifyTreeMember({ proof: m.job.proof as never, member: m.evidence, rootDocument, source });
          if (!(TREE_MEMBER_CATEGORIES as readonly string[]).includes(check.category)) continue;
          const proof = m.job.proof as unknown as BitGraphProof;
          if (rows.some((r) => r.proof.commit?.counter === proof.commit?.counter && r.proof.commit?.epochId === proof.commit?.epochId)) continue;
          rows.push({ proof, member: { index: m.evidence.index, count: m.evidence.count }, tree: true });
        }
      } catch {
        /* the file could not be read now: the store's answer decides below */
      }
    }
    if (!a.ok) {
      if (rows.length > 0) out.found.set(file.digestB64, rows);
      else out.unknown.set(file.digestB64, a.reason);
      return;
    }
    if (a.entries.length === 0) {
      if (rows.length > 0) out.found.set(file.digestB64, rows);
      return;
    }
    try {
      const source = await fileSource(file.path);
      for (const e of a.entries) {
        const bound = await fetchRecoveredProof(e, undefined, { ...lookup, source, trust });
        if (bound === null) continue;
        if (!(TREE_MEMBER_CATEGORIES as readonly string[]).includes(bound.check.category)) continue;
        const proof = bound.proof as unknown as BitGraphProof;
        if (rows.some((r) => r.proof.commit?.counter === proof.commit?.counter && r.proof.commit?.epochId === proof.commit?.epochId)) continue;
        rows.push({ proof, member: { index: e.member.index, count: e.member.count }, tree: true });
      }
      if (rows.length > 0) out.found.set(file.digestB64, rows);
    } catch (e) {
      // An entry says the file is in a tree, and the proof could not be read to check it: unknown, not new (unless a pending job already verified it).
      if (rows.length > 0) out.found.set(file.digestB64, rows);
      else out.unknown.set(file.digestB64, e instanceof Error ? e.message : String(e));
    }
  });
  out.failed = out.unknown.size;
  return out;
}

/**
 * Write a made tree's entries, the job saved first so nothing is lost if this
 * run is cut short: the saved job is finished by the next record or by
 * `bitgraph recovery flush`. Never throws: a failure is a result with its
 * reason. When even the job cannot be saved (a home directory that cannot be
 * written), the entries are written now as far as they go, and the result
 * says the rest is not saved.
 */
export async function keepRecoveryEntries(
  made: { proof: unknown; rootDocumentHex: string; leavesB64: string; names?: ReadonlyArray<string | null | undefined> },
  config: Pick<ApiConfig, "baseUrl">,
  opts: Pick<RecoveryWriteOptions, "fetch" | "retries" | "backoffMs" | "timeoutMs" | "budgetMs"> = {},
): Promise<KeptRecovery> {
  const budgetMs = opts.budgetMs ?? RECORD_RECOVERY_BUDGET_MS;
  const runOpts = { budgetMs, ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}), ...(opts.retries !== undefined ? { retries: opts.retries } : {}), ...(opts.backoffMs !== undefined ? { backoffMs: opts.backoffMs } : {}), ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) };
  let registered: Awaited<ReturnType<typeof registerRecoveryJob>> | null = null;
  let saveError: string | null = null;
  try {
    registered = await registerRecoveryJob(made, config);
  } catch (e) {
    saveError = e instanceof Error ? e.message : String(e);
  }
  if (registered !== null) {
    const result = await runRecoveryJob(registered.job, runOpts);
    if (result === null) {
      return { entries: 0, kept: 0, written: 0, alreadyThere: 0, salted: 0, blocked: 0, pending: 0, reason: "another process is writing this tree's entries", state: EMPTY_STATE(), done: false, job: registered.path };
    }
    return { ...result, job: result.done ? null : registered.path };
  }
  try {
    const r = await writeRecoveryEntries(
      {
        proof: made.proof as never,
        rootDocument: Uint8Array.from(Buffer.from(made.rootDocumentHex, "hex")),
        leavesBytes: Uint8Array.from(Buffer.from(made.leavesB64, "base64")),
        ...(made.names !== undefined ? { names: made.names } : {}),
      },
      { ...runOpts, baseUrl: config.baseUrl },
    );
    return { ...r, reason: r.pending > 0 ? `${r.reason ?? "entries pending"}; they could not be saved for later (${saveError})` : r.reason, job: null };
  } catch (e) {
    return { entries: 0, kept: 0, written: 0, alreadyThere: 0, salted: 0, blocked: 0, pending: 0, reason: `recovery entries were not written: ${(e as Error).message}`, state: EMPTY_STATE(), done: false, job: null };
  }
}

/** One line for a person: what the entries mean for finding this proof again. */
export function recoveryLine(r: RecoveryWriteResult & { job?: string | null }): string {
  if (r.entries > 0 && r.kept === r.entries) return `each file finds this proof again from its own bytes (${r.entries} sealed entr${r.entries === 1 ? "y" : "ies"} kept)`;
  const parts: string[] = [];
  if (r.pending > 0 || r.entries === 0) parts.push(`not yet recoverable from the files alone: ${r.reason ?? "the entries were not written"}`);
  if (r.blocked > 0) parts.push(`${r.blocked} of ${r.entries} entries are held by other entries under the same file, under both names (SPEC section 13); keep the export`);
  if (parts.length === 0) parts.push(`${r.kept} of ${r.entries} recovery entries kept`);
  if (r.pending > 0 && typeof r.job === "string") parts.push("the pending entries are saved; the next record finishes them, or run: bitgraph recovery flush");
  return parts.join("; ");
}
