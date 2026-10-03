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
 * After a make, every member's entries are written. That happens after the
 * proof is in hand and never stands in its way; a site that does not take
 * writes yet leaves them pending, and the result says why.
 */

import { TREE_MEMBER_CATEGORIES } from "@mikeargento/bitgraph-verify";
import { fetchRecoveredProof, recoverFromDigests, writeRecoveryEntries, type RecoveryWriteOptions, type RecoveryWriteResult } from "@mikeargento/bitgraph";
import type { ApiConfig } from "./api.js";
import { mapConcurrent } from "./encoding.js";
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

/** Ask the recovery entries of files the ledger does not know: every file, a thousand addresses a request. */
export async function lookupRecovered(files: readonly ScannedFile[], config: Pick<ApiConfig, "baseUrl">): Promise<RecoveryLookup> {
  const out: RecoveryLookup = { found: new Map(), unknown: new Map(), failed: 0 };
  if (files.length === 0) return out;
  const lookup = { baseUrl: config.baseUrl };
  const digests = files.map((f) => Uint8Array.from(Buffer.from(f.digestB64, "base64")));
  const answers = await recoverFromDigests(digests, undefined, lookup);
  await mapConcurrent(files, 4, async (file, k) => {
    const a = answers[k]!;
    if (!a.ok) {
      out.unknown.set(file.digestB64, a.reason);
      return;
    }
    if (a.entries.length === 0) return;
    try {
      const source = await fileSource(file.path);
      const rows: RecoveredRow[] = [];
      for (const e of a.entries) {
        const bound = await fetchRecoveredProof(e, undefined, { ...lookup, source });
        if (bound === null) continue;
        if (!(TREE_MEMBER_CATEGORIES as readonly string[]).includes(bound.check.category)) continue;
        const proof = bound.proof as unknown as BitGraphProof;
        if (rows.some((r) => r.proof.commit?.counter === proof.commit?.counter && r.proof.commit?.epochId === proof.commit?.epochId)) continue;
        rows.push({ proof, member: { index: e.member.index, count: e.member.count }, tree: true });
      }
      if (rows.length > 0) out.found.set(file.digestB64, rows);
    } catch (e) {
      // An entry says the file is in a tree, and the proof could not be read to check it: unknown, not new.
      out.unknown.set(file.digestB64, e instanceof Error ? e.message : String(e));
    }
  });
  out.failed = out.unknown.size;
  return out;
}

/** Write a made tree's entries. Never throws: a failure is a result with its reason. */
export async function keepRecoveryEntries(
  made: { proof: unknown; rootDocumentHex: string; leavesB64: string; names?: ReadonlyArray<string | null | undefined> },
  config: Pick<ApiConfig, "baseUrl">,
  opts: Omit<RecoveryWriteOptions, "baseUrl"> = {},
): Promise<RecoveryWriteResult> {
  try {
    return await writeRecoveryEntries(
      {
        proof: made.proof as never,
        rootDocument: Uint8Array.from(Buffer.from(made.rootDocumentHex, "hex")),
        leavesBytes: Uint8Array.from(Buffer.from(made.leavesB64, "base64")),
        ...(made.names !== undefined ? { names: made.names } : {}),
      },
      { ...opts, baseUrl: config.baseUrl },
    );
  } catch (e) {
    return {
      entries: 0, kept: 0, written: 0, alreadyThere: 0, salted: 0, blocked: 0, pending: 0,
      reason: `recovery entries were not written: ${(e as Error).message}`,
      state: opts.state ?? { progress: new Uint8Array(0), salts: {} },
      done: false,
    };
  }
}

/** One line for a person: what the entries mean for finding this proof again. */
export function recoveryLine(r: RecoveryWriteResult): string {
  if (r.entries > 0 && r.kept === r.entries) return `each file finds this proof again from its own bytes (${r.entries} sealed entr${r.entries === 1 ? "y" : "ies"} kept)`;
  const parts: string[] = [];
  if (r.pending > 0 || r.entries === 0) parts.push(`not yet recoverable from the files alone: ${r.reason ?? "the entries were not written"}`);
  if (r.blocked > 0) parts.push(`${r.blocked} of ${r.entries} entries are held by other entries under the same file, under both names (SPEC section 13); keep the export`);
  if (parts.length === 0) parts.push(`${r.kept} of ${r.entries} recovery entries kept`);
  return parts.join("; ");
}
