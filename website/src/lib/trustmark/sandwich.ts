// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * A BitGraphed file is a watermarked file between two BitGraphs:
 *
 *   BitGraph A   binds the original (with its fingerprint record).
 *   the mark     the pointer, made from A's nonce, written into the pixels.
 *   BitGraph B   binds the marked file.
 *
 * The pointer could not exist before A (it needs A's nonce, unseen until A was bound), and B shows the marked file
 * existed by B: the file was made between the two. This module remakes the pointer from A's public proof, so a page can
 * show, in the reader's own browser, that the pointer in the file is the one A's nonce makes.
 */

import { candidates, unb64, verifyMember } from "./ledger.ts";
import { epochRef, MAX_COUNTER, pack, tag, unpack } from "./payload.ts";
import { parseRecord } from "./record.ts";
import type { Proof } from "@/lib/plugins";

export type PointerParts = { eref: number; counter: number; tag: number };

/** The pointer BitGraph A's nonce makes for a photo with this pHash, or null when A's position does not fit one. */
export async function pointerFrom(original: Proof, phashHex: string): Promise<string | null> {
  const epochId = String(original.commit?.epochId ?? ""), counter = Number(original.commit?.counter);
  const nonce = String((original.commit as { nonceB64?: string } | undefined)?.nonceB64 ?? "");
  if (!epochId || !nonce || !Number.isSafeInteger(counter) || counter > MAX_COUNTER) return null;
  const eref = await epochRef(epochId);
  return pack(eref, counter, await tag(nonce, phashHex, eref, counter));
}

export const partsOf = (payload: string): PointerParts => unpack(payload);

/**
 * The pointer this photo's BitGraphed files carry, remade here from A's proof and the photo's published fingerprint
 * record, or null when the record is not published (no BitGraphed file has been made of it yet) or does not check out.
 */
export async function publishedPointer(photoDigestB64: string, original: Proof): Promise<string | null> {
  const epochId = String(original.commit?.epochId ?? ""), counter = Number(original.commit?.counter);
  if (!epochId || !Number.isSafeInteger(counter)) return null;
  for (const c of await candidates(await epochRef(epochId), counter)) {
    const bytes = unb64(c.recordB64), rec = parseRecord(bytes);
    if (!rec || rec.photo !== photoDigestB64) continue;
    if (String(c.proof.commit?.epochId) !== epochId || String(c.proof.commit?.counter) !== String(counter)) continue;
    if (!(await verifyMember(c.proof, bytes))) continue;
    return pointerFrom(original, rec.phash);
  }
  return null;
}
