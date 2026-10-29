// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Reading a copy: what anyone concludes from a copy alone, with the public ledger.
 *
 * Kept apart, because they are different kinds of claim:
 *   the proof   the original's BitGraph binds its exact bytes, after a nonce nobody could see (cryptographic);
 *   this copy   looks like the picture it bound: a visual match against the fingerprint record bound in that same
 *               BitGraph, tolerant of crops (align.ts). Not proof that the copy is unaltered; only the original's exact
 *               bytes prove that.
 *
 * The copy is the pointer (2026-10-29). Its pHash goes to the server, which returns the published records nearest it
 * (app/api/find); the copy's own pixels are then matched against each record's grid here, and the best match above
 * the threshold is the original. Nothing is added to a photo to make this work, and the picture never leaves the
 * machine. An invisible watermark did this job before; it changed the original's bytes, so the marked copy needed a
 * BitGraph of its own, and the find led to the copy's record rather than the original's.
 */

import { align, MATCH } from "./align.ts";
import { fingerprintOf, type Decoded } from "./record.ts";

export type Original = { counter: number; epochId: string; photoDigestB64: string };
export type LooksVerdict =
  | { verdict: "none" }
  | { verdict: "match"; original: Original; score: number };

type Candidate = { distance: number; phash: string; photo: string; counter: string; epoch: string; values: string };
const fromUrlSafe = (s: string) => { const t = s.replace(/-/g, "+").replace(/_/g, "/"); return t + "=".repeat((4 - (t.length % 4)) % 4); };

/** The verdict for a decoded copy: the original it looks like, when a published record matches it. */
export async function judge(img: Decoded): Promise<LooksVerdict> {
  const { phash } = fingerprintOf(img);
  const res = await fetch(`/api/find?phash=${phash}`).catch(() => null);
  if (!res?.ok) return { verdict: "none" };
  const { candidates = [] } = (await res.json().catch(() => ({}))) as { candidates?: Candidate[] };
  let best: LooksVerdict = { verdict: "none" };
  for (const c of candidates) {
    const { score } = align(img.rgba, img.w, img.h, c.values);
    if (score >= MATCH && (best.verdict === "none" || score > best.score)) {
      best = { verdict: "match", score, original: { counter: Number(c.counter), epochId: fromUrlSafe(c.epoch), photoDigestB64: c.photo } };
    }
  }
  return best;
}
