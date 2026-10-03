// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * Writing a tree's recovery entries from outside the browser (2026-10-03).
 *
 * The drop box keeps its trees recoverable through a persistent queue
 * (website/src/lib/recovery-queue.ts). The CLI, SDK and MCP make trees too,
 * and a file they made should be found again the same way when someone drops
 * it on bitgraph.ing. This posts the same sealed entries (recovery.ts, the
 * Node twin of the site's module) to POST /api/recovery, after the proof is
 * already in hand: it never stands between anyone and a proof.
 *
 * Every write is create-only. "created" counts as written; "exists" counts
 * only after the stored envelope is opened and holds this same member
 * (anything else is reported as blocked, never as written); "conflict" and
 * "error" are retried. A site that does not take recovery writes yet (503,
 * or no route at all) leaves the entries pending, and the caller says so: the
 * tree is exactly as made, it is just not recoverable from the file until its
 * entries are written.
 */

import { base64ToBytes, bytesToBase64 } from "@mikeargento/bitgraph-verify";
import {
  MAX_BATCH_ENTRIES,
  existingEntryHoldsMember,
  recoveryTreeFrom,
  sealRecoveryMember,
  type FetchLike,
  type RecoveryPlaintext,
  type RecoveryTreeInput,
} from "./recovery.js";

export interface RecoveryWriteInput extends RecoveryTreeInput {
  /** A file name per leaf, tree order. Advisory, sealed with each entry. */
  names?: ReadonlyArray<string | null | undefined>;
}

export interface RecoveryWriteOptions {
  /** Default https://bitgraph.ing. */
  baseUrl?: string;
  fetch?: FetchLike;
  /** Rounds of retry for conflicts, errors and transient failures. Default 3. */
  retries?: number;
  /** Milliseconds before the first retry; doubles each round. Default 500. */
  backoffMs?: number;
}

export interface RecoveryWriteResult {
  /** Entries this tree needs: two per placed member, one per as-is member. */
  entries: number;
  written: number;
  /** Already stored, and opened to hold this same member. */
  alreadyThere: number;
  /** Another member's entry holds the key (see SPEC section 13, squatting). */
  blocked: number;
  /** Not written: the site refused writes, or the attempts ran out. */
  pending: number;
  /** Why entries are pending, in words, when any are. */
  reason: string | null;
}

interface Pending { key: string; envelope: Uint8Array; digest: Uint8Array; plaintext: RecoveryPlaintext }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hostOf(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

export async function writeRecoveryEntries(input: RecoveryWriteInput, opts: RecoveryWriteOptions = {}): Promise<RecoveryWriteResult> {
  const tree = recoveryTreeFrom(input);
  const f: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));
  const base = opts.baseUrl ?? "https://bitgraph.ing";
  const retries = opts.retries ?? 3;
  let waitMs = opts.backoffMs ?? 500;

  let todo: Pending[] = [];
  for (let i = 0; i < tree.count; i++) {
    const { plaintext, writes } = await sealRecoveryMember(tree, i, input.names?.[i] ?? null);
    for (const w of writes) todo.push({ key: w.objectKey, envelope: w.envelope, digest: w.digest, plaintext });
  }
  const result: RecoveryWriteResult = { entries: todo.length, written: 0, alreadyThere: 0, blocked: 0, pending: 0, reason: null };

  for (let round = 0; round <= retries && todo.length > 0; round++) {
    if (round > 0) {
      await sleep(waitMs);
      waitMs *= 2;
    }
    const again: Pending[] = [];
    for (let at = 0; at < todo.length; at += MAX_BATCH_ENTRIES) {
      const batch = todo.slice(at, at + MAX_BATCH_ENTRIES);
      let res: Response;
      try {
        res = await f(`${base}/api/recovery`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entries: batch.map((e) => ({ key: e.key, envelope: bytesToBase64(e.envelope) })) }),
        });
      } catch (e) {
        result.reason = `the site could not be reached (${(e as Error).message})`;
        again.push(...batch);
        continue;
      }
      if (res.status === 503 || res.status === 404 || res.status === 405 || res.status === 501) {
        // Writes off on the site (503), or a site without the route at all:
        // nothing will land this run. Stop asking.
        result.pending = todo.length - at + again.length;
        result.reason = `${hostOf(base)} is not taking recovery writes yet; the tree is made, but these files cannot be found from the file alone until their entries are written`;
        return result;
      }
      if (!res.ok) {
        result.reason = `POST /api/recovery answered ${res.status}`;
        again.push(...batch);
        continue;
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        result.reason = "the site's answer was not JSON";
        again.push(...batch);
        continue;
      }
      const answers = new Map<string, { status: string; envelope?: string }>();
      const list = (body as { results?: unknown }).results;
      if (Array.isArray(list)) {
        for (const r of list as Array<{ key?: unknown; status?: unknown; envelope?: unknown }>) {
          if (typeof r.key === "string" && typeof r.status === "string") answers.set(r.key, { status: r.status, ...(typeof r.envelope === "string" ? { envelope: r.envelope } : {}) });
        }
      }
      for (const e of batch) {
        const a = answers.get(e.key);
        if (a?.status === "created") result.written++;
        else if (a?.status === "exists" && a.envelope !== undefined) {
          const stored = base64ToBytes(a.envelope);
          if (stored !== null && (await existingEntryHoldsMember(e.digest, e.key, stored, e.plaintext))) result.alreadyThere++;
          else result.blocked++;
        } else again.push(e);
      }
    }
    todo = again;
  }
  result.pending = todo.length;
  if (todo.length > 0 && result.reason === null) result.reason = "some entries were not written after every retry";
  return result;
}
