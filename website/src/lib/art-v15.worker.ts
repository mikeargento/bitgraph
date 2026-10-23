// © 2026 Michael Argento. All rights reserved.
/**
 * The painting's worker (bitgraph-art/15): a painting takes seconds to draw, so the page asks this worker and stays
 * responsive while it paints. It runs the very same modules the page and the tests run (commitment-art.ts and
 * art-print.ts), so the pixels and the file it returns are byte for byte the ones a main-thread draw would make, and the
 * proof's checks still compare them with the recorded digest. It keeps its canvas weave between requests.
 *
 * Messages in:  { id, kind: "art", commitment: Uint8Array, algorithm }   -> { id, ok, art: { recipe, pixels, manifest, png } }
 *               { id, kind: "print", req: PrintRequest }                 -> { id, ok, bytes }
 * Errors come back as { id, ok: false, error }. On load it says { ready: true }, so the page can tell a worker that never
 * started (draw on the page instead) from one that failed while painting (say so: never retry a too-large drawing on the
 * page itself).
 */
import { makeArt } from "./commitment-art.ts";
import { drawPrint, type PrintRequest } from "./art-print.ts";

type Inbound = { id: number; kind: "art"; commitment: Uint8Array; algorithm: string } | { id: number; kind: "print"; req: PrintRequest };
interface WorkerScope { postMessage(message: unknown, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent<Inbound>) => void) | null }
const scope = self as unknown as WorkerScope;

scope.postMessage({ ready: true });
scope.onmessage = (e: MessageEvent<Inbound>): void => {
  const m = e.data;
  void (async () => {
    try {
      if (m.kind === "art") {
        const art = await makeArt(m.commitment, m.algorithm);
        scope.postMessage({ id: m.id, ok: true, art }, [art.pixels.buffer as ArrayBuffer, art.png.buffer as ArrayBuffer]);
      } else {
        const bytes = await drawPrint(m.req);
        scope.postMessage({ id: m.id, ok: true, bytes }, [bytes.buffer as ArrayBuffer]);
      }
    } catch (err) {
      scope.postMessage({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
};
