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
/** The worker could not start here (an old browser, a blocked script): draw on the page from now on. */
let failed = false;
/** The current worker has said it is ready, so an error from now on is a failure while painting, not a failed start. */
let ready = false;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
/** A painting takes seconds, a slow phone a minute or two; past this the worker is taken as lost. */
const TIMEOUT_MS = 240_000;

/** The message for a drawing that failed in the worker: plain words for the device running out of memory. */
export function paintingError(raw: string): Error {
  return new Error(/allocation|out of memory|memory|terminated|lost/i.test(raw) ? "This device ran out of memory while painting. Try again on a computer." : raw || "the painting could not be drawn");
}

function stopWorker(err: Error): void {
  worker?.terminate();
  worker = null;
  ready = false;
  for (const p of pending.values()) { clearTimeout(p.timer); p.reject(err); }
  pending.clear();
}

function getWorker(): Worker | null {
  if (failed || typeof window === "undefined" || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./art-v15.worker.ts", import.meta.url), { type: "module" });
  } catch {
    failed = true;
    return null;
  }
  ready = false;
  worker.onmessage = (e: MessageEvent<{ ready?: boolean; id: number; ok: boolean; art?: DrawnArt; bytes?: Uint8Array; error?: string }>) => {
    const d = e.data;
    if (d.ready) { ready = true; return; }
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    clearTimeout(p.timer);
    if (d.ok) p.resolve(d.art ?? d.bytes); else p.reject(paintingError(d.error ?? ""));
  };
  worker.onerror = (e) => {
    e.preventDefault?.();
    if (!ready) { failed = true; stopWorker(new Error("NOSTART")); return; } // it never started: the callers draw on the page
    stopWorker(paintingError("the worker was lost while painting")); // it failed while painting (most often memory)
  };
  return worker;
}

function ask<T>(w: Worker, message: Record<string, unknown>): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => stopWorker(paintingError("the worker was lost while painting")), TIMEOUT_MS);
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    w.postMessage({ id, ...message });
  });
}

/** makeArt, in the worker for the versions that need it, on this thread otherwise (or when the worker cannot start). */
export async function makeArtOffThread(commitment: Uint8Array, algorithm: string): Promise<DrawnArt> {
  const w = paintsOffThread(algorithm) ? getWorker() : null;
  if (!w) return makeArt(commitment, algorithm);
  try {
    return await ask<DrawnArt>(w, { kind: "art", commitment: commitment.slice(), algorithm });
  } catch (e) {
    if (e instanceof Error && e.message === "NOSTART") return makeArt(commitment, algorithm); // the worker could not start: draw it here
    throw e;
  }
}

/** drawPrint, in the worker for the versions that need it. A drawing that fails in the worker is never retried here. */
export async function drawPrintOffThread(req: PrintRequest): Promise<Uint8Array> {
  const w = req.algorithm && paintsOffThread(req.algorithm) ? getWorker() : null;
  if (!w) { await new Promise((r) => setTimeout(r, 50)); return drawPrint(req); }
  try {
    return await ask<Uint8Array>(w, { kind: "print", req });
  } catch (e) {
    if (e instanceof Error && e.message === "NOSTART") return drawPrint(req);
    throw e;
  }
}
