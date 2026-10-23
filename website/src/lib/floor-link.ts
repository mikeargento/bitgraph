// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * A Base floor for one BitGraph, as two counts (Mike, 2026-10-18: "base floors are just their own bitgraph"; 2026-10-21:
 * "every bitgraph gets a base floor and ceiling"). BitGraph 1 binds base-floor.json, the latest Base block; BitGraph 2
 * binds the content right after it. A floor link is the checked statement that 1 is 2's floor. The bind is untouched:
 * a link is about two BitGraphs and is part of neither proof.
 *
 * Used by app/api/commit (which binds the floor in the same request as the content and writes the link after it
 * answers) and by app/api/floors (which accepts a link from anyone who holds both proofs and the block file).
 */
import { verifyAttested } from "@mikeargento/bitgraph-verify";
import { createHash } from "node:crypto";

export const FLOOR_FILE_FORMAT = "bitgraph-base-floor/1" as const;
export const FLOOR_LINK_FORMAT = "bitgraph-floor-link/1" as const;

const RPC = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

export type BaseBlock = { number: number; hash: string; timestamp: number };
export type PositionRef = { digestB64: string; epochId: string; counter: string };
type Commit = { epochId?: string; counter?: string; slotCounter?: string };
type ProofLike = Record<string, unknown> & { proofHash?: string; artifact?: { digestB64?: string }; commit?: Commit };

/** The latest Base block, from the RPC the site is configured with. Throws when Base does not answer. */
export async function latestBaseBlock(): Promise<BaseBlock> {
  const res = await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["latest", false] }),
  });
  const r = ((await res.json()) as { result?: { number?: string; hash?: string; timestamp?: string } }).result;
  if (!res.ok || !r?.number || !r.hash || !r.timestamp || !/^0x[0-9a-f]{64}$/i.test(r.hash)) throw new Error("Base did not answer");
  return { number: parseInt(r.number, 16), hash: r.hash.toLowerCase(), timestamp: parseInt(r.timestamp, 16) };
}

/** base-floor.json: the bytes BitGraph 1 binds. */
export function floorFileText(block: BaseBlock): string {
  return JSON.stringify({
    format: FLOOR_FILE_FORMAT,
    chain: "base-mainnet",
    chainId: 8453,
    number: block.number,
    hash: block.hash,
    timestamp: block.timestamp,
    note: "BitGraph 1 of two. The BitGraph bound right after this one was made after this Base block existed.",
  }, null, 2) + "\n";
}

export const sha256B64 = (text: string): string => createHash("sha256").update(text, "utf8").digest("base64");

export type FloorLink = {
  format: typeof FLOOR_LINK_FORMAT;
  floor: { bitgraph: PositionRef & { proofHash: string | null }; chain: "base-mainnet"; chainId: 8453; blockNumber: number; blockHash: string; blockTimestamp: number };
  record: PositionRef & { proofHash: string | null };
  blockFile: string;
  checked: string[];
};

export type FloorLinkResult = { ok: true; link: FloorLink } | { ok: false; error: string; status: number };

const refOf = (p: ProofLike): PositionRef | null => {
  const d = p.artifact?.digestB64, c = p.commit;
  return typeof d === "string" && typeof c?.epochId === "string" && typeof c.counter === "string" ? { digestB64: d, epochId: c.epochId, counter: c.counter } : null;
};

/**
 * Everything anyone could check before calling BitGraph 1 BitGraph 2's floor (2026-10-18 audit): the block file hashes
 * to 1's digest and is a Base block record; both proofs verify in full, AWS Nitro attestation included, on BitGraph's
 * published images; same epoch, 2 after 1; the block was fresh when 1 was bound; Base has the block with that hash and
 * time. Never the ledger's word alone. `a` and `b` are the proofs as the ledger (or the enclave's reply) holds them.
 */
export async function checkFloorLink(a: ProofLike, b: ProofLike, blockFile: string): Promise<FloorLinkResult> {
  const bad = (error: string, status = 400): FloorLinkResult => ({ ok: false, error, status });
  const ra = refOf(a), rb = refOf(b);
  if (!ra || !rb) return bad("both proofs need a digest, an epoch and a counter");
  if (typeof blockFile !== "string" || blockFile.length > 2048) return bad("blockFile is the text of base-floor.json");
  if (sha256B64(blockFile) !== ra.digestB64) return bad("blockFile is not BitGraph 1's content");
  let block: { format?: string; chainId?: number; number?: number; hash?: string; timestamp?: number };
  try { block = JSON.parse(blockFile); } catch { return bad("blockFile is not JSON"); }
  if (block.format !== FLOOR_FILE_FORMAT || block.chainId !== 8453 || !Number.isSafeInteger(block.number) || typeof block.hash !== "string" || !/^0x[0-9a-f]{64}$/.test(block.hash) || !Number.isSafeInteger(block.timestamp)) {
    return bad("blockFile is not a Base block record");
  }

  const ca = a.commit!, cb = b.commit!;
  if (ra.epochId !== rb.epochId) return bad("BitGraph 1 and 2 must be in the same epoch");
  if (!(Number(cb.slotCounter ?? cb.counter) > Number(ca.counter))) return bad("BitGraph 2 must come after BitGraph 1");

  const [va, vb] = await Promise.all([
    verifyAttested({ proof: a as never, bytes: new TextEncoder().encode(blockFile) }),
    verifyAttested({ proof: b as never }),
  ]);
  if (!va.valid) return bad(`BitGraph 1 does not verify: ${va.reason}`);
  if (!vb.valid) return bad(`BitGraph 2 does not verify: ${vb.reason}`);
  // A fresh read: the block is at most two minutes older than BitGraph 1's attested bind, and BitGraph 2 was bound
  // after BitGraph 1. A stale block would still be a true floor, only a loose one; first writer wins, so refuse it.
  const blockMs = block.timestamp! * 1000;
  if (va.attestedAtMs === null || vb.attestedAtMs === null) return bad("the attestations carry no time");
  if (blockMs > va.attestedAtMs + 5_000) return bad("the block is newer than BitGraph 1's bind");
  if (va.attestedAtMs - blockMs > 120_000) return bad("the block was more than two minutes old when BitGraph 1 was bound");
  if (vb.attestedAtMs < va.attestedAtMs) return bad("BitGraph 2's attested time is before BitGraph 1's");

  // Base has the block, with that hash and time.
  try {
    const res = await fetch(RPC, {
      method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: [`0x${block.number!.toString(16)}`, false] }),
    });
    const onchain = ((await res.json()) as { result?: { hash?: string; timestamp?: string } }).result;
    if (!onchain?.hash) return bad("Base did not answer for that block", 502);
    if (onchain.hash.toLowerCase() !== block.hash || parseInt(onchain.timestamp ?? "0x0", 16) !== block.timestamp) return bad("that block is not on Base with that hash and time");
  } catch {
    return bad("Base did not answer just now", 502);
  }

  return {
    ok: true,
    link: {
      format: FLOOR_LINK_FORMAT,
      floor: { bitgraph: { ...ra, proofHash: a.proofHash ?? null }, chain: "base-mainnet", chainId: 8453, blockNumber: block.number!, blockHash: block.hash, blockTimestamp: block.timestamp! },
      record: { ...rb, proofHash: b.proofHash ?? null },
      blockFile,
      checked: [
        "blockFile hashes to BitGraph 1's digest",
        "Base has that block with that hash and time",
        "same epoch, BitGraph 2 after BitGraph 1",
        "both proofs verified in full, AWS Nitro attestation included, on BitGraph's published images",
        "the block was less than two minutes old when BitGraph 1 was bound",
      ],
    },
  };
}
