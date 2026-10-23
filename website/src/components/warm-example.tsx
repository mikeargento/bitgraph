"use client";

import { useEffect } from "react";
import { warm, proofFeedKey, HOME_EXAMPLE_DIGEST } from "@/lib/warm";

/**
 * Restores the producer half of the warm cache for the home page's example.
 *
 * The consumer has been there all along: the proof page seeds its first paint
 * from takeWarm() and drops straight out of its loading state. Nothing called
 * warm() any more, though, so the seed never hit. It was lost in 1cfdc5d5, when
 * the home button pointed at /docs/overview for a while, and was not restored
 * when the button became a proof link again.
 *
 * Two triggers, because one is not enough. Idle covers the reader who clicks
 * straight away. Pointer/focus/touch intent covers the one who reads first,
 * whose idle warm would be past the 60s TTL by the time they click. warm() is
 * a no-op when a fetch is already in flight or a fresh result is cached, so
 * firing on every hover costs nothing.
 */
export function WarmExample() {
  useEffect(() => {
    const key = proofFeedKey(HOME_EXAMPLE_DIGEST);
    const go = () => warm(key);

    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleId: number | undefined;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    if (typeof w.requestIdleCallback === "function") idleId = w.requestIdleCallback(go, { timeout: 2000 });
    else timerId = setTimeout(go, 500);

    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[data-warm-example]"));
    const events = ["pointerenter", "focus", "touchstart"] as const;
    for (const a of links) for (const e of events) a.addEventListener(e, go, { passive: true });

    return () => {
      if (idleId !== undefined) w.cancelIdleCallback?.(idleId);
      if (timerId !== undefined) clearTimeout(timerId);
      for (const a of links) for (const e of events) a.removeEventListener(e, go);
    };
  }, []);

  return null;
}
