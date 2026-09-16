"use client";

import { BitGraphCamera } from "@/components/bitgraph-camera";
import { anonymous } from "@/lib/commit-strategy";

/* The site's camera, in the terminal register: one dashed hairline box in the
   reading column, 300px tall, nothing else. The camera keeps its own copy and
   its own flow (a lone file goes straight to its proof page; a folder becomes
   one set; a dropped proof.json is checked). Only the frame is styled here.

   ⚠️ The camera's own stylesheet wins ties (equal specificity, later in the
   DOM), so the few overrides below carry !important rather than chasing its
   class chain (the 2026-09-16 box needed four classes for the same fight). */
export function TryZone() {
  return (
    <div className="try-zone">
      <style>{`
        .try-zone { margin: 28px 0 8px; }
        .try-zone .bitgraph-wrap { width: 100% !important; max-width: none !important; margin: 0 !important; padding: 0 !important; min-height: 0 !important; }
        .try-zone .bitgraph-camera { width: 100% !important; max-width: none !important; height: 300px !important; max-height: none !important; aspect-ratio: auto !important; margin: 0 !important; }
        .try-zone .bitgraph-camera > div { border: 1px dashed var(--line) !important; background: var(--panel) !important; }
        @media (max-width: 640px) { .try-zone .bitgraph-camera { height: 240px !important; } }
      `}</style>
      {/* id is typed as the one the camera knows; it only keys the camera's result cache. */}
      <BitGraphCamera id="home" strategy={anonymous} fuseByDefault acceptsPendingDrop fitViewport={false} />
    </div>
  );
}
