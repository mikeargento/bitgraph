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
        {/* Names what opens. Two earlier labels failed differently:
            "How a BitGraph is made" was /camera's meta description, so it named
            a destination rather than an action, and used "made", a verb this
            site does not use (BitGraphs are taken and recorded).
            "See it as a camera" collided with the product itself: the home page
            IS the camera, so it read as "open the camera and record something".
            What actually opens is six film-to-BitGraph equations, so the label
            says exactly that and cannot be mistaken for a way to record.
            "A photograph" rather than "film" or "photography": film carries a
            cinema reading, photography names a practice, and the panel's
            closing row is literally "= A photograph" beside "= A BitGraph". So
            the label names the equation the diagram ends on, and echoes the
            parallel already sitting in the product's name. */}
        {open ? "Hide the comparison" : "Compare it to a photograph"}{" "}
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
