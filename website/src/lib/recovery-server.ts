/**
 * Recovery entries the site writes itself (2026-10-03), for the trees the
 * hosted MCP makes, and the site's own reading of them. That endpoint already
 * holds every leaf (each caller sends its files' digests to open and commit
 * them), so it seals each member's entries exactly as the drop box does
 * (lib/recovery.ts) and stores them create-only, straight into the store
 * POST /api/recovery writes. Without them, a file recorded through the hosted
 * MCP and later dropped on the site would not be found: a tree member is
 * never indexed by its plain hash.
 *
 * Off unless RECOVERY_WRITES=on, the same switch as the route. Never throws
 * and never stands between a caller and a proof: the tree is made first, and
 * whatever happens here is reported, never raised. An entry already stored
 * counts only when it opens to this same member; a key that holds another
 * member's entry (SPEC section 13, squatting) gets the same entry under its
 * salted name, with a fresh salt (nothing here outlives the request, so a
 * retried request may leave a second salted copy; a reader lists one member
 * once); only a salted name that is held too is blocked.
 *
 * A BUDGET, AND THE REST AFTER THE ANSWER. A hosted tree can have thousands
 * of members, and the route answers inside a deadline, so keepTreeOnSite
 * takes a time budget and returns the progress it reached (the same bytes
 * and salts every writer resumes from); the route hands the remainder to
 * Next's after(), which runs once the answer is sent. That continuation is
 * not durable (a function that dies loses it), and the export is the record
 * either way: the note on the export says so.
 */
import { TREE_MEMBER_CATEGORIES, type BitGraphProof, type TreeMemberEvidence } from "@mikeargento/bitgraph-verify";
import {
  RECOVERY_SIDE_BITS,
  existingEntryHoldsMember,
  fetchRecoveredProof,
  findOwnRecoveryEntry,
  newRecoverySalt,
  recoverFromDigests,
  recoverySaltKey,
  recoverySaltsFor,
  recoverySideResolved,
  recoverySidesOf,
  recoveryTreeFrom,
  sealRecoveryMember,
  type FetchLike,
  type RecoveryPlaintext,
  type RecoveryTreeInput,
  type RecoveryWrite,
} from "./recovery.ts";
import { handleRecoveryList, handleRecoveryLookup, recoveryWritesOn, type RecoveryStore } from "./recovery-store.ts";

/** What a writer keeps between runs: one progress byte per member (RECOVERY_SIDE_BITS) and the salts chosen, base64 by recoverySaltKey. */
export interface SiteRecoveryState {
  progress: Uint8Array;
  salts: Record<string, string>;
}

export interface SiteRecoveryResult {
  /** Entries this tree needs: two per placed member, one per as-is member. */
  entries: number;
  /** Kept when this call ended: written now, or already stored as this member, in this call or an earlier one. */
  kept: number;
  written: number;
  alreadyThere: number;
  /** Of the entries kept, those under a salted name: their deterministic key was held by another member's entry. */
  salted: number;
  blocked: number;
  pending: number;
  /** Why entries are pending, when any are. */
  reason: string | null;
  /** The progress reached, to resume from. */
  state: SiteRecoveryState;
  /** Every entry is kept or blocked. */
  done: boolean;
}

export interface SiteRecoveryOptions {
  /** Default: RECOVERY_WRITES=on. */
  writesOn?: boolean;
  /** Conflicts retried per entry. Default 3. */
  conflictRetries?: number;
  /** Milliseconds this call may spend; the rest is reported pending with BUDGET_REASON and resumes from `state`. Default: no budget. */
  budgetMs?: number;
  /** An earlier call's progress to resume from. */
  state?: SiteRecoveryState;
}

/** The reason on a result that stopped at its budget: the route continues it after the answer. */
export const BUDGET_REASON = "the rest is being written after this answer";

export async function keepTreeOnSite(
  input: RecoveryTreeInput & { names?: ReadonlyArray<string | null | undefined> },
  store: RecoveryStore | (() => RecoveryStore),
  opts: SiteRecoveryOptions = {},
): Promise<SiteRecoveryResult> {
  const result: SiteRecoveryResult = { entries: 0, kept: 0, written: 0, alreadyThere: 0, salted: 0, blocked: 0, pending: 0, reason: null, state: { progress: new Uint8Array(0), salts: {} }, done: false };
  const deadline = opts.budgetMs !== undefined ? Date.now() + opts.budgetMs : Infinity;
  try {
    const tree = recoveryTreeFrom(input);
    const progress = new Uint8Array(tree.count);
    if (opts.state?.progress !== undefined) progress.set(opts.state.progress.subarray(0, tree.count));
    const salts: Record<string, string> = { ...(opts.state?.salts ?? {}) };
    result.state = { progress, salts };
    const settle = (): void => {
      let entries = 0;
      let kept = 0;
      let salted = 0;
      let blocked = 0;
      for (let i = 0; i < tree.count; i++) {
        for (const side of recoverySidesOf(tree, i)) {
          entries++;
          const bits = RECOVERY_SIDE_BITS[side];
          if ((progress[i]! & bits.kept) === bits.kept) {
            kept++;
            if (salts[recoverySaltKey(i, side)] !== undefined) salted++;
          } else if ((progress[i]! & bits.blocked) === bits.blocked) blocked++;
        }
      }
      result.entries = entries;
      result.kept = kept;
      result.salted = salted;
      result.blocked = blocked;
      result.pending = entries - kept - blocked;
      result.done = result.pending === 0;
    };
    settle();
    if (result.done) return result;
    if (!(opts.writesOn ?? recoveryWritesOn())) {
      result.reason = "recovery writes are off on this site";
      return result;
    }
    const s = typeof store === "function" ? store() : store;
    const retries = opts.conflictRetries ?? 3;
    // The site reading its own store, for the look before a salted write.
    const lookupFetch = inProcessRecoveryFetch(s, async () => []);
    // The pending sides of every member, sealed as the work reaches them (a
    // thousand members are two thousand envelopes; not all at once).
    const members: number[] = [];
    for (let i = 0; i < tree.count; i++) if (recoverySidesOf(tree, i).some((side) => !recoverySideResolved(progress[i]!, side))) members.push(i);
    const work: Array<{ w: RecoveryWrite; plaintext: RecoveryPlaintext; index: number }> = [];
    let nextMember = 0;
    let broken = false;
    let outOfTime = false;
    const take = async (): Promise<{ w: RecoveryWrite; plaintext: RecoveryPlaintext; index: number } | null> => {
      while (work.length === 0 && nextMember < members.length) {
        const i = members[nextMember++]!;
        const sides = recoverySidesOf(tree, i).filter((side) => !recoverySideResolved(progress[i]!, side));
        const { plaintext, writes } = await sealRecoveryMember(tree, i, input.names?.[i] ?? null, sides, recoverySaltsFor(salts, i));
        for (const w of writes) work.push({ w, plaintext, index: i });
      }
      return work.shift() ?? null;
    };
    await Promise.all(Array.from({ length: 8 }, async () => {
      for (;;) {
        if (broken || outOfTime) return;
        if (Date.now() > deadline) {
          outOfTime = true;
          return;
        }
        const item = await take();
        if (item === null) return;
        const { w, plaintext, index } = item;
        const bits = RECOVERY_SIDE_BITS[w.side];
        for (let attempt = 0; attempt <= retries && !broken; attempt++) {
          try {
            const r = await s.putIfAbsent(w.objectKey, w.envelope);
            if (r.status === "created") {
              progress[index]! |= bits.kept;
              result.written++;
              break;
            } else if (r.status === "exists") {
              if (await existingEntryHoldsMember(w.digest, w.objectKey, r.envelope, plaintext)) {
                progress[index]! |= bits.kept;
                result.alreadyThere++;
              } else if (w.salted) {
                progress[index]! |= bits.blocked;
              } else {
                // Another member's entry holds the deterministic key. An entry
                // of this member may already sit under a salted name (an
                // earlier request that answered before finishing): found, it
                // counts and its salt is kept; an address that cannot be read
                // leaves the side pending; otherwise the same entry, under a
                // fresh salted name, joins the work.
                let own: Awaited<ReturnType<typeof findOwnRecoveryEntry>> | undefined;
                try {
                  own = await findOwnRecoveryEntry(w.digest, plaintext, lookupFetch);
                } catch {
                  own = undefined;
                }
                if (own === undefined) {
                  result.reason ??= "an address could not be read before a salted write";
                } else if (own !== null) {
                  progress[index]! |= bits.kept;
                  result.alreadyThere++;
                  if (own.salt !== null) salts[recoverySaltKey(index, w.side)] = Buffer.from(own.salt).toString("base64");
                } else {
                  const salt = newRecoverySalt();
                  salts[recoverySaltKey(index, w.side)] = Buffer.from(salt).toString("base64");
                  const again = await sealRecoveryMember(tree, index, input.names?.[index] ?? null, [w.side], { [w.side]: salt });
                  for (const sw of again.writes) work.push({ w: sw, plaintext: again.plaintext, index });
                }
              }
              break;
            }
            // "conflict": try again, a few times.
          } catch (e) {
            broken = true;
            result.reason = `the recovery store could not be written (${e instanceof Error ? e.message : String(e)})`;
          }
        }
      }
    }));
    const earlier = result.reason;
    settle();
    if (result.pending > 0 && result.reason === null) result.reason = outOfTime ? BUDGET_REASON : "some entries met a concurrent write every time";
    if (result.pending === 0) result.reason = null;
    else if (outOfTime) result.reason = BUDGET_REASON;
    else if (earlier !== null) result.reason = earlier;
  } catch (e) {
    result.reason = `recovery entries were not written: ${e instanceof Error ? e.message : String(e)}`;
    result.pending = Math.max(0, result.entries - result.kept - result.blocked);
    result.done = false;
  }
  return result;
}

/** One line for an export's notes: what the entries mean for finding the proof again. */
export function siteRecoveryNote(r: SiteRecoveryResult): string {
  if (r.entries > 0 && r.kept === r.entries) return "Each file finds this proof again from its own bytes on bitgraph.ing, even if this export is lost.";
  if (r.reason === BUDGET_REASON) return `${r.kept} of ${r.entries} recovery entries are written; the rest are being written after this answer. Keep this export: it is the record either way.`;
  if (r.blocked > 0 && r.pending === 0) return `${r.blocked} of ${r.entries} recovery entries are held by other entries under the same file, under both names; keep this export.`;
  return `Not yet recoverable from the files alone (${r.reason ?? "the entries were not written"}); keep this export.`;
}

// ---------------------------------------------------------------------------
// The site reading its own entries: a file's digest, on the hosted MCP, is
// enough to find the tree it is already in (no bytes, so TREE_PATH_VALID is
// the most a member can show; the proof is the ledger's and bound by hash).
// ---------------------------------------------------------------------------

export interface SiteRecovered {
  proof: BitGraphProof;
  member: TreeMemberEvidence;
  rootDocumentHex: string;
}

export interface SiteRecoveryLookup {
  /** Standard base64 digest to the tree positions it was found in (one per recording). */
  found: Map<string, SiteRecovered[]>;
  /** Standard base64 digest to why its lookup did not complete: whether it is already in a tree is unknown. */
  unknown: Map<string, string>;
}

/**
 * A fetch that never leaves the process: the recovery routes are their
 * handlers over `store`, and GET /api/proofs/<digest> is `proofsByDigest`
 * (the ledger's by-digest read). recoverFromDigests and fetchRecoveredProof
 * then run exactly as they do in a browser.
 */
export function inProcessRecoveryFetch(store: RecoveryStore, proofsByDigest: (urlSafeDigest: string) => Promise<unknown[]>): FetchLike {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  return async (input, init) => {
    const url = new URL(input, "https://bitgraph.local");
    if (url.pathname === "/api/recovery/lookup" && init?.method === "POST") {
      const r = await handleRecoveryLookup(String(init.body), store, { log: () => {} });
      return json(r.status, r.body);
    }
    const listed = /^\/api\/recovery\/([0-9a-f]{64})$/.exec(url.pathname);
    if (listed) {
      const r = await handleRecoveryList(listed[1]!, url.searchParams, store);
      return json(r.status, r.body);
    }
    const proofs = /^\/api\/proofs\/([^/]+)$/.exec(url.pathname);
    if (proofs) {
      try {
        return json(200, { proofs: (await proofsByDigest(decodeURIComponent(proofs[1]!))).map((proof) => ({ proof })) });
      } catch (e) {
        return json(503, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    return json(404, { error: "not found" });
  };
}

/**
 * The trees these digests are already members of, by their recovery entries,
 * read in this process. With no bytes in hand the most a member can show is a
 * valid path from a leaf naming the digest to the signed root
 * (TREE_PATH_VALID): "these bytes are named by a recorded tree", the same
 * strength as the ledger's index of set members. Never throws.
 */
export async function recoveredOnSite(digestsB64: readonly string[], fetchFn: FetchLike): Promise<SiteRecoveryLookup> {
  const out: SiteRecoveryLookup = { found: new Map(), unknown: new Map() };
  const digests: Uint8Array[] = [];
  const kept: string[] = [];
  for (const d of digestsB64) {
    const bytes = Buffer.from(d, "base64");
    if (bytes.length !== 32) continue;
    digests.push(new Uint8Array(bytes));
    kept.push(d);
  }
  if (digests.length === 0) return out;
  let answers;
  try {
    answers = await recoverFromDigests(digests, fetchFn);
  } catch (e) {
    for (const d of kept) out.unknown.set(d, e instanceof Error ? e.message : String(e));
    return out;
  }
  await Promise.all(kept.map(async (d, k) => {
    const a = answers[k]!;
    if (!a.ok) {
      out.unknown.set(d, a.reason);
      return;
    }
    if (a.entries.length === 0) return;
    try {
      const trees: SiteRecovered[] = [];
      for (const e of a.entries) {
        const bound = await fetchRecoveredProof(e, fetchFn);
        if (!bound) continue;
        if (bound.check.category !== "TREE_PATH_VALID" && !(TREE_MEMBER_CATEGORIES as readonly string[]).includes(bound.check.category)) continue;
        const key = `${bound.proof.commit?.epochId ?? ""}:${bound.proof.commit?.counter ?? ""}`;
        if (trees.some((t) => `${t.proof.commit?.epochId ?? ""}:${t.proof.commit?.counter ?? ""}` === key)) continue;
        trees.push({ proof: bound.proof, member: e.member, rootDocumentHex: e.rootDocument });
      }
      if (trees.length > 0) out.found.set(d, trees);
    } catch (e) {
      out.unknown.set(d, e instanceof Error ? e.message : String(e));
    }
  }));
  return out;
}
