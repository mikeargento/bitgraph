"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/* Open every route at the top. Next's App Router scroll handling is
   inconsistent across our entry points (nav links, in-app router.push,
   roll -> proof, results -> proof), so pages sometimes carried the previous
   scroll position over. Reset explicitly on each navigation.

   There are three ways a page can arrive and all three need covering:

     client-side  a Link or router.push. The pathname effect below.
     reload       the browser saves your offset and re-applies it as the page
                  grows. Ours grow after paint (skeleton, then payload, then a
                  full-size photo), so a refresh landed ~56px down and jittered
                  for seconds before settling.
     full load    a plain <a> or window.location.href. Handled the same as a
                  reload: nothing else holds the top while content arrives, and
                  the proof flow uses full loads on purpose (the positions list
                  and the &fresh=1 hop are both hard navigations onto the pages
                  that grow the most).

   back/forward is deliberately excluded from all of it. Restoring a remembered
   position is exactly what a reader pressing Back is asking for, and the
   results page's batch-list restore depends on it.

   A URL carrying a hash is left alone so in-page anchors still work. */

/* How long to hold the top, and how we decide when to stop.

   This used to be a flat 3000ms, picked from one production measurement of the
   proof page: mounts at ~480ms with a 944px document, 1117px at ~1481ms,
   settles at 1595px at ~2645ms. A fixed number sized to one trace is wrong in
   both directions. It over-holds a small docs page, and a cold cache or a phone
   on cellular outlives it, which is what made the failure intermittent rather
   than constant.

   So watch the document instead of the clock: hold while the page is still
   growing, let go once its height has been stable for SETTLE_MS. MAX_PIN_MS is
   only a backstop for pages that never stop changing height (the live roll, the
   anchor countdown), so the pin can't run forever.

   Either way it is a ceiling, not a lock: any real touch, wheel or key releases
   it immediately, so a reader who wants to scroll is never held for more than
   one frame. */
const SETTLE_MS = 600;
const MAX_PIN_MS = 5000;

/* Hold scroll at the top until the document stops growing.

   iOS is the reason this is a loop and not a single scrollTo. The tap that
   started the navigation leaves a momentum fling running, and the deceleration
   overwrites a one-shot reset a frame later, so the new page opens part-way
   down. Reported from a phone, and not reproducible with a synthetic click
   precisely because a synthetic click carries no momentum.

   Returns its own release function. onDone runs once, on release, whether that
   came from settling, the backstop, the reader, or a navigation cancelling it. */
function pinTop(onDone?: () => void): () => void {
  let live = true;
  let raf = 0;
  const start = performance.now();
  let lastHeight = document.documentElement.scrollHeight;
  let stableSince = start;

  const release = () => {
    if (!live) return;
    live = false;
    cancelAnimationFrame(raf);
    clearTimeout(backstop);
    window.removeEventListener("touchstart", release);
    window.removeEventListener("wheel", release);
    window.removeEventListener("keydown", release);
    onDone?.();
  };

  /* The rAF loop cannot be the only way out. Background a tab and rAF stops
     firing, so a pin started just before the reader switched away would never
     release and never run onDone, leaving history.scrollRestoration pinned to
     "manual" for the rest of the session. Back would then land at the top of
     every page instead of where they left, and nothing would ever put it back.
     So the ceiling is enforced by a timer, which keeps running, and the rAF
     loop only handles the case where the document settles early. */
  const backstop = setTimeout(release, MAX_PIN_MS);

  const frame = () => {
    if (!live) return;
    if (window.scrollY !== 0) window.scrollTo(0, 0);

    const now = performance.now();
    const height = document.documentElement.scrollHeight;
    if (height !== lastHeight) {
      lastHeight = height;
      stableSince = now;
    }
    if (now - stableSince >= SETTLE_MS || now - start >= MAX_PIN_MS) {
      release();
      return;
    }
    raf = requestAnimationFrame(frame);
  };

  window.addEventListener("touchstart", release, { passive: true });
  window.addEventListener("wheel", release, { passive: true });
  window.addEventListener("keydown", release);
  raf = requestAnimationFrame(frame);

  return release;
}

/* usePathname() drops the query, so the effect below never re-runs for
   /proof/X?counter=1 -> /proof/X?counter=2, and the page keeps whatever scroll
   position it had. useSearchParams() would see it, but calling it from a root
   layout component opts every statically rendered route into dynamic rendering
   (the same reason the proof page reads the query directly instead).

   So watch the URL rather than subscribe to it: have pushState and replaceState
   announce themselves. Both call through to the original with the original
   arguments, so Next's own history state is untouched. */
let historyPatched = false;

function patchHistory() {
  if (historyPatched || typeof window === "undefined") return;
  historyPatched = true;
  (["pushState", "replaceState"] as const).forEach((method) => {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<typeof original>) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event("bg:urlchange"));
      return result;
    };
  });
}

export function ScrollToTop() {
  const pathname = usePathname();
  const firstRender = useRef(true);
  const popped = useRef(false);
  const releasePin = useRef<(() => void) | null>(null);

  const startPin = (onDone?: () => void) => {
    releasePin.current?.();
    window.scrollTo(0, 0);
    releasePin.current = pinTop(onDone);
  };

  useEffect(() => {
    const onPop = () => { popped.current = true; };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Query-only navigations. Pathname changes are left to the effect below so a
  // single navigation never gets reset twice.
  useEffect(() => {
    patchHistory();
    let last = window.location.pathname + window.location.search;

    const onUrlChange = () => {
      const current = window.location.pathname + window.location.search;
      if (current === last) return;
      const samePath = window.location.pathname === last.split("?")[0];
      last = current;
      if (!samePath) return;
      if (window.location.hash) return;
      if (popped.current) { popped.current = false; return; }
      startPin();
    };

    window.addEventListener("bg:urlchange", onUrlChange);
    window.addEventListener("popstate", onUrlChange);
    return () => {
      window.removeEventListener("bg:urlchange", onUrlChange);
      window.removeEventListener("popstate", onUrlChange);
    };
  }, []);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      if (window.location.hash) return;
      const nav = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      // back_forward keeps whatever the browser restored.
      if (nav?.type !== "reload" && nav?.type !== "navigate") return;
      // Only a reload has a saved offset the browser will re-apply, and only
      // there did the layout's inline script flip restoration to manual, so
      // only there is there anything to hand back. A plain load is held by the
      // pin alone: touching scrollRestoration on a plain load would stop the
      // browser recording this entry's offset, and Back would lose the reader's
      // place. Both cases still need the pin, because both grow after paint.
      startPin(
        nav.type === "reload"
          ? () => { history.scrollRestoration = "auto"; }
          : undefined,
      );
      return () => releasePin.current?.();
    }
    if (window.location.hash) return;

    // Checked before the scroll, not after. This used to reset to the top and
    // only then notice it was a back/forward, so every Back was briefly yanked
    // to the top and depended on Next restoring the position afterwards.
    if (popped.current) { popped.current = false; return; }

    startPin();
    return () => releasePin.current?.();
  }, [pathname]);

  return null;
}
