/**
 * A set's members, listed once, so checking a set is not N lookups.
 *
 * ⚠️ WHY THIS EXISTS. A set/2 is ONE position for N files, and until now
 * checking those N files cost N lookups: `indexSetMemberEvidence` writes one
 * key per member under `by-digest/`, each holding the WHOLE set proof plus
 * that member's evidence. So a re-drop of a 48,000 file folder was 48,000
 * listings and ~104,000 reads, about 152,000 S3 operations, measured at 70s
 * against production on 2026-09-07 while the same folder checked in 4.0s
 * before it was recorded. One position, answered 48,000 separate times.
 *
 * Mike's read of it (2026-09-07) is the fix: "look up the FIRST available
 * proof and if it's in a big group it looks up the rest by logic". A probe
 * finds one member, the member names its set, and the set's list answers
 * every other file in the drop from memory. ~20 reads instead of 152,000.
 *
 * ⚠️ THIS IS AN INDEX, NEVER THE TRUTH. The per-digest keys stay exactly as
 * they are and remain the only thing a proof is read from. A list that is
 * missing, truncated, stale or unreadable must cost nothing but speed: every
 * digest it does not answer falls through to the lookup it has always had.
 * Nothing here may turn absence into a verdict — a digest that is not in a
 * list is not "not recorded", it is "not answered here".
 *
 * Layout, one object per chunk:
 *   set-members/{epochId}/{counter}/{chunk}.json
 *   { v, setDigest, epochId, counter, count, writeTime, from, entries }
 * where each entry is [digest (url-safe), kind ("m" set-member | "f"
 * fused-descendant), index]. A member contributes up to TWO entries, its
 * fused bytes and its origin, which is why a 48,000 file set lists ~96,000.
 */

/** Entries per stored chunk. ~55 bytes each, so a chunk is roughly 275 KB. */
export const SET_MEMBER_CHUNK = 5_000;
/** Current list format. A reader refuses anything else rather than guessing. */
export const SET_MEMBER_VERSION = 1;

export type MemberKind = "set-member" | "fused-descendant";

export interface SetMemberRef {
  setDigest: string;
  epochId: string;
  counter: string;
  kind: MemberKind;
  index: number;
  count: number;
  /** When the set's position was written, ms. Shared: the members were written together. */
  writeTime: number | null;
}

interface Chunk {
  v: number;
  setDigest: string;
  epochId: string;
  counter: string;
  count: number;
  writeTime: number | null;
  from: number;
  entries: Array<[string, "m" | "f", number]>;
}

/**
 * ⚠️ EVERY EPOCH THAT REACHES THIS MODULE IS NORMALISED, at the boundary.
 *
 * A proof's `commit.epochId` is STANDARD base64 ("P1IPCIeBd/gbBGJ...="), and
 * the ledger's keys use the url-safe spelling ("P1IPCIeBd_gbBGJ..."), the way
 * writeMemberKeys stamps them. Passing the proof's spelling through built a
 * prefix that could never match, and the "/" in it silently invented an extra
 * path segment. Same failure as the digest filter holding two spellings of
 * one digest (2026-09-07): one canonical form, applied where values come in,
 * is the only thing that keeps it from coming back.
 */
export function setMembersPrefix(epochId: string, counter: string): string {
  return `set-members/${toSafe(epochId)}/${counter}/`;
}
export function setMembersKey(epochId: string, counter: string, chunk: number): string {
  return `${setMembersPrefix(epochId, counter)}${String(chunk).padStart(6, "0")}.json`;
}

/** Serialize one chunk. Kept tiny on purpose: this is read whole, often. */
export function encodeChunk(
  meta: { setDigest: string; epochId: string; counter: string; count: number; writeTime: number | null },
  entries: Array<{ digestB64: string; kind: MemberKind; index: number }>,
  from: number,
): string {
  const c: Chunk = {
    v: SET_MEMBER_VERSION,
    setDigest: meta.setDigest,
    epochId: toSafe(meta.epochId),
    counter: String(meta.counter),
    count: meta.count,
    writeTime: meta.writeTime,
    from,
    entries: entries.map((e) => [toSafe(e.digestB64), e.kind === "set-member" ? "m" : "f", e.index]),
  };
  return JSON.stringify(c);
}

/**
 * Read one chunk into `into`, keyed by url-safe digest.
 *
 * Returns false for anything it does not fully understand — a bad version, a
 * shape that does not parse, a chunk naming a different position — and adds
 * nothing in that case. A partial list is allowed (the caller falls back per
 * digest); a MISLEADING one is not.
 */
export function decodeChunkInto(
  text: string,
  expect: { epochId: string; counter: string },
  into: Map<string, SetMemberRef>,
): boolean {
  let c: Chunk;
  try {
    c = JSON.parse(text) as Chunk;
  } catch {
    return false;
  }
  if (c?.v !== SET_MEMBER_VERSION || !Array.isArray(c.entries)) return false;
  if (toSafe(c.epochId) !== toSafe(expect.epochId) || String(c.counter) !== String(expect.counter)) return false;
  if (typeof c.setDigest !== "string" || typeof c.count !== "number") return false;
  for (const e of c.entries) {
    if (!Array.isArray(e) || e.length !== 3) continue;
    const [d, k, i] = e;
    if (typeof d !== "string" || (k !== "m" && k !== "f") || typeof i !== "number") continue;
    // First writer wins: a digest listed twice keeps the earlier position.
    if (into.has(d)) continue;
    into.set(d, {
      setDigest: c.setDigest,
      epochId: toSafe(c.epochId),
      counter: String(c.counter),
      kind: k === "m" ? "set-member" : "fused-descendant",
      index: i,
      count: c.count,
      writeTime: typeof c.writeTime === "number" ? c.writeTime : null,
    });
  }
  return true;
}

export function toSafe(d: string): string {
  return d.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * A member entry's proof IS its set's, so send it once and name it.
 *
 * ⚠️ Reference equality on purpose. Only an entry the member-list resolver
 * built holds the very object in `sets`; one that was genuinely READ has its
 * own parsed copy and is left alone, because two proofs that merely look
 * alike are not something this may assume. Nothing is lifted unless the set
 * it names is actually in the table to put back.
 */
export function liftSetProofs(
  results: Record<string, { proofs?: Array<{ proof?: unknown; setDigest?: string; setRef?: string }> } | undefined>,
  sets: Record<string, unknown>,
): number {
  let lifted = 0;
  for (const r of Object.values(results)) {
    for (const e of r?.proofs ?? []) {
      if (!e.setDigest || e.proof === undefined) continue;
      if (sets[e.setDigest] !== e.proof) continue;
      delete e.proof;
      e.setRef = e.setDigest;
      lifted++;
    }
  }
  return lifted;
}

/**
 * Put each lifted proof back from the side table, in place.
 *
 * An entry naming a set the answer did not carry is left WITHOUT a proof
 * rather than given a wrong one: a row with no proof shows as much, where a
 * substituted one would be a false claim about which position these bytes
 * hold.
 */
export function attachSetProofs(
  results: Record<string, { proofs?: Array<{ proof?: unknown; setRef?: string }> } | undefined>,
  sets: Record<string, unknown> | undefined,
): { attached: number; unresolved: number } {
  let attached = 0;
  let unresolved = 0;
  for (const r of Object.values(results)) {
    for (const e of r?.proofs ?? []) {
      if (typeof e.setRef !== "string") continue;
      const proof = sets?.[e.setRef];
      if (proof === undefined || proof === null) {
        unresolved++;
        continue;
      }
      e.proof = proof;
      delete e.setRef;
      attached++;
    }
  }
  return { attached, unresolved };
}
