import { setFreshProof } from "./fresh-proof";
import { cacheArtifactToIDB } from "./file-cache";

/* A drop of several photos, as a gallery: each photo's proof one at a time, or a grid of them all.
 *
 * On Make the photos of one drop share one BitGraph (one tree); on Check each photo leads to the BitGraph it was found
 * in, its own first one, or for a copy the original's, so every photo carries its own. The gallery is kept on this
 * device only: the list of photos (hash, name and BitGraph) in localStorage, so the proof pages keep their place after a
 * reload, and the files themselves in a module slot, which survives the client-side navigation from page to page like
 * fresh-proof. With the files in hand, each page opens with its photo (`prepare` hands it over on the way: the original
 * to the page's IndexedDB cache with its proof, a copy as the copy in hand). After a reload the pages still step
 * through, and the grid shows names where it has no pictures. */

export type GalleryItem = { digest: string; name: string; counter: string; epochId: string };
export type Gallery = { id: string; items: GalleryItem[] };

/** The most photos a drop keeps as a gallery, and how many galleries this device remembers. */
export const MAX_GALLERY = 1000;
const KEPT = 5;
const KEY = "bitgraph-galleries/2";

const toUrlSafe = (b64: string) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const toStd = (s: string) => { const t = s.replace(/-/g, "+").replace(/_/g, "/"); return t + "=".repeat((4 - (t.length % 4)) % 4); };

let held: { id: string; files: File[]; prepare: (i: number) => Promise<void> } | null = null;
const memo = new Map<string, Gallery>();

function remembered(): Gallery[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? (v as Gallery[]) : []; } catch { return []; }
}

/** Keeps a drop's photos as a gallery: `files[i]` is item i's file, `prepare(i)` hands it to its proof page. */
export function setGallery(g: Gallery, files: File[], prepare: (i: number) => Promise<void>) {
  held = { id: g.id, files, prepare };
  memo.set(g.id, g);
  warmThumbs(g);
  try { localStorage.setItem(KEY, JSON.stringify([g, ...remembered().filter((x) => x.id !== g.id)].slice(0, KEPT))); } catch { /* kept for this visit only */ }
}

/** The gallery a proof page belongs to: the newest one holding this file at this BitGraph. */
export function galleryOf(digestParam: string, counter: string | null, epochParam: string | null): { g: Gallery; index: number } | null {
  if (!counter) return null;
  const digest = toStd(digestParam);
  for (const g of [...[...memo.values()].reverse(), ...remembered()]) {
    const index = g.items.findIndex((it) => it.digest === digest && String(it.counter) === String(counter)
      && (!epochParam || toUrlSafe(it.epochId) === epochParam || it.epochId === epochParam));
    if (index >= 0) return { g, index };
  }
  return null;
}

export function hrefOf(g: Gallery, i: number): string {
  const it = g.items[i]!;
  return `/proof/${toUrlSafe(it.digest)}?counter=${encodeURIComponent(it.counter)}&epoch=${encodeURIComponent(toUrlSafe(it.epochId))}`;
}

/** The file of a photo, while this visit still holds it. */
export function fileOf(g: Gallery, i: number): File | null {
  return held?.id === g.id ? held.files[i] ?? null : null;
}

/** Opens a photo's proof, handing its file over first when it is held. */
export async function openItem(g: Gallery, i: number, push: (href: string) => void) {
  if (held?.id === g.id) await held.prepare(i).catch(() => {});
  // a gallery updated since it was drawn (each photo's first BitGraph found) opens where it points now
  push(hrefOf(memo.get(g.id) ?? g, i));
}

/** The hand-over for an original: its file to the page's cache, its proof seeded so the page never waits on an index. */
export async function handOriginal(file: File, digest: string, proof: unknown, counter: string, epochId: string) {
  await cacheArtifactToIDB(file, digest).catch(() => {});
  if (proof) setFreshProof(toUrlSafe(digest), { proofs: [{ proof }], positions: [{ counter, epoch: toUrlSafe(epochId), lowerTime: null, upperTime: null }], causalWindow: null, anchorBlock: null });
}

/* Thumbnails: made from the files in hand, a few at a time, each picture decoded straight to a small size so a
   drop of hundreds of large photos never holds them at full size. Each is kept on this device (IndexedDB
   "bitgraph-thumbs", by the photo's hash), so the grid keeps its pictures after a reload, in a new tab, or from a link,
   when the files themselves are no longer held. All of a gallery's are made in the background once it is set. */
const urls = new Map<string, Promise<string | null>>();
let running = 0;
const waiting: Array<() => void> = [];
const slot = () => new Promise<void>((r) => { if (running < 3) { running++; r(); } else waiting.push(() => { running++; r(); }); });
const done = () => { running--; waiting.shift()?.(); };

function thumbDb(): Promise<IDBDatabase> {
  return new Promise((ok, no) => {
    const req = indexedDB.open("bitgraph-thumbs", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("thumbs");
    req.onsuccess = () => ok(req.result);
    req.onerror = () => no(req.error);
  });
}
async function keptThumb(digest: string): Promise<Blob | null> {
  try {
    const db = await thumbDb();
    try {
      return await new Promise<Blob | null>((ok) => { const r = db.transaction("thumbs").objectStore("thumbs").get(digest); r.onsuccess = () => ok(r.result instanceof Blob ? r.result : null); r.onerror = () => ok(null); });
    } finally { db.close(); }
  } catch { return null; }
}
async function keepThumb(digest: string, blob: Blob) {
  try {
    const db = await thumbDb();
    const tx = db.transaction("thumbs", "readwrite");
    tx.objectStore("thumbs").put(blob, digest);
    await new Promise((r) => { tx.oncomplete = r; tx.onerror = r; });
    db.close();
  } catch { /* shown for this visit only */ }
}
async function makeThumb(f: File): Promise<Blob | null> {
  await slot();
  try {
    const bmp = await createImageBitmap(f, { resizeWidth: 360, resizeQuality: "medium" });
    try {
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      c.getContext("2d")!.drawImage(bmp, 0, 0);
      return await c.convertToBlob({ type: "image/jpeg", quality: 0.82 });
    } finally { bmp.close(); }
  } catch { return null; } finally { done(); }
}

async function cachedFile(digest: string): Promise<File | null> {
  try {
    const db = await new Promise<IDBDatabase>((ok, no) => { const r = indexedDB.open("bitgraph-files", 1); r.onupgradeneeded = () => r.result.createObjectStore("files"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    try {
      const rec = await new Promise<{ name?: string; data?: ArrayBuffer } | null>((ok) => { const r = db.transaction("files").objectStore("files").get(digest); r.onsuccess = () => ok(r.result ?? null); r.onerror = () => ok(null); });
      return rec?.data ? new File([rec.data], rec.name ?? "photo") : null;
    } finally { db.close(); }
  } catch { return null; }
}

/** A photo's thumbnail: kept on this device, or made from its file while the file is held. */
export function thumbOf(g: Gallery, i: number): Promise<string | null> {
  const digest = g.items[i]!.digest;
  let t = urls.get(digest);
  if (!t) {
    t = (async () => {
      const kept = await keptThumb(digest);
      if (kept) return URL.createObjectURL(kept);
      // the file held, or else the copy this browser cached when the photo's page was opened (lib/file-cache)
      const f = fileOf(g, i) ?? await cachedFile(digest);
      const made = f ? await makeThumb(f) : null;
      if (!made) return null;
      void keepThumb(digest, made);
      return URL.createObjectURL(made);
    })();
    // a miss is tried again later (its file may be held by then)
    void t.then((u) => { if (!u) urls.delete(digest); });
    urls.set(digest, t);
  }
  return t;
}

/** Makes and keeps all of a gallery's thumbnails, a few at a time, while its files are held. */
function warmThumbs(g: Gallery) {
  g.items.forEach((_, i) => { void thumbOf(g, i); });
}
