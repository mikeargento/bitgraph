/**
 * tree/1 on the site (2026-10-03): the one module every reader and writer of
 * a tree/1 BitGraph shares here. Every new BitGraph is a Merkle tree of files
 * under one position, and a single file is a tree of one (SPEC.md section 8).
 *
 * What the proof signs: the SHA-256 of an 84-byte ROOT DOCUMENT (domain,
 * count, root, commitment), with the marker { name: "bitgraph-fuse/2",
 * title: "tree/1", message: base64 SHA-256 of SPEC.md }. The root document
 * itself rides UNSIGNED as proof.metadata["bitgraph-tree/1"] = hex, and is
 * worth something only once it hashes to the signed digest. Nothing here
 * reads its count, root or commitment before that binding holds.
 *
 * The three halves, each used by more than one caller:
 *   - validateTreeCommit / reconcileTreeMetadata: the commit route, before
 *     the slot is spent and after the proof comes back.
 *   - bindTree / treeOfOneEvidence / treeHandoff: the proof page and the drop
 *     box, reading.
 *   - fetchTreeEvidence / buildTreeExport: export/1, the one JSON a holder
 *     keeps (floor header, Base ceiling, Ethereum settlement, filled from
 *     this site's read-only routes and vetted before they are written).
 * Making is fuse-tree-make.ts.
 *
 * Isomorphic on purpose, like fuse-set.ts: the two BitGraph packages and
 * three pure site modules are imported, nothing touches Next, window or the
 * ledger, and `fetch` is a parameter, so the route, the browser and node's
 * test runner all run the same code.
 */
import { sha256 } from "@noble/hashes/sha256";
import {
  KNOWN_TREE_SPEC_HASHES,
  LEAF_AS_IS,
  LEAF_PLACEMENTS,
  OUTPUT_ROOT_VERSION,
  PLACEMENTS,
  TREE_METADATA_KEY,
  TREE_PLACEMENT_ID,
  TREE_ROOT_DOCUMENT_BYTES,
  base64ToBytes,
  buildExport,
  buildTreeMemberEvidence,
  bytesEqual,
  bytesToBase64,
  bytesToHex,
  commitmentForProof,
  committedBytesFor,
  computeProofHash,
  fuseVersionOfName,
  hexToBytes,
  leafCodeOf,
  parseTreeRootDocument,
  treeLeafHash,
  verifyExport,
  type BitGraphExport,
  type BitGraphProof,
  type CeilingSidecar,
  type OutputRootSettlement,
  type SlotAllocation,
  type TreeLeaf,
  type TreeMemberEvidence,
} from "@mikeargento/bitgraph-verify";
import { placementForBytes } from "@mikeargento/bitgraph";
import { computeCommitmentFor } from "./fuse-commitment.ts";
import { FUSE2_ATTRIBUTION_NAME, TREE_TITLE as CORE_TREE_TITLE } from "./fuse-core.ts";
import { MAX_FUSE_BYTES } from "./fuse-placement.ts";

/** The signed title of a tree/1 proof (attribution.title). Pinned; the suite checks it equals TREE_PLACEMENT_ID. */
export const TREE_TITLE: typeof TREE_PLACEMENT_ID = CORE_TREE_TITLE as typeof TREE_PLACEMENT_ID;
/** The unsigned metadata key the root document rides under, as lowercase hex. Pinned to TREE_METADATA_KEY. */
export const TREE_KEY: typeof TREE_METADATA_KEY = "bitgraph-tree/1";
/** Where the site serves SPEC.md, byte for byte (public/spec/SPEC.md; a test pins it to spec/SPEC.md). */
export const SPEC_PATH = "/spec/SPEC.md";
/** The name SPEC.md travels under beside an export. */
export const SPEC_FILE_NAME = "SPEC.md";

/** The root document's hex: exactly 84 bytes, lowercase. */
const HEX_ROOT = new RegExp(`^[0-9a-f]{${TREE_ROOT_DOCUMENT_BYTES * 2}}$`);

function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

const asVerify = (proof: unknown): BitGraphProof => proof as BitGraphProof;

/**
 * The site's own hand-off key for ONE member's evidence riding beside a tree
 * proof copy (the drop box hands it to the proof page with the file it made
 * or checked). Unsigned and trusted for nothing: the page runs it through
 * verifyTreeMember with the file in hand before it says anything about the
 * file. Never written to the ledger, never sent to the boundary, and not part
 * of any format a reader is asked to support (that is export/1's member).
 */
export const TREE_MEMBER_KEY = "bitgraph-tree/1/member";

/** A proof copy for the proof page: the root document (and a member's evidence, when one is in hand) under metadata. */
export function treeHandoff(proof: BitGraphProof, rootDocumentHex: string, evidence?: TreeMemberEvidence | null): BitGraphProof {
  const prior = (proof as { metadata?: unknown }).metadata;
  return {
    ...proof,
    metadata: { ...(isPlainObject(prior) ? prior : {}), [TREE_KEY]: rootDocumentHex, ...(evidence ? { [TREE_MEMBER_KEY]: evidence } : {}) },
  } as BitGraphProof;
}

/** The member evidence a proof copy carries under TREE_MEMBER_KEY, unparsed; null when none. */
export function treeMemberHandoffOf(proof: unknown): unknown {
  const md = (proof as { metadata?: unknown } | null)?.metadata;
  return isPlainObject(md) ? md[TREE_MEMBER_KEY] ?? null : null;
}

/** Signed marker only: attribution.title is tree/1. Whether the rest of the marker holds is bindTree's question. */
export function isTreeTitled(proof: { attribution?: unknown } | null | undefined): boolean {
  const a = proof?.attribution;
  return typeof a === "object" && a !== null && (a as { title?: unknown }).title === TREE_TITLE;
}

/** The spec hash a tree/1 proof's signed message pins, when it is one this site knows. */
export function isKnownSpecHash(b64: unknown): b64 is string {
  return typeof b64 === "string" && KNOWN_TREE_SPEC_HASHES.includes(b64);
}

/* ── The commit route's half ── */

export type TreeCommitVerdict =
  | { ok: true; rootDocument: Uint8Array; hex: string; count: number }
  | { ok: false; status: 400; error: string };
export type TreeCommitOk = Extract<TreeCommitVerdict, { ok: true }>;

const refuse = (error: string): TreeCommitVerdict => ({ ok: false, status: 400, error });
const NOT_A_ROOT = `metadata['${TREE_KEY}'] is not a tree/1 root document`;

/**
 * The commit route's tree/1 validation: pure, and it never throws (an
 * exception anywhere inside is the structural refusal). Called for every
 * commit whose title is tree/1, before the anchor gate, the ledger read and
 * the parent call, so a bad one costs nothing and spends no position. Each
 * check is a 400 with a fixed sentence, in this order:
 *   1. the name is bitgraph-fuse/2: tree/1 always binds the floor block
 *   2. the caller named the floor it bound (the allocation's anchor)
 *   3. the message is the base64 SHA-256 of a SPEC.md this site knows
 *   4. metadata is exactly { "bitgraph-tree/1": <168 lowercase hex> }; any
 *      other key, __proto__ and constructor included, is refused here
 *   5. the 84 bytes parse as a root document (domain, count 1 to 1,000,000)
 *   6. its commitment is the one recomputed from the named slot and floor
 *   7. its SHA-256 is the committed digest
 * After 6 and 7 the proof the enclave signs is a tree/1 proof every verifier
 * accepts: the root document hashes to the signed digest and carries this
 * position's commitment, which is everything SPEC.md 8.6 step 3 asks.
 */
export function validateTreeCommit(input: {
  name: unknown;
  message: unknown;
  metadata: unknown;
  digestB64: string;
  slot: SlotAllocation;
  floorBlockHash: string | null | undefined;
}): TreeCommitVerdict {
  try {
    if (input.name !== FUSE2_ATTRIBUTION_NAME) return refuse(`a tree/1 commit is marked "${FUSE2_ATTRIBUTION_NAME}": its commitment binds the floor block`);
    if (typeof input.floorBlockHash !== "string" || input.floorBlockHash.length === 0) return refuse("a tree/1 commit carries body.anchor: the floor anchor /api/fuse/allocate returned with this position");
    if (!isKnownSpecHash(input.message)) return refuse("attribution.message must be the base64 SHA-256 of a SPEC.md this site knows");
    const metadata = input.metadata;
    if (!isPlainObject(metadata) || Object.keys(metadata).join(",") !== TREE_KEY || typeof metadata[TREE_KEY] !== "string" || !HEX_ROOT.test(metadata[TREE_KEY] as string)) {
      return refuse(`metadata must be { '${TREE_KEY}': <the 84-byte root document, lowercase hex> } and nothing else`);
    }
    const hex = metadata[TREE_KEY] as string;
    const rootDocument = hexToBytes(hex);
    if (rootDocument === null) return refuse(NOT_A_ROOT);
    const doc = parseTreeRootDocument(rootDocument);
    if (doc === null) return refuse(NOT_A_ROOT);
    if (!bytesEqual(doc.commitment, computeCommitmentFor(input.slot, input.floorBlockHash))) return refuse("root document commitment is not this position's");
    if (bytesToBase64(sha256(rootDocument)) !== input.digestB64) return refuse("root document does not hash to the committed digest");
    return { ok: true, rootDocument, hex, count: doc.count };
  } catch {
    return refuse(NOT_A_ROOT);
  }
}

/**
 * What the boundary did with the root document: "echoed" when the returned
 * proof carries the same hex, "mismatch" when it carries anything else under
 * the key (the caller refuses the proof), "attached" when it carries nothing,
 * in which case the verified hex is put under metadata["bitgraph-tree/1"] IN
 * PLACE, beside any other metadata the boundary returned. Never mutates on
 * "echoed" or "mismatch".
 */
export function reconcileTreeMetadata(returned: Record<string, unknown>, verified: { hex: string }): "echoed" | "attached" | "mismatch" {
  const prior = returned.metadata;
  if (isPlainObject(prior) && prior[TREE_KEY] !== undefined) return prior[TREE_KEY] === verified.hex ? "echoed" : "mismatch";
  returned.metadata = { ...(isPlainObject(prior) ? prior : {}), [TREE_KEY]: verified.hex };
  return "attached";
}

/* ── Reading ── */

export interface BoundTree {
  /** The 84 bytes that hash to the signed artifact digest. */
  rootDocument: Uint8Array;
  count: number;
  root: Uint8Array;
  commitment: Uint8Array;
  /** The pinned SPEC.md hash, base64: one this site knows. */
  specHashB64: string;
}

export type TreeBinding = { ok: true; tree: BoundTree } | { ok: false; reason: string };

/**
 * Strict and sync: the signed marker is tree/1 under bitgraph-fuse/2 with a
 * spec this site knows, the root document (explicit bytes win over the
 * proof's own metadata) is 84 bytes of tree/1, hashes to the SIGNED artifact
 * digest, and carries the commitment recomputed from the proof's own slot
 * record and signed floor block. The proof's signature is not checked here:
 * a page shows the signature check on its own line, and a caller that needs
 * both runs verifyTreeMember. Never throws.
 */
export function bindTree(proof: unknown, rootDocument?: Uint8Array | null): TreeBinding {
  const no = (reason: string): TreeBinding => ({ ok: false, reason });
  try {
    const p = asVerify(proof);
    if (!isTreeTitled(p)) return no("the proof's signed title is not tree/1");
    const a = p.attribution!;
    if (fuseVersionOfName(a.name) !== 2) return no("a tree/1 proof must be marked bitgraph-fuse/2");
    if (!isKnownSpecHash(a.message)) return no(typeof a.message === "string" ? `the proof follows a spec this site does not know (${a.message})` : "the proof pins no spec");
    const bytes = rootDocument ?? (() => {
      const md = (p as { metadata?: unknown }).metadata;
      const hex = isPlainObject(md) ? md[TREE_KEY] : undefined;
      return typeof hex === "string" ? hexToBytes(hex) : null;
    })();
    if (bytes === null) return no("no root document is in hand");
    const doc = parseTreeRootDocument(bytes);
    if (doc === null) return no("the root document is not 84 bytes of tree/1");
    const signed = base64ToBytes(p.artifact?.digestB64 ?? "");
    if (signed === null || !bytesEqual(sha256(bytes), signed)) return no("the root document does not hash to the signed artifact digest");
    if (!p.slotAllocation) return no("the proof carries no position record");
    if (!bytesEqual(doc.commitment, commitmentForProof(p, p.slotAllocation))) return no("the root document's commitment is not this position's");
    return { ok: true, tree: { rootDocument: bytes, count: doc.count, root: doc.root, commitment: doc.commitment, specHashB64: a.message as string } };
  } catch (e) {
    return no(e instanceof Error ? e.message : "the tree could not be bound");
  }
}

/** Sync SHA-256, for the small things hashed here (a root document, SPEC.md). */
const digest = (bytes: Uint8Array): Uint8Array => sha256(bytes);
/** The platform's native SHA-256, for a whole file: off the main thread's critical path, and ten times faster than JS. */
const digestAsync = async (bytes: Uint8Array): Promise<Uint8Array> => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));

/**
 * A tree of ONE needs no evidence beyond the file: its root is its only
 * leaf's hash and its path is empty, so the leaf can be rebuilt from the file
 * in hand and checked against the bound root. Tried as the original first,
 * under the placement the site would have chosen for these bytes, then as is,
 * then the other placements, then as the committed bytes themselves (the
 * commitment located inside them, the origin read back out). Returns the
 * member's evidence, which a verifier still checks like any other, or null
 * when the file is not this tree's one member. Never throws (it resolves to
 * null). Async because it hashes whole files, with the platform's hasher.
 */
export async function treeOfOneEvidence(bound: BoundTree, bytes: Uint8Array): Promise<TreeMemberEvidence | null> {
  if (bound.count !== 1) return null;
  const hit = (leaf: TreeLeaf): TreeMemberEvidence | null => {
    try {
      return bytesEqual(treeLeafHash(leaf), bound.root) ? buildTreeMemberEvidence(leaf, 0, 1, []) : null;
    } catch {
      return null;
    }
  };
  try {
    // The file's own hash is both a candidate origin and, when the file is
    // the committed bytes, the artifact: taken once, whatever is tried.
    const self = await digestAsync(bytes);
    // A file over the in-browser cap is always made as is, so that is tried
    // first for one; anything else under the placement its bytes pick.
    const preferred = leafCodeOf(placementForBytes(bytes)) ?? 0x03;
    const order = (bytes.length > MAX_FUSE_BYTES ? [LEAF_AS_IS, preferred] : [preferred, LEAF_AS_IS])
      .concat([0x01, 0x02, 0x03])
      .filter((c, i, all) => all.indexOf(c) === i);
    for (const code of order) {
      const leaf: TreeLeaf = code === LEAF_AS_IS
        ? { placement: LEAF_AS_IS, artifact: self, origin: self }
        : { placement: code, artifact: await digestAsync(committedBytesFor(code, bytes, bound.commitment)), origin: self };
      const found = hit(leaf);
      if (found) return found;
    }
    // The committed bytes in hand: locate the commitment, read the origin back.
    for (const p of PLACEMENTS) {
      const code = leafCodeOf(p.id);
      if (code === null || code === LEAF_AS_IS) continue;
      const located = p.locate(bytes);
      if (located === null || !bytesEqual(located.commitment, bound.commitment)) continue;
      const origin = located.originDigest ?? (located.originalBytes !== undefined ? await digestAsync(located.originalBytes) : undefined);
      if (origin === undefined) continue;
      const found = hit({ placement: code, artifact: self, origin });
      if (found) return found;
    }
  } catch {
    /* not this tree's member */
  }
  return null;
}

/** A leaf code in the site's words: "as is", or the placement id. */
export function leafPlacementName(code: number): string {
  const id = LEAF_PLACEMENTS[code];
  return id === undefined ? `code ${code}` : id === "as-is" ? "as is" : id;
}

/* ── export/1 ── */

/** Where the read-only evidence comes from: this site's own routes, by default on the same origin. */
export interface EvidenceSource {
  fetch?: typeof fetch;
  /** Origin the routes live on; "" (same origin) in the browser. */
  baseUrl?: string;
}

export interface TreeEvidence {
  floor: BitGraphExport["floor"];
  ceiling: BitGraphExport["ceiling"];
  settlement: BitGraphExport["settlement"];
  /** One sentence per part that is pending or could not be fetched, for the person saving the export. */
  notes: string[];
}

const toUrlSafe = (b64: string): string => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The proofHash a ceiling is filed under: the proof's own field when it carries one, else recomputed. */
export function proofHashOf(proof: BitGraphProof): string {
  const own = (proof as { proofHash?: unknown }).proofHash;
  return typeof own === "string" && own.length > 0 ? own : computeProofHash(proof);
}

async function getJson(src: EvidenceSource, path: string): Promise<{ status: number; json: unknown }> {
  const f = src.fetch ?? fetch;
  const res = await f(`${src.baseUrl ?? ""}${path}`, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  let json: unknown = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

/**
 * The three time sections of an export, read from this site's routes:
 *   floor       GET /api/proofs/witness?block=&hash=   the signed floor block's header
 *   ceiling     GET /api/ceilings/<proofHash>          the Base ceiling sidecar; 404 is pending
 *   settlement  GET /api/ceilings/settlement/<block>   output-root/1 for the ceiling's Base block; 404 is pending
 * Every route is a read. A part that is not there yet is written as pending,
 * which a verifier reports as not carried, never as a failure (SPEC.md 12);
 * a part that could not be fetched at all is written as null and named in
 * `notes`, because "we did not ask" is not "it is pending". Nothing here
 * judges what came back; buildTreeExport does, before anything is written.
 */
export async function fetchTreeEvidence(proof: BitGraphProof, src: EvidenceSource = {}): Promise<TreeEvidence> {
  const notes: string[] = [];
  let floor: TreeEvidence["floor"] = null;
  const fa = proof.commit?.slotAnchor;
  if (fa && typeof fa.blockNumber === "number" && typeof fa.blockHash === "string") {
    try {
      const r = await getJson(src, `/api/proofs/witness?block=${fa.blockNumber}&hash=${encodeURIComponent(fa.blockHash)}`);
      const w = r.json as { headerRlpHex?: unknown; blockNumber?: unknown; blockHash?: unknown } | null;
      if (r.status === 200 && typeof w?.headerRlpHex === "string") {
        floor = { blockNumber: fa.blockNumber, blockHash: fa.blockHash.toLowerCase(), header: w.headerRlpHex.toLowerCase() };
      } else {
        notes.push(`The floor block's header could not be fetched (BitGraph answered ${r.status}), so the floor's time is not in this export. Export again to add it.`);
      }
    } catch (e) {
      notes.push(`The floor block's header could not be fetched (${(e as Error).message}). Export again to add it.`);
    }
  } else {
    notes.push("This proof signs no floor block, so the export carries none.");
  }

  let ceiling: TreeEvidence["ceiling"] = null;
  let settlement: TreeEvidence["settlement"] = null;
  try {
    const r = await getJson(src, `/api/ceilings/${toUrlSafe(proofHashOf(proof))}`);
    const c = r.json as CeilingSidecar | null;
    if (r.status === 200 && c?.version === "bitgraph-ceiling/1") {
      ceiling = c.anchor ? c : { status: "pending" };
    } else if (r.status === 404) {
      ceiling = { status: "pending" };
    } else {
      notes.push(`The Base ceiling could not be fetched (BitGraph answered ${r.status}). Export again to add it.`);
    }
  } catch (e) {
    notes.push(`The Base ceiling could not be fetched (${(e as Error).message}). Export again to add it.`);
  }
  const baseBlock = ceiling && (ceiling as CeilingSidecar).anchor ? (ceiling as CeilingSidecar).anchor!.blockNumber : null;
  if (ceiling !== null && baseBlock === null) {
    settlement = { status: "pending" };
    notes.push("The Base ceiling had not landed when this export was made: it lands within minutes. Export again later to add it and its Ethereum settlement.");
  } else if (baseBlock !== null) {
    try {
      const r = await getJson(src, `/api/ceilings/settlement/${baseBlock}`);
      const j = r.json as { version?: unknown; settlement?: { version?: unknown } } | null;
      // The route's own object, or the same wrapped under `settlement`.
      const s = (j?.version === OUTPUT_ROOT_VERSION ? j : j?.settlement?.version === OUTPUT_ROOT_VERSION ? j.settlement : null) as OutputRootSettlement | null;
      if (r.status === 200 && s !== null && s.base?.blockNumber === baseBlock) {
        settlement = s;
      } else if (r.status === 200 && s !== null) {
        settlement = { status: "pending", baseBlock };
        notes.push(`BitGraph served a settlement for a different Base block than the ceiling's (${baseBlock}); it was left out. Export again later.`);
      } else if (r.status === 404 || r.status === 200) {
        settlement = { status: "pending", baseBlock };
        notes.push(`Base had not settled block ${baseBlock} on Ethereum when this export was made: that takes about an hour. Export again later to add it.`);
      } else {
        notes.push(`The Ethereum settlement could not be fetched (BitGraph answered ${r.status}). Export again to add it.`);
      }
    } catch (e) {
      notes.push(`The Ethereum settlement could not be fetched (${(e as Error).message}). Export again to add it.`);
    }
  }
  // A ceiling that could not be fetched leaves the settlement unasked: its
  // note already says to export again, which fetches both.
  return { floor, ceiling, settlement, notes };
}

/**
 * One export/1 document, vetted before it is written. The parts are checked
 * the way any reader will check them (verifyExport, offline, without the
 * file): a floor header, a ceiling or a settlement that does not verify
 * against this proof is left out and named in the notes, rather than shipped
 * inside a file whose whole job is to verify. A part this site served wrong
 * is our gap; it must never read as a fault in the holder's BitGraph.
 */
export async function buildTreeExport(
  proof: BitGraphProof,
  tree: BitGraphExport["tree"],
  evidence: TreeEvidence,
): Promise<{ exp: BitGraphExport; notes: string[] }> {
  const notes = [...evidence.notes];
  let parts = { floor: evidence.floor, ceiling: evidence.ceiling, settlement: evidence.settlement };
  const make = () => buildExport({ proof, tree, ...parts });
  const r = await verifyExport(make());
  const failed = (id: string) => r.claims.some((c) => c.id === id && c.result === "FALSE");
  if (failed("floor.header")) {
    parts = { ...parts, floor: null };
    notes.push("The floor block's header BitGraph served did not match the signed floor, so it was left out.");
  }
  if (failed("ceiling.base")) {
    parts = { ...parts, ceiling: null, settlement: null };
    notes.push("The Base ceiling BitGraph served did not verify against this proof, so it and its settlement were left out.");
  } else if (failed("ceiling.ethereum")) {
    parts = { ...parts, settlement: null };
    notes.push("The Ethereum settlement BitGraph served did not verify, so it was left out.");
  }
  return { exp: make(), notes };
}

/** The tree part of a member's export. */
export function memberTree(rootDocument: Uint8Array, member: TreeMemberEvidence): BitGraphExport["tree"] {
  return { rootDocument: bytesToHex(rootDocument), member };
}

/** The tree part of the owner's export: every leaf in tree order, and a file name per leaf. */
export function ownerTree(rootDocument: Uint8Array, leavesBytes: Uint8Array, names?: readonly string[]): BitGraphExport["tree"] {
  return { rootDocument: bytesToHex(rootDocument), leaves: bytesToBase64(leavesBytes), ...(names ? { names: [...names] } : {}) };
}

/** The tree part when neither a member's evidence nor the list is in hand: the root document alone. */
export function rootOnlyTree(rootDocument: Uint8Array): BitGraphExport["tree"] {
  return { rootDocument: bytesToHex(rootDocument) };
}

/**
 * SPEC.md as this site serves it, accepted only when its SHA-256 is the hash
 * the proof pins: shipping any other text beside an export would hand its
 * reader the wrong rules under the right name. Null when it cannot be had.
 */
export async function fetchSpecFor(specHashB64: string, src: EvidenceSource = {}): Promise<Uint8Array | null> {
  try {
    const f = src.fetch ?? fetch;
    const res = await f(`${src.baseUrl ?? ""}${SPEC_PATH}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytesToBase64(digest(bytes)) === specHashB64 ? bytes : null;
  } catch {
    return null;
  }
}

/** A file name for a member's export: the file's own name, so the pair sits together in a folder. */
export function memberExportName(fileName: string): string {
  const clean = fileName.replace(/[\x00-\x1f\x7f/\\]/g, " ").trim() || "file";
  return `${clean}.bitgraph.json`;
}

/** A file name for the owner's export: the position it holds. */
export function ownerExportName(proof: BitGraphProof): string {
  const c = proof.commit?.counter;
  return c ? `bitgraph-${c}.bitgraph.json` : "bitgraph.bitgraph.json";
}

/** The export as it is written: two-space JSON, the field order buildExport gives (SPEC.md 12). */
export function exportJson(exp: BitGraphExport): string {
  return JSON.stringify(exp, null, 2) + "\n";
}
