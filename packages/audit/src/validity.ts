// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-audit intrinsic validity (internal)
 *
 * Shared by reconstruction and anomaly classification to answer one
 * question: is this proof object cryptographically sound on its own
 * (structure, canonical signature, slot binding, epoch link shape and
 * successor binding), independent of run-order effects and of any supplied
 * trust policy?
 *
 * Sources, in order:
 *
 *   1. The run verification record: "verified" and "artifact-unavailable"
 *      are intrinsically valid.
 *   2. Anything else (status "failed", or the verification pass has not
 *      run) gets an isolated bytes-free recheck through
 *      verifyProofIntegrity with a fresh epoch link state and no policy.
 *      This separates order-dependent failures (the epoch link
 *      single-successor check fails whichever fork consumer verifies
 *      second) and policy rejections from cryptographic unsoundness.
 *
 * The run verification record is never modified: a proof that failed in
 * the run keeps that status everywhere it is reported. Intrinsic validity
 * only decides whether the proof may stand as a competing branch in a
 * divergence or carry a hard lineage edge.
 *
 * State discipline: the recheck resets the verify package's module-level
 * epoch link state before and after each call. Callers therefore run
 * reconstruction and classification only after verifyObservedProofs has
 * completed; that pass resets its own state at the start of every run, so
 * later audit runs are unaffected.
 */

import { resetEpochLinkState, verifyProofIntegrity } from "@mikeargento/bitgraph-verify";
import type { ObservedProof } from "./types.js";

const cache = new WeakMap<object, boolean>();

/** See module doc. Results are cached per ObservedProof object. */
export async function isIntrinsicallyValid(observed: ObservedProof): Promise<boolean> {
  const status = observed.verification?.status;
  if (status === "verified" || status === "artifact-unavailable") return true;

  const cached = cache.get(observed);
  if (cached !== undefined) return cached;

  resetEpochLinkState();
  let valid = false;
  try {
    valid = (await verifyProofIntegrity({ proof: observed.proof })).valid;
  } catch {
    valid = false;
  }
  resetEpochLinkState();

  cache.set(observed, valid);
  return valid;
}

/**
 * Strict decimal counter parse for topology purposes. Accepts ASCII digit
 * strings (leading zeros normalize through BigInt); anything else is
 * treated as no counter evidence. The canonical verifier separately
 * reports malformed counters on the verification dimension.
 */
export function parseCounter(value: string | undefined): bigint | undefined {
  if (value === undefined || value.length === 0 || !/^[0-9]+$/.test(value)) return undefined;
  return BigInt(value);
}

/** Deterministic member order: parseable counter ascending, then canonical hash. */
export function byCounterThenHash(
  a: { counter?: string; proofHash: string },
  b: { counter?: string; proofHash: string }
): number {
  const ca = parseCounter(a.counter);
  const cb = parseCounter(b.counter);
  if (ca !== undefined && cb !== undefined && ca !== cb) return ca < cb ? -1 : 1;
  if (ca !== undefined && cb === undefined) return -1;
  if (ca === undefined && cb !== undefined) return 1;
  return a.proofHash < b.proofHash ? -1 : a.proofHash > b.proofHash ? 1 : 0;
}

/** Append to a Map-of-arrays. */
export function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}
