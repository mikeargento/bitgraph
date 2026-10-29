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
 * the threshold is the original. A screenshot that frames the photo (a post, a card, a window) is tried again by its
 * rectangles (locate.ts), since the match runs one way round: the copy as a crop of the original. Nothing is added to a photo to make this work, and the picture never leaves the
 * machine. An invisible watermark did this job before; it changed the original's bytes, so the marked copy needed a
 * BitGraph of its own, and the find led to the copy's record rather than the original's.
 */

import { align, MATCH } from "./align.ts";
import { candidates as rectangles, cropRGBA } from "./locate.ts";
import { fingerprintOf, type Decoded } from "./record.ts";

/** phash and recordDigestB64: the record that matched, which opens the bound reference thumbnail (bound-thumbnail.ts). */
export type Original = { counter: number; epochId: string; photoDigestB64: string; phash: string; recordDigestB64: string; hosted: boolean; recordedMs: number | null };
/** others: every other bound original the copy also matches (the same picture exported twice is two originals, each
 *  with its own proof); the find lists them all and chooses none. Best score first. */
export type LooksVerdict =
  | { verdict: "none" }
  | { verdict: "unavailable" }
  | { verdict: "match"; original: Original; score: number; others: Array<{ original: Original; score: number }> };

type Candidate = { distance: number; phash: string; photo: string; counter: string; epoch: string; record: string; values: string; hosted?: boolean; recordedMs?: number | null };
const fromUrlSafe = (s: string) => { const t = s.replace(/-/g, "+").replace(/_/g, "/"); return t + "=".repeat((4 - (t.length % 4)) % 4); };

/** Rectangles of a framed screenshot tried after the whole picture, each one lookup on the server. */
const RECTANGLES = 6;

async function judgeOne(img: Decoded, seen: Map<string, Promise<Candidate[]>>): Promise<LooksVerdict> {
  const { phash } = fingerprintOf(img);
  let fetched = seen.get(phash);
  if (!fetched) {
    // a failed lookup is not an empty one: the caller must say the ledger could not be asked, not that nothing matched
    fetched = fetch(`/api/find?phash=${phash}`).then(async (r) => { if (!r.ok) throw new Error(`find ${r.status}`); return ((await r.json()) as { candidates?: Candidate[] }).candidates ?? []; });
    seen.set(phash, fetched);
  }
  let list: Candidate[];
  try { list = await fetched; } catch { return { verdict: "unavailable" }; }
  const matches: Array<{ original: Original; score: number }> = [];
  for (const c of list) {
    const { score } = align(img.rgba, img.w, img.h, c.values);
    if (score < MATCH) continue;
    const original: Original = { counter: Number(c.counter), epochId: fromUrlSafe(c.epoch), photoDigestB64: c.photo, phash: c.phash, recordDigestB64: fromUrlSafe(c.record), hosted: c.hosted === true, recordedMs: typeof c.recordedMs === "number" ? c.recordedMs : null };
    // one entry per original file: the same bytes bound more than once are one original, at its best-scoring position
    const dup = matches.findIndex((m) => m.original.photoDigestB64 === original.photoDigestB64);
    if (dup < 0) matches.push({ original, score });
    else if (score > matches[dup]!.score) matches[dup] = { original, score };
  }
  // The order is usefulness, not score: an original whose file is hosted first (it can give the visitor the file),
  // then the earliest bound (it proves when the picture first existed), then the closer match.
  const when = (m: { original: Original }) => m.original.recordedMs ?? Number.POSITIVE_INFINITY;
  matches.sort((a, b) => Number(b.original.hosted) - Number(a.original.hosted) || when(a) - when(b) || b.score - a.score);
  if (matches.length === 0) return { verdict: "none" };
  return { verdict: "match", score: matches[0]!.score, original: matches[0]!.original, others: matches.slice(1) };
}

/**
 * The verdict for a decoded copy: the original it looks like, when a published record matches it. search: when the
 * whole picture matches nothing, also try the rectangles a framed screenshot shows (a post with its caption, a card,
 * a window), each cut out and matched on its own (locate.ts); a lookup per rectangle, so a drop of many photos leaves
 * it off and only a single picture gets it.
 */
export async function judge(full: Decoded, { search = true } = {}): Promise<LooksVerdict> {
  const seen = new Map<string, Promise<Candidate[]>>();
  const whole = await judgeOne(full, seen);
  if (whole.verdict !== "none" || !search) return whole;
  for (const c of rectangles(full.rgba, full.w, full.h).slice(1, 1 + RECTANGLES)) {
    const r = await judgeOne({ rgba: cropRGBA(full.rgba, full.w, c.x, c.y, c.w, c.h), w: c.w, h: c.h }, seen);
    if (r.verdict !== "none") return r;
  }
  return whole;
}

/** Whether a match should open its first original without asking: it is the only one, or the only one hosted. */
export const opensAlone = (v: LooksVerdict): boolean => v.verdict === "match" && (v.others.length === 0 || (v.original.hosted && !v.others.some((m) => m.original.hosted)));
