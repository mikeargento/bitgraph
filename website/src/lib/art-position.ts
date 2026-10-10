/**
 * The image generator's protocol half (Mike, 2026-10-05): open a position, make the image FROM
 * its commitment, record the image in THAT position, and read the proof back before anything
 * is called made. Nothing here is new protocol: the open and the commit are the drop box's own
 * (fuse-tree-make.ts, with its lost-reply recovery), the marker is the inline one the MCP task
 * form uses (bitgraph-fuse/3 on a Base floor, bitgraph-fuse/2 on an Ethereum one, carry
 * "base64url": the commitment is inside the bytes as text),
 * and the checks are the published verifier's, plus the two only this image can offer:
 * regenerate it from the commitment the proof authenticates, and read the strip.
 *
 * Order is the whole point, so it is enforced, not described: the commitment exists before a
 * single pixel is drawn, the image is never made first, and a position is never swapped for
 * another. Only the PNG's SHA-256 leaves the browser.
 */
import { sha256 } from "@noble/hashes/sha256";
import {
  bytesToBase64, bytesEqual, commitmentForProof, inlineAttribution, signedFloorOf, verifyCarrier, verifyFuse, verifyProofIntegrity,
  type BitGraphProof, type CarrierClaim,
} from "@mikeargento/bitgraph-verify";
import { FuseError } from "@mikeargento/bitgraph";
import { computeCommitmentFor } from "./fuse-commitment.ts";
import { commitInPosition, fuseVersionOfFloor, openPosition, type TreeTransport } from "./fuse-tree-make.ts";
import { ART_ALGORITHM, ART_ALGORITHM_V2, ART_ALGORITHM_V3, ART_ALGORITHM_V4, ART_ALGORITHM_V5, ART_ALGORITHM_V6, ART_ALGORITHM_V7, ART_ALGORITHM_V8, ART_ALGORITHM_V9, ART_ALGORITHM_V10, ART_ALGORITHM_V11, ART_ALGORITHM_V12, ART_ALGORITHM_V13, ART_ALGORITHM_V14, ART_ALGORITHM_V15, ART_ALGORITHM_V16, ART_ALGORITHM_V17, checkArt, makeArt, toBase64Url, type ArtChecks, type ArtManifest, type ArtRecipe } from "./commitment-art.ts";
import { makeArtOffThread, paintsOffThread, type DrawnArt } from "./art-offthread.ts";

/** A position is good for 120 s; the image is recorded well inside that or not at all. */
export const POSITION_TTL_MS = 120_000;
const COMMIT_DEADLINE_MS = 105_000;

export type ArtStage = "opening" | "generating" | "recording" | "verifying" | "ready";

export type ArtErrorCode = "tee-restarting" | "open-failed" | "expired" | "record-failed" | "verification-failed";
export class ArtError extends Error {
  readonly code: ArtErrorCode;
  readonly recorded: boolean;
  constructor(code: ArtErrorCode, message: string, recorded = false) {
    super(message);
    this.name = "ArtError";
    this.code = code;
    this.recorded = recorded;
  }
}

export interface OpenedPosition {
  /** The position's counter on bitgraph:main. */
  slotCounter: string;
  epochId: string;
  /** The block the position opened after (the floor). */
  floorBlock: number;
  /** The floor's chain: "base" since enclave v10, "ethereum" before. */
  floorChain: "ethereum" | "base";
  /** The commitment, unpadded base64url: the image's only input. */
  commitment: string;
}

export interface MadeArtImage {
  position: OpenedPosition;
  /** The exact bytes recorded: the PNG whose SHA-256 the proof names. */
  png: Uint8Array;
  digestB64: string;
  proof: BitGraphProof;
  recipe: ArtRecipe;
  /** The canonical RGBA pixels the PNG decodes to. */
  pixels: Uint8Array;
  manifest: ArtManifest;
  checks: ArtChecks;
  /** True when the commit reply was lost and the proof was read back by digest. */
  recovered: boolean;
}

export interface ArtOptions {
  transport?: TreeTransport;
  onStage?: (stage: ArtStage, position: OpenedPosition | null) => void;
  /** The canonical pixels, the moment they exist (before the commit): for display only. */
  onDrawn?: (pixels: Uint8Array) => void;
  /** Injectable clock for tests; the wall clock never reaches the art. */
  now?: () => number;
  /** The drawing rules: the site's default (ART_ALGORITHM, a painting) unless a page asks for another (/generate, once /three: version 16; home: version 17). */
  algorithm?: string;
}

function fail(e: unknown, recorded: boolean): ArtError {
  if (e instanceof ArtError) return e;
  const code = e instanceof FuseError ? e.code : null;
  const msg = e instanceof Error ? e.message : String(e);
  if (code === "tee-restarting") return new ArtError("tee-restarting", "BitGraph's enclave is restarting (it does every day at 23:59 UTC). Try again in a minute.");
  if (code === "slot-unavailable") return new ArtError("expired", "The position expired before the image was recorded. Create another opens a new position and draws a new image.");
  if (code === "allocate-failed" || (!recorded && code === "network")) return new ArtError("open-failed", `The position could not be opened: ${msg}`);
  return new ArtError("record-failed", `The image could not be recorded: ${msg}`);
}

/**
 * One click: open, show the commitment, draw, record, verify. Throws an ArtError; when one is
 * thrown after the commit, `recorded` says so, because a proof exists even if it failed here.
 */
export async function createArtImage(opts: ArtOptions = {}): Promise<MadeArtImage> {
  const now = opts.now ?? (() => Date.now());
  const stage = opts.onStage ?? (() => {});
  const transport = opts.transport ?? {};

  stage("opening", null);
  let position: Awaited<ReturnType<typeof openPosition>>;
  try {
    position = await openPosition(transport);
  } catch (e) {
    throw fail(e, false);
  }
  const openedAt = now();
  const commitment = computeCommitmentFor(position.slot, position.floor);
  const opened: OpenedPosition = {
    slotCounter: String(position.slot.counter),
    epochId: String(position.slot.epochId),
    floorBlock: position.floor.blockNumber,
    floorChain: fuseVersionOfFloor(position.floor) === 3 ? "base" : "ethereum",
    commitment: toBase64Url(commitment),
  };

  stage("generating", opened);
  // A painting (version 15) is drawn in a worker, so the page stays responsive; the same modules, the same bytes.
  const art = await makeArtOffThread(commitment, opts.algorithm ?? ART_ALGORITHM);
  opts.onDrawn?.(art.pixels);
  const digestB64 = bytesToBase64(sha256(art.png));
  if (now() - openedAt > COMMIT_DEADLINE_MS) {
    throw new ArtError("expired", "The position ran out of time before the image could be recorded, so nothing was recorded. Create another opens a new position and draws a new image.");
  }

  stage("recording", opened);
  let proof: BitGraphProof, recovered: boolean;
  try {
    const sent = inlineAttribution(fuseVersionOfFloor(position.floor));
    const r = await commitInPosition(transport, position, digestB64, sent);
    proof = r.proof as unknown as BitGraphProof;
    recovered = r.recovered;
    if (proof.attribution?.name !== sent.name || proof.attribution?.title !== sent.title) {
      throw new ArtError("verification-failed", "The proof came back without the marker that was sent.", true);
    }
  } catch (e) {
    throw fail(e, false);
  }

  stage("verifying", opened);
  const integrity = await verifyProofIntegrity({ proof });
  if (!integrity.valid) throw new ArtError("verification-failed", `The proof does not verify: ${integrity.reason ?? "unknown reason"}`, true);
  if (proof.artifact?.digestB64 !== digestB64) throw new ArtError("verification-failed", "The proof names a different digest from the image.", true);
  const fuse = await verifyFuse({ proof, bytes: art.png });
  if (fuse.category !== "CARRIED_INLINE") throw new ArtError("verification-failed", `The verifier does not find this position's commitment in the image (${fuse.category}).`, true);
  const authenticated = commitmentForProof(proof, proof.slotAllocation!);
  if (!bytesEqual(authenticated, commitment)) throw new ArtError("verification-failed", "The proof authenticates a different commitment from the one the image was drawn from.", true);
  // The pixels were drawn from `commitment`, which is the authenticated commitment byte for byte (checked above), so the
  // check compares the file with them rather than painting the same picture a second time.
  const checks = await checkArt(art.png, authenticated, { commitment, algorithm: art.recipe.algorithm, pixels: art.pixels });
  if (checks.regenerated.result !== "TRUE" || checks.strip.result !== "TRUE") {
    throw new ArtError("verification-failed", `The image does not regenerate from its commitment: ${checks.regenerated.detail}`, true);
  }

  stage("ready", opened);
  return { position: opened, png: art.png, digestB64, proof, recipe: art.recipe, pixels: art.pixels, manifest: art.manifest, checks, recovered };
}

/* ── Checking a downloaded image-and-proof file, on this machine ───────────────────── */

export type CheckResult = "TRUE" | "FALSE" | "UNDETERMINED";
export interface ArtVerification {
  /** 1. The exact recorded bytes hash to the proof's digest. */
  digest: { result: CheckResult; detail: string };
  /** 2. The published verifier over the proof block: signature, attestation, commitment, floor, ceilings. */
  protocol: { result: CheckResult; detail: string; claims: CarrierClaim[]; ceiling: "present" | "unfetched" | "none" | null };
  /** 3. Regenerated from the authenticated commitment, the pixels match. */
  regenerated: { result: CheckResult; detail: string };
  /** 4. The strip spells that same commitment. */
  strip: { result: CheckResult; detail: string };
  /** The commitment the proof authenticates, base64url, when there is a proof to read. */
  commitment: string | null;
  digestB64: string | null;
  /** "complete" only when every check is TRUE and the anchors are in; never otherwise. */
  overall: "complete" | "pending" | "failed";
}

const PENDING: CheckResult = "UNDETERMINED";

/** Verify a BitGraphed image (the PNG with its proof block at the end) without contacting anyone. */
export async function verifyArtFile(bytes: Uint8Array, pcr0: readonly string[]): Promise<ArtVerification> {
  const v = await verifyCarrier(bytes, { pins: { pcr0: [...pcr0] } });
  const none = (detail: string) => ({ result: PENDING, detail });
  if (v.payload === null || v.inner === null) {
    return { digest: none(v.reading), protocol: { result: "UNDETERMINED", detail: v.reading, claims: v.claims, ceiling: null }, regenerated: none("no proof block to read the commitment from"), strip: none("no proof block to read the commitment from"), commitment: null, digestB64: null, overall: "failed" };
  }
  const proof = v.payload.proof as unknown as BitGraphProof;
  const digestClaim = v.claims.find((c) => c.id === "bytes.digest");
  const digest = { result: (digestClaim?.result ?? "UNDETERMINED") as CheckResult, detail: digestClaim?.detail ?? "the digest was not checked" };
  const protocolClaims = v.claims.filter((c) => c.id !== "bytes.digest");
  const protocol = { result: v.verdict as CheckResult, detail: v.reading, claims: protocolClaims, ceiling: v.ceiling };

  let authenticated: Uint8Array | null = null;
  try { if (proof.slotAllocation) authenticated = commitmentForProof(proof, proof.slotAllocation); } catch { authenticated = null; }
  const art = authenticated === null
    ? { regenerated: { result: "FALSE" as CheckResult, detail: "the proof carries no position record to authenticate a commitment" }, strip: { result: "FALSE" as CheckResult, detail: "no authenticated commitment to compare with" } }
    : await checkArt(v.inner, authenticated);

  const all = [digest.result, protocol.result, art.regenerated.result, art.strip.result];
  const overall: ArtVerification["overall"] = all.includes("FALSE") ? "failed" : all.every((r) => r === "TRUE") && (v.ceiling === "present" || v.ceiling === "none") ? "complete" : "pending";
  return {
    digest,
    protocol,
    regenerated: art.regenerated,
    strip: art.strip,
    commitment: authenticated === null ? null : toBase64Url(authenticated),
    digestB64: proof.artifact?.digestB64 ?? null,
    overall,
  };
}

/* ── The proof page opens the image: redrawn from code, never stored ─────────────────── */

/**
 * For a proof recorded with the inline marker, redraw the image from the commitment the proof authenticates and return it
 * only when its SHA-256 IS the recorded digest: the exact recorded file, rebuilt byte for byte, so it can be shown and
 * checked as the file in hand. Only versions with the fixed deflate can be rebuilt this way (bitgraph-art/2 and later); a
 * version-1 file's bytes came from a browser's compressor, so it is not rebuilt here (its pixels still redraw).
 * Newest version first. A painting (version 15) is drawn in a worker (onTry says which version is being drawn, so the
 * page can say it is painting); it is skipped for a record recorded before version 15 existed: the caller passes the
 * record's signed time (recordedMs, the attestation's own timestamp), or the proof's slot or commit time stands in.
 */
export const V15_FROM_MS = Date.UTC(2026, 9, 9);
/** Version 16 (/three) exists from the same day; a few hundred ms to draw, so it is tried first. */
export const V16_FROM_MS = Date.UTC(2026, 9, 9);
/** Version 17 (the home page's 16:9 Three) exists from 2026-10-10; as quick to draw as 16, and the most made, so it is tried first. */
export const V17_FROM_MS = Date.UTC(2026, 9, 10);
export async function redrawRecordedArt(proof: BitGraphProof, opts: { onTry?: (algorithm: string | null) => void; recordedMs?: number | null } = {}): Promise<{ png: Uint8Array; algorithm: string; art: DrawnArt } | null> {
  const a = proof.attribution;
  if (!a || a.title !== "base64url" || (a.name !== inlineAttribution(2).name && a.name !== inlineAttribution(3).name) || !proof.slotAllocation) return null;
  let commitment: Uint8Array;
  try { commitment = commitmentForProof(proof, proof.slotAllocation); } catch { return null; }
  const signedMs = Number(opts.recordedMs ?? proof.slotAllocation.time ?? proof.commit?.time ?? NaN);
  const before15 = Number.isFinite(signedMs) && signedMs < V15_FROM_MS;
  const before16 = Number.isFinite(signedMs) && signedMs < V16_FROM_MS;
  const before17 = Number.isFinite(signedMs) && signedMs < V17_FROM_MS;
  try {
    for (const algorithm of [ART_ALGORITHM_V17, ART_ALGORITHM_V16, ART_ALGORITHM_V15, ART_ALGORITHM_V14, ART_ALGORITHM_V13, ART_ALGORITHM_V12, ART_ALGORITHM_V11, ART_ALGORITHM_V10, ART_ALGORITHM_V8, ART_ALGORITHM_V9, ART_ALGORITHM_V7, ART_ALGORITHM_V6, ART_ALGORITHM_V5, ART_ALGORITHM_V4, ART_ALGORITHM_V3, ART_ALGORITHM_V2]) {
      if (algorithm === ART_ALGORITHM_V15 && before15) continue;
      if (algorithm === ART_ALGORITHM_V16 && before16) continue;
      if (algorithm === ART_ALGORITHM_V17 && before17) continue;
      // Each drawing is a few hundred ms of main thread (a painting, seconds in a worker); yield between them so the page
      // paints and stays responsive while a record that is not an /image picture is ruled out (2026-10-07).
      opts.onTry?.(algorithm);
      await new Promise((r) => setTimeout(r, 0));
      const art = paintsOffThread(algorithm) ? await makeArtOffThread(commitment, algorithm) : await makeArt(commitment, algorithm);
      if (bytesToBase64(sha256(art.png)) === proof.artifact?.digestB64) return { png: art.png, algorithm, art };
    }
    return null;
  } finally {
    opts.onTry?.(null);
  }
}

/* ── Coming back to an image (Mike, 2026-10-06: "if you navigate away from the page the image is gone
 * forever"). It never was: the recorded file is a function of its proof. /image?p=<digest> reads the
 * proof back by digest and rebuilds the whole made image from it, byte for byte, or gives nothing. */
export async function restoreArtImage(proof: BitGraphProof, opts: { onTry?: (algorithm: string | null) => void; recordedMs?: number | null } = {}): Promise<MadeArtImage | null> {
  const redrawn = await redrawRecordedArt(proof, opts);
  if (!redrawn || !proof.slotAllocation) return null;
  const commitment = commitmentForProof(proof, proof.slotAllocation);
  const art = redrawn.art; // drawn from this commitment by redrawRecordedArt, and its file is the recorded one
  const checks = await checkArt(art.png, commitment, { commitment, algorithm: redrawn.algorithm, pixels: art.pixels });
  const slot = proof.slotAllocation as unknown as { counter: string | number; epochId: string };
  let floor: ReturnType<typeof signedFloorOf> = null;
  try { floor = signedFloorOf(proof); } catch { floor = null; }
  return {
    position: { slotCounter: String(slot.counter), epochId: String(slot.epochId), floorBlock: floor?.blockNumber ?? 0, floorChain: floor?.chain ?? "ethereum", commitment: toBase64Url(commitment) },
    png: art.png,
    digestB64: proof.artifact!.digestB64,
    proof,
    recipe: art.recipe,
    pixels: art.pixels,
    manifest: art.manifest,
    checks,
    recovered: false,
  };
}
