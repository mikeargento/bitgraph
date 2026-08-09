"use client";

import { useState, useRef, useEffect } from "react";

/**
 * The whitepaper's contents.
 *
 * It reads itself off the document. The list used to be a hand-maintained array
 * in this file, and by 2026-08-09 it had drifted badly: 46 of the paper's 59
 * sections. Every subsection of Related Work but the last was missing, so the
 * contents jumped from "10 Related Work" straight to "10.8", both Worked
 * Examples were absent, and all four Birth-Death subsections were absent.
 * Eleven titles had also fallen out of sync with the headings they point at
 * ("Deployment Strategy" for a section called Deployment and Adoption).
 *
 * None of that was going to stay fixed by fixing it. A second copy of a
 * document's structure, kept by hand in a different file, drifts the next time
 * anyone edits the paper. So there is no copy now: on mount this walks the
 * rendered article and takes the id, the number and the title from the headings
 * themselves. Add a section to the paper and it appears here; renumber one and
 * the number follows.
 *
 * The markup it depends on is the shape every section already has, and the
 * whole of the paper is written this way:
 *
 *   <section id="sec-x">
 *     <h2|h3><span>9.2</span> Atomic Finalization Protocol</h2|h3>
 *
 * If a heading ever lacks the number span, the entry still appears, with the
 * whole heading as its title and no number. It degrades to something readable
 * rather than to nothing.
 */
type Entry = { id: string; num: string; title: string; sub: boolean };

export default function TocDropdown() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const found: Entry[] = [];
    // Document order, which is what querySelectorAll returns, so the contents
    // are in the paper's order without sorting anything.
    document.querySelectorAll<HTMLElement>("article section[id^='sec-']").forEach((sec) => {
      const h = sec.querySelector<HTMLElement>(":scope > h2, :scope > h3");
      if (!h) return;
      const numEl = h.querySelector<HTMLElement>(":scope > span:first-child");
      const num = numEl?.textContent?.trim() ?? "";
      // The heading minus its number span. Cloning keeps the live DOM untouched.
      const clone = h.cloneNode(true) as HTMLElement;
      clone.querySelector(":scope > span:first-child")?.remove();
      const title = (clone.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!title) return;
      found.push({ id: sec.id, num, title, sub: h.tagName === "H3" });
    });
    setEntries(found);
  }, []);

  // Close on a click outside and on Escape, the same two ways the Docs menu in
  // the site nav closes. Escape was missing here.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  // Nothing to show until the walk has run, and nothing to show if the paper
  // ever loses its sections: an empty box would be worse than no box.
  if (!entries.length) return null;

  // Each top-level section carries its own subsections, so a column break can
  // never separate "10 Related Work" from 10.1.
  const groups: Entry[][] = [];
  for (const e of entries) {
    if (!e.sub || !groups.length) groups.push([e]);
    else groups[groups.length - 1].push(e);
  }

  return (
    // Sticky, so the contents are reachable from anywhere in the paper. This is
    // the one page on the site that earns it: 59 sections, and getting from 14
    // back to 7 otherwise means scrolling to the top of a paper-length document
    // to find the index. Everywhere else "back to the top" is a short trip.
    //
    // 58px is the bar above it. The background matches the bar's and the page's,
    // so it reads as the bottom edge of the chrome rather than as a second bar
    // landing on the document, and z-index stays under the nav's 50.
    <div
      ref={ref}
      style={{
        position: "sticky", top: 58, zIndex: 40,
        background: "#f5f5f5", padding: "10px 0 12px", margin: "0 0 28px",
      }}
    >
      {/* Type, not a box. This was a bordered #f9fafb slab the full width of the
          reading column, which is the exact thing the docs section menu was
          deleted for being on 2026-07-27: a button on a site whose standing
          rule is no buttons. It is a word and a chevron now, the same control
          the nav uses to open Docs. */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="wp-contents"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: 0, margin: 0, border: "none", background: "none",
          fontFamily: "inherit", fontSize: 14, fontWeight: 700,
          letterSpacing: "-0.01em", color: "#111827", cursor: "pointer",
        }}
      >
        Contents
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Over the paper, not in its flow. It opened in flow while the control
          only existed at the top of the document, where pushing down text
          nobody had started reading cost nothing. Once the control follows you,
          opening it at section 14 would shove a thousand pixels of document out
          from under the reader, so it floats: a white card the width of the
          reading column, 1px #d0d5dd and square, the same surface the Docs menu
          in the nav opens.

          Two columns from 640px. Multi-column is right here and was wrong for
          the Docs panel, for the same reason in reverse: this is one ordered
          list that should fill column one and continue into column two, not
          four peer groups that would be packed unevenly by balancing. */}
      {open && (
        <nav id="wp-contents" aria-label="Contents" className="wp-toc">
          {/* The columns sit inside the scrolling card, never on it: see the
              note in globals.css about what a height cap does to a multi-column
              box. */}
          <div className="wp-toc-cols">
          {groups.map((g) => (
            <div key={g[0].id} className="wp-toc-group">
              {g.map((e) => (
                <a
                  key={e.id}
                  href={`#${e.id}`}
                  onClick={() => setOpen(false)}
                  // Anchors, not buttons with scroll handlers. The old version
                  // could not be opened in a new tab, copied as a link, or
                  // reached without JavaScript, and it hard-coded an 80px
                  // scroll offset for a 58px bar. Native anchors plus
                  // scroll-margin-top on the sections do the same job in CSS
                  // and leave a URL behind that someone can send to a lawyer.
                  className={e.sub ? "wp-toc-row wp-toc-sub" : "wp-toc-row"}
                >
                  <span className="wp-toc-num">{e.num}</span>
                  <span>{e.title}</span>
                </a>
              ))}
            </div>
          ))}
          </div>
        </nav>
      )}
    </div>
  );
}
