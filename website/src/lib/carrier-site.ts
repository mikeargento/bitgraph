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

import { verify, createVerificationContext, type BitGraphProof } from "@mikeargento/bitgraph-verify";
import {
  buildCarrier, parseCarrier, completeCarrier, carrierBounds,
  checkFloorBinding, checkCeilingBinding, anchorMessageBytes, verifyWitnessHeader,
  innerDigestMatches,
  type CarrierPayload, type CarrierProof, type CarrierWitness, type CarrierParse, type CarrierBounds,
} from "./carrier";

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

export interface BuiltCarrier {
  bytes: Uint8Array;
  fileName: string;
  ceiling: "present" | "unfetched";
  bounds: CarrierBounds;
  /** Why the ceiling is unfetched, when it is: the anchors route's own word. */
  ceilingNote: string | null;
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

export async function deCarrierFiles(files: File[]): Promise<{ files: File[]; notes: DeCarrierNote[]; proofs: Map<File, CarrierProof> }> {
  const MAGIC = [0x42, 0x47, 0x50, 0x52, 0x4f, 0x4f, 0x46, 0x01];
  const out = files.slice();
  const notes: DeCarrierNote[] = [];
  const proofs = new Map<File, CarrierProof>();
  for (let i = 0; i < out.length; i++) {
    const f = out[i];
    if (f.size < 26) continue;
    try {
      const tail = new Uint8Array(await f.slice(f.size - 8).arrayBuffer());
      if (!MAGIC.every((b, j) => tail[j] === b)) continue;
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
export async function buildCarrierForProof(committedBytes: Uint8Array, proofIn: { version: string; commit: unknown }, fileName: string): Promise<BuiltCarrier> {
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

  const payloadBase: CarrierPayload = {
    carrier: "bitgraph-carrier/1",
    proof: proof as unknown as CarrierProof,
    floor: { status: "present", anchor: floorAnchor as CarrierProof, witness: floorWitness },
    ceiling: { status: "unfetched" },
  };
  const floorErrs = checkFloorBinding(payloadBase.proof, payloadBase.floor);
  if (floorErrs.length > 0) throw new Error(`the fetched anchor is not the signed floor: ${floorErrs[0]}`);
  if (!innerDigestMatches(committedBytes, payloadBase)) throw new Error("these bytes do not hash to the proof's artifact digest; refusing to build a carrier around them");

  // The ceiling, if one has landed. "pending" and "could not fetch" stay distinct sentences.
  let ceilingNote: string | null = null;
  try {
    const after = await fetchAnchorSide(c.counter, c.epochId, "after");
    const anchor = after.anchors?.[0];
    if (after.bound?.state === "anchored" && anchor) {
      const id = (anchor as { commit?: { anchor?: { blockNumber?: number; blockHash?: string } } }).commit?.anchor;
      if (id && typeof id.blockNumber === "number" && typeof id.blockHash === "string") {
        const w = await fetchWitness(id.blockNumber, id.blockHash);
        await vetAnchor(anchor, w, "the closing anchor");
        const ceiling = { status: "present" as const, basis: "counter-order" as const, anchor: anchor as CarrierProof, witness: w };
        const errs = checkCeilingBinding(payloadBase.proof, ceiling);
        if (errs.length > 0) throw new Error(errs[0]);
        const payload = { ...payloadBase, ceiling };
        return { bytes: buildCarrier(committedBytes, payload), fileName: carrierFileName(fileName), ceiling: "present", bounds: carrierBounds(payload), ceilingNote: null };
      }
    }
    ceilingNote = after.bound?.note ?? "No anchor follows this position yet.";
  } catch (e) {
    // The floor stands on its own; an unreachable ceiling is stated, not silently blessed or invented.
    ceilingNote = e instanceof Error ? e.message : "The closing anchor could not be fetched.";
  }
  return { bytes: buildCarrier(committedBytes, payloadBase), fileName: carrierFileName(fileName), ceiling: "unfetched", bounds: carrierBounds(payloadBase), ceilingNote };
}

export interface CompletionResult {
  /** "completed" | "already-complete" | "pending" | "failed" */
  status: "completed" | "already-complete" | "pending" | "failed";
  bytes: Uint8Array;
  note: string;
  bounds: CarrierBounds | null;
}

/** Fetch and stamp the closing anchor into a dropped carrier. Never overwrites, never invents. */
export async function completeDroppedCarrier(bytes: Uint8Array): Promise<CompletionResult> {
  const p: CarrierParse = parseCarrier(bytes);
  if (p.kind !== "carrier") {
    return { status: "failed", bytes, note: p.kind === "none" ? "This file carries no proof block." : `The proof block is unreadable: ${p.reason}`, bounds: null };
  }
  if (p.payload.ceiling.status === "present") {
    return { status: "already-complete", bytes, note: "The time window inside is already complete.", bounds: carrierBounds(p.payload) };
  }
  const c = commitOf(p.payload.proof);
  if (c === null) return { status: "failed", bytes, note: "The carried proof is missing its commit fields.", bounds: null };
  const after = await fetchAnchorSide(c.counter, c.epochId, "after");
  const anchor = after.anchors?.[0];
  if (after.bound?.state !== "anchored" || !anchor) {
    return { status: "pending", bytes, note: after.bound?.note ?? "No anchor follows this position yet.", bounds: carrierBounds(p.payload) };
  }
  const id = (anchor as { commit?: { anchor?: { blockNumber?: number; blockHash?: string } } }).commit?.anchor;
  if (!id || typeof id.blockNumber !== "number" || typeof id.blockHash !== "string") {
    return { status: "failed", bytes, note: "The ledger's closing anchor carries no signed block identity.", bounds: carrierBounds(p.payload) };
  }
  const w = await fetchWitness(id.blockNumber, id.blockHash);
  await vetAnchor(anchor, w, "the closing anchor");
  const errs = checkCeilingBinding(p.payload.proof, { status: "present", basis: "counter-order", anchor: anchor as CarrierProof, witness: w });
  if (errs.length > 0) return { status: "failed", bytes, note: `The closing anchor does not bind: ${errs[0]}`, bounds: carrierBounds(p.payload) };
  const done = completeCarrier(bytes, { anchor: anchor as CarrierProof, witness: w });
  if (done.error) return { status: "failed", bytes, note: done.error, bounds: carrierBounds(p.payload) };
  const parsed = parseCarrier(done.bytes);
  return {
    status: "completed",
    bytes: done.bytes,
    note: "The closing anchor is now inside the file.",
    bounds: parsed.kind === "carrier" ? carrierBounds(parsed.payload) : null,
  };
}
