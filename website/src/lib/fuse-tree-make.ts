/**
 * Making a tree/1 BitGraph on the site (2026-10-03): N files, one position,
 * one commit, from 1 file to SITE_MAX_TREE_LEAVES. The drop box and the proof
 * page's "BitGraph again" both make through here; nothing on the site makes
 * a single fused file, a set/1 or a set/2 any more (those are still READ
 * everywhere, by fuse-client.ts and fuse-set.ts).
 *
 * The beats, in order, the same four every BitGraph has had:
 *   1. position  POST /api/fuse/allocate. The enclave signs a position record
 *                and returns the floor block it will sign at commit (v9). No
 *                floor, no tree: tree/1 always binds the floor block.
 *   2. leaves    commitment/2 from that record and that block, then one
 *                65-byte leaf per distinct file: placement code, SHA-256 of
 *                the committed bytes, SHA-256 of the file as dropped.
 *                  - a file the user keeps AS IS is a leaf (code 0x00) with its
 *                    own digest twice, no bytes read: recorded after the floor
 *                    block, the bytes themselves not dated. Never by size: the
 *                    protocol has none (SPEC 7.5)
 *                  - a file the scan saved a hasher state for is finished with
 *                    its placement's suffix: no second read
 *                  - any other file is read now, checked against the scan's
 *                    digest, built with its placement, checked to carry the
 *                    commitment and its own origin, hashed and released
 *   3. root      the leaves sorted and hashed into an RFC 6962 tree, and the
 *                84-byte root document over it, whose SHA-256 is committed
 *   4. commit    POST /api/fuse/commit with the tree/1 marker, the root
 *                document as hex under metadata["bitgraph-tree/1"], and the
 *                floor the commitment bound. A lost reply is read back by
 *                digest and accepted only under THIS position's record.
 * Then the proof is read before anyone is told it exists: verifyTreeMember
 * must call the root document bound (signature, marker, spec, commitment),
 * and every member's path must reach the committed root.
 *
 * What this never does: put the nonce anywhere but memory, make an ordinary
 * recording in place of a tree, or allocate a second position for the same
 * files. A failure after the position is held says so, and the position
 * expires on its own.
 *
 * Node-importable on purpose (explicit .ts specifiers, `fetch` and the
 * browser's frame yield passed in), so the suite runs the real maker against
 * a stub boundary that runs the real commit-route validation.
 */
import { FuseError, placementForBytes } from "@mikeargento/bitgraph";
import {
  LEAF_AS_IS,
  TREE_METADATA_KEY,
  base64ToBytes,
  buildTree,
  buildTreeMemberEvidence,
  buildTreeRootDocument,
  bytesEqual,
  bytesToBase64,
  bytesToHex,
  computeSlotRecordHash,
  currentTreeSpecHash,
  encodeTreeLeaves,
  getPlacement,
  leafCodeOf,
  treeAttribution,
  treeRootFromMember,
  verifyTreeMember,
  type BitGraphProof,
  type SlotAllocation,
  type TreeLeaf,
  type TreeMemberEvidence,
} from "@mikeargento/bitgraph-verify";
import { finishState, hashBlob } from "./scan-hash.ts";
import { computeCommitmentFor } from "./fuse-commitment.ts";
import { FUSE_CHAIN, isAnchorMark, isBaseFloorMark, isSlotRecord, type FloorMark } from "./fuse-core.ts";
import type { SitePlacement } from "./fuse-placement.ts";
import { TREE_KEY } from "./fuse-tree.ts";

/**
 * The most leaves one tree the site makes. The protocol allows 1,000,000
 * (MAX_TREE_LEAVES); the site's own cap is the one set/2 ran at, which keeps
 * the leaf pass well inside the 120 s position window on a laptop. A drop
 * larger than this becomes consecutive trees (planTrees says where it cuts).
 */
export const SITE_MAX_TREE_LEAVES = 100_000;

/**
 * Bytes one tree may need to READ AGAIN while its position is held: the
 * members the scan left without a hasher state. As-is members and members
 * with a state cost nothing. The camera passes a budget from the scan's
 * measured speed; this is the fallback.
 */
export const DEFAULT_TREE_REREAD_BUDGET = 4 * 1024 * 1024 * 1024;

/** One dropped file, as the scan left it. */
export interface TreeInput {
  /** The bytes, read only when the file is a member that must be built. */
  file: Blob;
  /** Advisory: the name the owner's export lists beside the leaf. */
  name: string;
  /** SHA-256 of the file as dropped, standard base64; the leaf's origin. */
  digestB64: string;
  /** The placement the scan read from the bytes, or null when it had none (decided from the bytes when they are read). */
  placement: SitePlacement | null;
  /** The scan's saved hasher state after the placement's prefix and the file's last byte, or null. */
  state: Uint8Array | null;
  /** The user's choice to keep the file as it is (code 0x00): no bytes are read for it. Never set by size. */
  asIs?: boolean;
}

export interface TreeTransport {
  /** Origin of the site's routes. "" is the same origin. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Per request. Default 30 s. */
  timeoutMs?: number;
  /** Lost-reply recovery: by-digest reads to attempt, and the wait between them. */
  recoveryAttempts?: number;
  recoveryDelayMs?: number;
}

export interface TreeProgress {
  /**
   * "hash": each file checked before any request (no bytes read).
   * "fuse": each leaf made, after the position is held.
   * "tree": 0 of 1 before the tree is built, 1 of 1 after.
   * "commit": 0 of 1 before the request, 1 of 1 when the proof is back.
   * "verify": each member's path checked against the committed root.
   */
  phase: "hash" | "fuse" | "tree" | "commit" | "verify";
  done: number;
  total: number;
}

export interface MakeTreeOptions {
  transport?: TreeTransport;
  /** Called as the tree advances. A throw inside it is ignored. */
  onProgress?: (p: TreeProgress) => void;
  /**
   * Hand the browser a frame. Called on a time gate (every PAINT_EVERY_MS of
   * work), never per member: a member finished from its saved state is pure
   * computation, and a loop of them never returns to the event loop on its
   * own (see the note in fuse-client.ts). Tests pass nothing.
   */
  paint?: () => Promise<void>;
  /** Milliseconds of work between paints. Default 250. */
  paintEveryMs?: number;
  /** Default SITE_MAX_TREE_LEAVES. */
  maxLeaves?: number;
  /** Actor-bound commits: an agency envelope passed through untouched. */
  agency?: unknown;
}

export interface MadeTreeMember {
  /** Index into the inputs. Inputs with the same bytes share one leaf. */
  input: number;
  /** The leaf's index in tree order: MadeTree.evidenceOf(leafIndex) is this file's evidence. */
  leafIndex: number;
  /** "as-is" or the placement that carries the commitment. */
  placement: "as-is" | SitePlacement;
  code: number;
  /** Standard base64. */
  originDigestB64: string;
  /** Standard base64: SHA-256 of the committed bytes (for as is, the file's own). */
  artifactDigestB64: string;
}

export interface MadeTree {
  proof: BitGraphProof;
  /** The 84 bytes the proof's digest names. */
  rootDocument: Uint8Array;
  count: number;
  rootHex: string;
  /** commitment/2, standard base64. */
  commitmentB64: string;
  /** Every leaf in tree order. */
  leaves: TreeLeaf[];
  /** The owner's list: every leaf in tree order, concatenated (count x 65 bytes). */
  leavesBytes: Uint8Array;
  /** A file name per leaf, tree order: the first input carrying it. Unsigned, informational. */
  names: string[];
  /** One per input, in input order. */
  members: MadeTreeMember[];
  /**
   * A leaf's evidence ({ index, count, leaf, path }), built when asked: a
   * member's export carries it. Not held for every member up front, because
   * at 100,000 files the paths alone are over a hundred megabytes of strings
   * that nothing reads (an owner's export carries the list instead).
   */
  evidenceOf: (leafIndex: number) => TreeMemberEvidence;
  /** True when the commit reply was lost and the proof was read back by digest. */
  recovered: boolean;
  /** True when the boundary echoed the root document in the proof's metadata. */
  echoed: boolean;
}

const DEFAULTS = { baseUrl: "", timeoutMs: 30_000, recoveryAttempts: 5, recoveryDelayMs: 1_500 } as const;
type Bound = Required<Pick<TreeTransport, keyof typeof DEFAULTS>> & TreeTransport;

const EXPIRING = "nothing was committed and the position will expire";

const toUrlSafe = (b64: string): string => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** SHA-256 through the platform's native hasher (WebCrypto in browsers and node alike). */
async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

async function request(t: Bound, path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<{ status: number; json: unknown }> {
  const f = t.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(`${t.baseUrl}${path}`, {
      method: init.method,
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : {},
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(t.timeoutMs),
    });
  } catch (err) {
    throw new FuseError("network", `request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const text = await res.text();
  let json: unknown = null;
  try { json = text.length > 0 ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

const messageOf = (json: unknown, fallback: string): string =>
  json !== null && typeof json === "object" && typeof (json as { error?: unknown }).error === "string" ? (json as { error: string }).error : fallback;
const codeOf = (json: unknown): string | null =>
  json !== null && typeof json === "object" && typeof (json as { code?: unknown }).code === "string" ? (json as { code: string }).code : null;

/** 1. position: the signed record and the floor the enclave will sign at commit (v10 a Base block, v9 an Ethereum anchor). */
async function allocate(t: Bound): Promise<{ slot: SlotAllocation; floor: FloorMark }> {
  const r = await request(t, "/api/fuse/allocate", { method: "POST", body: {} });
  if (r.status === 503 && codeOf(r.json) === "tee-restarting") throw new FuseError("tee-restarting", messageOf(r.json, "the boundary is restarting"), 503);
  if (r.status !== 200) throw new FuseError("allocate-failed", messageOf(r.json, `allocation failed (${r.status})`), r.status);
  const j = r.json as { slotId?: unknown; slot?: unknown; chainId?: unknown; anchor?: unknown; floor?: unknown } | null;
  if (j === null || !isSlotRecord(j.slot) || j.slotId !== j.slot.nonceB64 || j.chainId !== FUSE_CHAIN) {
    throw new FuseError("allocate-failed", "the allocation response is not a position record on bitgraph:main", r.status);
  }
  const base = isBaseFloorMark(j.floor) ? j.floor : null;
  const eth = isAnchorMark(j.anchor) ? j.anchor : null;
  if (base !== null && eth !== null) {
    throw new FuseError("allocate-failed", `the boundary returned two floors with the position (a Base block and an Ethereum anchor); a proof has one, so ${EXPIRING}`, r.status);
  }
  const floor = base ?? eth;
  if (floor === null) {
    throw new FuseError("allocate-failed", `the boundary returned no floor block with the position; tree/1 binds the floor block, so ${EXPIRING}`, r.status);
  }
  return { slot: j.slot as unknown as SlotAllocation, floor };
}

/** The commit body's floor field: a Base floor goes as `floor` (bitgraph-fuse/3), an Ethereum anchor as `anchor` (bitgraph-fuse/2). */
export function floorField(floor: FloorMark): { floor: FloorMark } | { anchor: FloorMark } {
  return isBaseFloorMark(floor) ? { floor } : { anchor: floor };
}

/** The bitgraph-fuse version a floor makes: 3 for a Base block, 2 for an Ethereum anchor. */
export const fuseVersionOfFloor = (floor: FloorMark): 2 | 3 => (isBaseFloorMark(floor) ? 3 : 2);

/**
 * Read back by digest after a lost or refused reply: the ONE proof whose
 * commit names this position's record hash and nonce. Any other proof of the
 * same digest is someone else's position. Never allocates.
 */
async function recover(t: Bound, digestB64: string, slot: SlotAllocation): Promise<BitGraphProof | null> {
  const slotHash = bytesToBase64(computeSlotRecordHash(slot));
  for (let attempt = 0; attempt < t.recoveryAttempts; attempt++) {
    if (attempt > 0) await sleep(t.recoveryDelayMs);
    let r: { status: number; json: unknown };
    try {
      r = await request(t, `/api/proofs/${encodeURIComponent(toUrlSafe(digestB64))}`, { method: "GET" });
    } catch {
      continue;
    }
    if (r.status !== 200) continue;
    const proofs = (r.json as { proofs?: Array<{ proof?: BitGraphProof }> } | null)?.proofs;
    if (!Array.isArray(proofs)) continue;
    for (const e of proofs) {
      const p = e?.proof;
      if (p && p.commit?.slotHashB64 === slotHash && p.commit?.nonceB64 === slot.nonceB64) return p;
    }
  }
  return null;
}

/** 4. commit, with the lost-reply rules; never a proof under any other position. */
async function commit(t: Bound, body: Record<string, unknown>, digestB64: string, slot: SlotAllocation): Promise<{ proof: BitGraphProof; recovered: boolean }> {
  let proof: BitGraphProof | null = null;
  let recovered = false;
  let reply: { status: number; json: unknown } | null = null;
  try {
    reply = await request(t, "/api/fuse/commit", { method: "POST", body });
  } catch (err) {
    // The request may have reached the boundary: read back before giving up.
    proof = await recover(t, digestB64, slot);
    if (proof === null) throw err;
    recovered = true;
  }
  if (proof === null && reply !== null) {
    if (reply.status === 200) {
      const j = reply.json as { proof?: BitGraphProof } | null;
      proof = j?.proof ?? null;
      if (proof === null) throw new FuseError("commit-refused", "the commit response carried no proof", 200);
    } else if ((reply.status === 409 && codeOf(reply.json) === "slot-unavailable") || (reply.status === 503 && codeOf(reply.json) === "tee-restarting")) {
      proof = await recover(t, digestB64, slot);
      if (proof === null) {
        const code = reply.status === 409 ? "slot-unavailable" : "tee-restarting";
        throw new FuseError(code, messageOf(reply.json, reply.status === 409 ? "the position is no longer available" : "the boundary is restarting"), reply.status);
      }
      recovered = true;
    } else {
      throw new FuseError("commit-refused", messageOf(reply.json, `commit refused (${reply.status})`), reply.status);
    }
  }
  if (proof === null) throw new FuseError("transport", "no proof");
  if (proof.slotAllocation?.nonceB64 !== slot.nonceB64 || proof.commit?.nonceB64 !== slot.nonceB64) {
    throw new FuseError("slot-mismatch", "the boundary returned a proof under a different position; nothing is called made");
  }
  return { proof, recovered };
}

/**
 * The same open and commit, for ONE artifact made inside its position (the image generator,
 * Mike, 2026-10-05): open first, make the bytes with the commitment in them, then commit their
 * digest. Same transport, same lost-reply recovery, same refusal of a proof under any other
 * position; the caller verifies what comes back before calling anything made.
 */
export async function openPosition(transport: TreeTransport = {}): Promise<{ slot: SlotAllocation; floor: FloorMark }> {
  return allocate({ ...DEFAULTS, ...transport });
}
export async function commitInPosition(
  transport: TreeTransport,
  position: { slot: SlotAllocation; floor: FloorMark },
  digestB64: string,
  attribution: { name: string; title: string },
): Promise<{ proof: BitGraphProof; recovered: boolean }> {
  const { slot, floor } = position;
  const body: Record<string, unknown> = {
    digests: [{ digestB64, hashAlg: "sha256" }],
    slotId: slot.nonceB64,
    slot,
    chainId: FUSE_CHAIN,
    attribution,
    ...floorField(floor),
  };
  return commit({ ...DEFAULTS, ...transport }, body, digestB64, slot);
}

const codeFor = (p: SitePlacement): number => leafCodeOf(p) ?? 0x03;

/**
 * Make ONE tree of every input: 1 to maxLeaves distinct files, any mix of
 * sizes. Inputs with the same bytes share a leaf (the same file dropped twice
 * is one member and two rows). Returns the proof with everything an export
 * needs beside it, or throws a FuseError (`member` names the input when the
 * failure is one file's). Never commits a partial tree.
 */
export async function makeTree(inputs: readonly TreeInput[], opts: MakeTreeOptions = {}): Promise<MadeTree> {
  const maxLeaves = opts.maxLeaves ?? SITE_MAX_TREE_LEAVES;
  const report = (phase: TreeProgress["phase"], done: number, total: number) => {
    if (opts.onProgress === undefined) return;
    try { opts.onProgress({ phase, done, total }); } catch { /* a progress hook never changes the outcome */ }
  };
  const everyMs = opts.paintEveryMs ?? 250;
  let lastPaint = performance.now();
  const breathe = async (): Promise<void> => {
    if (opts.paint === undefined || performance.now() - lastPaint < everyMs) return;
    await opts.paint();
    lastPaint = performance.now();
  };

  // 0. Check every input before any request: a refusal here spends nothing.
  if (!Array.isArray(inputs) || inputs.length === 0) throw new FuseError("bad-input", "a tree lists at least one file");
  interface Distinct { first: number; input: TreeInput; asIs: boolean; origin: Uint8Array }
  const distinct: Distinct[] = [];
  const keyOf = new Map<string, number>();
  const distinctOf: number[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const f = inputs[i]!;
    const origin = base64ToBytes(f.digestB64);
    if (origin === null || origin.length !== 32) throw new FuseError("bad-input", `${f.name}: the scan left no 32-byte digest`, null, i);
    const asIs = f.asIs === true;
    // The same bytes under the same rule make the same leaf: one member.
    const key = `${asIs ? 0 : 1}:${f.digestB64}`;
    let d = keyOf.get(key);
    if (d === undefined) {
      d = distinct.length;
      keyOf.set(key, d);
      distinct.push({ first: i, input: f, asIs, origin });
    }
    distinctOf.push(d);
    report("hash", i + 1, inputs.length);
  }
  if (distinct.length > maxLeaves) throw new FuseError("bad-input", `a tree the site makes lists at most ${maxLeaves} files (got ${distinct.length})`);

  // 0b. A file the scan left no state for (its length changed while it was
  // read, or an old scan) is scanned again NOW, before any position is
  // opened: streamed, never read whole, and never inside the position's
  // window. Its digest must still be the one dropped.
  for (const d of distinct) {
    const f = d.input;
    if (d.asIs || f.state !== null) continue;
    let again: Awaited<ReturnType<typeof hashBlob>>;
    try {
      again = await hashBlob(f.file);
    } catch (err) {
      throw new FuseError("load-failed", `${f.name} could not be read (${err instanceof Error ? err.message : String(err)})`, null, d.first);
    }
    if (again.digestB64 !== f.digestB64) throw new FuseError("bad-input", `${f.name} changed after it was read; drop it again`, null, d.first);
    if (again.state === null) throw new FuseError("bad-input", `${f.name} could not be streamed into a placement`, null, d.first);
    d.input = { ...f, placement: again.placement, state: again.state };
    await breathe();
  }
  const t: Bound = { ...DEFAULTS, ...(opts.transport ?? {}) };

  // 1. position
  const { slot, floor } = await allocate(t);
  // The spec follows the floor: SPEC v1 defines tree/1 under fuse/2 (an
  // Ethereum anchor), SPEC v2 under fuse/3 (a Base block). Pinned before the
  // leaves, so a missing spec costs no work.
  const fuseVersion = fuseVersionOfFloor(floor);
  let specHash: Uint8Array;
  try {
    specHash = currentTreeSpecHash(fuseVersion);
  } catch (err) {
    throw new FuseError("bad-input", `no tree/1 spec to pin for bitgraph-fuse/${fuseVersion} (${err instanceof Error ? err.message : String(err)}); ${EXPIRING}`);
  }

  // 2. leaves, under commitment/2 or /3. The position's window is running from here.
  const commitment = computeCommitmentFor(slot, floor);
  const leaves: TreeLeaf[] = [];
  const placements: Array<"as-is" | SitePlacement> = [];
  for (let k = 0; k < distinct.length; k++) {
    const d = distinct[k]!;
    const f = d.input;
    await breathe();
    if (d.asIs) {
      leaves.push({ placement: LEAF_AS_IS, artifact: d.origin, origin: d.origin });
      placements.push("as-is");
    } else if (f.state !== null && f.placement !== null && getPlacement(f.placement)?.frame !== undefined) {
      const p = getPlacement(f.placement)!;
      let artifact: Uint8Array;
      try {
        artifact = await finishState(f.state, p.frame!({ originalSize: f.file.size, originDigest: d.origin, commitment }).suffix);
      } catch (err) {
        throw new FuseError("builder-failed", `${f.name}: its saved hash could not be finished (${err instanceof Error ? err.message : String(err)}); ${EXPIRING}`, null, d.first);
      }
      if (!(artifact instanceof Uint8Array) || artifact.length !== 32) throw new FuseError("builder-failed", `${f.name}: its saved hash did not finish to a digest; ${EXPIRING}`, null, d.first);
      leaves.push({ placement: codeFor(f.placement), artifact, origin: d.origin });
      placements.push(f.placement);
    } else {
      // Every placed file reaches here with a state (step 0b scanned the rest
      // again before the position opened): a file is never read whole.
      throw new FuseError("bad-input", `${f.name}: no saved hash state to finish; ${EXPIRING}`, null, d.first);
    }
    report("fuse", k + 1, distinct.length);
  }

  // 3. root
  report("tree", 0, 1);
  let built: ReturnType<typeof buildTree>;
  let rootDocument: Uint8Array;
  try {
    built = buildTree(leaves);
    rootDocument = buildTreeRootDocument(commitment, built.sorted.length, built.root);
  } catch (err) {
    throw new FuseError("bad-input", `the tree could not be built: ${err instanceof Error ? err.message : String(err)}; ${EXPIRING}`);
  }
  const digestB64 = bytesToBase64(await sha256(rootDocument));
  const hex = bytesToHex(rootDocument);
  report("tree", 1, 1);

  // 4. commit
  const attribution = treeAttribution(specHash);
  const body: Record<string, unknown> = {
    digests: [{ digestB64, hashAlg: "sha256" }],
    slotId: slot.nonceB64,
    slot,
    chainId: FUSE_CHAIN,
    attribution,
    metadata: { [TREE_METADATA_KEY]: hex },
    // The floor the commitment bound: the route checks an Ethereum anchor against its ledger before the
    // position is spent, and a Base floor against the floor the proof signs.
    ...floorField(floor),
  };
  if (opts.agency !== undefined) body.agency = opts.agency;
  report("commit", 0, 1);
  const { proof, recovered } = await commit(t, body, digestB64, slot);
  report("commit", 1, 1);

  // The signed marker is the one that was sent, or nothing is called made.
  const a = proof.attribution;
  if (a?.name !== attribution.name || a?.title !== attribution.title || a?.message !== attribution.message) {
    throw new FuseError("verification-failed", "the returned proof does not carry the tree/1 marker that was sent; nothing is called made");
  }
  // The root document rides unsigned: an echo must be these bytes, and a
  // proof that came back without one gets them attached (the route attaches
  // them too), so a proof held in the browser always carries what binds it.
  const md = (proof as { metadata?: unknown }).metadata;
  const mdObj = md !== null && typeof md === "object" && !Array.isArray(md) ? (md as Record<string, unknown>) : null;
  const echoedHex = mdObj?.[TREE_KEY];
  if (echoedHex !== undefined && echoedHex !== hex) {
    throw new FuseError("verification-failed", `the returned proof carries a different root document under metadata["${TREE_KEY}"]`);
  }
  const echoed = echoedHex !== undefined;
  if (!echoed) proof.metadata = { ...(mdObj ?? {}), [TREE_KEY]: hex };

  // A minted proof is read by a verifier before it is called a proof: the
  // signature, the marker and spec, the commitment from the signed record and
  // floor, and the root document bound to the signed digest.
  const v = await verifyTreeMember({ proof, rootDocument });
  if (v.category !== "TREE_ROOT_VALID" || v.tree === null || v.tree.count !== built.sorted.length || v.tree.rootHex !== bytesToHex(built.root)) {
    throw new FuseError("verification-failed", `the returned proof does not verify as this tree: ${v.category} (${v.reason})`);
  }

  // Every member's path, checked against the committed root. A member's
  // export carries its own path; a path that does not reach the root would be
  // an export that cannot verify, so it is caught here instead.
  const count = built.sorted.length;
  const indexOf = new Map<string, number>();
  built.sorted.forEach((l, i) => indexOf.set(bytesToHex(l.artifact), i));
  for (let i = 0; i < count; i++) {
    const reached = treeRootFromMember(built.sorted[i]!, i, count, built.tree.path(i));
    if (reached === null || !bytesEqual(reached, built.root)) throw new FuseError("verification-failed", `leaf ${i}: its path does not reach the committed root`);
    if (i % 2000 === 1999) { report("verify", i + 1, count); await breathe(); }
  }
  report("verify", count, count);
  const sortedLeaves = built.sorted;
  const merkle = built.tree;
  const evidenceOf = (k: number): TreeMemberEvidence => buildTreeMemberEvidence(sortedLeaves[k]!, k, count, merkle.path(k));

  const names: string[] = new Array(count).fill("");
  const members: MadeTreeMember[] = inputs.map((f, i) => {
    const d = distinctOf[i]!;
    const leaf = leaves[d]!;
    const k = indexOf.get(bytesToHex(leaf.artifact))!;
    if (names[k] === "") names[k] = distinct[d]!.input.name;
    return {
      input: i,
      leafIndex: k,
      placement: placements[d]!,
      code: leaf.placement,
      originDigestB64: f.digestB64,
      artifactDigestB64: bytesToBase64(leaf.artifact),
    };
  });
  return {
    proof,
    rootDocument,
    count,
    rootHex: bytesToHex(built.root),
    commitmentB64: bytesToBase64(commitment),
    leaves: built.sorted,
    leavesBytes: encodeTreeLeaves(built.sorted),
    names,
    members,
    evidenceOf,
    recovered,
    echoed,
  };
}

/** A dropped file as a plan sees it: its size, and whether it can be finished without a second read. */
export interface PlanFile {
  size: number;
  /** True when the scan saved a hasher state the placement can finish. */
  stateful: boolean;
  /** True when the user keeps the file as it is: no bytes are read for it. */
  asIs?: boolean;
}

/**
 * Partition a drop into trees, in drop order: a new tree whenever adding a
 * file would pass the site's leaf cap or the re-scan budget. Files kept as is
 * and files with a saved state cost no read, so a drop of photos is one tree
 * up to the leaf cap whatever its size. Returns index groups into `files`.
 * Callers pass distinct files (the same bytes once).
 */
export function planTrees(files: readonly PlanFile[], rereadBudget = DEFAULT_TREE_REREAD_BUDGET, opts: { maxLeaves?: number } = {}): number[][] {
  const maxLeaves = opts.maxLeaves ?? SITE_MAX_TREE_LEAVES;
  const out: number[][] = [];
  let current: number[] = [];
  let reread = 0;
  files.forEach((f, i) => {
    const cost = f.asIs === true || f.stateful ? 0 : f.size;
    if (current.length > 0 && (current.length >= maxLeaves || reread + cost > rereadBudget)) {
      out.push(current);
      current = [];
      reread = 0;
    }
    current.push(i);
    reread += cost;
  });
  if (current.length > 0) out.push(current);
  return out;
}

/* ── Checking a whole tree from its files (Mike, 2026-10-07: "shouldnt i be able to drop the whole
 * folder in"). A tree's leaves are a function of its files and the position's commitment, so the
 * complete set of files rebuilds the tree with no export: each file is hashed (streamed, never read
 * whole), its placement decided from its bytes exactly as makeTree decides it, its committed digest
 * finished under the commitment the signed root document carries, and the sorted leaves give a root.
 * Equal count and root mean every file is a member, unchanged. A partial set, an extra file or an
 * edited one gives another root; which file differs needs the export (the leaves), not this. Files
 * the maker kept as is (no placement) are tried as a second reading of the same drop. */
export interface TreeRebuild {
  /** Distinct files read (the same bytes twice are one leaf, as makeTree counts them). */
  count: number;
  root: Uint8Array;
  /** "placed": every file under its placement; "as-is": every file kept as is. */
  reading: "placed" | "as-is";
}

export async function rebuildTreeFromFiles(
  files: readonly File[],
  commitment: Uint8Array,
  opts: { onProgress?: (done: number, total: number) => void; paint?: () => Promise<void>; paintEveryMs?: number } = {},
): Promise<{ placed: TreeRebuild | null; asIs: TreeRebuild }> {
  const everyMs = opts.paintEveryMs ?? 250;
  let lastPaint = performance.now();
  const breathe = async (): Promise<void> => {
    if (performance.now() - lastPaint < everyMs) return;
    if (opts.paint !== undefined) await opts.paint();
    else await new Promise((r) => setTimeout(r, 0));
    lastPaint = performance.now();
  };
  const placedLeaves = new Map<string, TreeLeaf>();
  const asIsLeaves = new Map<string, TreeLeaf>();
  let placedOk = true;
  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    const scan = await hashBlob(f);
    const origin = base64ToBytes(scan.digestB64);
    if (origin === null || origin.length !== 32) throw new FuseError("bad-input", `${f.name}: the scan left no 32-byte digest`);
    if (!asIsLeaves.has(scan.digestB64)) asIsLeaves.set(scan.digestB64, { placement: LEAF_AS_IS, artifact: origin, origin });
    if (placedOk && !placedLeaves.has(scan.digestB64)) {
      const p = scan.state !== null ? getPlacement(scan.placement) : undefined;
      if (p?.frame === undefined || scan.state === null) placedOk = false;
      else {
        const artifact = await finishState(scan.state, p.frame({ originalSize: f.size, originDigest: origin, commitment }).suffix);
        placedLeaves.set(scan.digestB64, { placement: codeFor(scan.placement), artifact, origin });
      }
    }
    opts.onProgress?.(i + 1, files.length);
    await breathe();
  }
  const asIsBuilt = buildTree([...asIsLeaves.values()]);
  const asIs: TreeRebuild = { count: asIsBuilt.sorted.length, root: asIsBuilt.root, reading: "as-is" };
  if (!placedOk) return { placed: null, asIs };
  const placedBuilt = buildTree([...placedLeaves.values()]);
  return { placed: { count: placedBuilt.sorted.length, root: placedBuilt.root, reading: "placed" }, asIs };
}

/** True when a rebuild is the bound tree: the same number of leaves and the same root. */
export function rebuildMatches(r: TreeRebuild | null, tree: { count: number; root: Uint8Array }): boolean {
  return r !== null && r.count === tree.count && bytesEqual(r.root, tree.root);
}
