"use client";

/* The drop-target border, drawn. Doctrine (Mike, 2026-08-06): a dashed edge
 * means "this is where you drop files", and every drop box wears it — the
 * home camera, the folder sync box, the proof page's find-this-file box.
 *
 * The dashes are DRAWN, not border-style: dashed. A CSS dashed border gives
 * each side its own dash run and then fills the mitre where they meet, so
 * every corner comes out as a solid L-shaped blob thicker than the line
 * itself. These are four background gradients, one per edge, 2px thin.
 *
 * Dash geometry is solved per edge so every corner is a clean right angle.
 * A fixed dash+gap cannot do it: an edge is only as long as it is, so the
 * pattern gets cut wherever it lands and three of the four corners end
 * mid-gap. For n dashes and the n-1 gaps between them to exactly span L:
 *
 *     n·d + (n-1)·g = L
 *
 * Fix the look (d:g = 9:7) and solve for the pair that fits: choose n from
 * the target period, then g = L / (n·r + n − 1) and d = r·g. Both ends of
 * every edge land ON a dash, and since each edge is measured separately the
 * dashes stay ~9px whether the edge is 348px or 960px.
 */

import { useEffect, useRef, useState } from "react";

export interface DashedEdges {
  /** Attach to the box whose edges are drawn. */
  ref: React.RefObject<HTMLDivElement | null>;
  /** Spread into the box's style, given the current edge color. */
  edgeStyle: (color: string) => React.CSSProperties;
}

export function useDashedEdges(): DashedEdges {
  const ref = useRef<HTMLDivElement | null>(null);
  const [dash, setDash] = useState({ hd: 9, hg: 7, vd: 9, vg: 7 });

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const RATIO = 9 / 7;   // dash : gap
    const PERIOD = 16;     // the look we are aiming at, in px
    const fit = (L: number) => {
      if (!L) return { d: 9, g: 7 };
      // L ≈ n·(d+g) − g, so this is the dash count nearest the target period.
      const n = Math.max(2, Math.round((L + PERIOD / (1 + RATIO)) / PERIOD));
      const g = L / (n * RATIO + n - 1);
      return { d: RATIO * g, g };
    };
    const measure = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      const H = fit(w), V = fit(h);
      setDash({ hd: H.d, hg: H.g, vd: V.d, vg: V.g });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const edgeStyle = (color: string): React.CSSProperties => ({
    backgroundImage: [
      `repeating-linear-gradient(to right, ${color} 0 ${dash.hd}px, transparent ${dash.hd}px ${dash.hd + dash.hg}px)`,
      `repeating-linear-gradient(to bottom, ${color} 0 ${dash.vd}px, transparent ${dash.vd}px ${dash.vd + dash.vg}px)`,
      `repeating-linear-gradient(to right, ${color} 0 ${dash.hd}px, transparent ${dash.hd}px ${dash.hd + dash.hg}px)`,
      `repeating-linear-gradient(to bottom, ${color} 0 ${dash.vd}px, transparent ${dash.vd}px ${dash.vd + dash.vg}px)`,
    ].join(", "),
    backgroundSize: "100% 2px, 2px 100%, 100% 2px, 2px 100%",
    backgroundPosition: "0 0, 100% 0, 0 100%, 0 0",
    backgroundRepeat: "no-repeat",
  });

  return { ref, edgeStyle };
}
