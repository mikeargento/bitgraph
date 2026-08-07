/* ── BitGraph Folder: file → folder = BitGraph ──
   An equation, the way /camera states things. The file and the BitGraph are its
   artwork (camera-explainer.tsx, the closing pair), recoloured only where the
   film brown would misread here: grey means a frame nothing has happened to
   yet, which is that diagram's own convention. Only the folder is new, drawn to
   the same spec: white fill, #0065A4 at 2.5, #D9E7F2 accent.

   Horizontal on desktop, vertical on mobile, with the arrow turning to point
   down so the sequence still reads in the direction the eye travels. */

const BRAND = "#0065A4";
const ACCENT = "#D9E7F2";
const INERT = "#9aa3ae";

function Term({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bgq-term">
      <svg viewBox="0 0 110 100" role="img" aria-label={label}>
        {children}
      </svg>
      <span>{label}</span>
    </div>
  );
}

export function FolderProcess() {
  return (
    <section className="bgq" aria-label="A file dropped in the folder equals a BitGraph">
      <style>{`
        /* The row is the page's one picture, so it gets room on all four sides
           rather than sitting tight against the copy above and below it. */
        .bgq { margin: 3.5rem 0 3.75rem; }
        /* Full width of the content column (2026-08-07): columns still size
           to content, but space-between spreads them so the FIRST glyph sits
           on the text rail and the LAST lands on the right edge, operators
           centered in the gaps. This is not the rejected 1fr-thirds layout,
           which centered every glyph and floated the figure ~60px off the
           rail; the rail alignment survives the spread. Glyphs scale up to
           carry the wider stance. */
        .bgq .row {
          display: grid;
          grid-template-columns: repeat(5, auto);
          justify-content: space-between;
          align-items: center;
          gap: 24px;
        }
        .bgq .bgq-term { display: flex; flex-direction: column; align-items: center; gap: 16px; }
        /* An explicit width, not 100%: the columns size to content now, and a
           percentage against a content-sized track has nothing to resolve to. */
        .bgq .bgq-term svg { width: 180px; max-width: 100%; height: auto; }
        .bgq .bgq-term span {
          font-family: IBM Plex Mono, monospace;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #4b5563;
          text-align: center;
        }
        .bgq .op {
          color: #9aa3ae;
          font-size: 24px;
          font-weight: 500;
          line-height: 1;
          text-align: center;
          align-self: center;
          /* offsets the label height below each glyph, so the operator sits on
             the glyphs' centre line rather than the whole cell's */
          margin-bottom: 30px;
        }
        /* Phones keep the equation horizontal, just smaller. It stacked here
           once; reading the equation down a column turned a statement into
           three pictures, and cost ~700px of scroll to do it.
           The whole row shrinks instead and left-aligns with the page rail.

           Sizes are viewport-relative so it holds from 320px up: the three
           glyphs, two operators and four gaps have to clear the 90% column,
           which is 338px on a 375px phone and 288px on a 320px one. 23vw is
           what fits at both. The labels are the real constraint, not the
           artwork: "THE FOLDER" and "A BITGRAPH" are 82px at the desktop
           11px/0.14em, so they drop to 10px/0.1em to sit inside the glyph. */
        @media (max-width: 640px) {
          .bgq { margin: 2.75rem 0 3rem; }
          .bgq .row { gap: min(10px, 2.6vw); }
          .bgq .bgq-term { gap: 10px; }
          .bgq .bgq-term svg { width: 22vw; max-width: 90px; }
          /* Stroke units were thinned for the 180px desktop render; at the
             phone's ~82px they would draw ~1.2px, so restore weight here. */
          .bgq .bgq-term svg [stroke] { stroke-width: 2.4; }
          .bgq .bgq-term span { font-size: 10px; letter-spacing: 0.1em; }
          .bgq .op { font-size: 17px; margin-bottom: 22px; }
        }
      `}</style>

      <div className="row">
        <Term label="a file">
          <rect x="3" y="3" width="104" height="94" fill="#FFFFFF" stroke={INERT} strokeWidth="1.6" />
          <rect x="13" y="13" width="84" height="58" fill="#F3F4F6" stroke={INERT} strokeWidth="1.3" />
          <path d="M21 71 L41 43 L53 57 L61 48 L75 71 Z" fill={INERT} />
          <circle cx="83" cy="27" r="6" fill={INERT} />
        </Term>

        <div className="op arrow" aria-hidden="true">→</div>

        <Term label="the folder">
          {/* One tone. Drawn as a single silhouette rather than a back panel
              plus a front panel, so there are no internal edges to read as
              seams: tab up the left, then the body. */}
          <path
            d="M4 88 V14 h38 l9 11 h55 v63 z"
            fill={ACCENT}
            stroke={BRAND}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </Term>

        <div className="op" aria-hidden="true">=</div>

        <Term label="a BitGraph">
          <rect x="3" y="3" width="104" height="94" fill="#FFFFFF" stroke={BRAND} strokeWidth="1.6" />
          <rect x="13" y="13" width="84" height="58" fill={ACCENT} stroke={BRAND} strokeWidth="1.3" />
          <circle cx="83" cy="27" r="6" fill={BRAND} />
          <path d="M80.2 27.2 L82.3 29.3 L86 24.8" fill="none" stroke="#FFFFFF" strokeWidth="1.05" strokeLinecap="round" strokeLinejoin="round" />
          <text x="45" y="35" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="9.5" letterSpacing="0.08em" fill={BRAND} opacity="0.5">10110010</text>
          <text x="55" y="56" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="14" fontWeight="600" fill={BRAND}>#3f9c…</text>
        </Term>
      </div>
    </section>
  );
}
