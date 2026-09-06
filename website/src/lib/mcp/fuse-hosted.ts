/**
 * Hosted BitGraph: the two-step recipe protocol.
 *
 * The hosted MCP endpoint never holds a caller's file, so it cannot run the
 * SDK's fuse() itself. It does not need to. Every registered placement is a
 * deterministic function of (original bytes, origin digest, commitment), and
 * the bytes that are NOT the original are computable here from the origin
 * digest and size alone. A caller that can hash the original can therefore
 * build the virtual new file from a recipe and hash that (Mike, 2026-09-03).
 *
 *   open    the caller sends the origin digest and size, plus the first bytes
 *           for the placement choice. This server allocates a slot at the
 *           boundary, derives the commitment to the signed slot record, and
 *           returns the recipe: the exact bytes to put after the original
 *           (trailer/1) or around it (container/1), with an opaque token that
 *           carries the slot record back in step two.
 *   commit  the caller assembles the new file, hashes it, and sends that digest
 *           with the token. This server commits under that exact slot with the
 *           signed marker (attribution name = profile, title = placement,
 *           message = origin digest) and returns the proof and the Frame.
 *
 * Two or more files opened together are ONE BitGraph, a set (placement
 * set/1), the way a drop on the site is: one slot is allocated for all of
 * them, every recipe carries the same commitment, each token names the slot
 * and says it belongs to a set, and the commit takes every member's digest at
 * once, builds the canonical manifest of them here, commits ITS digest under
 * the slot with the set marker (title set/1, no origin), verifies the returned
 * proof against the manifest bytes, and reports each file's row. The site's
 * commit route indexes every member, so a lookup by any file's own digest
 * finds the set. A single file is fused on its own, as a single drop is.
 *
 * Only digests, sizes, slot records and recipe bytes travel. File contents are
 * never uploaded, and the new files are virtual: nothing here keeps them.
 *
 * The ustar writer below is a verbatim copy of the one in
 * @mikeargento/bitgraph-verify (container/1). The unit test proves
 * prefix + original + suffix equals that placement's own build, byte for byte.
 */
import { getPlacement,
  CONTAINER_MANIFEST_PATH,
  CONTAINER_ORIGINAL_PATH,
  SET_METADATA_KEY,
  SET_PLACEMENT_ID,
  TRAILER_MAGIC,
  buildFrame,
  buildFusePayload,
  buildSetManifest,
  base64ToBytes,
  bytesEqual,
  bytesToBase64,
  computeSlotCommitment,
  fuseAttribution,
  parseSetManifest,
  readSetMetadata,
  verifyFuse,
  verifyProofIntegrity,
  type BitGraphProof as VerifyProof,
  type FuseFrame,
  type SetMember,
  type SlotAllocation,
} from "@mikeargento/bitgraph-verify";
import { fusedNamesFor, placementForBytes } from "@mikeargento/bitgraph";
import { FUSE_CHAIN, isSlotRecord } from "../fuse-core.ts";
import { apiBaseUrl } from "./api.ts";
import { toUrlSafeB64 } from "./encoding.ts";
import type { BitGraphProof } from "./types.ts";

export type HostedPlacement = "trailer/1" | "container/1" | "container/2";

/**
 * Files per call. Two or more share ONE slot and ONE commit, so the boundary
 * cost does not grow with the count; what does is the answer, one recipe and
 * one token per file, which this keeps inside what a client reads back.
 * Folders of any size are the stdio package's job, on the machine that holds them.
 */
export const MAX_OPEN_FILES = 40;
/** The enclave forgets an unconsumed slot after this long (SLOT_TTL_MS in the enclave). */
export const SLOT_TTL_SECONDS = 120;
/** The ustar size field: 8 GiB - 1. The caller hashes; nothing this size comes here. */
export const MAX_ORIGIN_BYTES = 0o77777777777;
/** The first bytes of the original, for the placement choice. */
export const HEAD_MIN_BYTES = 16;
export const HEAD_MAX_BYTES = 64;

const ALLOCATE_TIMEOUT_MS = 20_000;
const COMMIT_TIMEOUT_MS = 40_000;
const B64_32 = /^[A-Za-z0-9+/]{43}=$/;

// ---------------------------------------------------------------------------
// The recipe: everything in the new file that is not the original.
// ---------------------------------------------------------------------------

const BLOCK = 512;
const utf8 = (s: string) => new TextEncoder().encode(s);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function octal(n: number, width: number): Uint8Array {
  const s = n.toString(8).padStart(width - 1, "0") + "\0";
  if (s.length !== width) throw new RangeError("field overflow");
  return utf8(s);
}

function ustarHeader(name: string, size: number): Uint8Array {
  if (size > MAX_ORIGIN_BYTES) throw new RangeError("container/1 entries are limited to 8 GiB");
  const h = new Uint8Array(BLOCK);
  const nameBytes = utf8(name);
  if (nameBytes.length > 100) throw new RangeError("ustar name too long");
  h.set(nameBytes, 0);
  h.set(utf8("0000644\0"), 100); // mode
  h.set(utf8("0000000\0"), 108); // uid
  h.set(utf8("0000000\0"), 116); // gid
  h.set(octal(size, 12), 124); // size
  h.set(utf8("00000000000\0"), 136); // mtime: 0, the epoch; nothing about a clock enters the bytes
  h.set(utf8("        "), 148); // checksum placeholder
  h[156] = 0x30; // typeflag '0' regular file
  h.set(utf8("ustar\0"), 257); // magic
  h.set(utf8("00"), 263); // version
  let sum = 0;
  for (const b of h) sum += b;
  h.set(utf8(sum.toString(8).padStart(6, "0") + "\0 "), 148);
  return h;
}

function padTo(n: number): number {
  return (BLOCK - (n % BLOCK)) % BLOCK;
}

export type Recipe =
  | { placement: "trailer/1"; append: Uint8Array }
  | { placement: "container/1" | "container/2"; prefix: Uint8Array; suffix: Uint8Array };

/** The bytes the caller adds to the original. Pure: no I/O, no randomness. */
export function recipeFor(
  placement: HostedPlacement,
  originDigest: Uint8Array,
  originSize: number,
  commitment: Uint8Array
): Recipe {
  if (originDigest.length !== 32) throw new TypeError("originDigest must be 32 bytes");
  if (commitment.length !== 32) throw new TypeError("commitment must be 32 bytes");
  if (!Number.isInteger(originSize) || originSize < 0 || originSize > MAX_ORIGIN_BYTES) {
    throw new RangeError("originSize out of range");
  }
  if (placement === "trailer/1") {
    return { placement, append: concat(utf8(TRAILER_MAGIC), new Uint8Array(8), commitment) };
  }
  if (placement === "container/2") {
    // The original first: its header is the whole prefix, and the manifest
    // follows the original. The registered placement states the frame; the
    // test pins prefix + original + suffix to its build byte for byte.
    const f = getPlacement("container/2")!.frame!({ originalSize: originSize, originDigest, commitment });
    return { placement, prefix: f.prefix, suffix: f.suffix };
  }
  const manifest = buildFusePayload(commitment, originDigest);
  return {
    placement,
    prefix: concat(
      ustarHeader(CONTAINER_MANIFEST_PATH, manifest.length),
      manifest,
      new Uint8Array(padTo(manifest.length)),
      ustarHeader(CONTAINER_ORIGINAL_PATH, originSize)
    ),
    suffix: concat(new Uint8Array(padTo(originSize)), new Uint8Array(BLOCK * 2)),
  };
}

/** What a caller builds from a recipe. Used by the test and by nothing on the server: the new file is virtual. */
export function assemble(recipe: Recipe, original: Uint8Array): Uint8Array {
  return recipe.placement === "trailer/1"
    ? concat(original, recipe.append)
    : concat(recipe.prefix, original, recipe.suffix);
}

/**
 * The placement choice, from the first bytes of the original. Without them
 * the safe choice is the container (container/2, the original first), which wraps any bytes. The head must be
 * at least HEAD_MIN_BYTES unless the whole file is shorter, so the decision
 * here matches what the SDK would make with the whole file in hand.
 */
export function choosePlacement(head: Uint8Array | null, originSize: number): HostedPlacement | { error: string } {
  if (head === null) return "container/2";
  if (head.length > HEAD_MAX_BYTES) return { error: `head_base64 carries more than ${HEAD_MAX_BYTES} bytes` };
  if (head.length > originSize) return { error: "head_base64 is longer than the file itself" };
  if (head.length < HEAD_MIN_BYTES && head.length !== originSize) {
    return { error: `head_base64 must carry the first ${HEAD_MIN_BYTES} bytes of the file (or the whole file when it is shorter)` };
  }
  return placementForBytes(head);
}

// ---------------------------------------------------------------------------
// The token: the open step's state, echoed back by the caller. Opaque, not secret.
// Everything in it is either the enclave-signed slot record or what the caller
// itself declared; the boundary re-checks the slot at commit.
// ---------------------------------------------------------------------------

export interface OpenState {
  v: 1;
  slot: SlotAllocation;
  placement: HostedPlacement;
  origin: { digestB64: string; size: number; name: string };
  fusedName: string;
  frameName: string;
  /** Present when the slot was opened for two or more files at once: the commit makes one set of every token that shares it. */
  set?: true;
}

export function encodeToken(state: OpenState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

export function decodeToken(token: string): OpenState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const s = parsed as Record<string, unknown>;
  if (s.v !== 1) return null;
  if (!isSlotRecord(s.slot)) return null;
  if (s.placement !== "trailer/1" && s.placement !== "container/1" && s.placement !== "container/2") return null;
  if (s.set !== undefined && s.set !== true) return null;
  const origin = s.origin as Record<string, unknown> | undefined;
  if (
    typeof origin !== "object" || origin === null ||
    typeof origin.digestB64 !== "string" || !B64_32.test(origin.digestB64) ||
    typeof origin.size !== "number" || !Number.isInteger(origin.size) || origin.size < 0 || origin.size > MAX_ORIGIN_BYTES ||
    typeof origin.name !== "string" || origin.name.length === 0 || origin.name.length > 255
  ) {
    return null;
  }
  if (typeof s.fusedName !== "string" || typeof s.frameName !== "string") return null;
  return {
    v: 1,
    slot: s.slot as unknown as SlotAllocation,
    placement: s.placement,
    origin: { digestB64: origin.digestB64, size: origin.size, name: origin.name },
    fusedName: s.fusedName,
    frameName: s.frameName,
    ...(s.set === true ? { set: true as const } : {}),
  };
}

// ---------------------------------------------------------------------------
// The boundary, through this site's own /api/fuse routes: the same gate, the
// same flag, the same slot consumption a browser drop goes through.
// ---------------------------------------------------------------------------

export class HostedFuseError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly retryAfterSec: number | null;
  constructor(code: string, message: string, status: number | null = null, retryAfterSec: number | null = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

async function boundaryPost(path: string, body: unknown, timeoutMs: number): Promise<{ status: number; json: unknown; retryAfterSec: number | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiBaseUrl()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON body */
    }
    const raw = res.headers.get("retry-after");
    const retry = raw !== null ? Number.parseInt(raw, 10) : NaN;
    return { status: res.status, json, retryAfterSec: Number.isFinite(retry) ? retry : null };
  } finally {
    clearTimeout(timer);
  }
}

const messageOf = (json: unknown, fallback: string): string => {
  const e = (json as { error?: unknown } | null)?.error;
  return typeof e === "string" && e.length > 0 ? e : fallback;
};
const codeOf = (json: unknown): string | null => {
  const c = (json as { code?: unknown } | null)?.code;
  return typeof c === "string" ? c : null;
};

export interface Opened {
  token: string;
  state: OpenState;
  recipe: Recipe;
  commitmentB64: string;
  slotCounter: string;
  epochB64: string;
}

export interface OpenInput {
  name: string;
  size: number;
  digestB64: string;
  head: Uint8Array | null;
}

/** What the recipe needs from one file, checked before any slot exists so a bad input costs nothing. */
function memberInput(input: OpenInput): { originDigest: Uint8Array; placement: HostedPlacement } {
  const originDigest = base64ToBytes(input.digestB64);
  if (originDigest === null || originDigest.length !== 32) throw new HostedFuseError("bad-input", "digest must be a base64 SHA-256");
  const placement = choosePlacement(input.head, input.size);
  if (typeof placement !== "string") throw new HostedFuseError("bad-input", placement.error);
  return { originDigest, placement };
}

/** One slot from the boundary, through the site's own gate. */
async function allocateHosted(): Promise<SlotAllocation> {
  const alloc = await boundaryPost("/api/fuse/allocate", {}, ALLOCATE_TIMEOUT_MS);
  if (alloc.status !== 200) {
    throw new HostedFuseError(
      codeOf(alloc.json) ?? "allocate-failed",
      messageOf(alloc.json, `allocation refused (${alloc.status})`),
      alloc.status,
      alloc.retryAfterSec
    );
  }
  const a = alloc.json as { slotId?: unknown; slot?: unknown; chainId?: unknown } | null;
  if (a === null || !isSlotRecord(a.slot) || a.slotId !== a.slot.nonceB64 || a.chainId !== FUSE_CHAIN) {
    throw new HostedFuseError("allocate-failed", "the allocation response is not a slot record", alloc.status);
  }
  return a.slot as unknown as SlotAllocation;
}

/** The recipe and token for one file under a held slot. Pure once the slot is in hand. */
function openMember(slot: SlotAllocation, commitment: Uint8Array, input: OpenInput, member: { originDigest: Uint8Array; placement: HostedPlacement }, set: boolean): Opened {
  const recipe = recipeFor(member.placement, member.originDigest, input.size, commitment);
  const names = fusedNamesFor(input.name, member.placement);
  const state: OpenState = {
    v: 1,
    slot,
    placement: member.placement,
    origin: { digestB64: input.digestB64, size: input.size, name: input.name },
    fusedName: names.fusedName,
    frameName: names.frameName,
    ...(set ? { set: true as const } : {}),
  };
  return {
    token: encodeToken(state),
    state,
    recipe,
    commitmentB64: bytesToBase64(commitment),
    slotCounter: slot.counter,
    epochB64: toUrlSafeB64(slot.epochId),
  };
}

/** Step one for a single file: a slot for it, and the recipe for the bytes that will occupy it. */
export async function openHosted(input: OpenInput): Promise<Opened> {
  const member = memberInput(input);
  const slot = await allocateHosted();
  return openMember(slot, computeSlotCommitment(slot), input, member, false);
}

export interface OpenedSet {
  slot: SlotAllocation;
  commitmentB64: string;
  slotCounter: string;
  epochB64: string;
  /** In the order given. */
  members: Opened[];
}

/**
 * Step one for two or more files: ONE slot for all of them, and each file's
 * recipe for that slot's commitment. Every token carries the slot and the
 * set flag, so the commit makes one set of them. Inputs are checked before
 * the allocation; a bad one refuses the whole call and costs no slot.
 */
export async function openHostedSet(inputs: readonly OpenInput[]): Promise<OpenedSet> {
  if (inputs.length < 2) throw new HostedFuseError("bad-input", "a set opens two or more files");
  const members = inputs.map(memberInput);
  const slot = await allocateHosted();
  const commitment = computeSlotCommitment(slot);
  return {
    slot,
    commitmentB64: bytesToBase64(commitment),
    slotCounter: slot.counter,
    epochB64: toUrlSafeB64(slot.epochId),
    members: inputs.map((input, i) => openMember(slot, commitment, input, members[i]!, true)),
  };
}

export type Committed = {
  proof: BitGraphProof;
  frame: FuseFrame;
  recovered: boolean;
};

/** A proof under this exact slot for these exact bytes, or null. */
function proofUnderSlot(candidates: readonly BitGraphProof[], slot: SlotAllocation, artifactDigestB64: string): BitGraphProof | null {
  for (const p of candidates) {
    const s = p.slotAllocation as { nonceB64?: unknown } | undefined;
    if (p.artifact?.digestB64 === artifactDigestB64 && p.commit?.nonceB64 === slot.nonceB64 && s?.nonceB64 === slot.nonceB64) return p;
  }
  return null;
}

/** Read back by digest: a commit that reached the boundary may have minted even if the reply was lost. */
async function recover(slot: SlotAllocation, artifactDigestB64: string): Promise<BitGraphProof | null> {
  try {
    const res = await fetch(`${apiBaseUrl()}/api/proofs/digest/${encodeURIComponent(toUrlSafeB64(artifactDigestB64))}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status !== 200) return null;
    const j = (await res.json()) as { proofs?: Array<{ proof?: BitGraphProof }> } | null;
    const list = (j?.proofs ?? []).map((e) => e.proof).filter((p): p is BitGraphProof => p !== undefined);
    return proofUnderSlot(list, slot, artifactDigestB64);
  } catch {
    return null;
  }
}

/**
 * One commit under a held slot, with the lost-reply and refused-reply
 * recovery rules, and the two checks no caller may skip: the proof is under
 * this exact slot for these exact bytes, and it carries the marker that was
 * sent. What comes back is still unread as a proof; the caller runs the
 * verification it can.
 */
async function commitUnderSlot(
  slot: SlotAllocation,
  artifactDigestB64: string,
  body: { attribution: { name?: string; title?: string; message?: string } } & Record<string, unknown>,
): Promise<{ proof: BitGraphProof; recovered: boolean }> {
  let proof: BitGraphProof | null = null;
  let recovered = false;
  let reply: { status: number; json: unknown; retryAfterSec: number | null } | null = null;
  try {
    reply = await boundaryPost("/api/fuse/commit", body, COMMIT_TIMEOUT_MS);
  } catch (err) {
    proof = await recover(slot, artifactDigestB64);
    if (proof === null) throw new HostedFuseError("transport", `the commit request failed: ${err instanceof Error ? err.message : String(err)}`);
    recovered = true;
  }
  if (proof === null && reply !== null) {
    if (reply.status === 200) {
      const j = reply.json as { proof?: BitGraphProof } | null;
      proof = j?.proof ?? null;
      if (proof === null) throw new HostedFuseError("commit-refused", "the commit response carried no proof", 200);
    } else {
      const code = codeOf(reply.json);
      if (reply.status === 409 && code === "slot-unavailable") {
        proof = await recover(slot, artifactDigestB64);
        if (proof === null) throw new HostedFuseError("slot-unavailable", messageOf(reply.json, "the slot is no longer available"), 409);
        recovered = true;
      } else if (reply.status === 503 && code === "tee-restarting") {
        proof = await recover(slot, artifactDigestB64);
        if (proof === null) throw new HostedFuseError("tee-restarting", messageOf(reply.json, "the boundary is restarting"), 503, reply.retryAfterSec);
        recovered = true;
      } else {
        throw new HostedFuseError(code ?? "commit-refused", messageOf(reply.json, `commit refused (${reply.status})`), reply.status, reply.retryAfterSec);
      }
    }
  }
  if (proof === null) throw new HostedFuseError("transport", "no proof");

  // Never label as fused a proof under any other slot or for any other bytes.
  if (proofUnderSlot([proof], slot, artifactDigestB64) === null) {
    throw new HostedFuseError("slot-mismatch", "the boundary returned a proof under a different slot; nothing is labelled fused");
  }
  const attr = proof.attribution;
  const want = body.attribution;
  if (attr?.name !== want.name || attr?.title !== want.title || (attr?.message ?? undefined) !== want.message) {
    throw new HostedFuseError("marker-mismatch", "the returned proof does not carry the signed marker that was sent; nothing is labelled fused");
  }
  return { proof, recovered };
}

/** Step two for a single file: consume that exact slot with the digest of the bytes the caller built. */
export async function commitHosted(state: OpenState, artifactDigestB64: string): Promise<Committed> {
  const artifactDigest = base64ToBytes(artifactDigestB64);
  if (artifactDigest === null || artifactDigest.length !== 32) throw new HostedFuseError("bad-input", "artifact digest must be a base64 SHA-256");
  const originDigest = base64ToBytes(state.origin.digestB64);
  if (originDigest === null || originDigest.length !== 32) throw new HostedFuseError("bad-input", "the token carries no origin digest");
  const { slot, placement } = state;
  const { proof, recovered } = await commitUnderSlot(slot, artifactDigestB64, {
    digests: [{ digestB64: artifactDigestB64, hashAlg: "sha256" }],
    slotId: slot.nonceB64,
    slot,
    chainId: FUSE_CHAIN,
    attribution: fuseAttribution(placement, originDigest),
  });
  // A minted proof is checked by a reader before it is called a proof. The
  // bytes are not here, so this is the integrity half: signature, slot binding,
  // attestation. The byte half is the caller's, and any verifier's, with the file.
  const integrity = await verifyProofIntegrity({ proof: proof as unknown as VerifyProof });
  if (!integrity.valid) {
    throw new HostedFuseError("verification-failed", `the returned proof does not verify: ${integrity.reason ?? "unknown reason"}`);
  }
  const frame = buildFrame({
    proof: proof as unknown as VerifyProof,
    placement,
    artifactDigest,
    originDigest,
    fusedFile: state.fusedName,
  });
  return { proof, frame, recovered };
}

/* ── Sets: two or more files under one slot ── */

export interface SetEntry {
  state: OpenState;
  /** Standard base64: SHA-256 of the new file the caller built from this member's recipe. */
  artifactDigestB64: string;
}

export interface SetManifestBuilt {
  /** The canonical manifest bytes: the committed artifact. */
  manifestBytes: Uint8Array;
  manifestObject: Record<string, unknown>;
  /** Standard base64 of manifestBytes. */
  digestB64: string;
  /** Row ordinal in the canonical manifest, per entry (entries with the same fused digest share a row). */
  rowOf: number[];
  count: number;
}

/**
 * The canonical set manifest for entries that share a slot: one row per
 * distinct fused digest {artifact, origin, placement}, rows sorted by the
 * placement's own rule, the slot's commitment inside. Pure; the boundary
 * never sees a member's bytes, only this list and its digest.
 */
export async function setManifestFor(entries: readonly SetEntry[]): Promise<SetManifestBuilt> {
  if (entries.length === 0) throw new HostedFuseError("bad-input", "a set commits at least one member");
  const slot = entries[0]!.state.slot;
  const commitment = computeSlotCommitment(slot);
  const members: SetMember[] = [];
  const seen = new Map<string, number>();
  for (const e of entries) {
    if (e.state.slot.nonceB64 !== slot.nonceB64) throw new HostedFuseError("bad-input", "every member of a set commits under the same slot");
    const artifact = base64ToBytes(e.artifactDigestB64);
    if (artifact === null || artifact.length !== 32) throw new HostedFuseError("bad-input", `${e.state.origin.name}: artifact digest must be a base64 SHA-256`);
    const origin = base64ToBytes(e.state.origin.digestB64);
    if (origin === null || origin.length !== 32) throw new HostedFuseError("bad-input", `${e.state.origin.name}: the token carries no origin digest`);
    if (seen.has(e.artifactDigestB64)) continue;
    seen.set(e.artifactDigestB64, members.length);
    members.push({ artifact, origin, placement: e.state.placement });
  }
  const manifestBytes = buildSetManifest(commitment, members);
  const parsed = parseSetManifest(manifestBytes);
  if (parsed === null) throw new HostedFuseError("bad-input", "the set manifest did not round-trip");
  const rowIndex = new Map<string, number>();
  parsed.members.forEach((row, k) => rowIndex.set(bytesToBase64(row.artifact), k));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", manifestBytes as BufferSource));
  return {
    manifestBytes,
    manifestObject: JSON.parse(new TextDecoder().decode(manifestBytes)) as Record<string, unknown>,
    digestB64: bytesToBase64(digest),
    rowOf: entries.map((e) => rowIndex.get(e.artifactDigestB64) as number),
    count: parsed.members.length,
  };
}

export interface CommittedSet {
  /** The set proof, carrying the manifest under metadata whatever the boundary echoed. */
  proof: BitGraphProof;
  manifestBytes: Uint8Array;
  /** Standard base64: the committed artifact's digest. */
  artifactDigestB64: string;
  count: number;
  /** Per entry, in the order given: the row this member holds in the canonical manifest. */
  rowOf: number[];
  recovered: boolean;
  /** True when the boundary echoed the manifest in the proof's metadata. */
  manifestEchoed: boolean;
}

/**
 * Step two for a set: every member's fused digest at once, the manifest of
 * them built here, its digest committed under the shared slot with the set
 * marker, and the returned proof verified against the manifest bytes by the
 * reader every verifier is (FUSED_DIRECT under set/1) before any file is
 * called fused. The site's commit route validates the manifest against the
 * slot before the boundary sees it and indexes every member afterwards.
 */
export async function commitHostedSet(entries: readonly SetEntry[]): Promise<CommittedSet> {
  const built = await setManifestFor(entries);
  const slot = entries[0]!.state.slot;
  const { proof, recovered } = await commitUnderSlot(slot, built.digestB64, {
    digests: [{ digestB64: built.digestB64, hashAlg: "sha256" }],
    slotId: slot.nonceB64,
    slot,
    chainId: FUSE_CHAIN,
    attribution: fuseAttribution(SET_PLACEMENT_ID),
    metadata: { [SET_METADATA_KEY]: built.manifestObject },
  });
  // The committed bytes ARE in hand here, so the whole verification runs, not only the integrity half.
  const verification = await verifyFuse({ proof: proof as unknown as VerifyProof, bytes: built.manifestBytes });
  if (verification.category !== "FUSED_DIRECT" || verification.placement !== SET_PLACEMENT_ID) {
    throw new HostedFuseError("verification-failed", `the returned proof does not verify as a set: ${verification.category}${verification.reason ? ` (${verification.reason})` : ""}`);
  }
  const echoed = readSetMetadata(proof as unknown as VerifyProof);
  if (echoed !== null && !bytesEqual(echoed, built.manifestBytes)) {
    throw new HostedFuseError("verification-failed", "the returned proof echoes a different set manifest; nothing is labelled fused");
  }
  if (echoed === null) {
    const prior = proof.metadata;
    proof.metadata = { ...(typeof prior === "object" && prior !== null && !Array.isArray(prior) ? (prior as Record<string, unknown>) : {}), [SET_METADATA_KEY]: built.manifestObject };
  }
  return { proof, manifestBytes: built.manifestBytes, artifactDigestB64: built.digestB64, count: built.count, rowOf: built.rowOf, recovered, manifestEchoed: echoed !== null };
}

export interface CommitGroups {
  /** Entries whose tokens name a slot opened for a set, grouped by slot, in first-seen order. */
  sets: Array<{ slot: SlotAllocation; entries: Array<SetEntry & { position: number }> }>;
  /** Entries whose tokens were opened one file to a slot. */
  solos: Array<SetEntry & { position: number }>;
}

/**
 * Sort decoded commit entries by what their tokens say: members of one set
 * commit together under their shared slot, single files commit on their own.
 * A slot opened for a set but reaching the commit with one member is still a
 * set of one; the token decides, never the count.
 */
export function groupCommitEntries(entries: readonly Array<SetEntry & { position: number }>[number][]): CommitGroups {
  const sets = new Map<string, { slot: SlotAllocation; entries: Array<SetEntry & { position: number }> }>();
  const solos: Array<SetEntry & { position: number }> = [];
  for (const e of entries) {
    if (e.state.set === true) {
      const key = e.state.slot.nonceB64;
      const group = sets.get(key) ?? { slot: e.state.slot, entries: [] };
      group.entries.push(e);
      sets.set(key, group);
    } else {
      solos.push(e);
    }
  }
  return { sets: [...sets.values()], solos };
}

// ---------------------------------------------------------------------------
// Outcomes, in the product's vocabulary, and their rendering.
// ---------------------------------------------------------------------------

export interface OpenOutcome {
  name: string;
  digest: string; // origin, URL-safe
  outcome: "opened" | "on record" | "not opened";
  /** True when this file shares its slot with the others opened in the same call: they commit together as one set. */
  set?: boolean;
  placement: HostedPlacement | null;
  slot_counter: string | null;
  epoch: string | null;
  fused_name: string | null;
  frame_name: string | null;
  fuse_token: string | null;
  recipe:
    | { kind: "append"; append_base64: string }
    | { kind: "wrap"; prefix_base64: string; suffix_base64: string }
    | null;
  total_positions: number;
  proof_url: string | null;
  error: string | null;
}

export interface CommitOutcome {
  name: string;
  origin_digest: string; // URL-safe
  artifact_digest: string; // URL-safe
  outcome: "fused" | "not fused";
  placement: HostedPlacement;
  slot_counter: string | null;
  counter: string | null;
  epoch: string | null;
  fused_name: string;
  frame_name: string;
  proof_url: string | null;
  /* Every position these bytes occupy after this commit, newest last, filled
     by one ledger read after the commits land. Without it a caller who asked
     to BitGraph a file AGAIN could only be told about the position it just
     made: the commit knows its own counter and nothing about the earlier
     ones, so "again" reported the same as a first recording. */
  positions: Array<{ counter: string | null; epoch: string | null }>;
  recovered: boolean;
  error: string | null;
  /** Set members only: this file's row in the set, 1-based, of member_count. */
  member?: number;
  member_count?: number;
  /** Set members only: the set proof's artifact digest (URL-safe), the manifest of every member. */
  set_digest?: string;
}

/** The one BitGraph a set commit makes: one position for every member. */
export interface SetOutcome {
  slot_counter: string;
  counter: string | null;
  epoch: string | null; // URL-safe
  count: number;
  /** URL-safe: the manifest's digest, the committed artifact. */
  artifact_digest: string;
  proof_url: string;
  manifest_echoed: boolean;
  recovered: boolean;
}

export function recipeJson(recipe: Recipe): NonNullable<OpenOutcome["recipe"]> {
  return recipe.placement === "trailer/1"
    ? { kind: "append", append_base64: Buffer.from(recipe.append).toString("base64") }
    : { kind: "wrap", prefix_base64: Buffer.from(recipe.prefix).toString("base64"), suffix_base64: Buffer.from(recipe.suffix).toString("base64") };
}

export const ASSEMBLY_INSTRUCTIONS =
  "Build each new file locally, exactly: kind 'append' means new_file = original + append; kind 'wrap' means new_file = prefix + original + suffix (all base64-decoded to bytes). " +
  "Never alter the original. Then SHA-256 the new file, base64 that, and call bitgraph_commit with the fuse_token and that digest. " +
  `The slot expires ${SLOT_TTL_SECONDS} seconds after it is opened: commit inside that window, in the same session. A file need not be read twice: hash it with a copyable hasher before opening (Python's hashlib supports copy()), then finish a copy with the recipe's bytes.`;

export const SET_INSTRUCTIONS =
  "The files opened together share ONE slot and are ONE BitGraph: commit every one of them in a single bitgraph_commit call, each with its own fuse_token and digest. " +
  "Whatever that call carries becomes the set; a member left out cannot be added afterwards (the slot is consumed) and would need a new open.";

export function renderOpenMarkdown(outcomes: readonly OpenOutcome[]): string {
  const opened = outcomes.filter((o) => o.outcome === "opened");
  const onRecord = outcomes.filter((o) => o.outcome === "on record");
  const failed = outcomes.filter((o) => o.outcome === "not opened");
  const asSet = opened.length > 0 && opened.every((o) => o.set === true);
  const lines: string[] = [];
  const head = asSet ? `${opened.length} opened under one slot #${opened[0]?.slot_counter ?? "?"} (one set)` : `${opened.length} opened`;
  let headline = `${head}, ${onRecord.length} already on record.`;
  if (failed.length > 0) headline = `${head}, ${onRecord.length} already on record, ${failed.length} NOT opened.`;
  lines.push(headline);
  for (const o of outcomes) {
    if (o.outcome === "opened") {
      /* An `again` open already knows the file's history, so say it here rather
         than letting the caller assume a first recording. */
      const prior = o.total_positions > 0 ? ` · already at ${o.total_positions} position${o.total_positions === 1 ? "" : "s"}` : "";
      lines.push(`- opened · slot #${o.slot_counter ?? "?"} · ${o.name} · ${o.placement} → ${o.fused_name}${prior}`);
    } else if (o.outcome === "on record") {
      const note = o.total_positions > 1 ? ` (${o.total_positions} positions)` : "";
      lines.push(`- on record · ${o.name}${note}\n  ${o.proof_url}`);
    } else {
      lines.push(`- not opened · ${o.name} · ${o.error ?? "unknown error"}`);
    }
  }
  if (opened.length > 0) {
    lines.push("", ASSEMBLY_INSTRUCTIONS);
    if (asSet) lines.push("", SET_INSTRUCTIONS);
    lines.push("", "Each opened file's fuse_token and recipe are in the JSON (response_format=json returns them in full).");
  }
  if (onRecord.length > 0) {
    lines.push("", "Files already on record were not opened. To make a new BitGraph of one deliberately, call bitgraph_open with again=true.");
  }
  return lines.join("\n");
}

export function renderCommitMarkdown(outcomes: readonly CommitOutcome[], sets: readonly SetOutcome[] = []): string {
  const fused = outcomes.filter((o) => o.outcome === "fused");
  const failed = outcomes.filter((o) => o.outcome === "not fused");
  const lines: string[] = [];
  const setNote = sets.length === 1 ? ` as one set at #${sets[0]?.counter ?? "?"} (set of ${sets[0]?.count ?? "?"})` : sets.length > 1 ? ` in ${sets.length} sets` : "";
  lines.push(failed.length > 0 ? `${fused.length} fused${setNote}, ${failed.length} NOT fused.` : `${fused.length} fused${setNote}.`);
  for (const s of sets) {
    const rec = s.recovered ? " (recovered from the ledger)" : "";
    lines.push(`- set · slot #${s.slot_counter} → #${s.counter ?? "?"} · set of ${s.count}${rec}\n  ${s.proof_url}`);
  }
  for (const o of outcomes) {
    if (o.outcome === "fused" && o.member !== undefined) {
      lines.push(`- fused · ${o.name} → ${o.fused_name} (${o.member} of ${o.member_count ?? "?"}, ${o.placement})`);
      if (o.positions.length > 1) {
        const all = o.positions.map((p) => `#${p.counter ?? "?"}`).join(" · ");
        lines.push(`  ${o.positions.length} positions for these bytes: ${all}`);
      }
    } else if (o.outcome === "fused") {
      const rec = o.recovered ? " (recovered from the ledger)" : "";
      lines.push(`- fused · slot #${o.slot_counter ?? "?"} → #${o.counter ?? "?"} · ${o.name} → ${o.fused_name}${rec}\n  ${o.proof_url}`);
      if (o.positions.length > 1) {
        const all = o.positions.map((p) => `#${p.counter ?? "?"}`).join(" · ");
        lines.push(`  ${o.positions.length} positions for these bytes: ${all}`);
      }
    } else {
      lines.push(`- not fused · ${o.name} · ${o.error ?? "unknown error"}`);
    }
  }
  if (fused.some((o) => o.positions.length > 1)) {
    lines.push(
      "",
      "A file may occupy any number of positions. Report every position listed above, not only the one just made."
    );
  }
  if (sets.length > 0) {
    lines.push(
      "",
      "Each set's proof (with the manifest listing every member) is in the JSON as sets[].proof; save it once beside the originals. A member's new file is virtual: the original plus the set proof rebuilds it, and a lookup by the original's digest finds the set."
    );
  }
  if (fused.some((o) => o.member === undefined)) {
    lines.push(
      "",
      "Each fused file's Frame (proof plus manifest) is in the JSON as frames[]; save it next to the original as frame_name. The new file is virtual: the original plus the Frame rebuilds it, so keep the original unchanged."
    );
  }
  return lines.join("\n");
}
