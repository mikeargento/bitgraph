// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import type { Original } from "./check.ts";

/**
 * A copy of a photo (its BitGraphed file, a screenshot, a feed's copy) whose hidden pointer led to the photo's page,
 * handed to that page so it can show the copy in its file pane, labelled for what it is. Held in a module slot, which
 * survives the client-side navigation (as lib/fresh-proof does); read once.
 */

/** tag: the pointer's tag the copy carries, which opens the original's published thumbnail and credentials on its page.
 *  found: the original a copy was matched to by its looks (check.ts), which opens the same. */
export type HeldCopy = { name: string; data: ArrayBuffer; kind: "bitgraphed" | "copy"; score: number; tag?: number; found?: Original };

let slot: { digest: string; copy: HeldCopy } | null = null;

export function setHeldCopy(digestUrlSafe: string, copy: HeldCopy) { slot = { digest: digestUrlSafe, copy }; }

export function takeHeldCopy(digestUrlSafe: string): HeldCopy | null {
  if (slot && slot.digest === digestUrlSafe) { const c = slot.copy; slot = null; return c; }
  return null;
}

const CARRIER_MAGIC = [0x42, 0x47, 0x50, 0x52, 0x4f, 0x4f, 0x46, 0x01];
/** Whether a file is a BitGraphed file: a file with its proof block at the end (lib/carrier). */
export async function isBitGraphedFile(f: Blob): Promise<boolean> {
  if (f.size < 32) return false;
  const tail = new Uint8Array(await f.slice(f.size - 8).arrayBuffer());
  return CARRIER_MAGIC.every((b, i) => tail[i] === b);
}
