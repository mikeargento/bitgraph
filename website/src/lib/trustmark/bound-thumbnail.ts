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
import { epochRef } from "./payload.ts";
import { decodePhoto, parseRecord } from "./record.ts";
import type { Proof } from "@/lib/plugins";

export type BoundThumbnail = { url: string; counter: number; score: number };

export async function boundThumbnail(photoProof: Proof, tag: number): Promise<BoundThumbnail | null> {
  const epochId = String(photoProof.commit?.epochId ?? ""), counter = Number(photoProof.commit?.counter);
  if (!epochId || !Number.isSafeInteger(counter)) return null;
  const root = String(photoProof.artifact?.digestB64 ?? "");
  for (const c of await candidates(await epochRef(epochId), counter, tag)) {
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
