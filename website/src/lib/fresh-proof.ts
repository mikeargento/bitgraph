// Hand-off for a just-recorded proof. The drop flow commits inside the TEE, then
// navigates to the proof page. The committed proof already carries everything to
// paint the record (its image is in IndexedDB, its causal window / anchor fill in
// from the background fetch, since a brand-new proof's upper anchor hasn't landed
// yet). So we stash it in a module slot — which survives the client-side
// router.push, like pending-drop — and the proof page seeds from it instantly
// instead of showing the lookup skeleton. The create moment should read as
// "recording", not "loading a page".
let slot: { digest: string; data: unknown } | null = null;

export function setFreshProof(digest: string, data: unknown) {
  slot = { digest, data };
}

// Consume the seed for `digest` (url-safe). One-shot: cleared on read so a later
// reload or shared link falls through to the normal fetch, never a stale seed.
export function takeFreshProof<T = unknown>(digest: string): T | null {
  if (slot && slot.digest === digest) {
    const d = slot.data as T;
    slot = null;
    return d;
  }
  return null;
}
