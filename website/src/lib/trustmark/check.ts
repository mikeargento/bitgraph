// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Reading a copy: what anyone concludes from a copy alone, with the public ledger.
 *
 * Kept apart, because they are different kinds of claim:
 *   the proof   the original's BitGraph binds its exact bytes, after a nonce nobody could see (cryptographic);
 *   this copy   carries a pointer to that BitGraph and looks like the picture it bound: a visual match against the
 *               fingerprint record bound in that same BitGraph, tolerant of crops (align.ts). Not proof that the copy is
 *               unaltered; only the original's exact bytes prove that.
 *
 * A reading counts only when its pointer checks out: the record is a member of the tree the proof signs and the proof
 * verifies, the record names a photo, and the tag fits that BitGraph's nonce and the bound pHash. Trying several
 * readings (whole, centre square, zooms, the rectangles of a screenshot) therefore never turns noise into a verdict.
 */

import { align, MATCH, signature } from "./align.ts";
import { candidates, unb64, verifyMember } from "./ledger.ts";
import { candidates as rectangles } from "./locate.ts";
import { cropRGBA, readings } from "./marks.ts";
import { epochRef, tag, unpack } from "./payload.ts";
import { decodePhoto, parseRecord, type Decoded } from "./record.ts";
import { readDetachedC2PA } from "@/lib/c2pa-reader";
import { readRuntime } from "./runtime.ts";
import { resizeRGB } from "./tm.ts";
import type { Proof } from "@/lib/plugins";

export type Original = { proof: Proof; counter: number; epochId: string; photoDigestB64: string; artifactDigestB64: string };
/** The original's Content Credentials, shown for a copy only when their signed thumbnail matches it. */
export type Credentials = { signer?: string; creator?: string; generator?: string };
export type TrustmarkVerdict =
  | { verdict: "none"; markRead: boolean }
  | { verdict: "forged"; why: string }
  | { verdict: "mismatch"; original: Original; score: number }
  | { verdict: "match"; original: Original; score: number; frame: number; how: string; inScreenshot: boolean; credentials?: Credentials };

/** The first candidate record that this pointer genuinely names, with its parsed record. */
async function resolve(payload: string): Promise<{ original: Original; phash: string; values: string; c2pa?: { bytes: Uint8Array; proof: Proof } } | "forged" | null> {
  const { eref, counter, tag: t } = unpack(payload);
  let sawRecord = false;
  for (const c of await candidates(eref, counter)) {
    const bytes = unb64(c.recordB64), rec = parseRecord(bytes);
    if (!rec || !(await verifyMember(c.proof, bytes))) continue;
    const epochId = String(c.proof.commit?.epochId ?? ""), n = Number(c.proof.commit?.counter);
    if (n !== counter || (await epochRef(epochId)) !== eref) continue;
    sawRecord = true;
    if ((await tag(String((c.proof.commit as { nonceB64?: string } | undefined)?.nonceB64 ?? ""), rec.phash, eref, counter)) !== t) continue;
    const c2pa = c.c2paB64 && c.c2paProof ? { bytes: unb64(c.c2paB64), proof: c.c2paProof } : undefined;
    return { original: { proof: c.proof, counter: n, epochId, photoDigestB64: rec.photo, artifactDigestB64: String(c.proof.artifact?.digestB64 ?? "") }, phash: rec.phash, values: rec.blocks.values, c2pa };
  }
  return sawRecord ? "forged" : null;
}

// Every read shrinks the picture to 245 pixels, and the alignment to 160: shrinking a large photo once, first, gives
// the same readings for a fraction of the work.
const READ_MAX = 1600;
function shrunk(img: Decoded): Decoded {
  const s = READ_MAX / Math.max(img.w, img.h);
  if (s >= 1) return img;
  const w = Math.max(1, Math.round(img.w * s)), h = Math.max(1, Math.round(img.h * s)), n = img.w * img.h;
  const rgb = new Uint8ClampedArray(n * 3);
  for (let i = 0; i < n; i++) { rgb[i * 3] = img.rgba[i * 4]!; rgb[i * 3 + 1] = img.rgba[i * 4 + 1]!; rgb[i * 3 + 2] = img.rgba[i * 4 + 2]!; }
  const small = resizeRGB(rgb, img.w, img.h, w, h), rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i * 4] = small[i * 3]!; rgba[i * 4 + 1] = small[i * 3 + 1]!; rgba[i * 4 + 2] = small[i * 3 + 2]!; rgba[i * 4 + 3] = 255; }
  return { rgba, w, h };
}

async function judgeRegion(img: Decoded, zooms: boolean): Promise<TrustmarkVerdict | null> {
  const env = await readRuntime();
  let markRead = false, forged = false;
  for await (const r of readings(img.rgba, img.w, img.h, env, { zooms })) {
    markRead = true;
    const o = await resolve(r.payload);
    if (o === "forged") { forged = true; continue; }
    if (!o) continue;
    const a = align(img.rgba, img.w, img.h, o.values);
    if (a.score < MATCH) return { verdict: "mismatch", original: o.original, score: a.score };
    return { verdict: "match", original: o.original, score: a.score, frame: (a.window[1] - a.window[0]) * (a.window[3] - a.window[2]), how: r.how, inScreenshot: false, credentials: o.c2pa ? await credentialsFor(img, o.c2pa, o.original) : undefined };
  }
  if (forged) return { verdict: "forged", why: "the mark's tag does not fit the BitGraph it points to" };
  return markRead ? { verdict: "none", markRead: true } : null;
}

/**
 * The original's Content Credentials, for this copy, or undefined. They count only when the manifest is a file of the
 * original's own BitGraph and checks out (signature, certificate, assertion hashes; the image's own hash cannot be
 * checked without the image), and its signed thumbnail matches the copy: credentials taken from another picture
 * cannot pass, and a manifest with no thumbnail is never shown for a copy.
 */
async function credentialsFor(img: Decoded, c2pa: { bytes: Uint8Array; proof: Proof }, original: Original): Promise<Credentials | undefined> {
  if (String(c2pa.proof.artifact?.digestB64) !== original.artifactDigestB64 || !(await verifyMember(c2pa.proof, c2pa.bytes))) return undefined;
  const m = await readDetachedC2PA(c2pa.bytes);
  if (!m?.summary.signatureValid || !m.thumbnail) return undefined;
  const thumb = await decodePhoto(new Blob([m.thumbnail as BlobPart], { type: "image/jpeg" }));
  if (!thumb || align(img.rgba, img.w, img.h, signature(thumb.rgba, thumb.w, thumb.h)).score < MATCH) return undefined;
  return { signer: m.summary.signatureIssuer, creator: m.summary.creator, generator: m.summary.claimGeneratorInfo?.[0]?.name ?? m.summary.claimGenerator };
}

/** Whether the picture carries a pointer to a BitGraph, found anywhere in it (whole, zoomed, inside a screenshot) and
 *  checked against the ledger; a read that noise happens to decode does not count. */
export async function carriesPointer(img: Decoded): Promise<boolean> {
  return (await judge(img, { search: true, zooms: true })).verdict !== "none";
}

/**
 * The verdict for a decoded copy. search: also look for the photo inside a wider picture (a screenshot with a toolbar
 * or a page around it); several seconds when nothing is found, so the drop box uses it only for a check. zooms: also
 * try the copy put back in a larger frame, for one zoomed in; Make leaves these out, since a copy dropped there is the
 * file itself or a feed's copy.
 */
export async function judge(full: Decoded, { search = true, zooms = true } = {}): Promise<TrustmarkVerdict> {
  const img = shrunk(full);
  const whole = await judgeRegion(img, zooms);
  if (whole?.verdict === "match" || whole?.verdict === "mismatch" || !search) return whole ?? { verdict: "none", markRead: false };
  for (const c of rectangles(img.rgba, img.w, img.h).slice(1)) {
    const j = await judgeRegion({ rgba: cropRGBA(img.rgba, img.w, c.x, c.y, c.w, c.h), w: c.w, h: c.h }, false);
    if (j?.verdict === "match") return { ...j, inScreenshot: true };
    if (j?.verdict === "mismatch") return j;
  }
  return whole ?? { verdict: "none", markRead: false };
}
