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
 */

import { verifyCeiling, checkCeilingOnline, type CeilingSidecar } from "@mikeargento/bitgraph-verify";
import type { CeilingAnalysis, CeilingCheck, IngestResult } from "./types.js";

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
}

export async function verifyCeilings(ingest: IngestResult, options: CeilingAuditOptions = {}): Promise<CeilingAnalysis> {
  const writer = options.writer ?? BITGRAPH_CEILING_WRITER;
  const chainId = options.chainId ?? BASE_MAINNET_CHAIN_ID;
  const byHash = new Map(ingest.proofs.map((p) => [p.proofHash, p]));
  const checks: CeilingCheck[] = [];
  for (const f of ingest.ceilings ?? []) {
    const side = f.json as unknown as CeilingSidecar;
    const proofHash = typeof side.proofHash === "string" ? side.proofHash : null;
    const observed = proofHash ? byHash.get(proofHash) : undefined;
    if (!observed) {
      checks.push({ path: f.path, proofHash, status: "unmatched", reason: "no proof in this bundle has this ceiling's proofHash", onChain: null });
      continue;
    }
    const r = await verifyCeiling(observed.proof, side, { writerAddress: writer, chainId });
    if (!r.ok) {
      const pending = r.status === "pending";
      checks.push({ path: f.path, proofHash, status: pending ? "pending" : "failed", ...(r.reason ? { reason: r.reason } : {}), onChain: null });
      continue;
    }
    const w = r.window!;
    const check: CeilingCheck = {
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
    checks.push(check);
  }
  const statuses = (ingest.ceilingStatuses ?? []).map((f) => ({
    path: f.path,
    status: String(f.json["status"] ?? "unknown"),
    note: String(f.json["note"] ?? ""),
  }));
  return { writer, chainId, checks, statuses };
}
