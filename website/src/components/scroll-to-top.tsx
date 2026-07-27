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
export function ScrollToTop() {
  const pathname = usePathname();
  const firstRender = useRef(true);

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
  }, [pathname]);

  return null;
}
