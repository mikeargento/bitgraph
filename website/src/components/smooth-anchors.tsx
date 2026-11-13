"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import { useEffect } from "react";

/**
 * A contents list's links ("On this page", .tl-toc) slide the page to their section in a fixed 320 ms, fast at the start
 * and settling at the end, instead of jumping. The heading lands where a jump would put it (its scroll-margin-top under
 * the bar), the address takes the section's #hash, and focus moves to the section for keyboard and screen reader users.
 * Where reduced motion is asked for, the link jumps as before. Any other link is left alone.
 */
const DURATION = 320;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function SmoothAnchors() {
  useEffect(() => {
    let frame = 0;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.<HTMLAnchorElement>(".tl-toc a[href^='#']");
      if (!link) return;
      const id = decodeURIComponent(link.getAttribute("href")!.slice(1));
      const target = id ? document.getElementById(id) : null;
      if (!target) return;
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      e.preventDefault();
      cancelAnimationFrame(frame);
      const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
      const from = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const to = Math.max(0, Math.min(max, target.getBoundingClientRect().top + from - margin));
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / DURATION);
        window.scrollTo(0, from + (to - from) * ease(t));
        if (t < 1) frame = requestAnimationFrame(step);
        else {
          history.pushState(null, "", `#${id}`);
          if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
          target.focus({ preventScroll: true });
        }
      };
      frame = requestAnimationFrame(step);
    };
    document.addEventListener("click", onClick);
    return () => { document.removeEventListener("click", onClick); cancelAnimationFrame(frame); };
  }, []);
  return null;
}
