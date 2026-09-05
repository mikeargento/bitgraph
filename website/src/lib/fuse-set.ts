/**
 * BitGraph sets on the site (placement set/1): the one module every reader
 * of a set proof shares. A set is N files fused under ONE slot; the committed
 * artifact is the canonical manifest of member digests, carried UNSIGNED
 * under proof.metadata["bitgraph-fuse/1"] and protected only by hashing to
 * the signed artifact digest. Nothing here reads a row before that binding
 * holds, except parseSetOf, which serves display counts and says so.
 *
 * Isomorphic on purpose: only @mikeargento/bitgraph-verify is imported,
 * SHA-256 comes from globalThis.crypto.subtle, and nothing touches Next,
 * Buffer, window or the ledger, so the commit route, the by-digest index,
 * the camera, the proof page and the skeptic's drop all branch on the same
 * predicate and bind through the same function.
 */
import type { BitGraphProof, SetManifest, SetMemberProof, SetRoot, SlotAllocation } from "@mikeargento/bitgraph-verify";
import { bytesEqual, bytesToBase64, bytesToHex, computeSlotCommitment, parseSetManifest, parseSetMemberProof, parseSetRoot, readSetMetadata, setRootFromMember, MAX_SET2_MEMBERS, SET2_PLACEMENT_ID, SET_MEMBER_METADATA_KEY } from "@mikeargento/bitgraph-verify";

/** The signed placement id of a set/1 proof (attribution.title). Pinned; the suite checks it equals SET_PLACEMENT_ID. */
export const SET_TITLE = "set/1";
/** The signed placement id of a set/2 proof: a Merkle root over the rows instead of the list. Pinned to SET2_PLACEMENT_ID. */
export const SET2_TITLE: typeof SET2_PLACEMENT_ID = "set/2";
/** The unsigned metadata key a member's evidence (row, index, count, path) rides under beside a set/2 root document. */
export const SET_MEMBER_KEY: typeof SET_MEMBER_METADATA_KEY = "bitgraph-fuse/1/member";
/** The most rows one set-index request carries: ~2.2 MB of evidence with hex paths, under the platform's request cap. */
export const SET_INDEX_CHUNK = 2500;
/** Rows of member evidence a set/2 commit may leave to index later; pinned to MAX_SET2_MEMBERS. */
export const MAX_SET2_ROWS = MAX_SET2_MEMBERS;
/** The metadata key the manifest rides under, which is also the signed attribution name. Pinned; equals SET_METADATA_KEY. */
export const SET_KEY = "bitgraph-fuse/1";
/** Pinned; the suite checks it equals the core's MAX_SET_MEMBERS. */
export const MAX_SET_MEMBERS = 2000;
/** Cap on JSON.stringify(body.metadata).length, applied before any canonicalization. */
export const MAX_SET_METADATA_JSON = 600_000;
/** The member placements a site reader can rebuild; a row under any other id is refused at the route. */
export const SET_MEMBER_PLACEMENTS = ["trailer/1", "container/1", "container/2"] as const;

export interface SetMemberRow {
  /** Ordinal in the CANONICAL manifest (fuseSet's manifestIndex), never input order. */
  index: number;
  count: number;
  /** Standard base64. */
  originDigestB64: string;
  /** Standard base64. */
  fusedDigestB64: string;
  placement: string;
}

export interface BoundSet {
  kind: "set/1" | "set/2";
  /** The canonical bytes that hash to the signed artifact digest: the set/1 manifest, or the set/2 root document. */
  bytes: Uint8Array;
  manifest: SetManifest | SetRoot;
  /** The set's member count. */
  count: number;
  /** set/1: every row in manifest order. set/2: empty; a member is known only through its evidence (see bindSetMember). */
  members: SetMemberRow[];
  /** set/2 only: the tree root. */
  root: Uint8Array | null;
}

const HEX_64 = /^[0-9a-f]{64}$/;

function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

const keysOf = (x: object): string => Object.keys(x).sort().join(",");

/** { algorithm: "sha256", digest: <64 lowercase hex> } and nothing else. */
function isDigestField(x: unknown): boolean {
  return isPlainObject(x) && keysOf(x) === "algorithm,digest" && x.algorithm === "sha256" && typeof x.digest === "string" && HEX_64.test(x.digest);
}

const asVerify = (proof: Record<string, unknown>): BitGraphProof => proof as unknown as BitGraphProof;

async function sha256B64(bytes: Uint8Array): Promise<string> {
  return bytesToBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)));
}

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

function rowsOf(members: readonly { artifact: Uint8Array; origin: Uint8Array; placement: string }[]): SetMemberRow[] {
  return members.map((m, index) => ({
    index,
    count: members.length,
    originDigestB64: bytesToBase64(m.origin),
    fusedDigestB64: bytesToBase64(m.artifact),
    placement: m.placement,
  }));
}

/** Which set kind the SIGNED attribution declares: "set/1", "set/2", or null for anything else. Nothing unsigned decides this. */
export function setKindOf(proof: { attribution?: unknown } | null | undefined): "set/1" | "set/2" | null {
  const a = proof?.attribution;
  if (typeof a !== "object" || a === null || (a as { name?: unknown }).name !== SET_KEY) return null;
  const title = (a as { title?: unknown }).title;
  return title === SET_TITLE ? "set/1" : title === SET2_TITLE ? "set/2" : null;
}

/** Signed marker only: a set/1 or set/2 proof. */
export function isSetProof(proof: { attribution?: unknown } | null | undefined): boolean {
  return setKindOf(proof) !== null;
}

/**
 * Lenient, sync, no hash: the rows the proof's metadata manifest lists, in
 * manifest order, or null when there is none or it is not canonical.
 * UNBOUND: nothing here checks that the bytes hash to the signed digest, so
 * this serves DISPLAY COUNTS only (the Ledger row's label). Membership goes
 * through bindSet.
 */
export function parseSetOf(proof: Record<string, unknown>): { kind: "set/1" | "set/2"; commitmentHex: string; count: number; members: SetMemberRow[] } | null {
  const bytes = readSetMetadata(asVerify(proof));
  if (bytes === null) return null;
  if (setKindOf(proof) === "set/2") {
    const doc = parseSetRoot(bytes);
    if (doc === null) return null;
    return { kind: "set/2", commitmentHex: bytesToHex(doc.commitment), count: doc.count, members: [] };
  }
  const parsed = parseSetManifest(bytes);
  if (parsed === null) return null;
  return { kind: "set/1", commitmentHex: bytesToHex(parsed.commitment), count: parsed.members.length, members: rowsOf(parsed.members) };
}

/**
 * Strict, async, BOUND: the proof is marked set/1 with no origin digest in
 * its signed attribution, the manifest parses strictly, its canonical bytes
 * hash to the SIGNED artifact digest, its commitment equals the one
 * recomputed from the proof's own slot record, and it lists at most
 * MAX_SET_MEMBERS rows. Explicit manifest bytes win over proof.metadata.
 * Null on any failure; never throws. Every place that asserts membership,
 * lists members or writes an index key binds through here.
 */
export async function bindSet(proof: Record<string, unknown>, manifest?: Uint8Array | null): Promise<BoundSet | null> {
  try {
    const kind = setKindOf(proof);
    if (kind === null) return null;
    if ((proof.attribution as { message?: unknown }).message !== undefined) return null;
    const bytes = manifest ?? readSetMetadata(asVerify(proof));
    if (bytes === null) return null;
    const artifact = (proof.artifact as { digestB64?: unknown } | undefined)?.digestB64;
    if (typeof artifact !== "string" || (await sha256B64(bytes)) !== artifact) return null;
    const slot = proof.slotAllocation;
    if (typeof slot !== "object" || slot === null) return null;
    const commitment = computeSlotCommitment(slot as SlotAllocation);
    if (kind === "set/2") {
      const doc = parseSetRoot(bytes);
      if (doc === null || !bytesEqual(doc.commitment, commitment)) return null;
      return { kind, bytes, manifest: JSON.parse(decode(bytes)) as SetRoot, count: doc.count, members: [], root: doc.root };
    }
    const parsed = parseSetManifest(bytes);
    if (parsed === null || parsed.members.length > MAX_SET_MEMBERS) return null;
    if (!bytesEqual(parsed.commitment, commitment)) return null;
    return { kind, bytes, manifest: JSON.parse(decode(bytes)) as SetManifest, count: parsed.members.length, members: rowsOf(parsed.members), root: null };
  } catch {
    return null;
  }
}

/**
 * set/2: bind one member's evidence to a bound set. The evidence parses
 * strictly, names the set's count, and its leaf and path recompute the
 * bound root. Returns the row with its leaf index, or null. Never throws.
 */
export function bindSetMember(bound: BoundSet, evidence: unknown): (SetMemberRow & { proof: SetMemberProof }) | null {
  try {
    if (bound.kind !== "set/2" || bound.root === null) return null;
    const parsed = parseSetMemberProof(evidence);
    if (parsed === null || parsed.count !== bound.count) return null;
    const reached = setRootFromMember(parsed.member, parsed.index, parsed.count, parsed.path);
    if (reached === null || !bytesEqual(reached, bound.root)) return null;
    return {
      index: parsed.index,
      count: parsed.count,
      originDigestB64: bytesToBase64(parsed.member.origin),
      fusedDigestB64: bytesToBase64(parsed.member.artifact),
      placement: parsed.member.placement,
      proof: evidence as SetMemberProof,
    };
  } catch {
    return null;
  }
}

/** The member evidence a proof copy carries under metadata, unparsed; null when none. */
export function memberEvidenceOf(proof: Record<string, unknown>): unknown {
  const md = proof.metadata;
  if (!isPlainObject(md)) return null;
  return md[SET_MEMBER_KEY] ?? null;
}

/**
 * The row whose origin digest (role "origin") or fused digest (role "fused")
 * equals digestB64; an origin match wins. Null for the manifest digest and
 * for strangers. Takes a bound result so callers never re-hash.
 */
export function memberOf(bound: { members: SetMemberRow[] }, digestB64: string): (SetMemberRow & { role: "origin" | "fused" }) | null {
  const origin = bound.members.find((m) => m.originDigestB64 === digestB64);
  if (origin !== undefined) return { ...origin, role: "origin" };
  const fused = bound.members.find((m) => m.fusedDigestB64 === digestB64);
  if (fused !== undefined) return { ...fused, role: "fused" };
  return null;
}

/* ── The commit route's half ── */

export type SetCommitVerdict =
  | { ok: true; canonicalBytes: Uint8Array; manifestObject: SetManifest; members: SetMemberRow[] }
  | { ok: false; status: 400; error: string };
export type SetCommitOk = Extract<SetCommitVerdict, { ok: true }>;

const refuse = (error: string): SetCommitVerdict => ({ ok: false, status: 400, error });
const NOT_A_MANIFEST = `metadata['${SET_KEY}'] is not a set manifest`;

/**
 * The commit route's set validation: pure, and it never throws (an exception
 * anywhere inside is the structural refusal). Call it for a set/1 title or
 * whenever the body carries a metadata field; an ordinary fused commit
 * without one has nothing here to validate. The checks run in this order,
 * each a 400 with a fixed string, and all of them before any ledger read or
 * parent call, so a bad manifest costs nothing:
 *   1. metadata on a title other than set/1
 *   2. set/1 without metadata
 *   3. set/1 with an origin digest in attribution.message
 *   4. metadata not exactly { "bitgraph-fuse/1": <plain object> }; any other
 *      key, __proto__ and constructor included, is refused here
 *   5. fixed-depth structure with NO recursion: the four manifest keys, the
 *      type and placement literals, the commitment field, members an array
 *      (a nesting bomb is refused at its first row without being walked)
 *   6. 1 to MAX_SET_MEMBERS rows, before any per-row work
 *   5. every row exactly {artifact, origin, placement}, 32-byte lowercase-hex
 *      digests, a placement a site reader can rebuild
 *   7. the JSON size cap, before canonicalization
 *   8. the strict canonical round trip (sorted rows, no duplicate artifacts,
 *      no whitespace): readSetMetadata, then parseSetManifest
 *   9. the manifest's commitment equals the named slot's (floor and
 *      membership are inseparable; refused before the slot is spent)
 *  10. the canonical bytes hash to the committed digest
 * `limits` exists for tests that need the size cap low; the route never
 * passes it.
 */
export async function validateSetCommit(
  input: { title: string; message?: unknown; metadata: unknown; digestB64: string; slot: SlotAllocation },
  limits: { maxMetadataJson?: number } = {},
): Promise<SetCommitVerdict> {
  try {
    const kind: "set/1" | "set/2" | null = input.title === SET_TITLE ? "set/1" : input.title === SET2_TITLE ? "set/2" : null;
    const isSet = kind !== null;
    if (!isSet && input.metadata !== undefined) return refuse("metadata is accepted only for a set/1 or set/2 commit");
    if (isSet && input.metadata === undefined) return refuse(`a ${kind} commit requires metadata['${SET_KEY}']`);
    if (isSet && typeof input.message === "string" && input.message.length > 0) return refuse(`a ${kind} commit carries no origin digest`);

    const metadata = input.metadata;
    if (!isPlainObject(metadata) || keysOf(metadata) !== SET_KEY || !isPlainObject(metadata[SET_KEY])) {
      return refuse(`metadata must be { '${SET_KEY}': <set ${kind === "set/2" ? "root document" : "manifest"}> } and nothing else`);
    }
    const m = metadata[SET_KEY] as Record<string, unknown>;
    if (kind === "set/2") {
      // A root document: five keys, the literals, a count in range, two digests; canonical round trip, the slot's commitment, the committed digest.
      if (
        keysOf(m) !== "count,placement,root,slotCommitment,type" ||
        m.type !== SET_KEY ||
        m.placement !== SET2_TITLE ||
        typeof m.count !== "number" || !Number.isInteger(m.count) || m.count < 1 || m.count > MAX_SET2_ROWS ||
        !isDigestField(m.root) ||
        !isDigestField(m.slotCommitment)
      ) {
        return refuse(`metadata['${SET_KEY}'] is not a set root document`);
      }
      const canonicalBytes = readSetMetadata({ metadata } as unknown as BitGraphProof);
      if (canonicalBytes === null) return refuse(`metadata['${SET_KEY}'] is not a set root document`);
      const doc = parseSetRoot(canonicalBytes);
      if (doc === null) return refuse(`metadata['${SET_KEY}'] is not a set root document`);
      if (!bytesEqual(doc.commitment, computeSlotCommitment(input.slot))) return refuse("root document commitment is not this slot's");
      if ((await sha256B64(canonicalBytes)) !== input.digestB64) return refuse("root document does not hash to the committed digest");
      return { ok: true, canonicalBytes, manifestObject: JSON.parse(decode(canonicalBytes)) as SetManifest, members: [] };
    }
    if (
      keysOf(m) !== "members,placement,slotCommitment,type" ||
      m.type !== SET_KEY ||
      m.placement !== SET_TITLE ||
      !isDigestField(m.slotCommitment) ||
      !Array.isArray(m.members)
    ) {
      return refuse(NOT_A_MANIFEST);
    }
    const rows = m.members as unknown[];
    if (rows.length < 1 || rows.length > MAX_SET_MEMBERS) return refuse(`a set lists 1 to ${MAX_SET_MEMBERS} members`);
    for (const row of rows) {
      if (
        !isPlainObject(row) ||
        keysOf(row) !== "artifact,origin,placement" ||
        !isDigestField(row.artifact) ||
        !isDigestField(row.origin) ||
        !(SET_MEMBER_PLACEMENTS as readonly unknown[]).includes(row.placement)
      ) {
        return refuse(NOT_A_MANIFEST);
      }
    }
    if (JSON.stringify(metadata).length > (limits.maxMetadataJson ?? MAX_SET_METADATA_JSON)) return refuse("set manifest too large");

    const canonicalBytes = readSetMetadata({ metadata } as unknown as BitGraphProof);
    if (canonicalBytes === null) return refuse(NOT_A_MANIFEST);
    const parsed = parseSetManifest(canonicalBytes);
    if (parsed === null) return refuse(NOT_A_MANIFEST);
    if (!bytesEqual(parsed.commitment, computeSlotCommitment(input.slot))) return refuse("manifest commitment is not this slot's");
    if ((await sha256B64(canonicalBytes)) !== input.digestB64) return refuse("manifest does not hash to the committed digest");
    return { ok: true, canonicalBytes, manifestObject: JSON.parse(decode(canonicalBytes)) as SetManifest, members: rowsOf(parsed.members) };
  } catch {
    return refuse(NOT_A_MANIFEST);
  }
}

/**
 * What the boundary did with the manifest: "echoed" when the returned proof
 * carries bytes equal to the verified canonical bytes, "mismatch" when it
 * carries different ones (the caller refuses the proof), "attached" when it
 * carries none, in which case the verified manifest object is put under
 * metadata["bitgraph-fuse/1"] IN PLACE, beside any other metadata the
 * boundary returned (metadata that is not a plain object is replaced). Never
 * mutates on "echoed" or "mismatch".
 */
export function reconcileSetMetadata(
  returned: Record<string, unknown>,
  verified: { canonicalBytes: Uint8Array; manifestObject: SetManifest },
): "echoed" | "attached" | "mismatch" {
  const echoed = readSetMetadata(asVerify(returned));
  if (echoed !== null) return bytesEqual(echoed, verified.canonicalBytes) ? "echoed" : "mismatch";
  const prior = returned.metadata;
  returned.metadata = { ...(isPlainObject(prior) ? prior : {}), [SET_KEY]: verified.manifestObject };
  return "attached";
}

/* ── The index's half ── */

export interface SetIndexEntry {
  digestB64: string;
  /** "fused-descendant": these bytes are the origin of a member; "set-member": these exact bytes were fused under the proof as one of N. */
  kind: "fused-descendant" | "set-member";
  index: number;
  count: number;
}

/**
 * The by-digest keys a BOUND set earns, in manifest row order: each row's
 * origin as "fused-descendant" and its fused digest as "set-member". A
 * digest that is both (a member fused from another member's new file) is
 * listed ONCE, as "set-member"; a repeated origin once; the manifest's own
 * digest never (its own keys are the proof's ordinary ones).
 */
export function setIndexEntries(bound: { members: SetMemberRow[] }, artifactDigestB64: string): SetIndexEntry[] {
  const fused = new Set(bound.members.map((m) => m.fusedDigestB64));
  const seen = new Set<string>([artifactDigestB64]);
  const out: SetIndexEntry[] = [];
  for (const m of bound.members) {
    if (!fused.has(m.originDigestB64) && !seen.has(m.originDigestB64)) {
      seen.add(m.originDigestB64);
      out.push({ digestB64: m.originDigestB64, kind: "fused-descendant", index: m.index, count: m.count });
    }
    if (!seen.has(m.fusedDigestB64)) {
      seen.add(m.fusedDigestB64);
      out.push({ digestB64: m.fusedDigestB64, kind: "set-member", index: m.index, count: m.count });
    }
  }
  return out;
}

/** A shallow copy with metadata["bitgraph-fuse/1"] removed; metadata is dropped entirely when that leaves it empty. */
export function stripSetManifest(proof: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...proof };
  const md = copy.metadata;
  if (!isPlainObject(md) || !(SET_KEY in md)) return copy;
  const rest = { ...md };
  delete rest[SET_KEY];
  if (Object.keys(rest).length === 0) delete copy.metadata;
  else copy.metadata = rest;
  return copy;
}

/** N for a set proof whose metadata lists N rows, 0 for a set proof without a readable manifest, null for anything that is not a set. Display only. */
export function setCountOf(proof: Record<string, unknown>): number | null {
  if (!isSetProof(proof)) return null;
  return parseSetOf(proof)?.count ?? 0;
}

/**
 * Put a set's manifest back on member entries that came over the wire
 * without it. A batch lookup returns a member's set proof STRIPPED of its
 * manifest and lists each distinct set once in a side table (see
 * /api/proofs/batch): the same N-row manifest copied onto every one of N
 * member rows made a batch answer grow with N squared. Each entry names
 * its set by digest; the manifest is attached (by reference, one parsed
 * object per set) only when the side table holds a proof for that digest
 * whose signed artifact digest is the entry's own, so a header that named
 * the wrong set attaches nothing. Mutates the entries in place; pure
 * otherwise, no hashing: the copy is bound (bindSet) wherever it is used.
 */
export function attachSetManifests(
  results: Record<string, { proofs?: Array<{ proof: Record<string, unknown>; setDigest?: string }> } | undefined>,
  sets: Record<string, Record<string, unknown>> | undefined,
): number {
  if (!sets) return 0;
  let attached = 0;
  for (const r of Object.values(results)) {
    for (const e of r?.proofs ?? []) {
      if (!e.setDigest || !isPlainObject(e.proof)) continue;
      const set = sets[e.setDigest];
      if (!isPlainObject(set)) continue;
      const md = set.metadata;
      if (!isPlainObject(md) || !isPlainObject(md[SET_KEY])) continue;
      const own = (e.proof.artifact as { digestB64?: unknown } | undefined)?.digestB64;
      const theirs = (set.artifact as { digestB64?: unknown } | undefined)?.digestB64;
      if (typeof own !== "string" || own !== theirs) continue;
      const prior = e.proof.metadata;
      e.proof.metadata = { ...(isPlainObject(prior) ? prior : {}), [SET_KEY]: md[SET_KEY] };
      attached++;
    }
  }
  return attached;
}
