// Copyright (c) 2025-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * Finding a file in a tree through its sealed lookup entry (SPEC section 13).
 *
 * Trees of the tree/1 format index their files by sealed entries rather than
 * by each file's own hash, so a plain lookup cannot see those files. `check`
 * asks the entries too: an entry counts only when its proof is found and the
 * file is verified as that member from its own bytes, streamed. A squatted
 * entry or a proof that is not there finds nothing.
 *
 * A failed read is never a verdict: a file whose lookup did not complete is
 * UNKNOWN, and is reported that way.
 */

import { fetchRecoveredProof, recoverFromDigests, type RecoveryTrust } from "@mikeargento/bitgraph";
import { TREE_MEMBER_CATEGORIES } from "@mikeargento/bitgraph-verify";
import type { ApiConfig } from "./api.js";
import { mapConcurrent } from "./encoding.js";
import { fileSource, type ScannedFile } from "./scan.js";
import type { BitGraphProof, SetMemberView } from "./types.js";

/** A position a file was verified into through its lookup entry: always a tree member. */
export interface RecoveredRow {
  proof: BitGraphProof;
  member: SetMemberView;
  tree: true;
}

export interface RecoveryLookup {
  /** Standard base64 digest to every tree position the file was verified into. */
  found: Map<string, RecoveredRow[]>;
  /** Standard base64 digest to why its lookup did not complete. */
  unknown: Map<string, string>;
  /** unknown.size. */
  failed: number;
}

/** Which proofs a lookup accepts: BitGraph's published images (the default), or the signature and tree alone (BITGRAPH_RECOVERY_TRUST=none, a test seam). */
export function recoveryTrustFromEnv(): RecoveryTrust {
  return process.env["BITGRAPH_RECOVERY_TRUST"] === "none" ? "none" : "published";
}

export interface LookupOptions {
  trust?: RecoveryTrust;
}

/** Ask the sealed lookup entries of the given files, a thousand addresses a request. */
export async function lookupRecovered(files: readonly ScannedFile[], config: Pick<ApiConfig, "baseUrl">, opts: LookupOptions = {}): Promise<RecoveryLookup> {
  const out: RecoveryLookup = { found: new Map(), unknown: new Map(), failed: 0 };
  if (files.length === 0) return out;
  const trust = opts.trust ?? recoveryTrustFromEnv();
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
    const rows: RecoveredRow[] = [];
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
      // An entry says the file is in a tree, and the proof could not be read to check it: unknown, not "no".
      out.unknown.set(file.digestB64, e instanceof Error ? e.message : String(e));
    }
  });
  out.failed = out.unknown.size;
  return out;
}
