// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * The sandwich: a stretch of binds from BitGraph A to BitGraph B.
 *
 * A bind (enclave v11) takes exactly two counts: the nonce at N, the payload
 * at N+1. When every proof on a chain is a bind, the counter runs straight
 * through, so a stretch of proofs from A to B either accounts for every
 * count in between or it does not:
 *
 *   A  2435-2436 → R 2437-2438 → R 2439-2440 → B 2441-2442
 *
 * Each proof's nonce count is the previous proof's payload count plus one,
 * and each proof links to the previous one by prevB64. Then every record in
 * the stretch was bound after A and before B, and nothing else was.
 *
 * This checks the stretch's SHAPE. Each proof's own signature, attestation
 * and measurement are verify()'s job; run it on every proof as well.
 */

import { computeChainHash } from "./proof-hash.js";
import type { BitGraphProof } from "./types.js";

export interface StretchResult {
  ok: boolean;
  /** One line per failure; empty when ok. */
  reasons: string[];
  /** The first and last count the stretch covers, when it parses. */
  from?: string;
  to?: string;
}

function chainOf(p: BitGraphProof): string {
  return (p.commit as { chainId?: string }).chainId ?? "global";
}

/**
 * Check that `proofs` (in order, first = A, last = B) is one unbroken run of
 * binds: same epoch, key and chain; every proof atomic; each nonce count the
 * previous payload count plus one; each prevB64 the previous proof's chain hash.
 */
export function verifyStretch(proofs: readonly BitGraphProof[]): StretchResult {
  const reasons: string[] = [];
  if (proofs.length < 2) return { ok: false, reasons: ["a stretch needs at least two proofs (A and B)"] };

  const first = proofs[0]!;
  for (let i = 0; i < proofs.length; i++) {
    const p = proofs[i]!;
    const at = `proof ${i} (counter ${p.commit.counter ?? "?"})`;
    if (p.commit.atomic !== true || p.slotAllocation === undefined) {
      reasons.push(`${at} is not a bind: its nonce and payload were not one action`);
      continue;
    }
    let n: bigint;
    let n1: bigint;
    try {
      n = BigInt(p.slotAllocation.counter);
      n1 = BigInt(p.commit.counter ?? "");
    } catch {
      reasons.push(`${at} has a counter that does not parse`);
      continue;
    }
    if (n1 !== n + 1n) reasons.push(`${at}: payload count ${n1} is not nonce count ${n} plus one`);
    if (p.commit.epochId !== first.commit.epochId) reasons.push(`${at} is in another epoch`);
    if (p.signer.publicKeyB64 !== first.signer.publicKeyB64) reasons.push(`${at} is signed by another key`);
    if (chainOf(p) !== chainOf(first)) reasons.push(`${at} is on another chain`);
    if (i === 0) continue;

    const prev = proofs[i - 1]!;
    try {
      const prevEnd = BigInt(prev.commit.counter ?? "");
      if (n !== prevEnd + 1n) {
        reasons.push(`${at}: nonce count ${n} does not follow the previous payload count ${prevEnd} (counts ${prevEnd + 1n} to ${n - 1n} are unaccounted for)`);
      }
    } catch {
      reasons.push(`proof ${i - 1} has a counter that does not parse`);
    }
    if (p.commit.prevB64 !== computeChainHash(prev)) {
      reasons.push(`${at} does not link to the proof before it (prevB64)`);
    }
  }

  const last = proofs[proofs.length - 1]!;
  const from = first.slotAllocation?.counter;
  const to = last.commit.counter;
  return {
    ok: reasons.length === 0,
    reasons,
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
  };
}

/**
 * Was `record` bound after A and before B? True when the stretch from A to B
 * is unbroken (verifyStretch) and contains `record` strictly between them.
 * `stretch` is every proof from A to B inclusive, in order.
 */
export function verifyBetween(stretch: readonly BitGraphProof[], record: BitGraphProof): StretchResult {
  const s = verifyStretch(stretch);
  if (!s.ok) return s;
  const target = computeChainHash(record);
  const idx = stretch.findIndex((p) => computeChainHash(p) === target);
  if (idx <= 0 || idx >= stretch.length - 1) {
    return { ...s, ok: false, reasons: ["the record is not strictly between A and B in this stretch"] };
  }
  return s;
}
