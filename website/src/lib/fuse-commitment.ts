import { sha256 } from "@noble/hashes/sha256";
import { computeSlotCommitment, computeSlotRecordHash, base64ToBytes, type SlotAllocation } from "@mikeargento/bitgraph-verify";

/**
 * The commitment a fused file carries, for the site's server routes:
 * bitgraph-fuse/1 without a floor, bitgraph-fuse/2 with one.
 *
 *   commitment/2 = SHA256("bitgraph-fuse/2" || 0x00 || slotRecordHash || nonce || floorBlockHash)
 *
 * A site-local copy until @mikeargento/bitgraph-verify 1.15.0 (which exports
 * computeSlotCommitment2) is the site's dependency; the test suite checks this
 * against the vector minted by the v9 enclave, so the two cannot drift.
 */
const DOMAIN2 = (() => {
  const label = new TextEncoder().encode("bitgraph-fuse/2");
  const out = new Uint8Array(label.length + 1);
  out.set(label, 0);
  return out;
})();

export function computeCommitmentFor(slot: SlotAllocation, floorBlockHash?: string | null): Uint8Array {
  if (!floorBlockHash) return computeSlotCommitment(slot);
  const nonce = base64ToBytes(slot.nonceB64);
  if (nonce === null || nonce.length !== 32) throw new TypeError("slot.nonceB64 must decode to exactly 32 bytes");
  const hex = floorBlockHash.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new TypeError("the floor block hash must be 32 bytes");
  const floor = new Uint8Array(32);
  for (let i = 0; i < 32; i++) floor[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const slotHash = computeSlotRecordHash(slot);
  const pre = new Uint8Array(DOMAIN2.length + 32 + 32 + 32);
  pre.set(DOMAIN2, 0);
  pre.set(slotHash, DOMAIN2.length);
  pre.set(nonce, DOMAIN2.length + 32);
  pre.set(floor, DOMAIN2.length + 64);
  return sha256(pre);
}
