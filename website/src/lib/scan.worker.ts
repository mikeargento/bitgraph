/**
 * One scan worker: hashes the files it is handed, one at a time, with the
 * state-saving hasher, and answers with the digest, the placement decided
 * from the bytes, the saved state for a trailer/1 file, and the byte count.
 * The camera runs one worker per core so a drop is hashed at disk speed and
 * the page stays responsive.
 */
import { hashBlob } from "./scan-hash";

export interface ScanRequest {
  id: number;
  file: File;
}

export type ScanReply =
  | { id: number; ok: true; digestB64: string; placement: "trailer/1" | "container/1"; state: Uint8Array | null; bytes: number }
  | { id: number; ok: false; error: string };

self.onmessage = async (e: MessageEvent<ScanRequest>) => {
  const { id, file } = e.data;
  try {
    const r = await hashBlob(file);
    const reply: ScanReply = { id, ok: true, digestB64: r.digestB64, placement: r.placement, state: r.state, bytes: r.bytes };
    (self as unknown as Worker).postMessage(reply);
  } catch (err) {
    const reply: ScanReply = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    (self as unknown as Worker).postMessage(reply);
  }
};
