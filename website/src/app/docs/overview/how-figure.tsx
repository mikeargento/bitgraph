/**
 * The overview's one figure, under the HOW paragraph ("A record is bytes…"),
 * in the whitepaper's box-and-arrow grammar (the old docs/whitepaper/figures.tsx,
 * recoverable from 37dd05f7^): boxes with a title and a small subtitle, a
 * brand-tinted container for the enclave, a mono chip for the digest, thin
 * arrows with a word on them. Mike, 2026-09-11: "maybe a simpler diagram like
 * one from the whitepaper", after the slot-strip figure of the same morning
 * ("your picture sucked").
 *
 * ⚠️ THE SIGNED SLOT RECORD, NONCE INCLUDED, GOES TO THE DEVICE. An outside
 * sketch (2026-09-11) had the nonce staying inside the enclave and only a
 * derived commitment crossing; the code says otherwise (allocate returns the
 * record, the core pipeline derives the commitment on the device, and the
 * offline verifier recomputes it from the record inside the proof). Only
 * the raw nonce never enters the file's bytes. Do not redraw it that way.
 *
 * Two lanes, device over enclave (Mike, 2026-09-11: "should YOUR DEVICE be
 * on top?" Yes: the story starts with your file, top left, and the enclave
 * sits beneath, where the site says BitGraph sits), so the order reads left to right across
 * them without a zigzag: 1 opens N (enclave), 2 builds the new bytes around a
 * commitment to N (device), 3 commits their digest under N (enclave), and the
 * proof comes back down. The dashed "N is held, unspent" between 1 and 3 is
 * the point of the pattern: the position is open, and idle, the whole time
 * the bytes are being finished. The caption states the closure: the bytes
 * name N and N names the bytes (Mike, 2026-09-11: "it has to be perfect and
 * show the genius of the fuse pattern"). No anchor is drawn: an anchor is a
 * BitGraph made by the same path. The caption sits inside the card. "File", not "record", in
 * the drawing: record reads both as the artifact and as the act of recording
 * (Mike, same day), and the paragraph above already owns the word.
 *
 * Wide figures scroll sideways on a phone, as the whitepaper's did.
 *
 * 2026-09-17: back on How it works in place of the redesign's boundary figure
 * (Mike: "we should keep this diagram ... yours is way messier"). The frame
 * and caption follow the site's figure rules now; the inline margin and the
 * rule under the caption are gone.
 *
 * 2026-09-16: the drawing spans the text column exactly (the viewBox is cut to
 * the lanes' outer edges, no wrapper card, no max width), and every stroke is
 * a fixed 1 CSS px at any scale (vector-effect: non-scaling-stroke). Mike:
 * "let this match the width. but instead of 2px strokes maybe keep it to 1px".
 */

/* Colours mean what they mean everywhere else on the site (2026-09-16):
   blue is the enclave and the position, yellow is a position held and not yet
   spent, green is the proof. Square corners, like the rest of the site. */
const C = {
  held: "var(--warn)",
  proof: "var(--code)",   /* the coral, like inline code (Mike, 2026-09-16: "i think on diagram too"); green is verified only */
  ink: "var(--ink)",
  body: "var(--text)",
  mut: "var(--dim)",
  line: "var(--line)",
  white: "var(--panel)",
  brand: "var(--accent)",
};
const MONO = "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace";

/* Label text with its step number, if any, set bold. (This once coloured N
   and H as symbols; the symbols are gone, the words stayed.) */
function rich(text: string, size: number): React.ReactNode[] {
  /* A leading step number ("1. ") is set bold, as it is in the box titles,
     so a number on a pill weighs the same as a number on a box. */
  return text.split(/(^\d+\.\s)/).filter(Boolean).map((part, i) =>
    /^\d+\.\s$/.test(part) ? <tspan key={i} fontWeight={700} fontSize={size + 1}>{part}</tspan> : <tspan key={i}>{part}</tspan>);
}

function Box({ x, y, w, h, title, sub, stroke = C.line, sw = 1, titleFill = C.ink, fill = C.white }: {
  x: number; y: number; w: number; h: number; title: string; sub?: string[]; stroke?: string; sw?: number; titleFill?: string; fill?: string;
}) {
  const subs = sub ?? [];
  const cx = x + w / 2;
  const titleSize = 12.5;
  const lineH = 12;
  const blockH = titleSize + 4 + subs.length * lineH;
  const ty = y + h / 2 - blockH / 2 + titleSize;
  return (
    <g>
      <rect vectorEffect="non-scaling-stroke" x={x} y={y} width={w} height={h} rx={6} fill={fill} stroke={stroke} strokeWidth={sw} />
      <text x={cx} y={ty} textAnchor="middle" fontSize={titleSize} fontWeight={600} fill={titleFill}>{rich(title, titleSize)}</text>
      {subs.map((s, i) => (
        <text key={i} x={cx} y={ty + 13 + i * lineH} textAnchor="middle" fontSize={10} fill={C.mut}>{rich(s, 10)}</text>
      ))}
    </g>
  );
}

function Arrow({ d, id, brand, label, lx, ly }: { d: string; id: string; brand?: boolean; label?: string; lx?: number; ly?: number }) {
  return (
    <g>
      <path vectorEffect="non-scaling-stroke" d={d} fill="none" stroke={brand ? C.brand : C.mut} strokeWidth={1} markerEnd={`url(#${id}-${brand ? "b" : "g"})`} />
      {label && <text x={lx} y={ly} textAnchor="middle" fontSize={9.5} fill={brand ? C.brand : C.mut} letterSpacing="0.04em">{label}</text>}
    </g>
  );
}

/* A label as its own small pill, centred on the line it belongs to, over the
   line (Mike, 2026-09-11: "should these have their own little connecting
   pills?"). Width from the text length at 9.5px with letter-spacing. */
function Tag({ x, y, text, brand, held, proof, w: given }: { x: number; y: number; text: string; brand?: boolean; held?: boolean; proof?: boolean; w?: number }) {
  const tone = proof ? C.proof : held ? C.held : brand ? C.brand : null;
  // Measured text width plus 20px each side where the caller has measured it
  // (2026-09-11 pass: the estimate gave one pill 19px of padding and another
  // 30); the estimate stays as the fallback.
  // Mono: ~6.1px per character at 9.5px, plus 14px each side (2026-09-16; the
  // sans-era widths left the digest tag overflowing its box).
  const w = given ?? Math.round(text.length * 6.1 + 28);
  const h = 22;
  return (
    <g>
      <rect vectorEffect="non-scaling-stroke" x={x - w / 2} y={y - h / 2} width={w} height={h} rx={6} fill={C.white} stroke={tone ?? "var(--faint)"} strokeWidth={1} />
      <text x={x} y={y + 3.5} textAnchor="middle" fontSize={9.5} fill={tone ?? C.mut} letterSpacing="0.04em">{rich(text, 9.5)}</text>
    </g>
  );
}

export function HowFigure() {
  const id = "how";
  // A hairline closes the figure (Mike, 2026-09-16: "divider here?"): the
  // caption is set flush with the prose and in the secondary grey, and the
  // rule under it hands the page back to the body text.
  return (
    <figure>
      {/* One shaded card holds the drawing and its caption, caption inside,
          left-set (Mike, 2026-09-11). The device lane is white on the card's
          grey so the two lanes still read as two. */}
      <div>
        {/* Only the drawing scrolls on a phone; the caption below wraps and
            stays put (Mike, 2026-09-11). */}
        <div className="fig-well">
        <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 760 }} role="img" aria-label="Two lanes, your device over the enclave. In the enclave lane, position N is opened first from a hardware nonce while no digest exists, and its signed slot record goes down to your device. In the device lane, your file becomes new bytes that carry a commitment to N, built on your device. Their digest H goes back up to the enclave and is committed under N, signed and attested; N is consumed. The proof comes back down and leaves with the file. N was held, unspent, between opening and commit.">
          <svg viewBox="19 19 962 398" width="100%" style={{ display: "block", fontFamily: "inherit" }}>
            <defs>
              <marker id={`${id}-g`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill={C.mut} />
              </marker>
              <marker id={`${id}-b`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill={C.brand} />
              </marker>
            </defs>

            {/* the two lanes: where each step happens */}
            <rect vectorEffect="non-scaling-stroke" x={20} y={20} width={960} height={176} rx={6} fill="var(--bg)" stroke={C.line} strokeWidth={1} />
            {/* Lane titles are section titles, so they wear the site's heading colour (Mike, 2026-09-16). */}
            <text x={44} y={50} fontSize={9} fontWeight={700} letterSpacing="0.09em" fill="var(--head)">YOUR DEVICE</text>
            <rect vectorEffect="non-scaling-stroke" x={20} y={240} width={960} height={176} rx={6} fill="var(--bg)" stroke={C.brand} strokeWidth={1} />
            <text x={44} y={270} fontSize={9} fontWeight={700} letterSpacing="0.09em" fill="var(--head)">ENCLAVE / TEE</text>

            {/* enclave lane: 1 opens N, 3 commits under it; between them N is held */}
            <Box x={115} y={306} w={285} h={64} title="2. Open a position" sub={["from an empty request: nothing of the file", "a signed slot record: nonce, counter, epoch"]} stroke={C.brand} />
            <path vectorEffect="non-scaling-stroke" d="M 400 338 L 600 338" fill="none" stroke={C.held} strokeWidth={1} strokeDasharray="3 4" />
            <Tag x={500} y={338} text="position held, unspent" held />
            <Box x={600} y={306} w={285} h={64} title="4. Commit under the position" sub={["the digest bound, signed and attested", "the position consumed, once, in one step"]} stroke={C.brand} />

            {/* device lane: the file becomes new bytes that carry N */}
            <Box x={115} y={86} w={120} h={64} title="Your file" sub={["any bytes"]} />
            <Arrow id={id} d="M 235 118 L 316 118" />
            <Box x={320} y={86} w={360} h={64} title="3. New bytes" sub={["the file + a commitment derived here from the slot record", "built on your device, never uploaded"]} />

            {/* first: the slot record goes down into the bytes */}
            {/* the empty request, a pill on its wire like the other two (Mike,
                2026-09-11). The wire runs the full height like the others, so
                the pill sits mid-wire rather than on a stub; the pill's own
                words say the request carries nothing. */}
            <Arrow id={id} d="M 175 229 L 175 302" />
            {/* Green like the Proof box (Mike, 2026-09-16): the request that opens the
                position and the proof that closes it are the two ends of one path. */}
            <Tag x={175} y={218} text="1. ask for a position" proof />
            <Arrow id={id} d="M 355 306 L 355 154" brand />
            <Tag x={355} y={218} text="signed slot record" brand />

            {/* then: the digest of the new bytes goes back up, under N */}
            <Arrow id={id} d="M 645 150 L 645 302" />
            <Tag x={645} y={218} text="digest of the new bytes + the slot record" />

            {/* the proof comes back down and leaves with the file */}
            <Arrow id={id} d="M 825 306 L 825 154" brand />
            <Box x={765} y={86} w={120} h={64} title="Proof" sub={["with the file,", "verifies offline"]} stroke={C.proof} titleFill={C.proof} />
          </svg>
        </div>
        </div>
        <figcaption>
          {/* Plain words, no symbol: N lasted an afternoon and needed
              defining twice (Mike, 2026-09-11: "should N just be replaced by
              position?"). */}
          The bytes name the position, and the position names the bytes. The position was open before the new bytes were final, so they could not have been finished before it. The commit spends the position on exactly those bytes in one indivisible step, so it can never name any&nbsp;others.
        </figcaption>
        </div>
      </div>
    </figure>
  );
}
