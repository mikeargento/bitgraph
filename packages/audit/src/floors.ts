// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-audit signed floors (enclave v10)
 *
 * From enclave v10 a proof's floor is a Base block the enclave signs into the
 * proof as commit.slotFloor { chain: "base", evmChainId: 8453, blockNumber,
 * blockHash, blockTimestamp }, one per proof, instead of an Ethereum anchor
 * (commit.slotAnchor, read through the anchor proofs of the chain). Every
 * floor is read through signedFloorOf from bitgraph-verify, which refuses a
 * proof that signs both kinds: such a proof is ambiguous and nothing is read
 * from it as a floor.
 *
 * What a Base floor gives the temporal stage: a NOT-BEFORE for the proof that
 * signs it, grounded in block-hash unpredictability (the block hash did not
 * exist before the block, and the proof signs it). Never a not-after: a later
 * proof's floor block can predate this proof, so a floor bounds nothing
 * before it.
 *
 * The block time. Base mainnet stamps every block by its height, and the
 * enclave signs the time it read from a header it hashed itself. When the
 * bundle carries that header (a floor header file, bitgraph-floor-header/1,
 * as the carrier/3 unpacker writes it; or the floor inside a ceiling file or
 * an export) it is checked with checkFloorHeader: keccak-256 to the signed
 * hash, the signed number and time, Base mainnet's schedule. Without one the
 * time is the signed one, which must still be on Base mainnet's schedule for
 * the signed number, and confirming the block itself needs a Base lookup,
 * which this offline audit never makes.
 *
 * A floor stamped after the proof's own attestation document is withheld as a
 * bound (floorTimeIsBound): the record did not exist before that block, but
 * the block's time cannot be a "not before" for a record already attested.
 *
 * Proofs with no slotFloor are not read here at all: bundles from before the
 * cutover audit exactly as before.
 */

import {
  baseHeaderFields,
  checkFloorHeader,
  evmHexToBytes,
  floorTimeIsBound,
  onBaseSchedule,
  signedFloorOf,
} from "@mikeargento/bitgraph-verify";
import type { SignedFloor } from "@mikeargento/bitgraph-verify";
import { attestationTimestampMs } from "./attestation.js";
import type { FloorProblem, IngestResult, ObservedProof, SignedFloorRecord } from "./types.js";

/** A Base floor that bounds the proof signing it. */
export interface FloorEvidence {
  /** The proof that signs the floor. */
  proofHash: string;
  blockNumber: number;
  blockHash: string;
  /** Unix seconds: the signed time, equal to the checked header's when one was carried. */
  timestamp: number;
  timeSource: "header" | "signed";
}

export interface FloorReading {
  /** Base floors usable as not-before bounds, keyed by the proof that signs them. */
  bounds: Map<string, FloorEvidence>;
  /** Every Base floor a proof signs, bounding or withheld, in observation order. */
  records: SignedFloorRecord[];
  problems: FloorProblem[];
}

interface HeaderCandidate {
  path: string;
  raw: Uint8Array;
  /** Only floor header files are judged here; ceilings and exports are judged by their own stages. */
  fromFloorFile: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function iso(unix: number): string {
  return new Date(unix * 1000).toISOString();
}

function firstPath(p: ObservedProof): string | undefined {
  return p.sources[0]?.path;
}

/** Read every Base floor the bundle's proofs sign, and the headers that check them. */
export function readSignedFloors(ingest: IngestResult): FloorReading {
  const problems: FloorProblem[] = [];
  const records: SignedFloorRecord[] = [];
  const bounds = new Map<string, FloorEvidence>();

  // The Base floors the proofs sign, by block hash (to match header files).
  const signedHashes = new Set<string>();
  for (const p of ingest.proofs) {
    const f = p.proof.commit?.slotFloor as { blockHash?: unknown } | undefined;
    if (f !== undefined && typeof f.blockHash === "string") signedHashes.add(f.blockHash.toLowerCase());
  }

  // Headers in the bundle, by the hash their bytes compute to.
  const headers = new Map<string, HeaderCandidate[]>();
  const add = (hash: string, c: HeaderCandidate): void => {
    const list = headers.get(hash) ?? [];
    list.push(c);
    headers.set(hash, list);
  };
  for (const file of ingest.floorHeaders ?? []) {
    const json = file.json;
    const header = json["header"];
    const fields = typeof header === "string" ? baseHeaderFields(header) : null;
    if (json["chain"] !== "base" || fields === null) {
      problems.push({
        code: "floor-header-malformed",
        path: file.path,
        message:
          json["chain"] !== "base"
            ? `the floor header file names chain ${JSON.stringify(json["chain"])}; only a Base header (chain "base") is a floor header`
            : "the floor header file carries no readable Base block header",
      });
      continue;
    }
    const declared = typeof json["blockHash"] === "string" ? (json["blockHash"] as string).toLowerCase() : undefined;
    if (declared !== undefined && declared !== fields.blockHash) {
      problems.push({
        code: "floor-header-mismatch",
        path: file.path,
        message: `the header in this file hashes to ${fields.blockHash}, not to the block it names (${declared})`,
      });
      continue;
    }
    if (!signedHashes.has(fields.blockHash)) {
      problems.push({
        code: "floor-header-unmatched",
        path: file.path,
        message: `the header is Base block ${fields.blockNumber} (${fields.blockHash}), which no proof in this bundle signs as its floor`,
      });
      continue;
    }
    add(fields.blockHash, { path: file.path, raw: evmHexToBytes(header as string), fromFloorFile: true });
  }
  // The floor a ceiling file or an export carries, when it is a Base header.
  const carried = (path: string, floor: Record<string, unknown> | null, field: string): void => {
    if (floor === null || floor["chain"] !== "base" || typeof floor[field] !== "string") return;
    const fields = baseHeaderFields(floor[field] as string);
    if (fields === null || !signedHashes.has(fields.blockHash)) return;
    add(fields.blockHash, { path, raw: evmHexToBytes(floor[field] as string), fromFloorFile: false });
  };
  for (const c of ingest.ceilings ?? []) carried(c.path, record(c.json["floor"]), "blockHeader");
  for (const e of ingest.exports ?? []) if (e.status === "ok") carried(e.path, record(e.json["floor"]), "header");

  for (const p of ingest.proofs) {
    const commit = p.proof.commit as unknown as Record<string, unknown> | undefined;
    if (commit === undefined || commit["slotFloor"] === undefined) continue;
    const path = firstPath(p);
    let floor: SignedFloor | null;
    try {
      floor = signedFloorOf(p.proof);
    } catch (e) {
      const both = commit["slotAnchor"] !== undefined;
      problems.push({
        code: both ? "floor-ambiguous" : "floor-malformed",
        proofHash: p.proofHash,
        ...(path !== undefined ? { path } : {}),
        message: both
          ? "the proof signs two floors (commit.slotAnchor, an Ethereum anchor, and commit.slotFloor, a Base block); it is ambiguous and neither is read as its floor"
          : `the proof's commit.slotFloor is not a Base floor: ${(e as Error).message}`,
      });
      continue;
    }
    if (floor === null || floor.chain !== "base" || floor.blockTimestamp === undefined) continue;
    const base = {
      proofHash: p.proofHash,
      chain: "base" as const,
      blockNumber: floor.blockNumber,
      blockHash: floor.blockHash,
      blockTimestamp: floor.blockTimestamp,
    };
    const withheld = (reason: string, header: SignedFloorRecord["header"], headerPath?: string): void => {
      records.push({ ...base, header, ...(headerPath !== undefined ? { headerPath } : {}), bound: "withheld", withheldReason: reason });
    };

    if (!onBaseSchedule(floor.blockNumber, floor.blockTimestamp)) {
      const reason = `the signed time of Base block ${floor.blockNumber} (${floor.blockTimestamp}) is not Base mainnet's schedule for that block`;
      problems.push({ code: "floor-off-schedule", proofHash: p.proofHash, ...(path !== undefined ? { path } : {}), message: reason });
      withheld(reason, "not-carried");
      continue;
    }

    // A header in the bundle for the signed block: every floor header file
    // naming it must hold; the first that holds dates the floor.
    let checkedPath: string | undefined;
    let mismatch: string | undefined;
    for (const c of headers.get(floor.blockHash) ?? []) {
      const r = checkFloorHeader(floor, c.raw, "base");
      if (r.ok) {
        checkedPath ??= c.path;
      } else if (c.fromFloorFile) {
        mismatch = `${c.path}: ${r.reason}`;
        problems.push({
          code: "floor-header-mismatch",
          proofHash: p.proofHash,
          path: c.path,
          message: `the floor header does not match the Base floor the proof signs: ${r.reason}`,
        });
      }
    }
    const header: SignedFloorRecord["header"] = checkedPath !== undefined ? "checked" : "not-carried";
    if (mismatch !== undefined) {
      withheld(`a floor header in the bundle contradicts the signed floor (${mismatch})`, header, checkedPath);
      continue;
    }
    if (p.verification?.status === "failed") {
      withheld("the proof does not verify, so the floor in it is not a signed one", header, checkedPath);
      continue;
    }
    const attestedMs = attestationTimestampMs(
      ((p.proof as { environment?: { attestation?: { reportB64?: string } } }).environment?.attestation?.reportB64) ?? ""
    );
    const timeOk = floorTimeIsBound(floor.blockTimestamp, attestedMs);
    if (!timeOk.ok) {
      withheld(timeOk.reason, header, checkedPath);
      continue;
    }
    records.push({ ...base, header, ...(checkedPath !== undefined ? { headerPath: checkedPath } : {}), bound: "not-before" });
    bounds.set(p.proofHash, {
      proofHash: p.proofHash,
      blockNumber: floor.blockNumber,
      blockHash: floor.blockHash,
      timestamp: floor.blockTimestamp,
      timeSource: checkedPath !== undefined ? "header" : "signed",
    });
  }
  return { bounds, records, problems };
}

/** The sentence a Base floor bound states about its block time, shared by the reports. */
export function baseFloorTimeSentence(blockNumber: number | string, timestamp: number, timeSource: "header" | "signed"): string {
  return timeSource === "header"
    ? `Base block ${blockNumber} is stamped ${iso(timestamp)}; its header is in the bundle and was checked against the signed block hash, number and time.`
    : `Base block ${blockNumber} is stamped ${iso(timestamp)} as the proof signs it, on Base mainnet's schedule for that block; no header for it is in the bundle, so confirming the block needs a Base lookup.`;
}
