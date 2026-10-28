/* A drop of several photos, as a gallery: each photo's proof one at a time, or a grid of them all.
 *
 * The photos of one drop share one BitGraph (one tree), and each opens its own proof page. The gallery is kept on this
 * device only: the list of photos (hash and name) in localStorage, so the proof pages keep their place after a reload,
 * and the files themselves in a module slot, which survives the client-side navigation from page to page like
 * fresh-proof. With the files in hand, each page opens with its photo (written to the page's IndexedDB cache on the
 * way) and with its proof handed over, so it never waits on the tree's index. After a reload the pages still step
 * through, from the index, and the grid shows names where it has no pictures. */

import { setFreshProof } from "./fresh-proof";
import { cacheArtifactToIDB } from "./file-cache";

export type GalleryItem = { digest: string; name: string };
export type Gallery = { id: string; counter: string; epochId: string; items: GalleryItem[] };

/** The most photos a drop keeps as a gallery, and how many galleries this device remembers. */
export const MAX_GALLERY = 1000;
const KEPT = 5;
const KEY = "bitgraph-galleries";

const toUrlSafe = (b64: string) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const toStd = (s: string) => { const t = s.replace(/-/g, "+").replace(/_/g, "/"); return t + "=".repeat((4 - (t.length % 4)) % 4); };

let held: { id: string; files: Map<string, File>; proofOf: (digest: string) => unknown } | null = null;

function remembered(): Gallery[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? (v as Gallery[]) : []; } catch { return []; }
}

/** Keeps a drop's photos as a gallery. `proofOf` gives a photo's proof with its place in the tree, for the hand-over. */
export function setGallery(g: Gallery, files: Map<string, File>, proofOf: (digest: string) => unknown) {
  held = { id: g.id, files, proofOf };
  try { localStorage.setItem(KEY, JSON.stringify([g, ...remembered().filter((x) => x.id !== g.id)].slice(0, KEPT))); } catch { /* kept for this visit only */ }
  memo.set(g.id, g);
}
const memo = new Map<string, Gallery>();

/** The gallery a proof page belongs to: the newest one holding this file at this BitGraph. */
export function galleryOf(digestParam: string, counter: string | null, epochParam: string | null): { g: Gallery; index: number } | null {
  if (!counter) return null;
  const digest = toStd(digestParam);
  const all = [...memo.values(), ...remembered()];
  for (const g of all) {
    if (String(g.counter) !== String(counter)) continue;
    if (epochParam && toUrlSafe(g.epochId) !== epochParam && g.epochId !== epochParam) continue;
    const index = g.items.findIndex((it) => it.digest === digest);
    if (index >= 0) return { g, index };
  }
  return null;
}

export function hrefOf(g: Gallery, i: number): string {
  return `/proof/${toUrlSafe(g.items[i]!.digest)}?counter=${encodeURIComponent(g.counter)}&epoch=${encodeURIComponent(toUrlSafe(g.epochId))}`;
}

/** The file of a photo, while this visit still holds it. */
export function fileOf(g: Gallery, digest: string): File | null {
  return held?.id === g.id ? held.files.get(digest) ?? null : null;
}

/** Opens a photo's proof: its file goes to the page's cache and its proof is handed over first, when they are held. */
export async function openItem(g: Gallery, i: number, push: (href: string) => void) {
  const it = g.items[i]!;
  const f = fileOf(g, it.digest);
  if (f) {
    await cacheArtifactToIDB(f, it.digest).catch(() => {});
    const proof = held!.proofOf(it.digest);
    if (proof) setFreshProof(toUrlSafe(it.digest), { proofs: [{ proof }], positions: [{ counter: g.counter, epoch: toUrlSafe(g.epochId), lowerTime: null, upperTime: null }], causalWindow: null, anchorBlock: null });
  }
  push(hrefOf(g, i));
}

/* Thumbnails: made from the files in hand, a few at a time, each picture decoded straight to a small size so a
   drop of hundreds of large photos never holds them at full size. */
const thumbs = new Map<File, Promise<string | null>>();
let running = 0;
const waiting: Array<() => void> = [];
const slot = () => new Promise<void>((r) => { if (running < 3) { running++; r(); } else waiting.push(() => { running++; r(); }); });
const done = () => { running--; waiting.shift()?.(); };

export function thumbOf(f: File): Promise<string | null> {
  let t = thumbs.get(f);
  if (!t) {
    t = (async () => {
      await slot();
      try {
        const bmp = await createImageBitmap(f, { resizeWidth: 360, resizeQuality: "medium" });
        try {
          const c = new OffscreenCanvas(bmp.width, bmp.height);
          c.getContext("2d")!.drawImage(bmp, 0, 0);
          return URL.createObjectURL(await c.convertToBlob({ type: "image/jpeg", quality: 0.82 }));
        } finally { bmp.close(); }
      } catch { return null; } finally { done(); }
    })();
    thumbs.set(f, t);
  }
  return t;
}
