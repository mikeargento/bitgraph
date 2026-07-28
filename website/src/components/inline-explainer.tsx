"use client";

import { useState } from "react";
import { CameraExplainer } from "@/components/camera-explainer";

/* Opens the explainer diagram in place, so a reader on /uses can see how a
   BitGraph is made without losing their position in the list.

   Expands inline rather than opening a modal. The diagram is about 1620px tall
   at desktop and taller on a phone, so a dialog would mean scrolling inside a
   scroll, which is the worst version of this on mobile. Inline also needs no
   focus trap, no scroll lock, and no escape handling, and it matches the
   collapsibles already used on proof pages.

   Renders CameraExplainer itself rather than a copy, so /uses and /camera can
   never drift. /camera stays the canonical, linkable page; this is the same
   component shown in a second place. */
export function InlineExplainer() {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ marginBottom: open ? 44 : 30 }}>
      <button
        type="button"
        className="bg-action-link"
        aria-expanded={open}
        aria-controls="inline-explainer"
        onClick={() => setOpen((o) => !o)}
      >
        {/* Names what opens, not a destination. "How a BitGraph is made" was
            /camera's meta description, which read correctly while this
            navigated but reads as a page title now that it expands in place.
            It also used "made", a verb the site does not use: BitGraphs are
            taken and recorded. What actually opens is the camera analogy, so
            the label promises that and ties it to the tagline. */}
        {open ? "Hide the camera" : "See it as a camera"}{" "}
        {/* The arrow turns to point down when open, so the control reads as an
            expander rather than as a link that failed to navigate. */}
        <span
          className="arrow"
          style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform .18s ease" }}
        >
          &rarr;
        </span>
      </button>

      {open && (
        <div id="inline-explainer" style={{ marginTop: 10 }}>
          <CameraExplainer />
        </div>
      )}
    </div>
  );
}
