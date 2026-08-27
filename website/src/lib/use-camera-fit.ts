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
 * @param enabled        false once the page has stopped being a single
 *                       viewport-fitted composition. ⚠️ That includes a page
 *                       where the camera is STILL VISIBLE but a list has grown
 *                       under it: fit() sums every sibling of the frame into
 *                       its chrome, so a growing list is counted as chrome and
 *                       squeezes the frame flat (/actor, 2026-08-19, Mike:
 *                       "should it get smooshed like that"). Home never hit
 *                       this because its results are a separate step.
 * @param titleSelector  the page's headline, inside .bitgraph-wrap.
 * @param moreSelector   the row beneath the frame, inside .bitgraph-wrap.
 *
 * ⚠️ ALIGNING TITLES ACROSS PAGES: the wrap is a centred column, so a title's
 * position is set by how much SHORTER the composition is than the wrap. Two
 * pages therefore align when their total composition height matches, and a
 * page whose block below the frame is taller has to give the difference back
 * somewhere. `shrinkBy` is where.
 *
 * ⚠️ It shrinks the frame below its NATURAL height, which is the only thing
 * that works. An earlier knob subtracted from the available room instead and
 * was removed: at most widths the frame is capped by its aspect ratio well
 * under that room, so the subtraction was already unused and the knob silently
 * did nothing. Natural height is computed here from the frame's own width and
 * its computed aspect-ratio, so it tracks the CSS rather than duplicating it.
 * @param shrinkBy  px to take off the frame so a taller block below it does
 *                  not push the title up. Home passes nothing.
 */
export function useCameraFit(
  enabled: boolean,
  titleSelector: string,
  moreSelector: string,
  shrinkBy = 0,
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
    /* ⚠️ CLEAR, do not just bail. These are custom properties on a live
       element, so a plain early return leaves the last measurement in place
       and the frame keeps obeying a number nobody is updating any more.
       Removing them hands the frame back to its CSS fallback, which is what
       a page that has stopped being viewport-fitted should use. */
    if (!enabled) {
      const w = document.querySelector<HTMLElement>(".bitgraph-wrap");
      w?.style.removeProperty("--bg-cam-avail");
      w?.style.removeProperty("--bg-wrap-min");
      return;
    }
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
      /* Phones centre BELOW the nav, not on the viewport (Mike, 2026-08-26:
         "isnt this sitting high on mobile?"). The top*2 symmetry above is
         right on desktop, but on a phone the nav is a large slice of a short
         viewport and its mirror-band at the bottom holds nothing: on a 770px
         phone viewport the gap under the nav measured ~70 while the void
         under the link measured ~135, so the composition read high even
         though its centre sat on the viewport's centre. Centring in
         [nav bottom, viewport bottom] makes the two VISIBLE gaps equal,
         which is what the eye actually checks. 768 is the site's mobile
         line; landscape phones exceed it and keep the desktop symmetry. */
      /* No footer on the camera pages (Mike, 2026-08-27): the bar briefly
         lived here too, with its height subtracted from the room, and WebKit
         sized the frame over the text on iPhone. The site footer skips these
         pages instead, so the formulas below are exactly the ones verified
         on 2026-08-26. */
      const room = window.innerWidth < 768
        ? Math.round(window.innerHeight - top - statusBar)
        : Math.round(window.innerHeight - top * 2 - statusBar);

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
      /* The frame's natural height, from its own width and whatever
         aspect-ratio the CSS is currently applying. Capping at natural minus
         shrinkBy is what actually makes an aspect-capped frame give ground. */
      let cap = room - other;
      if (shrinkBy > 0) {
        const ar = getComputedStyle(cam).aspectRatio;
        const [w, h] = ar.includes("/") ? ar.split("/").map((n) => parseFloat(n)) : [0, 0];
        if (w > 0 && h > 0) cap = Math.min(cap, (cam.offsetWidth * h) / w - shrinkBy);
      }
      const avail = Math.max(floor, Math.round(cap));
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
  }, [enabled, titleSelector, moreSelector, shrinkBy]);
}
