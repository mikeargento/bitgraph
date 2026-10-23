/* The artifact-bytes handoff: how a proof page comes to hold the picture.
 *
 * The proof page polls IndexedDB "bitgraph-files" for the artifact's bytes
 * under the proof digest (standard base64). The home page writes them there
 * after recording; /folder writes them when a row whose bytes are in hand is
 * opened. Bytes first so the image appears immediately; the C2PA read is
 * best-effort (a ~6 MB WASM toolkit, lazily loaded) and never blocks the
 * bytes. Everything stays on the device — this is a cache, not an upload.
 */

import type { C2PAReadResult } from "./c2pa-reader";

export async function cacheArtifactToIDB(file: File, proofDigest: string): Promise<void> {
  const buf = await file.arrayBuffer();
  const writeRecord = async (c2pa: C2PAReadResult | null, c2paChecked: boolean) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("bitgraph-files", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("files");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put({ name: file.name, data: buf, c2pa, c2paChecked }, proofDigest);
    await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = j; });
    db.close();
  };
  await writeRecord(null, false);
  let c2pa: C2PAReadResult | null = null;
  try {
    const { readC2PA } = await import("./c2pa-reader");
    c2pa = await readC2PA(file);
  } catch (e) {
    console.warn("[bitgraph] c2pa read failed:", e);
  }
  await writeRecord(c2pa, true);
}

/* ── Rendered previews, remembered. ──
   A HEIC (every iPhone's default) cannot be shown by most browsers; the proof
   page converts it to JPEG in WebAssembly, which on a 24 MP photo takes
   several seconds. Content-addressed by the proof digest, the converted
   preview is as permanent as the bytes it was made from, so it is kept in the
   same store under a sibling key and the second visit is instant. Same
   database, same store, same version: a new object store would mean a
   version bump at every open() site. The key is `${digest}:preview`, which no
   digest can collide with (a digest is base64 and carries no colon). */

const previewKey = (proofDigest: string) => `${proofDigest}:preview`;

async function openFilesDB(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("bitgraph-files", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getPreviewFromIDB(proofDigest: string): Promise<Blob | null> {
  try {
    const db = await openFilesDB();
    const tx = db.transaction("files", "readonly");
    const rec = await new Promise<{ data: ArrayBuffer; mime: string } | undefined>((resolve) => {
      const req = tx.objectStore("files").get(previewKey(proofDigest));
      req.onsuccess = () => resolve(req.result as { data: ArrayBuffer; mime: string } | undefined);
      req.onerror = () => resolve(undefined);
    });
    db.close();
    return rec?.data ? new Blob([rec.data], { type: rec.mime || "image/jpeg" }) : null;
  } catch {
    return null;
  }
}

export async function putPreviewToIDB(proofDigest: string, preview: Blob): Promise<void> {
  try {
    const data = await preview.arrayBuffer();
    const db = await openFilesDB();
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put({ data, mime: preview.type || "image/jpeg" }, previewKey(proofDigest));
    await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = j; });
    db.close();
  } catch { /* a preview that is not remembered is converted again next time */ }
}

/* ── The net under a BitGraph that has not been filed anywhere yet ──
 *
 * ⚠️ THE LEDGER USED TO BE THE BACKUP AND IS ABOUT TO STOP BEING ONE.
 * Discovery and sharing were replaceable; durability was not. While every
 * proof is written to the bucket, a package you forget to save is merely
 * inconvenient — the proof is still ours to hand back. Once only anchors are
 * written, the package IS the BitGraph, and losing it loses evidence whose
 * position stays minted and consumed forever.
 *
 * So making now ends in a file automatically, and a copy of that same file is
 * kept here. Downloads is the least durable folder on the machine; this turns
 * "gone forever" into "gone if you also lose this browser profile", which is
 * a different kind of bad. It is a net, not a home: the folder on disk is the
 * real thing, and this exists for the minutes and days before someone files
 * it somewhere they trust.
 *
 * Same database and store as the artifact bytes, under a key no digest can
 * collide with, so no version bump and no second open() site.
 */

const PACKAGE_PREFIX = "package:";
const packageKey = (id: string) => `${PACKAGE_PREFIX}${id}`;

export interface SavedPackage {
  /** The download's own filename, so it can be handed back under it. */
  name: string;
  blob: Blob;
  savedAt: number;
  /** Positions it holds, "epoch counter" each — what was minted, for a
   *  reader deciding whether this copy is still worth keeping. */
  positions: string[];
}

/** Keep a copy of a package that was just handed to the browser. Best effort
 *  in every direction: a private window, a full disk or a browser that
 *  refuses storage must never break the download that already happened. */
export async function putPackageToIDB(id: string, pkg: SavedPackage): Promise<void> {
  try {
    const db = await openFilesDB();
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put(pkg, packageKey(id));
    await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = j; });
    db.close();
  } catch (e) {
    console.warn("[bitgraph] could not keep a copy of the package:", e);
  }
}

/** Every package still held, newest first. */
export async function listPackagesFromIDB(): Promise<Array<SavedPackage & { id: string }>> {
  try {
    const db = await openFilesDB();
    const tx = db.transaction("files", "readonly");
    const store = tx.objectStore("files");
    const keys = await new Promise<IDBValidKey[]>((res, rej) => {
      const r = store.getAllKeys();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const wanted = keys.filter((k): k is string => typeof k === "string" && k.startsWith(PACKAGE_PREFIX));
    const out: Array<SavedPackage & { id: string }> = [];
    for (const k of wanted) {
      const v = await new Promise<SavedPackage | undefined>((res, rej) => {
        const r = store.get(k);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      if (v?.blob) out.push({ ...v, id: k.slice(PACKAGE_PREFIX.length) });
    }
    db.close();
    return out.sort((a, b) => b.savedAt - a.savedAt);
  } catch (e) {
    console.warn("[bitgraph] could not read kept packages:", e);
    return [];
  }
}

/** Drop a kept copy. Called once its positions are known to be in a folder
 *  the person actually holds — never on a timer, and never to make room. */
export async function forgetPackageInIDB(id: string): Promise<void> {
  try {
    const db = await openFilesDB();
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").delete(packageKey(id));
    await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = j; });
    db.close();
  } catch (e) {
    console.warn("[bitgraph] could not forget a kept package:", e);
  }
}
