// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * verifyCarrier — the offline read path for a BitGraphed file (bitgraph-carrier/1
 * or /2), one result per claim, each saying what it rests on.
 *
 * Given the file and nothing else, it strips the block by structure and checks:
 *
 *   the bytes       SHA-256 of the committed bytes is the digest the proof names
 *   the proof       Ed25519 signature, the position record and its bindings, the
 *                   fused commitment rebuilt (bitgraph-fuse/1 or /2), proofHash
 *   the attestation ES384 signature, the certificate chain to the AWS Nitro root
 *                   (641A0321…), validity at the document's own instant, PCR0 against
 *                   the proof's measurement, user_data against the signed body; and,
 *                   on a v2 block, the openssl-checkable witness against the document
 *   the floor       the anchor proof named by the signed slotAnchor, verified over its
 *                   own message, matched by identity; its Ethereum header recomputed
 *   the ceilings    in position: the next anchor, same checks; in time (v2): the Base
 *                   sidecar's whole chain of custody (verifyCeiling); settled (v2): the
 *                   Ethereum block that committed the batch data (verifySettlementPointer)
 *   the pins        what the file declares it was made under, against the verifier's own
 *
 * Two LEVELS. Offline, every claim above holds by mathematics and the AWS root,
 * with the two block headers taken as the ones matching their hashes. CONFIRMED
 * needs one question answered by any node the caller names: is that header the
 * chain's own block? The lookups are injected; this module never fetches.
 *
 *   TRUE          every carried claim passed. A claim not carried (no ceiling yet,
 *                 no settlement yet) is stated as NOT_CARRIED, never as failure.
 *   FALSE         evidence contradicts a claim: wrong bytes, a bad signature, a floor
 *                 that is not the signed one, a ceiling that does not follow the commit.
 *   UNDETERMINED  the block is unreadable (corrupted, not forged), the version is
 *                 unknown, or the bytes carry no block at all.
 *
 * The reading is written HERE, from the results, never read from the file.
 */

import { verify, verifyProofIntegrity, createVerificationContext } from "./verifier.js";
import { verifyFuse } from "./fuse-verify.js";
import { readFuseAttribution } from "./fuse.js";
import { computeProofHash, computeSignedBodyHash } from "./proof-hash.js";
import { verifyNitroAttestation, witnessMatchesAttestation, awsNitroRootSha256, type AttestationWitness } from "./nitro.js";
import { baseTimeIsBound, verifyCeiling, checkCeilingOnline, type CeilingSidecar } from "./ceiling.js";
import { PUBLISHED_PCR0S, publishedMeasurement } from "./measurements.js";
import { verifySettlementPointer, checkSettlementOnline, BASE_MAINNET_SETTLEMENT_PINS, type SettlementPointer, type SettlementPins } from "./settlement.js";
import type { BitGraphProof } from "./types.js";
import { sha256 } from "@noble/hashes/sha256";
import {
  parseCarrier, checkFloorBinding, checkCeilingBinding, anchorMessageBytes,
  verifyWitnessHeader, carrierBounds, innerDigestMatches, carrierVersionOf,
  type CarrierBounds, type CarrierPayload,
} from "./carrier.js";

/** BitGraph's published ceiling writer on Base mainnet: the default pin a verifier compares with. */
export const BITGRAPH_CEILING_WRITER = "0xf3972408D853c975F86351C311f4310220bbF2a3";
export const BASE_MAINNET_CHAIN_ID = 8453;

export type ClaimResult = "TRUE" | "FALSE" | "UNDETERMINED" | "NOT_CARRIED";

export interface CarrierClaim {
  /** Stable id, dotted: "bytes.digest", "proof.signature", "attestation.root", "floor.header", "ceiling.time.inclusion", "confirmed.floor" ... */
  id: string;
  /** One line a reader can print. */
  name: string;
  result: ClaimResult;
  /** What the claim rests on when TRUE: "SHA-256", "Ed25519", "the AWS Nitro root (641A0321…)", "Ethereum block N, header as given", ... */
  restsOn: string;
  detail: string;
  level: "offline" | "confirmed";
}

export interface CarrierLookups {
  /** Ethereum mainnet: the chain's block hash at a height, or null. */
  ethereumBlockHash?: (blockNumber: number) => Promise<string | null>;
  /** Base mainnet: the chain's block hash at a height, or null. */
  baseBlockHash?: (blockNumber: number) => Promise<string | null>;
}

export interface CarrierVerifyOptions {
  /** The one online question per chain, answered by nodes the caller names. Without them the confirmed level is UNDETERMINED. */
  lookups?: CarrierLookups;
  /** The verifier's own pins. The file's declared pins are compared with these, never used as these. */
  pins?: {
    /**
     * PCR0 values the verifier accepts. Default: BitGraph's published images
     * (SPEC section 16). An empty list accepts nothing and leaves the claim,
     * and so the verdict, undetermined.
     */
    pcr0?: readonly string[];
    ceilingWriter?: string;
    baseChainId?: number;
    settlement?: SettlementPins;
  };
}

export interface CarrierVerifyResult {
  verdict: "TRUE" | "FALSE" | "UNDETERMINED";
  /** Why the Base block's time is not stated as a bound, when it is not (see baseTimeIsBound). */
  baseTimeWithheld?: string | null;
  /** "ok" | "none" | "corrupt" — whether the bytes carried a readable block at all. */
  carrier: "ok" | "none" | "corrupt";
  version: 1 | 2 | null;
  /** Every failed or undetermined check, in the order met. Empty on a clean TRUE. */
  reasons: string[];
  /** Stated only when the block was readable. notAfter null = NOT FETCHED, in those words. */
  bounds: CarrierBounds | null;
  ceiling: "present" | "unfetched" | null;
  claims: CarrierClaim[];
  /** Plain language, written from the claims. */
  reading: string;
  payload: CarrierPayload | null;
  /** The committed bytes, for callers that go on to placement or origin recovery. */
  inner: Uint8Array | null;
}

export async function verifyCarrier(bytes: Uint8Array, opts: CarrierVerifyOptions = {}): Promise<CarrierVerifyResult> {
  const parsed = parseCarrier(bytes);
  if (parsed.kind === "none") {
    const claim: CarrierClaim = { id: "block", name: "A proof block at the end of the file", result: "UNDETERMINED", restsOn: "", detail: "no carrier block: these bytes do not carry a proof inside", level: "offline" };
    return { verdict: "UNDETERMINED", carrier: "none", version: null, reasons: [claim.detail], bounds: null, ceiling: null, claims: [claim], reading: "These bytes carry no proof block.", payload: null, inner: null };
  }
  if (parsed.kind === "corrupt") {
    const detail = `carrier block found but unreadable: ${parsed.reason}. A corrupted block, not a forgery.`;
    const claim: CarrierClaim = { id: "block", name: "A proof block at the end of the file", result: "UNDETERMINED", restsOn: "", detail, level: "offline" };
    return { verdict: "UNDETERMINED", carrier: "corrupt", version: null, reasons: [detail], bounds: null, ceiling: null, claims: [claim], reading: "The file ends in a proof block this reader cannot read. That is a damaged or newer block, not a verdict on the file.", payload: null, inner: null };
  }
  const result = await verifyCarrierPayload(parsed.payload, parsed.inner, opts);
  return { ...result, reading: `${result.reading} ${envelopeSentence(bytes, parsed.inner)}` };
}

/**
 * THE ENVELOPE RULE, said out loud (outside review, 2026-10-02: "confirm the verify output
 * says plainly that the bitgraphed file's own SHA-256 is not the committed digest, since
 * that file travels without the README"). A reader who hashes the file they were handed
 * and compares it with the proof would otherwise conclude the proof is wrong.
 */
function envelopeSentence(outer: Uint8Array, inner: Uint8Array): string {
  const hex = (b: Uint8Array) => Array.from(sha256(b), (x) => x.toString(16).padStart(2, "0")).join("");
  return `This file's own SHA-256 (${hex(outer)}) is not the committed digest and is not meant to be: the proof block at its end is part of this file's bytes. The proof names the bytes before that block (SHA-256 ${hex(inner)}), and those are the bytes checked here.`;
}

/**
 * The same claims over a payload already in hand, with the committed bytes or
 * without them. A proof page holds the payload's parts (the proof, the anchors,
 * the headers, the Base sidecar) and often not the file, so with `inner` null the
 * two claims that need the bytes (the digest, the fused commitment) are stated
 * as not carried, and everything else is judged exactly as for a file.
 */
export async function verifyCarrierPayload(payload: CarrierPayload, inner: Uint8Array | null, opts: CarrierVerifyOptions = {}): Promise<CarrierVerifyResult> {
  const version = carrierVersionOf(payload);
  const claims: CarrierClaim[] = [];
  const add = (id: string, name: string, result: ClaimResult, restsOn: string, detail: string, level: "offline" | "confirmed" = "offline") =>
    claims.push({ id, name, result, restsOn, detail, level });
  const proof = payload.proof as unknown as BitGraphProof;
  const pinnedWriter = opts.pins?.ceilingWriter ?? BITGRAPH_CEILING_WRITER;
  const baseChainId = opts.pins?.baseChainId ?? BASE_MAINNET_CHAIN_ID;

  if (inner !== null) add("block", "A proof block at the end of the file", "TRUE", "the block's own structure", `bitgraph-carrier/${version}, found from the end of the file and stripped exactly once`);

  // 1. The committed bytes are the ones the proof names.
  if (inner !== null) {
    const digestOk = innerDigestMatches(inner, payload);
    add("bytes.digest", "The committed bytes are the ones the proof names", digestOk ? "TRUE" : "FALSE", "SHA-256", digestOk ? "SHA-256 of the bytes before the block equals the proof's artifact digest" : "the committed bytes do not hash to the carried proof's artifact digest");
  } else {
    add("bytes.digest", "The committed bytes are the ones the proof names", "NOT_CARRIED", "", `the file is not in hand; the proof names SHA-256 ${String((proof.artifact as { digestB64?: string } | undefined)?.digestB64 ?? "")}`);
  }

  // 2. The proof itself, under the existing bitgraph/1 algorithm. A fresh
  //    context: a carrier is judged alone, not against this process's history.
  //    Without the bytes, the integrity half runs (verify() without bytes).
  const proofResult = inner !== null
    ? await verify({ proof, bytes: inner, context: createVerificationContext() })
    : await verifyProofIntegrity({ proof, context: createVerificationContext() });
  add("proof.signature", "The proof is signed and its position record is bound to it", proofResult.valid ? "TRUE" : "FALSE", "Ed25519", proofResult.valid ? "the enclave's Ed25519 signature over the canonical signed body verifies; the position record's own signature, its hash in the commit, the nonce and the counter order all agree" : `the carried proof does not verify: ${proofResult.reason ?? "unspecified"}`);

  const ph = (payload.proof as { proofHash?: unknown }).proofHash;
  if (typeof ph === "string") {
    const ok = computeProofHash(proof) === ph;
    add("proof.hash", "The ledger's proofHash is this proof's", ok ? "TRUE" : "FALSE", "SHA-256", ok ? "recomputed over the signed-body subset and equal" : "the proofHash field is not the hash of this proof's signed-body subset");
  }

  // 3. Fused: the commitment inside the bytes, rebuilt from the signed record (fuse/2: and the signed floor block).
  const marker = readFuseAttribution(proof);
  if (marker !== null && inner === null) {
    add("proof.fused", "The bytes carry the position commitment", "NOT_CARRIED", "", `the file is not in hand; its bytes carry a bitgraph-fuse/${marker.version ?? 1} commitment to check`);
  } else if (marker !== null && inner !== null) {
    const f = await verifyFuse({ proof, bytes: inner });
    const good = f.category === "FUSED_DIRECT" || f.category === "CARRIED_INLINE";
    add("proof.fused", "The bytes carry the position commitment", good ? "TRUE" : "FALSE",
      marker.version === 2 ? "SHA-256 over the signed position record, its nonce and the signed floor block hash" : "SHA-256 over the signed position record and its nonce",
      good ? `${f.category}: ${marker.version === 2 ? "the commitment binds the floor block, so the bytes could not have been finished before that block existed" : "the commitment was made from the position record before the bytes were finished"}` : `${f.category}${f.reason ? `: ${f.reason}` : ""}`);
  } else {
    add("proof.fused", "The bytes carry the position commitment", "NOT_CARRIED", "", "an ordinary recording: the position was taken after the bytes existed, and no commitment is inside them");
  }

  // 4. The attestation: the hardware's word on which image signed, bound to this proof.
  const env = (proof as { environment?: { measurement?: unknown; attestation?: { format?: unknown; reportB64?: unknown } } }).environment;
  const measurement = typeof env?.measurement === "string" && /^[0-9a-fA-F]+$/.test(env.measurement) ? env.measurement.toLowerCase() : null;
  let attestedAtMs: number | null = null;
  const att = env?.attestation;
  if (att && att.format === "aws-nitro" && typeof att.reportB64 === "string") {
    const n = verifyNitroAttestation(att.reportB64, { ...(measurement !== null ? { expectedPcr0: measurement } : {}), expectedUserDataB64: computeSignedBodyHash(proof) });
    const byName = (prefix: string) => n.checks.find((c) => c.name.startsWith(prefix));
    const sig = byName("AWS signature"), chain = byName("Certificate chain"), root = byName("Chains to") ?? byName("Trust root"), validity = byName("Certificate validity"), pcr0 = byName("PCR0"), bound = byName("Bound to this proof");
    const r = (c: { pass: boolean } | undefined): ClaimResult => (c === undefined ? "UNDETERMINED" : c.pass ? "TRUE" : "FALSE");
    add("attestation.signature", "AWS hardware signed the attestation", r(sig), "ES384 (P-384)", sig?.detail ?? "not reached");
    add("attestation.chain", "The certificate chain holds together", r(chain), "ES384 (P-384)", chain?.detail ?? "not reached");
    add("attestation.root", "The chain reaches the AWS Nitro root", r(root), `the AWS Nitro Enclaves Root CA G1 (${n.rootSha256.slice(0, 8)}…)`, root?.detail ?? "not reached");
    add("attestation.validity", "Every certificate was valid at the document's own instant", r(validity), "the document's signed timestamp", validity?.detail ?? "not reached");
    if (measurement === null) add("attestation.pcr0", "The attested image is the one the proof names", "FALSE", "", "the proof's environment.measurement is not a hex string, so it names no image");
    else add("attestation.pcr0", "The attested image is the one the proof names", r(pcr0), "PCR0 inside the signed document", pcr0?.detail ?? "not reached");
    add("attestation.binding", "The attestation is bound to this proof", r(bound), "user_data inside the signed document", bound?.detail ?? "not reached");
    if (sig?.pass && chain?.pass && root?.pass && typeof n.doc?.timestampMs === "number") attestedAtMs = n.doc.timestampMs;
    const docPcr0 = (n.doc?.pcrs as Record<number, unknown> | undefined)?.[0];
    const measured = typeof docPcr0 === "string" ? docPcr0.toLowerCase() : measurement;
    const usingDefault = opts.pins?.pcr0 === undefined;
    const policy = (opts.pins?.pcr0 ?? PUBLISHED_PCR0S).map((x) => String(x).toLowerCase());
    if (measured === null) {
      add("attestation.pins", "The image is one the verifier accepts", "FALSE", "", "there is no PCR0 to judge: the document carries none and the proof names none");
    } else if (policy.length === 0) {
      add("attestation.pins", "The image is one the verifier accepts", "UNDETERMINED", "", `no accepted images were given: PCR0 is ${measured}; any AWS Nitro enclave can produce a valid attestation, and only a measurement policy says whose this is`);
    } else {
      const ok = policy.includes(measured);
      const pub = publishedMeasurement(measured);
      add("attestation.pins", "The image is one the verifier accepts", ok ? "TRUE" : "FALSE",
        usingDefault ? "BitGraph's published enclave images (SPEC section 16)" : "the verifier's own list",
        ok
          ? usingDefault && pub ? `PCR0 ${measured.slice(0, 16)}… is BitGraph's published ${pub.version} image (since ${pub.since})` : `PCR0 ${measured.slice(0, 16)}… is on the verifier's list`
          : usingDefault ? `PCR0 ${measured.slice(0, 16)}… is not an image BitGraph published, so this proof is not BitGraph's` : `PCR0 ${measured.slice(0, 16)}… is not on the verifier's list`);
    }
    if (version === 2 && payload.attestation) {
      const w = witnessMatchesAttestation(payload.attestation as unknown as AttestationWitness, att.reportB64);
      add("attestation.witness", "The openssl witness is what the document decodes to", w.ok ? "TRUE" : "FALSE", "recomputed from the attestation document", w.detail);
    }
  } else {
    add("attestation.signature", "AWS hardware signed the attestation", "NOT_CARRIED", "", "the proof carries no aws-nitro attestation");
  }

  // 5. The floor: the anchor proof verifies over its own signed message, and
  //    it is the anchor the enclave fixed at allocation, matched by identity.
  const floorMsg = anchorMessageBytes(payload.floor.anchor);
  if (floorMsg.error !== null) add("floor.anchor", "The floor anchor is a genuine anchor proof", "FALSE", "", `floor anchor: ${floorMsg.error}`);
  else {
    const floorResult = await verify({ proof: payload.floor.anchor as unknown as BitGraphProof, bytes: floorMsg.bytes, context: createVerificationContext() });
    add("floor.anchor", "The floor anchor is a genuine anchor proof", floorResult.valid ? "TRUE" : "FALSE", "Ed25519", floorResult.valid ? "the anchor proof verifies over its own signed block-hash message, under the same key" : `the floor anchor proof does not verify: ${floorResult.reason ?? "unspecified"}`);
  }
  const floorBind = checkFloorBinding(payload.proof, payload.floor);
  add("floor.binding", "The floor is the anchor the enclave fixed for this position", floorBind.length === 0 ? "TRUE" : "FALSE", "the proof's signed commit.slotAnchor", floorBind.length === 0 ? "the anchor's counter, block number and block hash equal the signed slotAnchor" : floorBind.join("; "));
  const floorWitness = verifyWitnessHeader(payload.floor.witness);
  add("floor.header", "The floor block's header is the one with that hash", floorWitness.ok ? "TRUE" : "FALSE", `Ethereum block ${payload.floor.witness.blockNumber}, header as given`, floorWitness.ok ? `keccak-256 of the header equals the signed block hash; its time is ${iso(floorWitness.timestamp)}` : `floor witness: ${floorWitness.error}`);

  // 6. The ceiling in position, only when the carrier claims one.
  if (payload.ceiling.status === "present") {
    const ceilMsg = anchorMessageBytes(payload.ceiling.anchor);
    if (ceilMsg.error !== null) add("ceiling.position.anchor", "The closing anchor is a genuine anchor proof", "FALSE", "", `ceiling anchor: ${ceilMsg.error}`);
    else {
      const ceilResult = await verify({ proof: payload.ceiling.anchor as unknown as BitGraphProof, bytes: ceilMsg.bytes, context: createVerificationContext() });
      add("ceiling.position.anchor", "The closing anchor is a genuine anchor proof", ceilResult.valid ? "TRUE" : "FALSE", "Ed25519", ceilResult.valid ? "the anchor proof verifies over its own signed block-hash message, under the same key" : `the ceiling anchor proof does not verify: ${ceilResult.reason ?? "unspecified"}`);
    }
    const cb = checkCeilingBinding(payload.proof, payload.ceiling);
    add("ceiling.position.binding", "The record was committed before the closing anchor", cb.length === 0 ? "TRUE" : "FALSE", "the enclave's counter order", cb.length === 0 ? "the anchor's counter follows the commit counter on the same chain, epoch and key: a bound in position, not a clock time" : cb.join("; "));
    const cw = verifyWitnessHeader(payload.ceiling.witness);
    add("ceiling.position.header", "The closing block's header is the one with that hash", cw.ok ? "TRUE" : "FALSE", `Ethereum block ${payload.ceiling.witness.blockNumber}, header as given`, cw.ok ? `keccak-256 of the header equals the anchor's block hash; its time is ${iso(cw.timestamp)}` : `ceiling witness: ${cw.error}`);
  } else {
    add("ceiling.position.binding", "The record was committed before the closing anchor", "NOT_CARRIED", "", "closing anchor not fetched: the floor stands on its own");
  }

  // 7. v2: the ceiling in time, the Base block the record existed by.
  let ceilingTime: { blockNumber: number; blockHash: string; blockTimestamp: number; status: string } | null = null;
  let baseTimeWithheld: string | null = null;
  let sidecar: CeilingSidecar | null = null;
  if (version === 2) {
    const ct = payload.ceilingInTime;
    if (ct && ct.status === "present") {
      sidecar = ct.sidecar as unknown as CeilingSidecar;
      const c = await verifyCeiling(proof, sidecar, { writerAddress: pinnedWriter, chainId: baseChainId, proofAlreadyVerified: proofResult.valid });
      const byName = (n: string) => c.checks.find((x) => x.name === n);
      const r = (x: { ok: boolean } | undefined): ClaimResult => (x === undefined ? "UNDETERMINED" : x.ok ? "TRUE" : "FALSE");
      add("ceiling.time.record", "The record is under the root the ceiling names", r(byName("merkle")), "SHA-256 (RFC 9162 tree)", byName("merkle")?.detail ?? c.reason ?? "not reached");
      add("ceiling.time.payload", "The transaction carries that root", r(byName("payload")), "the 84-byte BGC1 payload", byName("payload")?.detail ?? c.reason ?? "not reached");
      add("ceiling.time.sender", "The transaction was signed by the ceiling writer", r(byName("sender")), `secp256k1; the writer pin ${pinnedWriter.slice(0, 8)}…`, byName("sender")?.detail ?? c.reason ?? "not reached");
      add("ceiling.time.inclusion", "The transaction is in the Base block", r(byName("inclusion")), `Merkle-Patricia proof; Base block ${sidecar.anchor?.blockNumber ?? "?"}, header as given`, byName("inclusion")?.detail ?? c.reason ?? "not reached");
      add("ceiling.time.floor", "The floor header the ceiling carries is the signed floor", r(byName("floor")), "the proof's signed commit.slotAnchor", byName("floor")?.detail ?? "the sidecar carries no floor header");
      const win = c.ok ? c.window?.ceiling : undefined;
      if (win) {
        // The inclusion holds either way; a stamp that cannot be a bound is withheld as a time.
        const stamp = baseTimeIsBound(win.blockTimestamp, { floorTimestampSec: floorWitness.timestamp ?? null, attestedAtMs });
        if (stamp.ok) ceilingTime = { blockNumber: win.blockNumber, blockHash: win.blockHash, blockTimestamp: win.blockTimestamp, status: c.status ?? "included" };
        else baseTimeWithheld = stamp.reason;
      }
      if (!c.ok && c.reason) add("ceiling.time", "The ceiling in time holds together", "FALSE", "", c.reason);
      add("ceiling.time.status", "How far Base had settled the block", "UNDETERMINED", "", `the sidecar says "${sidecar.status}", as BitGraph's Base node reported when the file was written; not proven by the file. Settlement below is the proof, when carried.`);
    } else {
      add("ceiling.time.record", "The record existed by a Base block", "NOT_CARRIED", "", ct?.status === "unfetched" ? "the ceiling in time was not fetched when this file was made" : "no ceiling in time is stated");
    }

    // 8. v2: settlement on Ethereum, when carried.
    const st = payload.settlement;
    if (st && st.status === "present") {
      const pointer = st.pointer as unknown as SettlementPointer;
      const sp = verifySettlementPointer(pointer, opts.pins?.settlement ?? BASE_MAINNET_SETTLEMENT_PINS);
      const byName = (n: string) => sp.checks.find((x) => x.name === n);
      const r = (x: { ok: boolean } | undefined): ClaimResult => (x === undefined ? "UNDETERMINED" : x.ok ? "TRUE" : "FALSE");
      add("settlement.header", "The Ethereum block's header is the one with that hash", r(byName("header")), `Ethereum block ${pointer.l1?.blockNumber ?? "?"}, header as given`, byName("header")?.detail ?? sp.reason ?? "not reached");
      add("settlement.inclusion", "Base's batch transaction is in that Ethereum block", r(byName("inclusion")), "Merkle-Patricia proof", byName("inclusion")?.detail ?? sp.reason ?? "not reached");
      add("settlement.blobs", "The transaction lists the blobs that carry the batch", r(byName("blobs")), "secp256k1; the batcher and inbox pins; KZG versioned hashes", byName("blobs")?.detail ?? sp.reason ?? "not reached");
      if (sidecar && pointer.baseBlockHash && sidecar.anchor && pointer.baseBlockHash.toLowerCase() !== sidecar.anchor.blockHash.toLowerCase()) {
        add("settlement.base", "The settlement is for the ceiling's Base block", "FALSE", "", "the pointer names a different Base block than the ceiling");
      }
      add("settlement.blobs.decoded", "The ceiling transaction's bytes are in the blob data", "UNDETERMINED", "", "blob bytes are checked by bitgraph-audit with the blobs kept beside the package (KZG, channel decode); this reader holds only the pointer");
    } else if (ceilingTime !== null) {
      add("settlement.header", "The Base block's batch data is on Ethereum", "NOT_CARRIED", "", st?.status === "unfetched" ? "settlement not fetched when this file was made" : "no settlement is stated");
    }

    // 9. The declared pins, compared with the verifier's.
    if (payload.pins) {
      const notes: string[] = [];
      if (payload.pins.pcr0 && String(payload.pins.pcr0).toLowerCase() !== String(proof.environment?.measurement).toLowerCase()) notes.push("the declared PCR0 is not the proof's measurement");
      if (payload.pins.ceilingWriter && payload.pins.ceilingWriter.toLowerCase() !== pinnedWriter.toLowerCase()) notes.push(`the declared ceiling writer ${payload.pins.ceilingWriter} is not the verifier's pin`);
      if (payload.pins.chains?.base !== undefined && payload.pins.chains.base !== baseChainId) notes.push(`the declared Base chain ${payload.pins.chains.base} is not the verifier's`);
      add("pins", "What the file says it was made under agrees with this verifier's pins", notes.length === 0 ? "TRUE" : "FALSE", "the verifier's own pins", notes.length === 0 ? "declared pins match; they were never used as authority" : notes.join("; "));
    }
  }

  // 10. Confirmed: the block hashes against nodes the caller named.
  const lk = opts.lookups;
  if (lk?.ethereumBlockHash) {
    const h = (await safe(() => lk.ethereumBlockHash!(payload.floor.witness.blockNumber)))?.toLowerCase();
    const ok = h === payload.floor.witness.blockHash.toLowerCase();
    add("confirmed.floor", "The floor block is Ethereum's own", h ? (ok ? "TRUE" : "FALSE") : "UNDETERMINED", "the Ethereum node the caller named", h ? (ok ? `Ethereum block ${payload.floor.witness.blockNumber} matches the node` : `the node's block ${payload.floor.witness.blockNumber} is ${h}, not this header`) : "the node did not answer", "confirmed");
    const pc = payload.ceiling;
    if (pc.status === "present") {
      const h2 = (await safe(() => lk.ethereumBlockHash!(pc.witness.blockNumber)))?.toLowerCase();
      const ok2 = h2 === pc.witness.blockHash.toLowerCase();
      add("confirmed.ceiling.position", "The closing block is Ethereum's own", h2 ? (ok2 ? "TRUE" : "FALSE") : "UNDETERMINED", "the Ethereum node the caller named", h2 ? (ok2 ? `Ethereum block ${pc.witness.blockNumber} matches the node` : `the node's block is ${h2}, not this header`) : "the node did not answer", "confirmed");
    }
    const st = payload.settlement;
    if (st && st.status === "present") {
      const r = await checkSettlementOnline(st.pointer as unknown as SettlementPointer, lk.ethereumBlockHash);
      add("confirmed.settlement", "The settling Ethereum block is Ethereum's own", r.ok ? "TRUE" : "FALSE", "the Ethereum node the caller named", r.detail, "confirmed");
    }
  } else {
    add("confirmed.floor", "The floor block is Ethereum's own", "UNDETERMINED", "", "no Ethereum node given: the header is taken as the one matching its hash; confirm block " + payload.floor.witness.blockNumber + " against any node or explorer", "confirmed");
  }
  if (sidecar) {
    if (lk?.baseBlockHash) {
      const r = await checkCeilingOnline(sidecar, lk.baseBlockHash);
      add("confirmed.ceiling.time", "The ceiling block is Base's own", r.onChain === null ? "UNDETERMINED" : r.onChain ? "TRUE" : "FALSE", "the Base node the caller named", r.detail, "confirmed");
    } else {
      add("confirmed.ceiling.time", "The ceiling block is Base's own", "UNDETERMINED", "", `no Base node given: confirm block ${sidecar.anchor?.blockNumber ?? "?"} against any node or explorer`, "confirmed");
    }
  }

  const reasons = claims.filter((c) => c.result === "FALSE").map((c) => `${c.name}: ${c.detail}`);
  // TRUE needs the image to be one the verifier accepts: an attestation alone
  // says only that some AWS Nitro enclave signed.
  const pins = claims.find((c) => c.id === "attestation.pins");
  if (reasons.length === 0 && pins?.result !== "TRUE") reasons.push(pins ? `${pins.name}: ${pins.detail}` : "The image is one the verifier accepts: the proof carries no attestation, so no image was established");
  const verdict: CarrierVerifyResult["verdict"] = claims.some((c) => c.result === "FALSE") ? "FALSE" : pins?.result === "TRUE" ? "TRUE" : "UNDETERMINED";
  const bounds = carrierBounds(payload);
  return {
    verdict,
    baseTimeWithheld,
    carrier: "ok",
    version,
    reasons,
    bounds,
    ceiling: payload.ceiling.status,
    claims,
    reading: writeReading(verdict, claims, bounds, proof, ceilingTime, floorWitness.timestamp, baseTimeWithheld),
    payload,
    inner,
  };
}

async function safe<T>(f: () => Promise<T>): Promise<T | null> {
  try { return await f(); } catch { return null; }
}

function iso(ts: number | null): string {
  return ts === null ? "unknown" : new Date(ts * 1000).toISOString().replace(".000Z", "Z");
}

/**
 * The reading, from the results. It names what the file proves and what that
 * rests on, and says what removes each reliance. Never stored in the file.
 */
function writeReading(
  verdict: CarrierVerifyResult["verdict"],
  claims: CarrierClaim[],
  bounds: CarrierBounds,
  proof: BitGraphProof,
  ceilingTime: { blockNumber: number; blockHash: string; blockTimestamp: number } | null,
  floorTs: number | null,
  baseTimeWithheld: string | null = null,
): string {
  const get = (id: string) => claims.find((c) => c.id === id);
  if (verdict === "FALSE") {
    const failed = claims.filter((c) => c.result === "FALSE").map((c) => c.name.toLowerCase());
    return `This file does not verify: ${failed.join("; ")}. Nothing here is a verdict on what the bytes say, only that the evidence does not hold together.`;
  }
  const position = proof.commit?.counter ?? "?";
  const epoch = (proof.commit?.epochId ?? "").replace(/=+$/, "").slice(0, 8);
  const fused = get("proof.fused");
  const after = floorTs !== null ? `made after Ethereum block ${bounds.notBefore.blockNumber} (${iso(floorTs)})` : `made after Ethereum block ${bounds.notBefore.blockNumber}`;
  const by = ceilingTime ? `, and existed by Base block ${ceilingTime.blockNumber} (${iso(ceilingTime.blockTimestamp)})` : "";
  const settled = bounds.settledBy ? `, whose batch data Ethereum committed in block ${bounds.settledBy.blockNumber} (${iso(bounds.settledBy.timestamp)})` : "";
  const before = bounds.notAfter ? `; committed before the anchoring of Ethereum block ${bounds.notAfter.blockNumber}, a bound in position` : "";
  const digest = get("bytes.digest");
  const subject = digest?.result !== "TRUE"
    ? "The bytes this proof names were committed"
    : fused?.result === "TRUE"
      ? (fused.restsOn.includes("floor block") ? "These exact bytes were finished after the floor block existed" : "These exact bytes were finished after their position was opened")
      : "These exact bytes were committed";
  const att = get("attestation.root");
  const rests: string[] = ["SHA-256", "Ed25519"];
  if (att?.result === "TRUE") rests.push(`the AWS Nitro root (${awsNitroRootSha256().slice(0, 8)}…)`);
  rests.push(`Ethereum block ${bounds.notBefore.blockNumber}`);
  if (ceilingTime) rests.push(`Base block ${ceilingTime.blockNumber}`);
  if (bounds.settledBy) rests.push(`Ethereum block ${bounds.settledBy.blockNumber}`);
  const confirmed = claims.filter((c) => c.level === "confirmed");
  const allConfirmed = confirmed.length > 0 && confirmed.every((c) => c.result === "TRUE");
  const tail = allConfirmed
    ? "Every block was confirmed against a node, so nothing here rests on a header taken as given."
    : "Offline, the blocks are taken from their headers, each of which hashes to the hash the evidence names; confirm them against any node or explorer to remove that reliance.";
  const pins = get("attestation.pins");
  const pinLine = pins?.result === "TRUE" ? ` ${pins.detail.replace(/^PCR0 [0-9a-f]+… is /, "The enclave image is ")}.` : pins?.result === "UNDETERMINED" ? ` ${pins.detail}.` : !pins ? " The proof carries no attestation, so which enclave image signed it is not established." : "";
  const withheld = baseTimeWithheld ? ` The record is in a Base block, but its time is not used as a bound: ${baseTimeWithheld}.` : "";
  const lead = verdict === "UNDETERMINED" ? "Not judged in full. " : "";
  return `${lead}${subject}: ${after}${by}${settled}${before}. Position ${position} of epoch ${epoch}…. Rests on: ${rests.join(", ")}. ${tail}${withheld}${pinLine}`;
}
