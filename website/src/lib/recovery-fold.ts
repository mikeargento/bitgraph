/**
 * The drop box's recovery lookup (2026-10-03): a dropped file that the ledger
 * does not know may still be a member of a tree/1 BitGraph, because tree
 * members are never indexed by their plain hash. Its sealed recovery entry
 * (lib/recovery.ts) is how it finds its proof again.
 *
 * recoverRows asks for every row that has bytes, found or new (a thousand
 * addresses a request: recoverFromDigests), binds each entry to its proof, and
 * verifies the file as that member before reporting it. It never changes a
 * row itself; the caller turns "new" into "found" with what comes back, and
 * ADDS a tree position to a row the plain index already found (a file can hold
 * an older solo position and a tree position), only ever in that direction.
 *
 * A failed read is not a verdict, in either direction. A row whose lookup
 * did not complete (the store could not be read, the answer was malformed,
 * the proof route was down) is UNKNOWN: it is not found, and it is not new
 * either, because a member of an earlier tree would look exactly like it.
 * The caller does not make an unknown row without asking (SPEC section 13).
 *
 * Trees this browser made whose entries are not written yet (a closed tab, a
 * site that took no writes) are asked too, through `local`: their members are
 * on record, and the store does not know it yet.
 */
import { TREE_MEMBER_CATEGORIES, base64ToBytes, blobSource, hexToBytes, type BitGraphProof, type TreeMemberEvidence } from "@mikeargento/bitgraph-verify";
import { fetchRecoveredProof, recoverFromDigests, type FetchLike, type RecoveredEntry } from "./recovery.ts";

/** An entry this browser still owes (recovery-queue.ts, localEntriesFor): a tree made here whose writes are not all in. */
export type LocalEntry = Omit<RecoveredEntry, "objectKey" | "entryId">;

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

/**
 * How many files' lookups are asked together, and how many such groups at once
 * (2026-10-07: a 50,000-file drop sat on "Checking 50000 of 50000" for minutes:
 * the lookup had no progress of its own, and every file's local-record read was
 * started at once). One group is one batch POST (MAX_LOOKUP_ADDRESSES), measured
 * at about 3.4 s on production for 1,000 addresses.
 */
export const RECOVERY_GROUP = 1000;
export const RECOVERY_GROUPS_IN_FLIGHT = 8;

export async function recoverRows(rows: readonly RecoveryRow[], opts: { fetch?: FetchLike; baseUrl?: string; local?: (digest32: Uint8Array) => Promise<LocalEntry[]>; trust?: "published" | "none"; onProgress?: (done: number, total: number) => void } = {}): Promise<RecoveryFold> {
  const out: RecoveryFold = { found: new Map(), unknown: new Map(), failed: 0 };
  // EVERY file with bytes is asked, found or new (2026-10-04). Until then only "new" rows were
  // asked, so a file that already held an older solo position was never asked about its tree:
  // its tree position went unlisted and its export went out without its place (the website
  // twin of the SDK check defect fixed the same day). A row already found stays found whatever
  // the lookup says; the caller ADDS the tree positions to the ones it has.
  const unfound = rows.map((r, i) => [r, i] as const).filter(([r]) => r.digestB64 && !r.fromProofJson);
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
  // Groups of RECOVERY_GROUP files, RECOVERY_GROUPS_IN_FLIGHT at a time: each group is one lookup
  // POST, then its files' local reads one after another, so neither the server nor this tab's
  // own records are asked for everything at once, and progress moves with every group.
  const total = asked.length;
  let done = 0;
  let next = 0;
  opts.onProgress?.(0, total);
  const worker = async (): Promise<void> => {
    while (next < total) {
      const from = next;
      const to = Math.min(total, from + RECOVERY_GROUP);
      next = to;
      const answers = await recoverFromDigests(digests.slice(from, to), opts.fetch, lookupOpts);
      for (let k = from; k < to; k++) await foldRow(asked[k]![0], asked[k]![1], k, answers[k - from]!);
      done += to - from;
      opts.onProgress?.(done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(RECOVERY_GROUPS_IN_FLIGHT, Math.ceil(total / RECOVERY_GROUP)) }, worker));
  out.failed = out.unknown.size;
  return out;

  async function foldRow(r: RecoveryRow, i: number, k: number, a: Awaited<ReturnType<typeof recoverFromDigests>>[number]): Promise<void> {
    // What this browser still owes comes first: those trees are on record whatever the store says.
    // Its own records that cannot be read are an unknown of their own, never an empty history.
    let local: LocalEntry[] = [];
    let localFailure: string | null = null;
    try {
      local = opts.local !== undefined ? await opts.local(digests[k]!) : [];
    } catch (e) {
      localFailure = `this browser's own pending records could not be read (${e instanceof Error ? e.message : String(e)})`;
    }
    if (localFailure !== null) {
      out.unknown.set(i, localFailure);
      if (!a.ok || a.entries.length === 0) return;
    }
    if (!a.ok && local.length === 0) {
      out.unknown.set(i, a.reason);
      return;
    }
    const entries: LocalEntry[] = [...local, ...(a.ok ? a.entries : [])];
    if (entries.length === 0) return;
    try {
      // The file is checked as a stream: a 40 GB file is a 40 GB file.
      const source = blobSource(r.file);
      const trees: RecoveredTree[] = [];
      // A failed server lookup is unknown unless a local entry verifies below: "could not tell" is never "new".
      if (!a.ok) out.unknown.set(i, a.reason);
      if (localFailure !== null) out.unknown.set(i, localFailure);
      for (const e of entries) {
        const bound = await fetchRecoveredProof(e, opts.fetch, { ...lookupOpts, source, ...(opts.trust !== undefined ? { trust: opts.trust } : {}) });
        if (!bound || !(TREE_MEMBER_CATEGORIES as readonly string[]).includes(bound.check.category)) continue;
        const rootDocument = hexToBytes(e.rootDocument);
        if (rootDocument === null) continue;
        const key = treePositionKey(bound.proof);
        if (trees.some((t) => t.proofKey === key)) continue;
        trees.push({ proofKey: key, proof: bound.proof, rootDocument, rootDocumentHex: e.rootDocument, evidence: e.member });
        out.found.set(i, trees);
        out.unknown.delete(i);
      }
      if (trees.length) {
        out.found.set(i, trees);
        out.unknown.delete(i);
      }
    } catch (e) {
      // An entry says the file is in a tree, and the proof could not be read to check it: unknown, not new.
      // A member already verified above still stands: a verified match wins over an unfinished discovery.
      if (out.found.has(i)) return;
      out.unknown.set(i, e instanceof Error ? e.message : String(e));
    }
  }
}
