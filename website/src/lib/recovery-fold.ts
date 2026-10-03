/**
 * The drop box's recovery lookup (2026-10-03): a dropped file that the ledger
 * does not know may still be a member of a tree/1 BitGraph, because tree
 * members are never indexed by their plain hash. Its sealed recovery entry
 * (lib/recovery.ts) is how it finds its proof again.
 *
 * recoverRows asks for every row still "new" (a thousand addresses a request:
 * recoverFromDigests), binds each entry to its proof, and verifies the file
 * as that member before reporting it. It never changes a row itself; the
 * caller turns "new" into "found" with what comes back, and only ever in that
 * direction.
 *
 * A failed read is not a verdict, in either direction. A row whose lookup
 * did not complete (the store could not be read, the answer was malformed,
 * the proof route was down) is UNKNOWN: it is not found, and it is not new
 * either, because a member of an earlier tree would look exactly like it.
 * The caller does not make an unknown row without asking (SPEC section 13).
 */
import { TREE_MEMBER_CATEGORIES, base64ToBytes, blobSource, hexToBytes, type BitGraphProof, type TreeMemberEvidence } from "@mikeargento/bitgraph-verify";
import { fetchRecoveredProof, recoverFromDigests, type FetchLike } from "./recovery.ts";

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
  /** Row index to why its lookup did not complete. These rows stay "new" on the surface, but whether they are already in a tree is unknown: not to be made without asking. */
  unknown: Map<number, string>;
  /** unknown.size. */
  failed: number;
}

export const treePositionKey = (p: { commit?: { epochId?: string; counter?: string }; artifact: { digestB64: string } }): string =>
  `${p.commit?.epochId ?? ""}:${p.commit?.counter ?? ""}:${p.artifact.digestB64}`;

export async function recoverRows(rows: readonly RecoveryRow[], opts: { fetch?: FetchLike; baseUrl?: string } = {}): Promise<RecoveryFold> {
  const out: RecoveryFold = { found: new Map(), unknown: new Map(), failed: 0 };
  const unfound = rows.map((r, i) => [r, i] as const).filter(([r]) => r.status === "new" && r.digestB64 && !r.fromProofJson);
  if (unfound.length === 0) return out;
  const lookupOpts = opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {};
  const asked: Array<readonly [RecoveryRow, number]> = [];
  const digests: Uint8Array[] = [];
  for (const [r, i] of unfound) {
    const digest32 = base64ToBytes(r.digestB64);
    if (digest32 === null || digest32.length !== 32) continue;
    asked.push([r, i]);
    digests.push(digest32);
  }
  const answers = await recoverFromDigests(digests, opts.fetch, lookupOpts);
  await Promise.all(asked.map(async ([r, i], k) => {
    const a = answers[k]!;
    if (!a.ok) {
      out.unknown.set(i, a.reason);
      return;
    }
    if (a.entries.length === 0) return;
    try {
      // The file is checked as a stream: a 40 GB file is a 40 GB file.
      const source = blobSource(r.file);
      const trees: RecoveredTree[] = [];
      for (const e of a.entries) {
        const bound = await fetchRecoveredProof(e, opts.fetch, { ...lookupOpts, source });
        if (!bound || !(TREE_MEMBER_CATEGORIES as readonly string[]).includes(bound.check.category)) continue;
        const rootDocument = hexToBytes(e.rootDocument);
        if (rootDocument === null) continue;
        const key = treePositionKey(bound.proof);
        if (trees.some((t) => t.proofKey === key)) continue;
        trees.push({ proofKey: key, proof: bound.proof, rootDocument, rootDocumentHex: e.rootDocument, evidence: e.member });
      }
      if (trees.length) out.found.set(i, trees);
    } catch (e) {
      // An entry says the file is in a tree, and the proof could not be read to check it: unknown, not new.
      out.unknown.set(i, e instanceof Error ? e.message : String(e));
    }
  }));
  out.failed = out.unknown.size;
  return out;
}
