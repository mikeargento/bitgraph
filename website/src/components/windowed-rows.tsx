import { useEffect, useRef, useState } from "react";

/**
 * Which slice of a long list of uniform rows is worth putting in the DOM.
 *
 * A 30,000 file drop rendered every row as a card of roughly sixteen elements,
 * which is around 400,000 nodes mounted in one pass, and the browser froze
 * (Mike, 2026-09-07). Nothing about the node count depends on the drop being
 * interesting: the rows off screen cost exactly as much as the ones you can
 * see. This keeps the mounted count proportional to the viewport instead, and
 * the list keeps its true height from spacers above and below, so the
 * scrollbar and anchor links behave as if every row were there.
 *
 * Rows must be a FIXED height for this to be honest, which is what makes a
 * plain text list the right shape for it: uniform lines, no thumbnails, no
 * cards that grow with their content.
 *
 * The page itself scrolls, not a box inside it, so the measurement is the
 * list's position in the viewport rather than a container's scrollTop.
 */
export function useWindowedRows(count: number, rowHeight: number, overscan = 16) {
  const ref = useRef<HTMLDivElement>(null);
  // Null until measured, so the first paint shows a screenful without the
  // effect having to write state before the browser has laid anything out.
  const [range, setRange] = useState<{ first: number; last: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let shown = { first: -1, last: -1 };
    // Measured straight from the scroll event, not from a requestAnimationFrame.
    // rAF does not run while a tab is hidden, and a queued frame that never
    // arrives leaves a flag set and every later scroll ignored, so the list
    // would still be showing the first screenful when the tab came back. The
    // work here is one rect read and some arithmetic; the state write below is
    // the expensive part and only happens when the visible range really moves,
    // which is once every several rows of scrolling.
    const measure = () => {
      const top = el.getBoundingClientRect().top;
      const first = Math.max(0, Math.floor(-top / rowHeight) - overscan);
      const fits = Math.ceil(window.innerHeight / rowHeight) + overscan * 2;
      const last = Math.min(count, first + fits);
      // Scroll fires far more often than the window actually changes, and a
      // setState per frame would undo the point of this.
      if (first === shown.first && last === shown.last) return;
      shown = { first, last };
      setRange(shown);
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [count, rowHeight, overscan]);

  return { ref, first: range?.first ?? 0, last: range?.last ?? Math.min(count, 60) };
}
