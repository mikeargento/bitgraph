// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * Ceilings in time (bitgraph-ceiling/1): each ceiling file in the bundle is
 * matched to its proof by proofHash and checked with verifyCeiling, offline.
 * The one thing offline cannot say is whether the carried Base header is on
 * Base's chain. The audit reports that as unchecked; `bitgraph ceiling
 * verify --rpc` or any Base explorer answers it.
 *
 * The writer address is a trust input, like a measurement allowlist: the
 * default is the address BitGraph publishes, and a reader can pass another.
 *
 * A ceiling file may carry its SETTLEMENT on Ethereum (bitgraph-settlement/1,
 * the `settlement` field): the batcher transaction whose blobs hold the Base
 * block. Two layers, both offline, reported as separate lines: the POINTER
 * (verifySettlementPointer, against the Base mainnet pins or ones the reader
 * passes) and the BLOBS (blob bytes kept in the bundle next to the ceiling
 * file or under a `blobs/` folder, verified against the listed KZG
 * commitments and decoded down to the ceiling transaction). Blob bytes
 * absent from the bundle are reported, never a failure; a pointer or blob
 * that is present and wrong fails the ceiling like any other bad evidence.
 * The settlement is checked whether or not the ceiling's proof is in the
 * bundle: it is evidence about the ceiling file itself.
 */

import {
  verifyCeiling, checkCeilingOnline, verifySettlementPointer, BASE_MAINNET_SETTLEMENT_PINS, decodeHeader, evmHexToBytes,
  type CeilingSidecar, type SettlementPointer, type SettlementPins,
} from "@mikeargento/bitgraph-verify";
import { streamArtifactsByHash } from "./ingest.js";
import { verifySettlementBlobs } from "./settlement-blobs.js";
import type { CeilingAnalysis, CeilingCheck, CeilingSettlementCheck, IngestResult } from "./types.js";

/** BitGraph's published ceiling writer on Base mainnet (bitgraph.ing/ceilings). */
export const BITGRAPH_CEILING_WRITER = "0xf3972408D853c975F86351C311f4310220bbF2a3";
export const BASE_MAINNET_CHAIN_ID = 8453;

export interface CeilingAuditOptions {
  writer?: string;
  chainId?: number;
  /**
   * The one online question, supplied by an embedder that allows network:
   * the Base chain's block hash at a height. The audit itself never makes a
   * network call (its zero-network guarantee), so the CLI never sets this.
   */
  getBlockHash?: (blockNumber: number) => Promise<string | null>;
  /** The batch inbox and batcher a settlement pointer must name. Base mainnet's by default. */
  settlementPins?: SettlementPins;
}

export async function verifyCeilings(ingest: IngestResult, options: CeilingAuditOptions = {}): Promise<CeilingAnalysis> {
  const writer = options.writer ?? BITGRAPH_CEILING_WRITER;
  const chainId = options.chainId ?? BASE_MAINNET_CHAIN_ID;
  const pins = options.settlementPins ?? BASE_MAINNET_SETTLEMENT_PINS;
  const byHash = new Map(ingest.proofs.map((p) => [p.proofHash, p]));
  const checks: CeilingCheck[] = [];
  for (const f of ingest.ceilings ?? []) {
    const side = f.json as unknown as CeilingSidecar;
    const proofHash = typeof side.proofHash === "string" ? side.proofHash : null;
    const observed = proofHash ? byHash.get(proofHash) : undefined;
    let check: CeilingCheck;
    if (!observed) {
      check = { path: f.path, proofHash, status: "unmatched", reason: "no proof in this bundle has this ceiling's proofHash", onChain: null };
    } else {
      const r = await verifyCeiling(observed.proof, side, { writerAddress: writer, chainId });
      if (!r.ok) {
        const pending = r.status === "pending";
        check = { path: f.path, proofHash, status: pending ? "pending" : "failed", ...(r.reason ? { reason: r.reason } : {}), onChain: null };
      } else {
        const w = r.window!;
        check = {
          path: f.path,
          proofHash,
          status: "verified",
          ...(r.label ? { label: r.label } : {}),
          window: {
            floorBlock: w.floor.blockNumber || null,
            floorTime: w.floor.blockTimestamp,
            ceilingChainId: w.ceiling.chainId,
            ceilingBlock: w.ceiling.blockNumber,
            ceilingTime: w.ceiling.blockTimestamp,
            widthSeconds: w.widthSeconds,
          },
          onChain: null,
          onChainDetail: "header not checked against chain",
        };
        if (options.getBlockHash) {
          const online = await checkCeilingOnline(side, options.getBlockHash);
          check.onChain = online.onChain;
          check.onChainDetail = online.detail;
          if (online.onChain === false) {
            check.status = "failed";
            check.reason = `chain: ${online.detail}`;
          }
        }
      }
    }
    const carried = f.json["settlement"];
    if (carried !== null && carried !== undefined) {
      const settlement = await auditSettlement(f.path, side, carried, ingest, pins);
      check.settlement = settlement;
      if (settlement.status === "failed" && check.status !== "failed") {
        check.status = "failed";
        check.reason = settlement.lines.find((l) => l.includes("FAILED")) ?? "settlement: failed";
      }
    }
    checks.push(check);
  }
  const statuses = (ingest.ceilingStatuses ?? []).map((f) => ({
    path: f.path,
    status: String(f.json["status"] ?? "unknown"),
    note: String(f.json["note"] ?? ""),
  }));
  return { writer, chainId, checks, statuses };
}

// ── settlement ─────────────────────────────────────────────────────────────

function whenUtc(unix: number): string {
  const iso = new Date(unix * 1000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

/** The bundle paths a blob file named `file` may sit at, next to the ceiling file first. */
function blobCandidatePaths(ceilingPath: string, file: string): string[] {
  const slash = ceilingPath.lastIndexOf("/");
  const dir = slash < 0 ? "" : ceilingPath.slice(0, slash + 1);
  return [`${dir}${file}`, `${dir}blobs/${file}`, `blobs/${file}`, file];
}

async function auditSettlement(
  path: string,
  side: CeilingSidecar,
  carried: unknown,
  ingest: IngestResult,
  pins: SettlementPins,
): Promise<CeilingSettlementCheck> {
  const lines: string[] = [];
  const failed = (pointer: CeilingSettlementCheck["pointer"], blobs: CeilingSettlementCheck["blobs"]): CeilingSettlementCheck =>
    ({ status: "failed", pointer, blobs, lines });
  const noBlobs = (detail: string, listed: number): CeilingSettlementCheck["blobs"] => ({ status: "absent", detail, listed, supplied: 0 });

  // 1. The pointer: header, inclusion, batcher, blob commitments.
  const pointer = carried as SettlementPointer;
  const p = verifySettlementPointer(pointer, pins);
  const listed = Array.isArray(pointer?.blobs) ? pointer.blobs.length : 0;
  if (!p.ok) {
    lines.push(`settlement: pointer FAILED (${p.reason ?? "invalid"})`);
    return failed({ ok: false, reason: p.reason ?? "invalid" }, noBlobs("not checked: the pointer failed", listed));
  }
  const existedBy = p.existedBy!;
  // The pointer must be about THIS ceiling's Base block and transaction.
  const anchor = side.anchor;
  let mismatch: string | null = null;
  if (!anchor) mismatch = "the ceiling has no Base transaction yet";
  else if (pointer.baseBlockNumber !== anchor.blockNumber || pointer.baseBlockHash.toLowerCase() !== anchor.blockHash.toLowerCase()) {
    mismatch = `the pointer names Base block ${pointer.baseBlockNumber} (${pointer.baseBlockHash.slice(0, 10)}…), this ceiling is in block ${anchor.blockNumber} (${anchor.blockHash.slice(0, 10)}…)`;
  } else if (pointer.located && pointer.located.txHash.toLowerCase() !== anchor.txHash.toLowerCase()) {
    mismatch = `the pointer locates transaction ${pointer.located.txHash.slice(0, 10)}…, this ceiling's is ${anchor.txHash.slice(0, 10)}…`;
  }
  if (mismatch) {
    lines.push(`settlement: pointer FAILED (${mismatch})`);
    return failed({ ok: false, reason: mismatch, existedBy }, noBlobs("not checked: the pointer is for another block", listed));
  }
  lines.push(`settlement: pointer ok, Ethereum block ${existedBy.blockNumber} at ${whenUtc(existedBy.blockTimestamp)}`);
  const pointerOk: CeilingSettlementCheck["pointer"] = { ok: true, existedBy };

  // 2. The blobs, when the bundle holds their bytes.
  const wanted = new Map<string, string>(); // sha256 hex -> versioned hash
  const byPath = new Map<string, string>(); // bundle path -> sha256 hex
  for (const a of ingest.artifacts) for (const ap of a.paths) byPath.set(ap, a.sha256Hex);
  const byBasename = new Map<string, string>();
  for (const a of ingest.artifacts) for (const ap of a.paths) byBasename.set(ap.slice(ap.lastIndexOf("/") + 1), a.sha256Hex);
  for (const b of pointer.blobs) {
    const file = typeof b.file === "string" ? b.file : `${b.versionedHash.toLowerCase()}.bin`;
    if (file.includes("/") || file.includes("\\") || file.includes("..")) continue;
    const hex = blobCandidatePaths(path, file).map((c) => byPath.get(c)).find((h) => h !== undefined) ?? byBasename.get(file);
    if (hex) wanted.set(hex, b.versionedHash.toLowerCase());
  }
  if (wanted.size === 0) {
    lines.push("settlement: blobs not in bundle");
    return { status: "pointer-only", pointer: pointerOk, blobs: noBlobs("blobs not in bundle", listed), lines };
  }
  const bytesByHash = new Map<string, Uint8Array>();
  for await (const m of streamArtifactsByHash(ingest, wanted.keys())) bytesByHash.set(wanted.get(m.sha256Hex)!, m.bytes);
  let expectParent: string | undefined;
  try {
    expectParent = anchor ? decodeHeader(evmHexToBytes(anchor.blockHeader)).parentHash : undefined;
  } catch {
    expectParent = undefined;
  }
  const r = await verifySettlementBlobs(pointer, bytesByHash, {
    expect: {
      txHash: anchor!.txHash,
      rawTx: anchor!.rawTx,
      ...(expectParent ? { baseParentHash: expectParent } : {}),
    },
  });
  if (!r.ok) {
    lines.push(`settlement: blobs FAILED (${r.reason ?? "invalid"})`);
    return failed(pointerOk, { status: "failed", detail: r.reason ?? "invalid", listed, supplied: bytesByHash.size });
  }
  const c = r.channel!;
  const frames = c.complete ? `all ${c.framesDecoded} frames` : `frames 0..${c.framesDecoded - 1}${c.framesTotal ? ` of ${c.framesTotal}` : ""}`;
  const loc = r.located!;
  lines.push(`settlement: blobs decoded (${frames}), ceiling tx located in Base block ${loc.baseBlockNumber}${loc.batchComplete ? "" : " (batch cut at the last frame supplied)"}`);
  return {
    status: "verified",
    pointer: pointerOk,
    blobs: {
      status: "verified",
      detail: `${bytesByHash.size} of ${listed} blobs supplied; ${frames} decoded; ${r.checks.map((k) => k.detail ?? k.name).join("; ")}`,
      listed,
      supplied: bytesByHash.size,
      located: { baseBlockNumber: loc.baseBlockNumber, baseTxIndex: loc.baseTxIndex, txHash: loc.txHash, batchComplete: loc.batchComplete, framesDecoded: c.framesDecoded, framesTotal: c.framesTotal },
    },
    lines,
  };
}
