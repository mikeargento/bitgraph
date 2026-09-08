// Copyright (c) 2024-2026 Mike Argento.

/**
 * The Ethereum block header, RLP-encoded, so an anchor carries its own evidence.
 *
 * An anchor commits SHA-256 of a block hash. To check that claim you need the
 * header the hash covers: keccak256(header) must equal the signed block hash,
 * and the block's timestamp is then bound to it by collision resistance. Until
 * now the header was not stored, so every reader had to go back to an Ethereum
 * RPC to reconstruct it, and an export needed a separate witness file.
 *
 * The header is already in hand when the anchor is made: getLatestBlock's RPC
 * response IS the header, and it was being thrown away. Encoding it there and
 * putting it in the anchor's metadata costs about 600 bytes and makes the tick
 * carry the evidence for itself.
 *
 * ⚠️ THE ENCODING IS SELF-CHECKED, which is what makes this safe to hold in
 * two places (the site keeps a copy for anchors written before this existed).
 * A header is only ever emitted when keccak256 of it reproduces the block hash
 * we were given, so a fork field this does not know about yields NOTHING
 * rather than something wrong. Ethereum adds header fields at hard forks, and
 * an encoder that guessed would be worse than one that abstains.
 *
 * ⚠️ AND IT IS UNSIGNED, in `metadata`, like everything else there. It is a
 * convenience, never a claim: a reader recomputes the hash from these bytes
 * and compares it to the SIGNED block hash in attribution.message and
 * commit.anchor. A tampered header simply fails to reproduce the hash.
 */
import { keccak_256 } from "@noble/hashes/sha3";

/** An `eth_getBlockByNumber` result, header fields only. */
export interface RpcBlockHeader {
  parentHash: string; sha3Uncles: string; miner: string; stateRoot: string;
  transactionsRoot: string; receiptsRoot: string; logsBloom: string;
  difficulty: string; number: string; gasLimit: string; gasUsed: string;
  timestamp: string; extraData: string; mixHash: string; nonce: string;
  baseFeePerGas?: string; withdrawalsRoot?: string; blobGasUsed?: string;
  excessBlobGas?: string; parentBeaconBlockRoot?: string; requestsHash?: string;
  hash: string;
}

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
/** Integer field: minimal big-endian, no leading zeros (0 -> empty). */
function q(hex: string | undefined): Uint8Array {
  if (hex == null) return new Uint8Array(0);
  let h = hex.replace(/^0x/, "").replace(/^0+/, "");
  if (h === "") return new Uint8Array(0);
  if (h.length % 2) h = "0" + h;
  return Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
}
/** Fixed-width data field: exact bytes, leading zeros preserved. */
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
  if (b.baseFeePerGas != null) fields.push(q(b.baseFeePerGas));                 // London
  if (b.withdrawalsRoot != null) fields.push(d(b.withdrawalsRoot));             // Shanghai
  if (b.blobGasUsed != null) fields.push(q(b.blobGasUsed));                     // Cancun
  if (b.excessBlobGas != null) fields.push(q(b.excessBlobGas));                 // Cancun
  if (b.parentBeaconBlockRoot != null) fields.push(d(b.parentBeaconBlockRoot)); // Cancun
  if (b.requestsHash != null) fields.push(d(b.requestsHash));                   // Prague
  return rlpList(fields);
}

export function toHex0x(bytes: Uint8Array): string {
  let s = "0x";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/**
 * The header's RLP as hex, or null when it does not reproduce `expectedHash`.
 *
 * Null is the honest answer for a block this encoder cannot represent (a new
 * hard-fork field): the anchor is written without a header, exactly as every
 * anchor before this change, and a reader falls back to an RPC.
 */
export function headerRlpFor(header: RpcBlockHeader | null | undefined, expectedHash: string): string | null {
  if (!header) return null;
  try {
    const rlp = encodeHeaderRlp(header);
    if (toHex0x(keccak_256(rlp)).toLowerCase() !== expectedHash.toLowerCase()) return null;
    return toHex0x(rlp);
  } catch {
    return null;
  }
}
