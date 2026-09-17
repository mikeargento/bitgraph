"use client";

import { BitGraphCamera } from "@/components/bitgraph-camera";
import { anonymous } from "@/lib/commit-strategy";
import { DropPrompt, Browse } from "@/components/drop-prompt";

/* The site's drop target on the Try page: a short band across the reading
   column with two lines in it. Its geometry and text sizes are the `.try-zone`
   rules in globals.css. The camera keeps its own flow (a lone file goes
   straight to its proof page; a folder becomes one set; a dropped proof.json
   is checked). Inside the box: the mark and one sentence (drop-prompt.tsx). The
   page's headline, "Make or check a BitGraph", sits under the box, over the words
   that explain it (Mike, 2026-09-17). */
export function TryZone() {
  return (
    <div className="try-zone">
      {/* id is typed as the one the camera knows; it only keys the camera's
          result cache. The lines are this page's own words, passed as props so
          the shared camera keeps its defaults elsewhere. */}
      <BitGraphCamera
        id="home"
        strategy={anonymous}
        fuseByDefault
        acceptsPendingDrop
        fitViewport={false}
        dropPrompt={<DropPrompt>Drag files or a folder here, or <Browse /></DropPrompt>}
      />
    </div>
  );
}
