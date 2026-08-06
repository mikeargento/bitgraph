/* What the browser remembers about YOUR BitGraph folder.
 *
 * A browser cannot read a folder on its own: it gets the bytes only while a
 * drop or a picker is in hand, and loses them the moment the tab closes. So
 * /folder would be blank on every visit until you handed the folder over
 * again, which is a poor thing to ask of someone whose recordings all sit
 * right there on their own disk.
 *
 * This keeps the ANSWER rather than the access: one row per recording, plus
 * the few-KB thumbnail the roll already generates for its 48px cell. Enough
 * to render your whole roll instantly, with pictures, having read nothing.
 * Re-handing the folder is then a refresh for what is new, not the price of
 * admission.
 *
 * ⚠️ Local only, and it has to stay that way. This is a store of the user's
 * own thumbnails on the user's own machine; nothing here is ever sent, and
 * nothing here is authoritative. A cached verdict is re-presented on the
 * next sync ONLY when the export's fingerprint (artifact and proof.json,
 * name+size+mtime each) proves nothing changed — see RowMemo in
 * folder-check for why that is sound on an append-only ledger. Anything
 * changed, failed, unchecked, or unsealed is recomputed from the bytes.
 */

const DB = "bitgraph-folder";
const STORE = "rows";
// v2 adds "meta", which holds one thing: the directory handle. A handle is
// the re-usable form of a hand-over — structured-cloneable, so IndexedDB can
// keep it — and it is what lets "Sync again" read the folder without another
// drag, in the browsers whose API allows it at all.
const META = "meta";
const VERSION = 2;

/** One remembered recording. Mirrors the fields the roll renders, which is
 *  deliberately not the whole proof: this is a browsing cache, not a copy of
 *  the ledger. */
export interface CachedRow {
  /** url-safe digest: the key, and what a proof page is addressed by. */
  digest: string;
  dirName: string;
  fileName: string | null;
  counter: string | null;
  epochUrlSafe: string | null;
  block: number | null;
  ts: number | null;
  writeTime: number | null;
  /** The last verdict seen WHILE THE BYTES WERE IN HAND. Kept for the count,
   *  never re-presented as a fresh check; see the note above. */
  ok: boolean | null;
  failure: string | null;
  /** The export's fingerprint when the verdict was ok: the matched file's
   *  name is in fileName, size/mtime are its walk-time identity, and
   *  proofSize/proofMtime are proof.json's own. Together (with dirName) they
   *  are the memo key that lets the next sync skip an unchanged export
   *  entirely — zero reads. Absent on rows that never matched. */
  size?: number | null;
  mtime?: number | null;
  proofSize?: number | null;
  proofMtime?: number | null;
  thumb?: Blob;
  /** A ~512px JPEG of the artifact, made in the same decode as the thumb.
   *  What a proof page opened from /folder shows when the bytes themselves
   *  are not in hand. Never uploaded, like everything here. */
  preview?: Blob;
}

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "digest" });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

/** Every remembered row. Empty when nothing has been handed over yet, which
 *  is what puts /folder into its first-run state. */
export async function readCachedRows(): Promise<CachedRow[]> {
  try {
    const db = await open();
    const rows = await new Promise<CachedRow[]>((res, rej) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => res((req.result as CachedRow[]) || []);
      req.onerror = () => rej(req.error);
    });
    db.close();
    return rows;
  } catch {
    return []; // a browser refusing storage is a blank page, not an error
  }
}

/** Write rows, preserving any thumbnail and preview already held for the same
 *  digest: a re-read of the folder produces fresh verdicts but regenerates
 *  pictures lazily, and dropping them on every visit would make the roll
 *  flash empty. */
export async function writeCachedRows(rows: CachedRow[]): Promise<void> {
  if (!rows.length) return;
  try {
    const db = await open();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const row of rows) {
        const get = store.get(row.digest);
        get.onsuccess = () => {
          const prior = get.result as CachedRow | undefined;
          store.put({ thumb: prior?.thumb, preview: prior?.preview, ...row });
        };
      }
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch { /* browsing still works, it just will not be remembered */ }
}

/** Attach a thumbnail (and its larger preview) to a row already written. */
export async function writeCachedThumb(digest: string, thumb: Blob, preview?: Blob): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const get = store.get(digest);
      get.onsuccess = () => {
        const prior = get.result as CachedRow | undefined;
        if (prior) store.put({ ...prior, thumb, ...(preview ? { preview } : {}) });
      };
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch { /* the row simply shows its type label next time */ }
}

/** One row, by the url-safe digest a proof page is addressed by. How that
 *  page finds the preview for a recording whose bytes are not in hand. */
export async function readCachedRow(digest: string): Promise<CachedRow | null> {
  try {
    const db = await open();
    const row = await new Promise<CachedRow | null>((res, rej) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(digest);
      req.onsuccess = () => res((req.result as CachedRow | undefined) ?? null);
      req.onerror = () => rej(req.error);
    });
    db.close();
    return row;
  } catch {
    return null;
  }
}

/** Keep the folder's directory handle for later syncs. Chromium only; the
 *  value is opaque here on purpose (folder-check owns the shape). */
export async function saveDirHandle(handle: unknown): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(META, "readwrite");
      tx.objectStore(META).put(handle, "dirHandle");
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch { /* syncing just stays a drag */ }
}

export async function readDirHandle(): Promise<unknown | null> {
  try {
    const db = await open();
    const h = await new Promise<unknown>((res, rej) => {
      const req = db.transaction(META, "readonly").objectStore(META).get("dirHandle");
      req.onsuccess = () => res(req.result ?? null);
      req.onerror = () => rej(req.error);
    });
    db.close();
    return h;
  } catch {
    return null;
  }
}

/** Forget the folder: rows, thumbnails AND the handle. The recordings are
 *  untouched: they are on the ledger and in the folder, and this only ever
 *  held a picture of them plus permission to look again. */
export async function clearCachedRows(): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction([STORE, META], "readwrite");
      tx.objectStore(STORE).clear();
      tx.objectStore(META).clear();
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch { /* nothing to do */ }
}
