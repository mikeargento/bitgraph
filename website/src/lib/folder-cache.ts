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
 * nothing here is authoritative. Every verdict is recomputed from the bytes
 * when the folder is handed over again, because a cached "matches the
 * ledger" is a claim about a file this code can no longer see.
 */

const DB = "bitgraph-folder";
const STORE = "rows";
const VERSION = 1;

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
  thumb?: Blob;
}

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "digest" });
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

/** Write rows, preserving any thumbnail already held for the same digest: a
 *  re-read of the folder produces fresh verdicts but regenerates thumbnails
 *  lazily, and dropping them on every visit would make the roll flash empty. */
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
          store.put(row.thumb ? row : { ...row, thumb: prior?.thumb });
        };
      }
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch { /* browsing still works, it just will not be remembered */ }
}

/** Attach a thumbnail to a row already written. */
export async function writeCachedThumb(digest: string, thumb: Blob): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const get = store.get(digest);
      get.onsuccess = () => {
        const prior = get.result as CachedRow | undefined;
        if (prior) store.put({ ...prior, thumb });
      };
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch { /* the row simply shows its type label next time */ }
}

/** Forget the folder. The recordings are untouched: they are on the ledger
 *  and in the folder, and this only ever held a picture of them. */
export async function clearCachedRows(): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch { /* nothing to do */ }
}
