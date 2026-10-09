/**
 * Drawing off the page's thread (bitgraph-art/15, 2026-10-09): a painting takes seconds, so in a browser it is drawn
 * in a Web Worker (art-v15.worker.ts) that runs the same modules, and the page shows a calm wait while it paints. Older
 * versions draw in well under a second and stay on the main thread, as they always have. Where there is no Worker (node,
 * the tests) or it cannot start, everything is drawn here, the same way: the result is the same bytes either way.
 */
import { ART_ALGORITHM_V15, makeArt, type ArtManifest, type ArtRecipe } from "./commitment-art.ts";
import { drawPrint, type PrintRequest } from "./art-print.ts";

export interface DrawnArt { recipe: ArtRecipe; pixels: Uint8Array; manifest: ArtManifest; png: Uint8Array }

/** The versions drawn in the worker. */
export const paintsOffThread = (algorithm: string): boolean => algorithm === ART_ALGORITHM_V15;

let worker: Worker | null = null;
let failed = false;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (failed || typeof window === "undefined" || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./art-v15.worker.ts", import.meta.url), { type: "module" });
  } catch {
    failed = true;
    return null;
  }
  worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; art?: DrawnArt; bytes?: Uint8Array; error?: string }>) => {
    const d = e.data, p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    if (d.ok) p.resolve(d.art ?? d.bytes); else p.reject(new Error(d.error ?? "the painting could not be drawn"));
  };
  worker.onerror = (e) => {
    // A worker that cannot load (an old browser, a blocked script) never answers: fall back to this thread from now on.
    failed = true;
    worker = null;
    const err = new Error(e.message || "the painting's worker stopped");
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  return worker;
}

function ask<T>(w: Worker, message: Record<string, unknown>): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ id, ...message });
  });
}

/** makeArt, in the worker for the versions that need it, on this thread otherwise (or when the worker cannot run). */
export async function makeArtOffThread(commitment: Uint8Array, algorithm: string): Promise<DrawnArt> {
  const w = paintsOffThread(algorithm) ? getWorker() : null;
  if (!w) return makeArt(commitment, algorithm);
  try {
    return await ask<DrawnArt>(w, { kind: "art", commitment: commitment.slice(), algorithm });
  } catch (e) {
    if (!failed) throw e;
    return makeArt(commitment, algorithm); // the worker could not start: draw it here
  }
}

/** drawPrint, in the worker for the versions that need it. */
export async function drawPrintOffThread(req: PrintRequest): Promise<Uint8Array> {
  const w = req.algorithm && paintsOffThread(req.algorithm) ? getWorker() : null;
  if (!w) { await new Promise((r) => setTimeout(r, 50)); return drawPrint(req); }
  try {
    return await ask<Uint8Array>(w, { kind: "print", req });
  } catch (e) {
    if (!failed) throw e;
    return drawPrint(req);
  }
}
