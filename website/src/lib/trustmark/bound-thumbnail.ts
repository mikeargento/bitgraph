// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * What a photo's BitGraph bound, as a picture: the thumbnail bound in its BitGraphed file's own BitGraph and published
 * with the fingerprint record (export.ts, app/api/trustmark/records), for a visitor who holds a copy (a screenshot, a
 * feed's copy) to compare with. Only for that visitor: the record opens with the pointer's tag the copy carries, so a
 * position read off the ledger shows no picture. A visual only for those who already hold one.
 *
 * Nothing is taken on trust. It is shown only when the record is a file of this very BitGraph, the thumbnail is a file
 * of a BitGraph that verifies, and the thumbnail matches the fingerprint this BitGraph bound (align.ts): a thumbnail of
 * another picture cannot pass. A reference, not proof: only the original's exact bytes prove the photo.
 */

import { align, MATCH } from "./align.ts";
import { candidates, unb64, verifyMember } from "./ledger.ts";
import { epochRef, tag as tagOf } from "./payload.ts";
import type { Original } from "./check.ts";
import { decodePhoto, parseRecord } from "./record.ts";
import type { Proof } from "@/lib/plugins";

export type BoundThumbnail = { url: string; counter: number; score: number };

export async function boundThumbnail(photoProof: Proof, tag: number, recordDigestB64?: string): Promise<BoundThumbnail | null> {
  const epochId = String(photoProof.commit?.epochId ?? ""), counter = Number(photoProof.commit?.counter);
  if (!epochId || !Number.isSafeInteger(counter)) return null;
  const root = String(photoProof.artifact?.digestB64 ?? "");
  for (const c of await candidates(await epochRef(epochId), counter, tag, recordDigestB64 ? { epochId, recordDigestB64 } : undefined)) {
    if (!c.thumbB64 || !c.thumbProof) continue;
    if (String(c.proof.artifact?.digestB64) !== root || String(c.proof.commit?.epochId) !== epochId || Number(c.proof.commit?.counter) !== counter) continue;
    const recordBytes = unb64(c.recordB64), rec = parseRecord(recordBytes);
    if (!rec || !(await verifyMember(c.proof, recordBytes))) continue;
    const thumbBytes = unb64(c.thumbB64);
    if (!(await verifyMember(c.thumbProof, thumbBytes))) continue;
    const img = await decodePhoto(new Blob([thumbBytes as BlobPart], { type: "image/jpeg" }));
    if (!img) continue;
    const { score } = align(img.rgba, img.w, img.h, rec.blocks.values);
    if (score < MATCH) continue;
    return { url: URL.createObjectURL(new Blob([thumbBytes as BlobPart], { type: "image/jpeg" })), counter: Number(c.thumbProof.commit?.counter), score };
  }
  return null;
}

/** The bound reference for an original found by a copy's looks (check.ts): the proof at the found position gives the
 *  nonce, the matched record its pHash, and together the tag that opens the published record; the thumbnail is then
 *  checked as above. Null when the record was published without one (photos bound before 2026-10-29, until their
 *  original is checked once). */
export async function foundThumbnail(o: Original): Promise<BoundThumbnail | null> {
  const safe = o.photoDigestB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const res = await fetch(`/api/proofs/${safe}`).catch(() => null);
  const body = res?.ok ? ((await res.json().catch(() => null)) as { proofs?: Array<{ kind?: string; proof: Proof }> } | null) : null;
  const at = body?.proofs?.find((p) => p.kind === "recorded" && String(p.proof.commit?.epochId) === o.epochId && Number(p.proof.commit?.counter) === o.counter)?.proof;
  const nonce = String((at?.commit as { nonceB64?: unknown } | undefined)?.nonceB64 ?? "");
  if (!at || !nonce) return null;
  const eref = await epochRef(o.epochId);
  return boundThumbnail(at, await tagOf(nonce, o.phash, eref, o.counter), o.recordDigestB64);
}
