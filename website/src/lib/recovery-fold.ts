/**
 * The drop box's recovery lookup (2026-10-03): a dropped file that the ledger
 * does not know may still be a member of a tree/1 BitGraph, because tree
 * members are never indexed by their plain hash. Its sealed recovery entry
 * (lib/recovery.ts) is how it finds its proof again.
 *
 * recoverRows asks for every row still "new" (at most `limit` of them), binds
 * each entry to its proof, and verifies the file as that member before
 * reporting it. It never changes a row itself; the caller turns "new" into
 * "found" with what comes back, and only ever in that direction. A failed
 * read is not a verdict: the row stays "new", and the failure is returned so
 * the caller can say so.
 */
import { TREE_MEMBER_CATEGORIES, base64ToBytes, hexToBytes, type BitGraphProof, type TreeMemberEvidence } from "@mikeargento/bitgraph-verify";
import { fetchRecoveredProof, recoverFromDigest, type FetchLike } from "./recovery.ts";

/** Rows still "new" beyond this count are a first recording, not lost exports: the round trips are skipped. */
export const RECOVERY_LOOKUP_LIMIT = 200;

export interface RecoveryRow {
  status: string;
  digestB64: string;
  file: Blob;
  fromProofJson?: boolean;
}

export interface RecoveredTree {
  /** epochId:counter:artifactDigestB64, one tree position. */
  proofKey: string;
  proof: BitGraphProof;
  rootDocument: Uint8Array;
  rootDocumentHex: string;
  evidence: TreeMemberEvidence;
}

export interface RecoveryFold {
  /** Row index to every tree position the file was verified into, one per position. */
  found: Map<number, RecoveredTree[]>;
  /** Rows whose lookup could not complete (they stay "new"). */
  failed: number;
  /** True when more rows were "new" than the limit, and none were asked. */
  skipped: boolean;
}

export const treePositionKey = (p: { commit?: { epochId?: string; counter?: string }; artifact: { digestB64: string } }): string =>
  `${p.commit?.epochId ?? ""}:${p.commit?.counter ?? ""}:${p.artifact.digestB64}`;

export async function recoverRows(rows: readonly RecoveryRow[], opts: { fetch?: FetchLike; limit?: number; baseUrl?: string } = {}): Promise<RecoveryFold> {
  const out: RecoveryFold = { found: new Map(), failed: 0, skipped: false };
  const unfound = rows.map((r, i) => [r, i] as const).filter(([r]) => r.status === "new" && r.digestB64 && !r.fromProofJson);
  if (unfound.length === 0) return out;
  if (unfound.length > (opts.limit ?? RECOVERY_LOOKUP_LIMIT)) {
    out.skipped = true;
    return out;
  }
  const lookupOpts = opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {};
  await Promise.all(unfound.map(async ([r, i]) => {
    try {
      const digest32 = base64ToBytes(r.digestB64);
      if (digest32 === null || digest32.length !== 32) return;
      const entries = await recoverFromDigest(digest32, opts.fetch, lookupOpts);
      if (!entries.length) return;
      const bytes = new Uint8Array(await r.file.arrayBuffer());
      const trees: RecoveredTree[] = [];
      for (const e of entries) {
        const bound = await fetchRecoveredProof(e, opts.fetch, { ...lookupOpts, bytes });
        if (!bound || !(TREE_MEMBER_CATEGORIES as readonly string[]).includes(bound.check.category)) continue;
        const rootDocument = hexToBytes(e.rootDocument);
        if (rootDocument === null) continue;
        const key = treePositionKey(bound.proof);
        if (trees.some((t) => t.proofKey === key)) continue;
        trees.push({ proofKey: key, proof: bound.proof, rootDocument, rootDocumentHex: e.rootDocument, evidence: e.member });
      }
      if (trees.length) out.found.set(i, trees);
    } catch {
      out.failed++;
    }
  }));
  return out;
}
