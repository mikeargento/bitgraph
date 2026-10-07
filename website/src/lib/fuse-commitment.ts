import { sha256 } from "@noble/hashes/sha256";
import { computeSlotCommitment, computeSlotRecordHash, base64ToBytes, type SlotAllocation } from "@mikeargento/bitgraph-verify";

/**
 * The commitment a fused file carries, for the site's server routes:
 * bitgraph-fuse/1 without a floor, bitgraph-fuse/2 with an Ethereum floor
 * anchor (enclave v9), bitgraph-fuse/3 with a Base floor (enclave v10).
 *
 *   commitment/2 = SHA256("bitgraph-fuse/2" || 0x00 || slotRecordHash || nonce || floorBlockHash)
 *   commitment/3 = SHA256("bitgraph-fuse/3" || 0x00 || slotRecordHash || nonce || floorBlockHash)
 *
 * A site-local copy of the verify package's computeSlotCommitment2/3; the
 * test suite checks both against vectors minted by the v9 and v10 enclaves,
 * so the copies cannot drift.
 */
const domainOf = (label: string): Uint8Array => {
  const bytes = new TextEncoder().encode(label);
  const out = new Uint8Array(bytes.length + 1);
  out.set(bytes, 0);
  return out;
};
const DOMAIN2 = domainOf("bitgraph-fuse/2");
const DOMAIN3 = domainOf("bitgraph-fuse/3");

/** The floor a commitment binds: its block hash, and its chain ("base" makes a fuse/3 commitment; anything else, an Ethereum anchor, fuse/2). */
export type CommitmentFloor = string | { blockHash: string; chain?: unknown } | null | undefined;

/**
 * The commitment for a slot and the floor it binds. `floor` is the floor
 * object an allocation returned or a proof signs (its `chain` picks the
 * version), or a bare block hash, whose chain is `chain` (default Ethereum,
 * the meaning every caller had before enclave v10). No floor: fuse/1.
 */
export function computeCommitmentFor(slot: SlotAllocation, floor?: CommitmentFloor, chain?: "ethereum" | "base"): Uint8Array {
  if (!floor) return computeSlotCommitment(slot);
  const floorBlockHash = typeof floor === "string" ? floor : floor.blockHash;
  const onBase = typeof floor === "string" ? chain === "base" : floor.chain === "base";
  if (typeof floorBlockHash !== "string" || floorBlockHash.length === 0) return computeSlotCommitment(slot);
  const nonce = base64ToBytes(slot.nonceB64);
  if (nonce === null || nonce.length !== 32) throw new TypeError("slot.nonceB64 must decode to exactly 32 bytes");
  const hex = floorBlockHash.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new TypeError("the floor block hash must be 32 bytes");
  const floorBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) floorBytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const domain = onBase ? DOMAIN3 : DOMAIN2;
  const slotHash = computeSlotRecordHash(slot);
  const pre = new Uint8Array(domain.length + 32 + 32 + 32);
  pre.set(domain, 0);
  pre.set(slotHash, domain.length);
  pre.set(nonce, domain.length + 32);
  pre.set(floorBytes, domain.length + 64);
  return sha256(pre);
}
