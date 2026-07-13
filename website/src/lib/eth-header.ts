/**
 * Ethereum block-header witness builder (server-side).
 *
 * An anchor proof signs a recent Ethereum block hash (in attribution.message),
 * which pins the BitGraph chain to public time. To make that time claim
 * verifiable FULLY OFFLINE from an export bundle, we ship the block's RLP
 * header alongside the anchor: a verifier recomputes keccak256(header) and
 * confirms it equals the signed block hash, then reads the timestamp from the
 * header (bound to that hash by collision resistance). This is exactly the
 * `bitgraph-anchor-witness/1` format the audit tool already verifies
 * (BUNDLE-FORMAT.md section 10).
 *
 * The header is re-encoded from the RPC block fields in canonical order,
 * covering every hard-fork field through Prague (base fee, withdrawals,
 * blob-gas, parent beacon root, requests hash). The encoding is SELF-CHECKED:
 * we only return a witness when the recomputed hash matches the expected block
 * hash, so a wrong or fork-incomplete encoding is never emitted.
 */

import { keccak_256 } from "@noble/hashes/sha3.js";

const RPC_ENDPOINTS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.llamarpc.com",
  "https://rpc.ankr.com/eth",
  "https://cloudflare-eth.com",
];

export interface AnchorWitness {
  version: "bitgraph-anchor-witness/1";
  headerRlpHex: string;
  blockNumber: number;
  blockHash: string;
}

interface RpcBlockHeader {
  parentHash: string; sha3Uncles: string; miner: string; stateRoot: string;
  transactionsRoot: string; receiptsRoot: string; logsBloom: string;
  difficulty: string; number: string; gasLimit: string; gasUsed: string;
  timestamp: string; extraData: string; mixHash: string; nonce: string;
  baseFeePerGas?: string; withdrawalsRoot?: string; blobGasUsed?: string;
  excessBlobGas?: string; parentBeaconBlockRoot?: string; requestsHash?: string;
  hash: string;
}

// ── Minimal RLP encoder ──
function concat(...arrs: Uint8Array[]): Uint8Array {
  const n = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(n);
  let i = 0;
  for (const a of arrs) { out.set(a, i); i += a.length; }
  return out;
}
function encodeLength(len: number, offset: number): Uint8Array {
  if (len < 56) return Uint8Array.of(offset + len);
  let hex = len.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const bytes = Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
  return Uint8Array.of(offset + 55 + bytes.length, ...bytes);
}
function rlpString(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 1 && bytes[0]! < 0x80) return bytes;
  return concat(encodeLength(bytes.length, 0x80), bytes);
}
function rlpList(items: Uint8Array[]): Uint8Array {
  const body = concat(...items.map(rlpString));
  return concat(encodeLength(body.length, 0xc0), body);
}
// Integer field: minimal big-endian, no leading zeros (0 -> empty).
function q(hex: string | undefined): Uint8Array {
  if (hex == null) return new Uint8Array(0);
  let h = hex.replace(/^0x/, "").replace(/^0+/, "");
  if (h === "") return new Uint8Array(0);
  if (h.length % 2) h = "0" + h;
  return Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
}
// Fixed-width data field: exact bytes, leading zeros preserved.
function d(hex: string | undefined): Uint8Array {
  if (hex == null) return new Uint8Array(0);
  let h = hex.replace(/^0x/, "");
  if (h.length % 2) h = "0" + h;
  return Uint8Array.from((h.match(/../g) ?? []).map((x) => parseInt(x, 16)));
}

/** RLP-encode a block header in canonical field order (through Prague). */
export function encodeHeaderRlp(b: RpcBlockHeader): Uint8Array {
  const fields: Uint8Array[] = [
    d(b.parentHash), d(b.sha3Uncles), d(b.miner), d(b.stateRoot), d(b.transactionsRoot),
    d(b.receiptsRoot), d(b.logsBloom), q(b.difficulty), q(b.number), q(b.gasLimit),
    q(b.gasUsed), q(b.timestamp), d(b.extraData), d(b.mixHash), d(b.nonce),
  ];
  if (b.baseFeePerGas != null) fields.push(q(b.baseFeePerGas));        // London
  if (b.withdrawalsRoot != null) fields.push(d(b.withdrawalsRoot));    // Shanghai
  if (b.blobGasUsed != null) fields.push(q(b.blobGasUsed));            // Cancun
  if (b.excessBlobGas != null) fields.push(q(b.excessBlobGas));        // Cancun
  if (b.parentBeaconBlockRoot != null) fields.push(d(b.parentBeaconBlockRoot)); // Cancun
  if (b.requestsHash != null) fields.push(d(b.requestsHash));          // Prague
  return rlpList(fields);
}

function toHex0x(bytes: Uint8Array): string {
  let s = "0x";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

async function fetchHeader(blockNumber: number): Promise<RpcBlockHeader | null> {
  const numHex = "0x" + blockNumber.toString(16);
  for (const rpc of RPC_ENDPOINTS) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getBlockByNumber", params: [numHex, false], id: 1 }),
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { result?: RpcBlockHeader };
      if (data.result?.hash) return data.result;
    } catch { /* try next endpoint */ }
  }
  return null;
}

/**
 * Build an offline-verifiable witness for one anchor's Ethereum block. Returns
 * null when the header cannot be fetched OR the re-encoded header does not hash
 * to `expectedBlockHash` (so a bad encoding is never emitted).
 */
export async function buildAnchorWitness(
  blockNumber: number,
  expectedBlockHash: string
): Promise<AnchorWitness | null> {
  const header = await fetchHeader(blockNumber);
  if (!header) return null;
  const rlp = encodeHeaderRlp(header);
  const computed = toHex0x(keccak_256(rlp));
  if (computed.toLowerCase() !== expectedBlockHash.toLowerCase()) return null;
  return {
    version: "bitgraph-anchor-witness/1",
    headerRlpHex: toHex0x(rlp),
    blockNumber,
    blockHash: expectedBlockHash.toLowerCase(),
  };
}
