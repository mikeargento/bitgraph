"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/* Open every route at the top. Next's App Router scroll handling is
   inconsistent across our entry points (nav links, in-app router.push,
   roll -> proof, results -> proof), so pages sometimes carried the previous
   scroll position over. Reset explicitly on each pathname change.

   Reloads need their own handling. The browser saves your offset and then
   re-applies it as the page grows, and our pages grow after paint (skeleton,
   then the proof payload, then a full-size photo). The result was a refresh
   landing ~56px down and jittering for several seconds before settling. So on
   a reload we take restoration over, pin the top, and hand it back once the
   page has settled — back/forward keeps its restored position, which the
   results page's batch-list restore depends on.

   A URL carrying a hash is left alone so in-page anchors still work. */
/* How long to hold the top after a forward navigation. Long enough to outlast
   an iOS momentum fling, short enough that it can never be felt as a fight. */
const PIN_MS = 400;

export function ScrollToTop() {
  const pathname = usePathname();
  const firstRender = useRef(true);
  // Back/forward is left alone: the pin is for taps, and restoring a remembered
  // position is exactly what a reader pressing Back is asking for.
  const popped = useRef(false);

  useEffect(() => {
    const onPop = () => { popped.current = true; };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      if (window.location.hash) return;
      const nav = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      if (nav?.type !== "reload") return;
      // The inline script in the layout already set restoration to manual
      // during parse; just pin the top and hand it back once content settles.
      window.scrollTo(0, 0);
      // Content keeps arriving for a beat; hold the top until it settles, then
      // give restoration back so future back/forward navigations still work.
      const t = setTimeout(() => { history.scrollRestoration = "auto"; }, 3000);
      return () => clearTimeout(t);
    }
    if (window.location.hash) return;

    window.scrollTo(0, 0);

    if (popped.current) { popped.current = false; return; }

    /* One scrollTo is not enough on a phone. iOS keeps a momentum fling running
       after the tap that started the navigation, so the deceleration overwrites
       the reset a frame later and the new page opens part-way down. Reported
       from a phone, and not reproducible with a synthetic click precisely
       because a synthetic click carries no momentum.

       So hold the top for a few frames instead of setting it once, and let go
       the instant the reader touches the screen themselves: a fling is inertia
       from the previous page, a touch is intent about this one. */
    let raf = 0;
    let live = true;
    const stopAt = performance.now() + PIN_MS;

    const release = () => {
      live = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("touchstart", release);
      window.removeEventListener("wheel", release);
      window.removeEventListener("keydown", release);
    };

    const pin = () => {
      if (!live) return;
      if (window.scrollY !== 0) window.scrollTo(0, 0);
      if (performance.now() < stopAt) raf = requestAnimationFrame(pin);
      else release();
    };

    window.addEventListener("touchstart", release, { passive: true });
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("keydown", release);
    raf = requestAnimationFrame(pin);

    return release;
  }, [pathname]);

  return null;
}
