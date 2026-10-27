// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * A photo dropped on Make, handed to its BitGraphed file page (components/bitgraphed-view), which makes BitGraph A, the
 * watermark and BitGraph B in one run. Held in a module slot, which survives the client-side navigation (as
 * lib/fresh-proof does); read once, so a reload or a shared link never makes anything.
 */

let slot: { digest: string; file: File } | null = null;

export function setPendingPhoto(digestUrlSafe: string, file: File) { slot = { digest: digestUrlSafe, file }; }

export function takePendingPhoto(digestUrlSafe: string): File | null {
  if (slot && slot.digest === digestUrlSafe) { const f = slot.file; slot = null; return f; }
  return null;
}
