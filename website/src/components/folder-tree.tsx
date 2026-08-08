/* What the Folder actually writes to your disk.
 *
 * The page's other exhibit (FolderProcess) is the equation: file in, BitGraph
 * out. This is the receipt for it. "Where did my file go" is the first
 * question anyone has after their first drop, and the page used to answer it
 * inside a sentence in a paragraph, which is the wrong shape for a path.
 *
 * The layout is copied from the generator, not invented: see the header of
 * packages/folder/src/export.js. If that changes, this is wrong and must
 * change with it.
 *
 * ONE line is brand blue, and it is the only one that is yours. Everything
 * else the folder wrote; the blue is the file you dropped, sitting inside the
 * machinery rather than replaced by it. That is the whole point of the
 * exhibit, so it is carried by colour rather than by a caption.
 */
export function FolderTree() {
  return (
    <section className="bgt" aria-label="What the folder writes to your disk">
      <ul className="bgt-tree">
        <li><span className="bgt-path bgt-dir">BitGraph/</span><span className="bgt-note">on your Desktop</span></li>
        <li className="d1"><span className="bgt-path bgt-dir">Recordings/</span><span className="bgt-note">the archive</span></li>
        <li className="d2"><span className="bgt-path bgt-dir">BitGraph (sunset.jpg)/</span><span className="bgt-note">one folder per file</span></li>
        <li className="d3"><span className="bgt-path bgt-you">sunset.jpg</span><span className="bgt-note">your file, moved in</span></li>
        <li className="d3"><span className="bgt-path">proof.json</span><span className="bgt-note">the recording</span></li>
        {/* No index.html. The Folder writes no HTML at all as of 1.12.0. */}
        <li className="d3"><span className="bgt-path bgt-dir">ethereum-anchors/</span><span className="bgt-note">the public timeline it sits in</span></li>
      </ul>
      <style>{`
        .bgt { background: #fff; border: 1px solid #d0d5dd; border-radius: 0; padding: 26px 28px; margin: 0 0 1rem; }
        .bgt .bgt-tree { list-style: none; margin: 0; padding: 0; }
        /* baseline, not center: the path and its note are different families
           and sizes, and centring them left the note riding high. */
        /* Longhand top/bottom, NOT the padding shorthand: the shorthand rule
           carries an element selector and so outranks the .d1/.d2/.d3 indents
           below, which silently flattened the whole tree to one column. */
        .bgt .bgt-tree li {
          display: flex; align-items: baseline; gap: 14px;
          padding-top: 3px; padding-bottom: 3px; line-height: 1.55;
        }
        .bgt .bgt-path {
          font-family: IBM Plex Mono, ui-monospace, monospace;
          font-size: 13px; color: #111827; white-space: nowrap;
        }
        .bgt .bgt-dir { color: #374151; }
        /* The one line that is yours. */
        .bgt .bgt-you { color: #0065A4; font-weight: 600; }
        /* ⚠️ Notes sit BESIDE their path, not in a right-hand column.
           They were right-aligned so the paths kept a clean left edge to read
           the indentation off. The guides do that now, so the only thing the
           far column still bought was eye-travel: pairing a name with its
           note meant crossing most of an 800px row and counting rows to be
           sure you had the right one.

           Colour-coding the pairs was the other way to fix it and it does not
           fit here: six rows need six distinguishable hues, and this palette
           is one brand blue and greys. Blue already means "interactive" or
           "this one is yours". Adjacency needs no new colour at all. */
        .bgt .bgt-note {
          font-size: 12.5px; color: #6b7280; white-space: nowrap;
        }
        .bgt .d1 { padding-left: 22px; }
        .bgt .d2 { padding-left: 44px; }
        .bgt .d3 { padding-left: 66px; }

        /* ── Guides: the strokes that let the eye follow a column.
           Indentation alone asks the reader to measure whitespace, and by the
           fourth level they are counting pixels to work out what belongs to
           what. A rule down each level and a stub into each name says it.

           DRAWN, not typed: box-drawing characters would ride the text
           baseline, inherit the mono metrics and break the moment a note
           wraps under its path on a phone. These are absolutely positioned
           against the row, so they are unaffected by what the row contains.

           Geometry: each level's rule sits 12px left of that level's own
           indent, which is inside the parent's text column, and the stub runs
           from the rule to 4px short of the name. --guide-mid is the distance
           from the top of the row to the middle of the PATH line, not to the
           middle of the row: on a phone the note sits underneath and the row
           is twice as tall, so a 50% elbow would point at empty space. ── */
        .bgt .bgt-tree { --guide-mid: 13px; }
        .bgt .bgt-tree li { position: relative; }
        .bgt .d1::before, .bgt .d2::before, .bgt .d3::before {
          content: ""; position: absolute; top: 0; width: 1px;
          height: var(--guide-mid); background: #d7dbe0;
        }
        .bgt .d1::after, .bgt .d2::after, .bgt .d3::after {
          content: ""; position: absolute; top: var(--guide-mid);
          height: 1px; background: #d7dbe0;
        }
        .bgt .d1::before { left: 10px; }
        .bgt .d1::after  { left: 10px; width: 8px; }
        .bgt .d2::before { left: 32px; }
        .bgt .d2::after  { left: 32px; width: 8px; }
        .bgt .d3::before { left: 54px; }
        .bgt .d3::after  { left: 54px; width: 8px; }
        /* The three leaves are siblings, so the rule has to CARRY DOWN past
           each of them to reach the next. Only the last one stops at its own
           elbow, which is what closes the branch. */
        .bgt .d3::before { height: 100%; }
        .bgt .d3:last-child::before { height: var(--guide-mid); }
        /* Under ~620px the two columns cannot both hold their line, and a
           nowrap note would push the panel into a horizontal scroll. The note
           drops beneath its path instead, still right of the indent so the
           tree's left edge survives, which is the thing the exhibit is for. */
        /* Under ~620px the two columns cannot both hold their line: the
           deepest path plus its note needs ~314px against the 254px a 320px
           phone offers, so a nowrap note would force the panel into a
           horizontal scroll. The note drops beneath its path instead.

           The spacing then has to do work the columns were doing. Stacked at
           an even rhythm, every note reads as another line OF the tree, and
           the structure turns to mush. So the gap WITHIN a pair is nothing
           and the gap BETWEEN pairs is 12px: each path keeps its note, and
           the seven entries still read as seven. */
        @media (max-width: 620px) {
          .bgt { padding: 20px 16px; }
          /* Smaller path type here, so the middle of that line moves up. */
          .bgt .bgt-tree { --guide-mid: 9px; }
          .bgt .d1::before, .bgt .d1::after { left: 6px; }
          .bgt .d2::before, .bgt .d2::after { left: 20px; }
          .bgt .d3::before, .bgt .d3::after { left: 34px; }
          .bgt .d1::after, .bgt .d2::after, .bgt .d3::after { width: 6px; }
          .bgt .bgt-tree li {
            flex-wrap: wrap; gap: 0;
            padding-top: 0; padding-bottom: 12px;
          }
          .bgt .bgt-tree li:last-child { padding-bottom: 0; }
          .bgt .bgt-path { font-size: 12px; }
          /* Still wraps under its path here: measured, the deepest path plus
             its note needs ~314px against the 254px a 320px phone offers, so
             side by side would force a horizontal scroll. */
          .bgt .bgt-note {
            white-space: normal; flex-basis: 100%;
            font-size: 11.5px; line-height: 1.45;
          }
          .bgt .d1 { padding-left: 14px; }
          .bgt .d2 { padding-left: 28px; }
          .bgt .d3 { padding-left: 42px; }
        }
      `}</style>
    </section>
  );
}
