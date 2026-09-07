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
    const results: ScanResult[] = [];
    for (const file of files) {
      // One bad file is that file's answer, not the batch's: the caller falls
      // back for it alone rather than losing the other ninety-nine.
      try {
        const r = await hashBlob(file);
        results.push({ ok: true, digestB64: r.digestB64, placement: r.placement, state: r.state, bytes: r.bytes });
      } catch (err) {
        results.push({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    (self as unknown as Worker).postMessage({ id, ok: true, results } satisfies ScanReply);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies ScanReply);
  }
};
