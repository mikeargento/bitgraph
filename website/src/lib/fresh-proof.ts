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

/* ── What was just saved, and what to do with it ───────────────────────────
 *
 * ⚠️ A SOLO MAKE SAID NOTHING ABOUT THE FILE IT WROTE. Making ends in a file
 * now, and the line explaining that file lives on the results card — but a
 * lone file is the product's most common gesture and it navigates STRAIGHT to
 * its proof page, so the card is never rendered and the download arrived with
 * no explanation at all. Mike, minutes after it shipped: "it didnt create a
 * FOLDER called bitgraph on my desktop". He had no way to know one was his to
 * make, because nothing had told him a file was saved in the first place.
 *
 * So the notice rides across the navigation the same way the proof does. Same
 * one-shot rule: read once, so a reload or a shared link never shows a stale
 * sentence about someone else's download.
 */
let savedSlot: string | null = null;

export function setSavedNotice(text: string) {
  savedSlot = text;
}

export function takeSavedNotice(): string | null {
  const t = savedSlot;
  savedSlot = null;
  return t;
}
