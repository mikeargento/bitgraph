import { attestationTimestampMs } from "@/lib/nitro-verify";

// Lists call recordedMsOf per row per render (a checked folder can hold
// thousands), and the answer for a given proof object never changes.
const memo = new WeakMap<object, number | null>();

/** A BitGraph's recorded instant: its attestation document's own timestamp,
 *  the TEE's signed clock, in epoch ms.
 *
 *  The one clock the site shows a BitGraph's time by (Mike, 2026-09-27:
 *  "make it consistent"). The proof page leads with it (RE-RULING 2026-09-25),
 *  and the Positions rows, the bracket anchors, the ledger lists and the drop
 *  box all read it here, so a row and the page it opens never disagree. Before
 *  this, the ledger showed when the proof file reached storage (S3's clock,
 *  about a second later) and the Positions rows showed the floor block's mine
 *  time. An Ethereum block's mine time is a different clock and an earlier
 *  moment, and is only ever shown labelled as the block's.
 *
 *  Decoded, not verified: the Hardware Enclave card verifies the document on
 *  demand. Null when the document is absent or unreadable; never throws. */
export function recordedMsOf(proof: unknown): number | null {
  if (proof === null || typeof proof !== "object") return null;
  const hit = memo.get(proof);
  if (hit !== undefined) return hit;
  const env = (proof as { environment?: { attestation?: { reportB64?: unknown } } }).environment;
  const rep = env?.attestation?.reportB64;
  const ms = typeof rep === "string" && rep.length > 0 ? attestationTimestampMs(rep) : null;
  memo.set(proof, ms);
  return ms;
}
