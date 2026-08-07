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
          display: flex; align-items: baseline; gap: 16px;
          padding-top: 3px; padding-bottom: 3px; line-height: 1.55;
        }
        .bgt .bgt-path {
          font-family: IBM Plex Mono, ui-monospace, monospace;
          font-size: 13px; color: #111827; white-space: nowrap;
        }
        .bgt .bgt-dir { color: #374151; }
        /* The one line that is yours. */
        .bgt .bgt-you { color: #0065A4; font-weight: 600; }
        /* Notes are the page's own sans at a step down, pushed right so they
           form their own column and the paths keep a clean left edge to read
           the indentation off. */
        .bgt .bgt-note {
          margin-left: auto; text-align: right;
          font-size: 12.5px; color: #4b5563; white-space: nowrap;
        }
        .bgt .d1 { padding-left: 22px; }
        .bgt .d2 { padding-left: 44px; }
        .bgt .d3 { padding-left: 66px; }
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
          .bgt .bgt-tree li {
            flex-wrap: wrap; gap: 0;
            padding-top: 0; padding-bottom: 12px;
          }
          .bgt .bgt-tree li:last-child { padding-bottom: 0; }
          .bgt .bgt-path { font-size: 12px; }
          .bgt .bgt-note {
            margin-left: 0; text-align: left; white-space: normal;
            flex-basis: 100%; font-size: 11.5px; line-height: 1.45;
          }
          .bgt .d1 { padding-left: 14px; }
          .bgt .d2 { padding-left: 28px; }
          .bgt .d3 { padding-left: 42px; }
        }
      `}</style>
    </section>
  );
}
