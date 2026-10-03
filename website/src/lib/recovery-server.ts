/**
 * Recovery entries the site writes itself (2026-10-03), for the trees the
 * hosted MCP makes. That endpoint already holds every leaf (each caller sends
 * its files' digests to open and commit them), so it seals each member's
 * entries exactly as the drop box does (lib/recovery.ts) and stores them
 * create-only, straight into the store POST /api/recovery writes. Without
 * them, a file recorded through the hosted MCP and later dropped on the site
 * would not be found: a tree member is never indexed by its plain hash.
 *
 * Off unless RECOVERY_WRITES=on, the same switch as the route. Never throws
 * and never stands between a caller and a proof: the tree is made first, and
 * whatever happens here is reported, never raised. An entry already stored
 * counts only when it opens to this same member; a key that holds another
 * member's entry (SPEC section 13, squatting) gets the same entry under its
 * salted name, with a fresh salt (nothing here outlives the request, so a
 * retried request may leave a second salted copy; a reader lists one member
 * once); only a salted name that is held too is blocked.
 */
import { existingEntryHoldsMember, newRecoverySalt, recoveryTreeFrom, sealRecoveryMember, type RecoveryPlaintext, type RecoveryTreeInput, type RecoveryWrite } from "./recovery.ts";
import { recoveryWritesOn, type RecoveryStore } from "./recovery-store.ts";

export interface SiteRecoveryResult {
  /** Entries this tree needs: two per placed member, one per as-is member. */
  entries: number;
  written: number;
  alreadyThere: number;
  /** Of the entries kept, those under a salted name: their deterministic key was held by another member's entry. */
  salted: number;
  blocked: number;
  pending: number;
  /** Why entries are pending, when any are. */
  reason: string | null;
}

export interface SiteRecoveryOptions {
  /** Default: RECOVERY_WRITES=on. */
  writesOn?: boolean;
  /** Conflicts retried per entry. Default 3. */
  conflictRetries?: number;
}

export async function keepTreeOnSite(
  input: RecoveryTreeInput & { names?: ReadonlyArray<string | null | undefined> },
  store: RecoveryStore | (() => RecoveryStore),
  opts: SiteRecoveryOptions = {},
): Promise<SiteRecoveryResult> {
  const result: SiteRecoveryResult = { entries: 0, written: 0, alreadyThere: 0, salted: 0, blocked: 0, pending: 0, reason: null };
  try {
    const tree = recoveryTreeFrom(input);
    const sealed = [];
    for (let i = 0; i < tree.count; i++) sealed.push(await sealRecoveryMember(tree, i, input.names?.[i] ?? null));
    result.entries = sealed.reduce((n, s) => n + s.writes.length, 0);
    if (!(opts.writesOn ?? recoveryWritesOn())) {
      result.pending = result.entries;
      result.reason = "recovery writes are off on this site";
      return result;
    }
    const s = typeof store === "function" ? store() : store;
    const retries = opts.conflictRetries ?? 3;
    const work: Array<{ w: RecoveryWrite; plaintext: RecoveryPlaintext; index: number }> = sealed.flatMap(({ plaintext, writes }, index) => writes.map((w) => ({ w, plaintext, index })));
    // A store that fails once is not asked again this call: the rest stay pending.
    let broken = false;
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(8, work.length) }, async () => {
      while (next < work.length) {
        const { w, plaintext, index } = work[next++]!;
        let done = false;
        for (let attempt = 0; attempt <= retries && !done && !broken; attempt++) {
          try {
            const r = await s.putIfAbsent(w.objectKey, w.envelope);
            if (r.status === "created") {
              result.written++;
              if (w.salted) result.salted++;
              done = true;
            } else if (r.status === "exists") {
              if (await existingEntryHoldsMember(w.digest, w.objectKey, r.envelope, plaintext)) {
                result.alreadyThere++;
                if (w.salted) result.salted++;
              } else if (w.salted) {
                result.blocked++;
              } else {
                // Another member's entry holds the deterministic key: the same entry, under its salted name, joins the work.
                const again = await sealRecoveryMember(tree, index, input.names?.[index] ?? null, [w.side], { [w.side]: newRecoverySalt() });
                for (const sw of again.writes) work.push({ w: sw, plaintext: again.plaintext, index });
              }
              done = true;
            }
          } catch (e) {
            broken = true;
            result.reason = `the recovery store could not be written (${e instanceof Error ? e.message : String(e)})`;
          }
        }
        if (!done) result.pending++;
      }
    }));
    if (result.pending > 0 && result.reason === null) result.reason = "some entries met a concurrent write every time";
  } catch (e) {
    result.pending = result.entries - result.written - result.alreadyThere - result.blocked;
    result.reason = `recovery entries were not written: ${e instanceof Error ? e.message : String(e)}`;
  }
  return result;
}

/** One line for an export's notes: what the entries mean for finding the proof again. */
export function siteRecoveryNote(r: SiteRecoveryResult): string {
  const kept = r.written + r.alreadyThere;
  if (r.entries > 0 && kept === r.entries) return "Each file finds this proof again from its own bytes on bitgraph.ing, even if this export is lost.";
  if (r.blocked > 0) return `${r.blocked} of ${r.entries} recovery entries are held by another tree's member under the same file; keep this export.`;
  return `Not yet recoverable from the files alone (${r.reason ?? "the entries were not written"}); keep this export.`;
}
