/**
 * Wait for the browser to actually draw a frame.
 *
 * ⚠️ THE PRIMITIVE MATTERS, and getting it wrong is expensive in both
 * directions. setTimeout is throttled to about one a second in a hidden tab
 * and clamps to 4ms once chained, so yielding per item with it costs minutes
 * over a large drop. scheduler.yield() and MessageChannel are cheap and hand
 * control back to the event loop, but NEITHER GUARANTEES A PAINT: the browser
 * draws when it decides to, so a loop that yields with them can still show a
 * frozen screen.
 *
 * requestAnimationFrame resolves when a frame is being painted, which is the
 * actual requirement, and it is self-limiting at the display rate. A hidden
 * tab has nothing to paint, so a cheap macrotask is the right fallback there.
 *
 * Pair it with a time gate, never a per-item one: one frame per 250ms of work
 * is four visible updates a second, which is plenty to watch a count move.
 */
export const paintFrame = (): Promise<void> =>
  typeof requestAnimationFrame === "function" && typeof document !== "undefined" && document.visibilityState === "visible"
    ? new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    : new Promise<void>((resolve) => {
        const c = new MessageChannel();
        c.port1.onmessage = () => { c.port1.close(); resolve(); };
        c.port2.postMessage(0);
      });

/** Milliseconds of work between frames. Four updates a second. */
export const PAINT_EVERY_MS = 250;
