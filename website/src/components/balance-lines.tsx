// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.
"use client";

import { useEffect } from "react";

/**
 * Even lines for a short block of text on narrow screens. A paragraph set ragged-right fills each line as far as it
 * can, which on a phone leaves some lines long and some short. This narrows the block to the smallest width that
 * keeps the same number of lines, so every line comes out about the same length. The same in every browser, unlike
 * `text-wrap: balance`, which stops working past a few lines in some of them.
 *
 * Runs after the fonts are in, again shortly after (the no-orphans pass ties the last words once the page is
 * hydrated, which can move a break), and whenever the window's width changes. Above `maxViewport` it does nothing and
 * clears what it set.
 */
export function BalanceLines({ selector, maxViewport = 760 }: { selector: string; maxViewport?: number }) {
  useEffect(() => {
    const balance = () => {
      document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        el.style.removeProperty("max-width");
        if (window.innerWidth > maxViewport) return;
        const full = el.getBoundingClientRect().width;
        const height = el.getBoundingClientRect().height;
        if (!full || !height) return;
        let lo = Math.floor(full * 0.6);
        let hi = Math.ceil(full);
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          el.style.setProperty("max-width", `${mid}px`, "important");
          if (el.getBoundingClientRect().height > height + 1) lo = mid;
          else hi = mid;
        }
        el.style.setProperty("max-width", `${hi}px`, "important");
      });
    };
    let lastWidth = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      balance();
    };
    const timers = [0, 400, 1500, 3500, 6500].map((ms) => window.setTimeout(balance, ms));
    document.fonts?.ready.then(balance).catch(() => {});
    window.addEventListener("resize", onResize);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener("resize", onResize);
    };
  }, [selector, maxViewport]);
  return null;
}
