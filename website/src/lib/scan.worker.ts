/**
 * One scan worker: hashes the files it is handed with the state-saving hasher,
 * and answers with the digest, the placement decided from the bytes, the saved
 * hasher state where the placement allows one, and the byte count. The camera
 * runs one worker per core so a drop is hashed at disk speed and the page
 * stays responsive.
 *
 * ⚠️ A REQUEST CARRIES MANY FILES, NOT ONE. At one file per message a 48,000
 * file drop is 48,000 round trips through the pool to hash 57 bytes apiece,
 * and the messaging, not the hashing, is what the wait was made of: 2.7MB of
 * content in total took 6.9s (measured 2026-09-07). A File posts as a handle,
 * so a hundred of them cost about what one costs.
 */
import { hashBlob } from "./scan-hash";

/**
 * Files read at once inside one worker, chosen from how big they are.
 *
 * The reads are what the scan waits on, and a read spends its time waiting
 * rather than computing, so more in flight costs little TIME. What it costs is
 * MEMORY: every read in flight holds its bytes. Small files can go very wide;
 * a folder of photos cannot, or eight workers reading hundreds of multi-MB
 * files at once is hundreds of megabytes held for no reason.
 *
 * So the budget is bytes, not files: each tier holds about 4-8MB in flight per
 * worker, so at the pool's eight workers the whole scan holds tens of MB
 * whatever the drop is made of. Going from 8 reads to 64 on 48,000 tiny files
 * took the scan from 6.6s to 2.0s (measured 2026-09-07).
 *
 * The large-file tiers are also tighter than the flat 8 they replace: eight
 * workers reading eight 4MB files each was 256MB held at once on a photo
 * folder, which nobody had noticed because only tiny files had been measured.
 */
function readsInFlight(files: File[]): number {
  let total = 0;
  for (const f of files) total += f.size;
  const avg = files.length === 0 ? 0 : total / files.length;
  if (avg <= 64 * 1024) return 64;        // <= 4MB per worker, 32MB across the pool
  if (avg <= 512 * 1024) return 16;       // <= 8MB per worker, 64MB across the pool
  if (avg <= 4 * 1024 * 1024) return 4;   // <= 16MB per worker
  return 2;                               // big files: a couple at a time
}

export interface ScanRequest {
  id: number;
  files: File[];
}

/** One file's answer, in the order the files were sent. */
export type ScanResult =
  | { ok: true; digestB64: string; placement: "trailer/1" | "container/1" | "container/2"; state: Uint8Array | null; bytes: number }
  | { ok: false; error: string };

export type ScanReply =
  | { id: number; ok: true; results: ScanResult[] }
  | { id: number; ok: false; error: string };

self.onmessage = async (e: MessageEvent<ScanRequest>) => {
  const { id, files } = e.data;
  try {
    // ⚠️ SEVERAL FILES AT ONCE, and the reason is measured. Batching the
    // messages, reading whole instead of streaming, and reusing the hasher
    // each left the scan at about 6.6s for 48,000 files (2026-09-07), which is
    // 0.14ms a file for 2.7MB of content in total. That is not hashing, it is
    // waiting on 48,000 separate file reads. Reading them one after another
    // inside a worker means only one is ever in flight per worker; hashing
    // still serialises on the worker's own thread, which is right, but the
    // waiting no longer does.
    //
    // Results go in BY INDEX. A batch that answered out of order would pair a
    // file with another file's digest, which is far worse than being slow.
    const results: ScanResult[] = new Array(files.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(readsInFlight(files), files.length) }, async () => {
      while (next < files.length) {
        const i = next++;
        // One bad file is that file's answer, not the batch's: the caller
        // falls back for it alone rather than losing the other ninety-nine.
        try {
          const r = await hashBlob(files[i]);
          results[i] = { ok: true, digestB64: r.digestB64, placement: r.placement, state: r.state, bytes: r.bytes };
        } catch (err) {
          results[i] = { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
    }));
    (self as unknown as Worker).postMessage({ id, ok: true, results } satisfies ScanReply);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies ScanReply);
  }
};
