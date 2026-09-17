"use client";

/* The drop-target border. Doctrine (Mike, 2026-08-06): a dashed edge means
 * "this is where you drop files", and every drop box wears it: the Try page's
 * band, the ledger's anchor box, the proof page's find-this-file box.
 *
 * 2026-09-18: a fine CSS dashed border with the site's 6px corners (Mike, of
 * the drawn version: "dotted lines on drop boxes should be tighter. smaller").
 * Until today the dashes were DRAWN, four background gradients 2px thick with
 * a 9:7 dash solved per edge, because at 2px with square corners a CSS dashed
 * border fills each mitre into a solid L. At 1px on a rounded corner the
 * browser carries the dashes round the curve cleanly, so the drawing is no
 * longer needed; it is in git history if the corners are ever squared again.
 *
 * The API is unchanged: attach `ref` to the box and spread `edgeStyle(color)`
 * into its style, so hover, focus and drag-over can recolour the edge.
 */

import { useRef } from "react";

export interface DashedEdges {
  /** Attach to the box whose edge is dashed. */
  ref: React.RefObject<HTMLDivElement | null>;
  /** Spread into the box's style, given the current edge color. */
  edgeStyle: (color: string) => React.CSSProperties;
}

export function useDashedEdges(): DashedEdges {
  const ref = useRef<HTMLDivElement | null>(null);
  const edgeStyle = (color: string): React.CSSProperties => ({
    border: `1px dashed ${color}`,
    borderRadius: "var(--radius-card)",
  });
  return { ref, edgeStyle };
}
