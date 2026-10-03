// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * Recovery entries for record (2026-10-03): the same sealed entries the drop
 * box keeps (SPEC section 13), so a file made here is found again from its
 * bytes alone, wherever it is dropped next.
 *
 * A tree member is never indexed by its plain hash, so the ledger's silence is
 * not "new". Before a record calls a file fresh, its entries are asked for
 * (at most RECOVERY_LOOKUP_LIMIT files: more is a first recording, not lost
 * exports). An entry counts only when its proof is found and the file is
 * verified as that member from its own bytes; over the fuse cap, where the
 * bytes are not read again, only a leaf whose committed digest is the file's
 * own counts, because an original would need rebuilding. Anything less (a
 * squatted entry, a proof that cannot be found, a store that cannot be read)
 * leaves the file new: a failed read is never a verdict.
 *
 * After a make, every member's entries are written. That happens after the
 * proof is in hand and never stands in its way; a site that does not take
 * writes yet leaves them pending, and the result says why.
 */

import { readFile } from "node:fs/promises";
import { TREE_MEMBER_CATEGORIES, decodeTreeLeaf, hexToBytes } from "@mikeargento/bitgraph-verify";
import { MAX_FUSE_BYTES, fetchRecoveredProof, recoverFromDigest, writeRecoveryEntries, type RecoveryWriteResult } from "@mikeargento/bitgraph";
import type { ApiConfig } from "./api.js";
import { mapConcurrent } from "./encoding.js";
import type { ScannedFile } from "./scan.js";
import type { BitGraphProof, SetMemberView } from "./types.js";

/** At most this many files the ledger does not know are looked up by their recovery entries before a record; more is a first recording. */
export const RECOVERY_LOOKUP_LIMIT = 200;

/** A position a file was verified into through its recovery entry: always a tree member. */
export interface RecoveredRow {
  proof: BitGraphProof;
  member: SetMemberView;
  tree: true;
}

export interface RecoveryLookup {
  /** Standard base64 digest to every tree position the file was verified into. */
  found: Map<string, RecoveredRow[]>;
  /** Files whose lookup could not complete; they stay new. */
  failed: number;
  /** True when more files were unknown than the limit, and none were asked. */
  skipped: boolean;
}

export type { RecoveryWriteResult };

/** Ask the recovery entries of files the ledger does not know. */
export async function lookupRecovered(files: readonly ScannedFile[], config: Pick<ApiConfig, "baseUrl">, limit = RECOVERY_LOOKUP_LIMIT): Promise<RecoveryLookup> {
  const out: RecoveryLookup = { found: new Map(), failed: 0, skipped: false };
  if (files.length === 0) return out;
  if (files.length > limit) {
    out.skipped = true;
    return out;
  }
  const lookup = { baseUrl: config.baseUrl };
  await mapConcurrent(files, 4, async (file) => {
    try {
      const digest32 = Uint8Array.from(Buffer.from(file.digestB64, "base64"));
      const entries = await recoverFromDigest(digest32, undefined, lookup);
      if (entries.length === 0) return;
      const bytes = file.size <= MAX_FUSE_BYTES ? new Uint8Array(await readFile(file.path)) : undefined;
      const rows: RecoveredRow[] = [];
      for (const e of entries) {
        const bound = await fetchRecoveredProof(e, undefined, bytes !== undefined ? { ...lookup, bytes } : lookup);
        if (bound === null) continue;
        const leafBytes = hexToBytes(e.member.leaf);
        const leaf = leafBytes !== null ? decodeTreeLeaf(leafBytes) : null;
        const isMember = (TREE_MEMBER_CATEGORIES as readonly string[]).includes(bound.check.category)
          || (bytes === undefined && bound.check.category === "TREE_PATH_VALID" && leaf !== null && Buffer.from(leaf.artifact).equals(Buffer.from(digest32)));
        if (!isMember) continue;
        const proof = bound.proof as unknown as BitGraphProof;
        if (rows.some((r) => r.proof.commit?.counter === proof.commit?.counter && r.proof.commit?.epochId === proof.commit?.epochId)) continue;
        rows.push({ proof, member: { index: e.member.index, count: e.member.count }, tree: true });
      }
      if (rows.length > 0) out.found.set(file.digestB64, rows);
    } catch {
      out.failed++;
    }
  });
  return out;
}

/** Write a made tree's entries. Never throws: a failure is a result with its reason. */
export async function keepRecoveryEntries(
  made: { proof: unknown; rootDocumentHex: string; leavesB64: string; names?: ReadonlyArray<string | null | undefined> },
  config: Pick<ApiConfig, "baseUrl">,
): Promise<RecoveryWriteResult> {
  try {
    return await writeRecoveryEntries(
      {
        proof: made.proof as never,
        rootDocument: Uint8Array.from(Buffer.from(made.rootDocumentHex, "hex")),
        leavesBytes: Uint8Array.from(Buffer.from(made.leavesB64, "base64")),
        ...(made.names !== undefined ? { names: made.names } : {}),
      },
      { baseUrl: config.baseUrl },
    );
  } catch (e) {
    return { entries: 0, written: 0, alreadyThere: 0, blocked: 0, pending: 0, reason: `recovery entries were not written: ${(e as Error).message}` };
  }
}

/** One line for a person: what the entries mean for finding this proof again. */
export function recoveryLine(r: RecoveryWriteResult): string {
  const kept = r.written + r.alreadyThere;
  if (r.entries > 0 && kept === r.entries) return `each file finds this proof again from its own bytes (${r.entries} sealed entr${r.entries === 1 ? "y" : "ies"} kept)`;
  const parts: string[] = [];
  if (r.pending > 0 || r.entries === 0) parts.push(`not yet recoverable from the files alone: ${r.reason ?? "the entries were not written"}`);
  if (r.blocked > 0) parts.push(`${r.blocked} of ${r.entries} entries are held by another tree's member under the same file (SPEC section 13); keep the export`);
  if (parts.length === 0) parts.push(`${kept} of ${r.entries} recovery entries kept`);
  return parts.join("; ");
}
