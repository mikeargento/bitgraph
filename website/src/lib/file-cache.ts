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
