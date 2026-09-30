/**
 * The site's carrier glue: assemble a bitgraph-carrier/1 from a proof the
 * page already holds, and complete a dropped carrier's time window.
 *
 * Everything here is material-fetching and honesty plumbing around the
 * format module (lib/carrier.ts, the byte-identical copy of the verify
 * package's). Nothing is stamped unverified: every anchor is checked with
 * the published verifier over its own signed message, matched by identity
 * against the proof's signed slotAnchor (floor) or counter order (ceiling),
 * and every block header is recomputed with keccak before it travels.
 *
 * A fetch that fails throws with words, never a silent downgrade: "could not
 * fetch" and "has not landed yet" are different sentences (the anchors route
 * says which with `bound.state`, and a read failure there is a 503).
 */

import {
  verify, createVerificationContext, verifyCeiling, assembleCarrierV2Payload, carrierBlockSize, CARRIER_BLOCK_ZIP_LIMIT,
  BITGRAPH_CEILING_WRITER, BASE_MAINNET_CHAIN_ID, computeProofHash, type BitGraphProof,
} from "@mikeargento/bitgraph-verify";
import {
  buildCarrier, parseCarrier, completeCarrier, completeCarrierInTime, carrierBounds, carrierVersionOf,
  checkFloorBinding, checkCeilingBinding, anchorMessageBytes, verifyWitnessHeader,
  innerDigestMatches,
  type CarrierPayload, type CarrierProof, type CarrierWitness, type CarrierParse, type CarrierBounds, type CarrierCeilingInTime,
} from "./carrier";
import { toUrlSafeB64 } from "./explorer";

type AnchorSideAnswer = {
  anchors?: Array<Record<string, unknown>>;
  bound?: { state: "anchored" | "pending" | "closed" | "none" | "unknown-epoch"; note?: string };
};

function commitOf(proof: CarrierProof): { counter: string; epochId: string; slotCounter: string | null; slotAnchor: { counter: string; blockNumber: number; blockHash: string } | null } | null {
  const c = (proof as { commit?: Record<string, unknown> }).commit;
  if (!c || typeof c !== "object") return null;
  const counter = c["counter"], epochId = c["epochId"];
  if (typeof counter !== "string" || typeof epochId !== "string") return null;
  const sa = c["slotAnchor"] as { counter?: unknown; blockNumber?: unknown; blockHash?: unknown } | undefined;
  const slotAnchor = sa && typeof sa.counter === "string" && typeof sa.blockNumber === "number" && typeof sa.blockHash === "string"
    ? { counter: sa.counter, blockNumber: sa.blockNumber, blockHash: sa.blockHash }
    : null;
  const slotCounter = typeof c["slotCounter"] === "string" ? (c["slotCounter"] as string) : null;
  return { counter, epochId, slotCounter, slotAnchor };
}

async function fetchAnchorSide(counter: string, epochId: string, side: "before" | "after"): Promise<AnchorSideAnswer> {
  const q = `counter=${encodeURIComponent(counter)}&epoch=${encodeURIComponent(epochId)}&${side === "before" ? "before=1" : "limit=1"}`;
  const r = await fetch(`/api/proofs/anchors?${q}`);
  if (!r.ok) throw new Error(`the ledger read for the ${side === "before" ? "floor" : "closing"} anchor failed (${r.status}); nothing was concluded from it`);
  return (await r.json()) as AnchorSideAnswer;
}

async function fetchWitness(blockNumber: number, blockHash: string): Promise<CarrierWitness> {
  const r = await fetch(`/api/proofs/witness?block=${blockNumber}&hash=${encodeURIComponent(blockHash)}`);
  if (!r.ok) throw new Error(`the block-header witness for block ${blockNumber} could not be fetched (${r.status})`);
  const w = (await r.json()) as { headerRlpHex?: string; blockNumber?: number; blockHash?: string };
  if (typeof w.headerRlpHex !== "string" || typeof w.blockNumber !== "number" || typeof w.blockHash !== "string") {
    throw new Error("the witness answer did not carry a header");
  }
  return { headerRlpHex: w.headerRlpHex, blockNumber: w.blockNumber, blockHash: w.blockHash };
}

/** Verify an anchor proof + witness pair completely, client side, before it is embedded anywhere. */
async function vetAnchor(anchor: Record<string, unknown>, witness: CarrierWitness, what: string): Promise<void> {
  const msg = anchorMessageBytes(anchor);
  if (msg.error !== null) throw new Error(`${what}: ${msg.error}`);
  const res = await verify({ proof: anchor as unknown as BitGraphProof, bytes: msg.bytes, context: createVerificationContext() });
  if (!res.valid) throw new Error(`${what} does not verify: ${res.reason ?? "unspecified"}`);
  const w = verifyWitnessHeader(witness);
  if (!w.ok) throw new Error(`${what} witness: ${w.error}`);
}

/**
 * A short, capped wait for the anchor that follows, only while the ledger says
 * "pending" (the live epoch, none landed yet): most of the time the next
 * anchor is seconds away, and a file that leaves complete never needs a second
 * step. "closed" and "none" are permanent answers and are never waited on, and
 * the cap keeps the idle cadence (anchors up to an hour apart) from hanging
 * anyone: past it, the file leaves floor-only with the honest note, as before.
 */
async function fetchAfterWithWait(counter: string, epochId: string, waitMs: number): Promise<AnchorSideAnswer> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const after = await fetchAnchorSide(counter, epochId, "after");
    if (after.bound?.state !== "pending" || Date.now() >= deadline) return after;
    await new Promise((r) => setTimeout(r, 3000));
  }
}

export interface BuiltCarrier {
  bytes: Uint8Array;
  fileName: string;
  /** The ceiling in position: the next anchor. */
  ceiling: "present" | "unfetched";
  /** The ceiling in time: the Base block the record existed by. */
  ceilingInTime: "present" | "unfetched";
  /** Whether the openssl attestation witness is inside (left out only to keep a ZIP-family file under its limit). */
  witness: boolean;
  bounds: CarrierBounds;
  /** Why the ceiling is unfetched, when it is: the anchors route's own word. */
  ceilingNote: string | null;
}

/** PK\x03\x04: a ZIP-family file (zip, docx, xlsx, pptx), whose reader must find its end record within the last 64 KiB. */
function isZipFamily(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * The ceiling in time for a proof, from this site's own route, verified with
 * the published verifier before it travels. null with pending=true when the
 * writer has not written one yet (404, or a sidecar still without a
 * transaction); a sidecar that does not verify throws, since a carrier is
 * never built on a guess.
 */
async function fetchCeilingInTime(proof: BitGraphProof): Promise<{ sidecar: Record<string, unknown> | null; pending: boolean }> {
  const ph = (proof as { proofHash?: string }).proofHash ?? computeProofHash(proof);
  const r = await fetch(`/api/ceilings/${encodeURIComponent(toUrlSafeB64(ph))}`);
  if (r.status === 404) return { sidecar: null, pending: true };
  if (!r.ok) throw new Error(`the ceiling read failed (${r.status}); nothing was concluded from it`);
  const sidecar = (await r.json()) as Record<string, unknown>;
  const v = await verifyCeiling(proof as never, sidecar as never, { writerAddress: BITGRAPH_CEILING_WRITER, chainId: BASE_MAINNET_CHAIN_ID });
  if (!v.ok) {
    if (v.status === "pending") return { sidecar: null, pending: true };
    throw new Error(`the ceiling in time does not verify: ${v.reason ?? "unspecified"}`);
  }
  return { sidecar, pending: false };
}

/** The v2 payload for these parts, kept under the ZIP limit when the bytes are a ZIP-family file. */
function payloadWithinLimits(committedBytes: Uint8Array, parts: Parameters<typeof assembleCarrierV2Payload>[0]): { payload: CarrierPayload; witness: boolean } {
  let payload = assembleCarrierV2Payload(parts as never) as unknown as CarrierPayload;
  let witness = payload.attestation !== undefined;
  if (isZipFamily(committedBytes) && carrierBlockSize(payload as never) > CARRIER_BLOCK_ZIP_LIMIT) {
    payload = assembleCarrierV2Payload({ ...parts, withAttestationWitness: false } as never) as unknown as CarrierPayload;
    witness = false;
    if (carrierBlockSize(payload as never) > CARRIER_BLOCK_ZIP_LIMIT) {
      throw new Error(`the proof block (${carrierBlockSize(payload as never)} bytes) would pass the 64 KiB a ZIP-family file can carry after its end record; download the proof beside the file instead`);
    }
  }
  return { payload, witness };
}

/** photo.jpg → photo.bitgraph.jpg; a name already in that form keeps it. */
export function carrierFileName(name: string): string {
  if (/\.bitgraph(\.[^.]+)?$/i.test(name)) return name;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}.bitgraph${name.slice(dot)}` : `${name}.bitgraph`;
}
/** The inverse, for a dropped carrier's inner bytes. */
export function innerFileName(name: string): string {
  return name.replace(/\.bitgraph(\.[^.]+)$/i, "$1").replace(/\.bitgraph$/i, "");
}

/**
 * Strip carriers out of a list of dropped files, so every check downstream
 * runs on the committed bytes. The envelope's own hash is recorded nowhere:
 * hashing the outer file would answer "never recorded" about bytes that are.
 * Only files whose last 8 bytes are the magic are read whole; a block that is
 * present but unreadable leaves the file untouched and is reported as such.
 */
export interface DeCarrierNote {
  name: string;
  ceiling: "present" | "unfetched" | "corrupt";
  outer?: Uint8Array;
  /** The carried proof, when the inner bytes hash to its artifact digest: the row needs no lookup. */
  proof?: CarrierProof;
  /** false: the bytes inside do NOT match the carried proof. Stated, and the file goes through as plain bytes. */
  innerMatches?: boolean;
}

/**
 * No real carrier is smaller than this. Its block always holds the proof and
 * the floor anchor's proof, each an attested bitgraph/1 proof of several KB
 * (both carriers measured 2026-09-28 carry about 29 KB). A file under it
 * cannot be one, so it is not opened at all.
 *
 * ⚠️ THIS IS WHAT A BIG DROP WAITED ON. Every file used to have its last 8
 * bytes read, one file at a time, before hashing could start. Each read is a
 * round trip through the browser's file layer however small, and 55,000
 * small files took 8.6s of it, measured: the spinner that sat on "Reading
 * your folder… 55,000 files" (Mike, 2026-09-28: "it just spins for a moment
 * if its alot of files").
 */
const CARRIER_MIN_BYTES = 4096;
/** Tail reads in flight, for the files big enough to check (a folder of photos). */
const TAIL_READS_IN_FLIGHT = 32;

export async function deCarrierFiles(files: File[]): Promise<{ files: File[]; notes: DeCarrierNote[]; proofs: Map<File, CarrierProof> }> {
  const MAGIC = [0x42, 0x47, 0x50, 0x52, 0x4f, 0x4f, 0x46, 0x01];
  const out = files.slice();
  const notes: DeCarrierNote[] = [];
  const proofs = new Map<File, CarrierProof>();
  // Which files end in the magic, read in parallel. Only those are read whole.
  const tagged: number[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(TAIL_READS_IN_FLIGHT, out.length) }, async () => {
    while (next < out.length) {
      const i = next++;
      const f = out[i];
      if (f.size < CARRIER_MIN_BYTES) continue;
      try {
        const tail = new Uint8Array(await f.slice(f.size - 8).arrayBuffer());
        if (MAGIC.every((b, j) => tail[j] === b)) tagged.push(i);
      } catch { /* unreadable: the file goes through the normal path untouched */ }
    }
  }));
  // The few that are carriers, in drop order, so the notes read in that order.
  tagged.sort((a, b) => a - b);
  for (const i of tagged) {
    const f = out[i];
    try {
      const whole = new Uint8Array(await f.arrayBuffer());
      const parsed = parseCarrier(whole);
      if (parsed.kind === "carrier") {
        const inner = new File([parsed.inner.slice() as Uint8Array<ArrayBuffer>], innerFileName(f.name), { type: f.type, lastModified: f.lastModified });
        out[i] = inner;
        const matches = innerDigestMatches(parsed.inner, parsed.payload);
        // A matching carrier is its own answer: the carried proof rides with the
        // row, so the drop needs no lookup and can never re-mint what it holds.
        if (matches) proofs.set(inner, parsed.payload.proof);
        // The outer bytes ride along only while incomplete, so one click can
        // fetch the closing anchor and hand back the completed file.
        notes.push(parsed.payload.ceiling.status === "unfetched"
          ? { name: f.name, ceiling: "unfetched", outer: whole, ...(matches ? { proof: parsed.payload.proof } : {}), innerMatches: matches }
          : { name: f.name, ceiling: parsed.payload.ceiling.status, ...(matches ? { proof: parsed.payload.proof } : {}), innerMatches: matches });
      } else if (parsed.kind === "corrupt") {
        notes.push({ name: f.name, ceiling: "corrupt" });
      }
    } catch { /* unreadable: the file goes through the normal path untouched */ }
  }
  return { files: out, notes, proofs };
}

/**
 * Assemble a carrier around committed bytes the page holds. The floor is the
 * anchor the proof's signed slotAnchor names, fetched and verified; the
 * ceiling is stamped only when the ledger says one has landed, and left
 * `unfetched` in so many words otherwise. Throws with a sentence on any
 * failed read: a carrier is never built on a guess.
 */
export async function buildCarrierForProof(committedBytes: Uint8Array, proofIn: { version: string; commit: unknown }, fileName: string, opts: { waitForCeilingMs?: number } = {}): Promise<BuiltCarrier> {
  const proof = proofIn as unknown as BitGraphProof;
  const c = commitOf(proof as unknown as CarrierProof);
  if (c === null) throw new Error("the proof is missing its commit fields");
  if (c.slotAnchor === null) throw new Error("this proof carries no signed floor (recorded before enclave v7), so it cannot travel as a carrier");

  // The floor, by identity: ask for the anchor before the SLOT (never the commit).
  const floorAt = c.slotCounter ?? c.counter;
  const floorSide = await fetchAnchorSide(floorAt, c.epochId, "before");
  const floorAnchor = floorSide.anchors?.[0];
  if (!floorAnchor) throw new Error(`the floor anchor could not be read from the ledger (${floorSide.bound?.state ?? "no answer"}); the proof still names it, try again`);
  const floorWitness = await fetchWitness(c.slotAnchor.blockNumber, c.slotAnchor.blockHash);
  await vetAnchor(floorAnchor, floorWitness, "the floor anchor");

  const floor = { status: "present" as const, anchor: floorAnchor as CarrierProof, witness: floorWitness };
  const floorErrs = checkFloorBinding(proof as unknown as CarrierProof, floor);
  if (floorErrs.length > 0) throw new Error(`the fetched anchor is not the signed floor: ${floorErrs[0]}`);
  if (!innerDigestMatches(committedBytes, { carrier: "bitgraph-carrier/2", proof: proof as unknown as CarrierProof, floor, ceiling: { status: "unfetched" } })) {
    throw new Error("these bytes do not hash to the proof's artifact digest; refusing to build a carrier around them");
  }

  // The ceiling in position, if one has landed. "pending" and "could not fetch" stay distinct sentences.
  let ceiling: CarrierPayload["ceiling"] = { status: "unfetched" };
  let ceilingNote: string | null = null;
  try {
    const after = await fetchAfterWithWait(c.counter, c.epochId, opts.waitForCeilingMs ?? 0);
    const anchor = after.anchors?.[0];
    if (after.bound?.state === "anchored" && anchor) {
      const id = (anchor as { commit?: { anchor?: { blockNumber?: number; blockHash?: string } } }).commit?.anchor;
      if (id && typeof id.blockNumber === "number" && typeof id.blockHash === "string") {
        const w = await fetchWitness(id.blockNumber, id.blockHash);
        await vetAnchor(anchor, w, "the closing anchor");
        const candidate = { status: "present" as const, basis: "counter-order" as const, anchor: anchor as CarrierProof, witness: w };
        const errs = checkCeilingBinding(proof as unknown as CarrierProof, candidate);
        if (errs.length > 0) throw new Error(errs[0]);
        ceiling = candidate;
      }
    }
    if (ceiling.status !== "present") ceilingNote = after.bound?.note ?? "No anchor follows this position yet.";
  } catch (e) {
    // The floor stands on its own; an unreachable ceiling is stated, not silently blessed or invented.
    ceilingNote = e instanceof Error ? e.message : "The closing anchor could not be fetched.";
  }

  // The ceiling in time: the Base block, seconds after the commit. Not yet is a state, not a failure.
  let ceilingInTime: CarrierCeilingInTime = { status: "unfetched", searched: { at: new Date().toISOString() } };
  try {
    const { sidecar } = await fetchCeilingInTime(proof);
    if (sidecar !== null) ceilingInTime = { status: "present", sidecar };
  } catch (e) {
    ceilingNote = ceilingNote ?? (e instanceof Error ? e.message : "The Base ceiling could not be fetched.");
  }

  const { payload, witness } = payloadWithinLimits(committedBytes, { proof: proof as unknown as CarrierProof, floor, ceiling, ceilingInTime });
  return {
    bytes: buildCarrier(committedBytes, payload),
    fileName: carrierFileName(fileName),
    ceiling: ceiling.status,
    ceilingInTime: ceilingInTime.status,
    witness,
    bounds: carrierBounds(payload),
    ceilingNote,
  };
}

/**
 * The anchor pair for a proof, as the ledger serves them: full anchor proofs,
 * each carrying its own block header in metadata, so one JSON file per anchor
 * is self-contained evidence. The floor is the signed slotAnchor's anchor when
 * the proof carries one (v7+), else the anchor before the commit; the closing
 * anchor is the first after the commit, and "none yet" is an answer.
 */
export async function fetchAnchorPair(proofIn: { version: string; commit: unknown }): Promise<{
  floor: Record<string, unknown> | null;
  ceiling: Record<string, unknown> | null;
  note: string | null;
}> {
  const c = commitOf(proofIn as unknown as CarrierProof);
  if (c === null) throw new Error("the proof is missing its commit fields");
  const floorAt = c.slotAnchor !== null ? (c.slotCounter ?? c.counter) : c.counter;
  const [beforeSide, afterSide] = await Promise.all([
    fetchAnchorSide(floorAt, c.epochId, "before"),
    fetchAnchorSide(c.counter, c.epochId, "after"),
  ]);
  const floor = beforeSide.anchors?.[0] ?? null;
  const ceiling = afterSide.bound?.state === "anchored" ? (afterSide.anchors?.[0] ?? null) : null;
  const note = ceiling === null ? (afterSide.bound?.note ?? "No anchor follows this position yet.") : null;
  return { floor, ceiling, note };
}

export interface CompletionResult {
  /** "completed" | "already-complete" | "pending" | "failed" */
  status: "completed" | "already-complete" | "pending" | "failed";
  bytes: Uint8Array;
  note: string;
  bounds: CarrierBounds | null;
}

/**
 * Fetch and stamp what followed the commit into a dropped carrier: the closing
 * anchor, and on a /2 file the Base block. Never overwrites, never invents.
 */
export async function completeDroppedCarrier(bytes: Uint8Array, opts: { waitForCeilingMs?: number } = {}): Promise<CompletionResult> {
  let p: CarrierParse = parseCarrier(bytes);
  if (p.kind !== "carrier") {
    return { status: "failed", bytes, note: p.kind === "none" ? "This file carries no proof block." : `The proof block is unreadable: ${p.reason}`, bounds: null };
  }
  const v2 = carrierVersionOf(p.payload) === 2;
  const needsAnchor = p.payload.ceiling.status !== "present";
  const needsTime = v2 && p.payload.ceilingInTime?.status !== "present";
  if (!needsAnchor && !needsTime) {
    return { status: "already-complete", bytes, note: "The time window inside is already complete.", bounds: carrierBounds(p.payload) };
  }
  const c = commitOf(p.payload.proof);
  if (c === null) return { status: "failed", bytes, note: "The carried proof is missing its commit fields.", bounds: null };
  let out = bytes;
  const stamped: string[] = [];
  const pending: string[] = [];

  if (needsAnchor) {
    const after = await fetchAfterWithWait(c.counter, c.epochId, opts.waitForCeilingMs ?? 0);
    const anchor = after.anchors?.[0];
    if (after.bound?.state === "anchored" && anchor) {
      const id = (anchor as { commit?: { anchor?: { blockNumber?: number; blockHash?: string } } }).commit?.anchor;
      if (!id || typeof id.blockNumber !== "number" || typeof id.blockHash !== "string") {
        return { status: "failed", bytes, note: "The ledger's closing anchor carries no signed block identity.", bounds: carrierBounds(p.payload) };
      }
      const w = await fetchWitness(id.blockNumber, id.blockHash);
      await vetAnchor(anchor, w, "the closing anchor");
      const errs = checkCeilingBinding(p.payload.proof, { status: "present", basis: "counter-order", anchor: anchor as CarrierProof, witness: w });
      if (errs.length > 0) return { status: "failed", bytes, note: `The closing anchor does not bind: ${errs[0]}`, bounds: carrierBounds(p.payload) };
      const done = completeCarrier(out, { anchor: anchor as CarrierProof, witness: w });
      if (done.error) return { status: "failed", bytes, note: done.error, bounds: carrierBounds(p.payload) };
      out = done.bytes;
      stamped.push("the closing anchor");
    } else pending.push(after.bound?.note ?? "No anchor follows this position yet.");
  }

  if (needsTime) {
    const { sidecar } = await fetchCeilingInTime(p.payload.proof as unknown as BitGraphProof);
    if (sidecar !== null) {
      const done = completeCarrierInTime(out, sidecar);
      if (done.error) return { status: "failed", bytes, note: done.error, bounds: carrierBounds(p.payload) };
      out = done.bytes;
      stamped.push("the Base ceiling");
    } else pending.push("The Base ceiling has not been written yet.");
  }

  const parsed = parseCarrier(out);
  p = parsed;
  const bounds = parsed.kind === "carrier" ? carrierBounds(parsed.payload) : null;
  if (stamped.length === 0) return { status: "pending", bytes, note: pending.join(" "), bounds };
  const note = `${stamped.join(" and ").replace(/^./, (ch) => ch.toUpperCase())} ${stamped.length === 1 ? "is" : "are"} now inside the file.${pending.length ? ` ${pending.join(" ")}` : ""}`;
  return { status: "completed", bytes: out, note, bounds };
}
