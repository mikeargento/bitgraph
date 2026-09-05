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
 * Only digests, sizes, slot records and recipe bytes travel. File contents are
 * never uploaded, and the new file is virtual: nothing here keeps it.
 *
 * The ustar writer below is a verbatim copy of the one in
 * @mikeargento/bitgraph-verify (container/1). The unit test proves
 * prefix + original + suffix equals that placement's own build, byte for byte.
 */
import { getPlacement,
  CONTAINER_MANIFEST_PATH,
  CONTAINER_ORIGINAL_PATH,
  TRAILER_MAGIC,
  buildFrame,
  buildFusePayload,
  base64ToBytes,
  bytesToBase64,
  computeSlotCommitment,
  fuseAttribution,
  verifyProofIntegrity,
  type BitGraphProof as VerifyProof,
  type FuseFrame,
  type SlotAllocation,
} from "@mikeargento/bitgraph-verify";
import { fusedNamesFor, placementForBytes } from "@mikeargento/bitgraph";
import { FUSE_CHAIN, isSlotRecord } from "../fuse-core.ts";
import { apiBaseUrl } from "./api.ts";
import { toUrlSafeB64 } from "./encoding.ts";
import type { BitGraphProof } from "./types.ts";

export type HostedPlacement = "trailer/1" | "container/1" | "container/2";

/** Files per call: each one is a slot allocation now and a commit later, inside the route's window. */
export const MAX_OPEN_FILES = 10;
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
  if (s.placement !== "trailer/1" && s.placement !== "container/1") return null;
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

/** Step one: a slot for this file, and the recipe for the bytes that will occupy it. */
export async function openHosted(input: { name: string; size: number; digestB64: string; head: Uint8Array | null }): Promise<Opened> {
  const originDigest = base64ToBytes(input.digestB64);
  if (originDigest === null || originDigest.length !== 32) throw new HostedFuseError("bad-input", "digest must be a base64 SHA-256");
  const placement = choosePlacement(input.head, input.size);
  if (typeof placement !== "string") throw new HostedFuseError("bad-input", placement.error);

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
  const slot = a.slot as unknown as SlotAllocation;
  const commitment = computeSlotCommitment(slot);
  const recipe = recipeFor(placement, originDigest, input.size, commitment);
  const names = fusedNamesFor(input.name, placement);
  const state: OpenState = {
    v: 1,
    slot,
    placement,
    origin: { digestB64: input.digestB64, size: input.size, name: input.name },
    fusedName: names.fusedName,
    frameName: names.frameName,
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

/** Step two: consume that exact slot with the digest of the bytes the caller built. */
export async function commitHosted(state: OpenState, artifactDigestB64: string): Promise<Committed> {
  const artifactDigest = base64ToBytes(artifactDigestB64);
  if (artifactDigest === null || artifactDigest.length !== 32) throw new HostedFuseError("bad-input", "artifact digest must be a base64 SHA-256");
  const originDigest = base64ToBytes(state.origin.digestB64);
  if (originDigest === null || originDigest.length !== 32) throw new HostedFuseError("bad-input", "the token carries no origin digest");
  const { slot, placement } = state;
  const body = {
    digests: [{ digestB64: artifactDigestB64, hashAlg: "sha256" }],
    slotId: slot.nonceB64,
    slot,
    chainId: FUSE_CHAIN,
    attribution: fuseAttribution(placement, originDigest),
  };

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

// ---------------------------------------------------------------------------
// Outcomes, in the product's vocabulary, and their rendering.
// ---------------------------------------------------------------------------

export interface OpenOutcome {
  name: string;
  digest: string; // origin, URL-safe
  outcome: "opened" | "on record" | "not opened";
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
}

export function recipeJson(recipe: Recipe): NonNullable<OpenOutcome["recipe"]> {
  return recipe.placement === "trailer/1"
    ? { kind: "append", append_base64: Buffer.from(recipe.append).toString("base64") }
    : { kind: "wrap", prefix_base64: Buffer.from(recipe.prefix).toString("base64"), suffix_base64: Buffer.from(recipe.suffix).toString("base64") };
}

export const ASSEMBLY_INSTRUCTIONS =
  "Build each new file locally, exactly: kind 'append' means new_file = original + append; kind 'wrap' means new_file = prefix + original + suffix (all base64-decoded to bytes). " +
  "Never alter the original. Then SHA-256 the new file, base64 that, and call bitgraph_commit with the fuse_token and that digest. " +
  "The slot is held until the boundary's daily restart (23:59 UTC); commit in the same session.";

export function renderOpenMarkdown(outcomes: readonly OpenOutcome[]): string {
  const opened = outcomes.filter((o) => o.outcome === "opened");
  const onRecord = outcomes.filter((o) => o.outcome === "on record");
  const failed = outcomes.filter((o) => o.outcome === "not opened");
  const lines: string[] = [];
  let headline = `${opened.length} opened, ${onRecord.length} already on record.`;
  if (failed.length > 0) headline = `${opened.length} opened, ${onRecord.length} already on record, ${failed.length} NOT opened.`;
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
    lines.push("", ASSEMBLY_INSTRUCTIONS, "", "Each opened file's fuse_token and recipe are in the JSON (response_format=json returns them in full).");
  }
  if (onRecord.length > 0) {
    lines.push("", "Files already on record were not opened. To make a new BitGraph of one deliberately, call bitgraph_open with again=true.");
  }
  return lines.join("\n");
}

export function renderCommitMarkdown(outcomes: readonly CommitOutcome[]): string {
  const fused = outcomes.filter((o) => o.outcome === "fused");
  const failed = outcomes.filter((o) => o.outcome === "not fused");
  const lines: string[] = [];
  lines.push(failed.length > 0 ? `${fused.length} fused, ${failed.length} NOT fused.` : `${fused.length} fused.`);
  for (const o of outcomes) {
    if (o.outcome === "fused") {
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
  if (fused.length > 0) {
    lines.push(
      "",
      "Each fused file's Frame (proof plus manifest) is in the JSON as frames[]; save it next to the original as frame_name. The new file is virtual: the original plus the Frame rebuilds it, so keep the original unchanged."
    );
  }
  return lines.join("\n");
}
