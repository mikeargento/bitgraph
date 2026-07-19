"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/* Open every route at the top. Next's App Router scroll handling is
   inconsistent across our entry points (nav links, in-app router.push,
   roll -> proof, results -> proof), so pages sometimes carried the previous
   scroll position over. Reset explicitly on each pathname change.

   Skips the first mount, so a hard load or refresh keeps the browser's own
   scroll (a direct URL lands at top; back/forward restores position), and
   skips any URL carrying a hash so in-page anchor links still work. */
export function ScrollToTop() {
  const pathname = usePathname();
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (window.location.hash) return;
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}
