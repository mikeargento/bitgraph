"use client";

import { useEffect } from "react";

/**
 * The camera frame's height measurement, shared by home and /actor.
 *
 * It lived inline on the home page until 2026-08-19, when /actor grew the same
 * composition (title, dashed frame, one line under it) and visibly did NOT
 * match: with no measurement running, `.bitgraph-camera` fell back to its CSS
 * `calc(100dvh - 320px)`, a constant tuned for home's chrome and wrong for a
 * page carrying an identity line and two controls beneath the frame.
 *
 * ⚠️ Two copies of this would drift. The numbers below were each argued for
 * once and the reasoning is in the comments; duplicating them means the next
 * person fixes one and not the other.
 *
 * The only per-page difference is which two elements are observed for height
 * changes, so those are parameters. Everything else, including every constant
 * and every listener, is identical to what home shipped.
 *
 * @param enabled        false while the page is showing something other than
 *                       the camera (home's results view), which unhooks the
 *                       listeners rather than measuring a frame that is gone.
 * @param titleSelector  the page's headline, inside .bitgraph-wrap.
 * @param moreSelector   the row beneath the frame, inside .bitgraph-wrap.
 *
 * ⚠️ THIS HOOK DOES NOT ALIGN TITLES ACROSS PAGES, and do not add a knob that
 * tries to. One was tried on 2026-08-19 and removed: the wrap is a centred
 * column, so the title's position is set by how much shorter the composition
 * is than the wrap, and holding pixels back from the frame only moves it while
 * the frame is FIT-capped. Above a certain width the frame is capped by its
 * aspect ratio instead, the held-back pixels are already unused, and the knob
 * silently does nothing. Two pages align when the content ABOVE and BELOW
 * their frames is the same height. Match those and this hook does the rest at
 * every viewport; see .declare-more against .hero-more.
 */
export function useCameraFit(
  enabled: boolean,
  titleSelector: string,
  moreSelector: string,
) {
  /* Size the frame to whatever height is actually left, so the page fills the
     viewport and never scrolls.

     The CSS rule used to solve this with a constant: 100dvh - 280px on desktop,
     - 320px on phones, standing in for "the nav, title, deck, gap and link".
     A constant is only right for the layout it was measured against, and this
     page's chrome has changed repeatedly, so it drifts into either a scrollbar
     or a box smaller than it needs to be.

     Measured instead: everything in the wrap except the frame is invariant to
     the frame's own size, so (viewport - wrapTop - everythingElse) is the
     height the frame may occupy, and one pass settles. Width is still derived
     FROM that height rather than the other way round, which the globals.css
     note is emphatic about: a height-driven aspect-ratio once let WebKit take
     the width from content height and overflow the box on iPhone.

     The CSS keeps the old constants as the var's fallback, so the frame is
     sensibly sized on the first paint before this runs, and if JS never runs
     the page behaves exactly as it did. */
  useEffect(() => {
    if (!enabled) return;
    const wrap = document.querySelector<HTMLElement>(".bitgraph-wrap");
    const cam = document.querySelector<HTMLElement>(".bitgraph-camera");
    if (!wrap || !cam) return;

    const box = (el: Element) => {
      const cs = getComputedStyle(el);
      return (el as HTMLElement).offsetHeight
        + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
    };

    const fit = () => {
      const top = wrap.getBoundingClientRect().top + window.scrollY;

      /* Twice the nav, not once. Subtracting it once gives the region BELOW
         the nav, and centring in that region lands the composition half a nav
         height below the middle of the screen: with a 58px nav the hero sat at
         529 against a viewport centre of 500. Taking it off both ends puts the
         wrap's centre on the viewport's centre while it still starts under the
         nav. Costs the frame one nav height of maximum size, which only shows
         on windows short enough for height to be the binding constraint. */
      /* Standalone has a third band to account for, and it is invisible to
         every viewport API: the status bar sits at the top of the SCREEN but
         outside the viewport, so centring on innerHeight lands the whole
         composition half a status bar low on the glass. Same class of error as
         the nav one below, one level up.

         screen.height minus innerHeight is that band. The assumption is that
         in standalone the web view runs to the bottom edge with the home
         indicator overlaying it, so the difference is top inset only; capped
         at 80 so a wrong assumption cannot throw the layout far. Zero in a
         normal tab, where the browser's own chrome is already excluded from
         both numbers. */
      const standalone = window.matchMedia("(display-mode: standalone)").matches
        || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
      const statusBar = standalone && window.screen?.height
        ? Math.min(80, Math.max(0, Math.round(window.screen.height - window.innerHeight)))
        : 0;
      const room = Math.round(window.innerHeight - top * 2 - statusBar);

      /* Summed from the siblings, NOT from (wrap.height - cam.height). Once
         the wrap has a min-height it stays that tall no matter how small the
         frame gets, so the subtraction would count the leftover whitespace as
         chrome, shrink the frame, create more whitespace, and settle on
         whatever size it happened to start at. These parts do not depend on
         the frame's size, so this cannot feed itself. */
      const hero = cam.parentElement;
      const wcs = getComputedStyle(wrap);
      let other = parseFloat(wcs.paddingTop) + parseFloat(wcs.paddingBottom) + box(cam) - cam.offsetHeight;
      if (hero) {
        for (const el of Array.from(hero.children)) if (el !== cam) other += box(el);
      }

      /* The floor drops on a short viewport, matching the CSS min-height for
         the same range. 180px is what the headline and two hint lines need
         before they crowd, but holding it on a landscape phone is what forced
         the page to scroll; 120 still carries the copy. */
      const floor = window.innerHeight <= 520 ? 120 : 180;
      const avail = Math.max(floor, Math.round(room - other));
      wrap.style.setProperty("--bg-cam-avail", `${avail}px`);
      wrap.style.setProperty("--bg-wrap-min", `${room}px`);
    };

    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);

    /* A window resize is not the only thing that moves the remainder. The
       title and the link row change height when their text wraps or when the
       webfont lands, and neither event reaches a resize listener.

       Observed rather than polled, and only these two: both are invariant to
       the frame's size, so re-measuring cannot feed itself. Observing the wrap
       or the html element instead would loop, since the value we set changes
       their height. */
    const ro = new ResizeObserver(fit);
    const title = wrap.querySelector(titleSelector);
    const more = wrap.querySelector(moreSelector);
    if (title) ro.observe(title);
    if (more) ro.observe(more);
    document.fonts?.ready.then(fit).catch(() => {});

    /* Launched from a Home Screen bookmark there is no browser chrome, and
       that is the problem: the page mounts behind the splash screen, when
       innerHeight can still be a pre-layout value, and afterwards NOTHING
       fires. In a normal tab the URL bar collapsing sends a resize that
       quietly corrects the first measurement; standalone has no chrome to
       collapse, so a bad first read would stand for the whole session and the
       composition would sit off centre until the app was killed.

       pageshow covers the standalone launch and a bfcache restore, load covers
       a late layout, and visualViewport is the surface iOS actually updates
       when the visible area changes (window.innerHeight can lag it). A frame
       later catches the case where all three fire before layout settles. */
    const onShow = () => { fit(); requestAnimationFrame(fit); };
    window.addEventListener("pageshow", onShow);
    window.addEventListener("load", onShow);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", fit);
    requestAnimationFrame(fit);

    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("load", onShow);
      vv?.removeEventListener("resize", fit);
      ro.disconnect();
    };
  }, [enabled, titleSelector, moreSelector]);
}
