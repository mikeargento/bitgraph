/**
 * The overview's one figure, under the HOW paragraph ("A record is bytes…"),
 * in the whitepaper's box-and-arrow grammar (the old docs/whitepaper/figures.tsx,
 * recoverable from 37dd05f7^): boxes with a title and a small subtitle, a
 * brand-tinted container for the enclave, a mono chip for the digest, thin
 * arrows with a word on them. Mike, 2026-09-11: "maybe a simpler diagram like
 * one from the whitepaper", after the slot-strip figure of the same morning
 * ("your picture sucked").
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
 */

const C = {
  ink: "#111827",
  body: "#1f2937",
  mut: "#4b5563",
  line: "#d0d5dd",
  white: "#ffffff",
  brand: "#0065A4",
  brandTint: "rgba(0,101,164,0.045)",
  brandTintLight: "rgba(0,101,164,0.022)",
};
const MONO = "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace";

/* The two named values, wherever they appear in the drawing: N (the position)
   in blue mono, H (the digest) in ink mono, matching the caption. Everything
   else in the label stays in the text face. */
function rich(text: string, size: number): React.ReactNode[] {
  return text.split(/(\bN\b|\bH\b)/).filter(Boolean).map((part, i) =>
    part === "N" ? <tspan key={i} fontFamily={MONO} fontWeight={600} fill={C.brand} fontSize={size * 0.95}>N</tspan>
    : part === "H" ? <tspan key={i} fontFamily={MONO} fontWeight={600} fill={C.ink} fontSize={size * 0.95}>H</tspan>
    : <tspan key={i}>{part}</tspan>);
}

function Box({ x, y, w, h, title, sub, stroke = C.line, sw = 1, titleFill = C.body, fill = C.white }: {
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
      <rect x={x} y={y} width={w} height={h} rx={8} fill={fill} stroke={stroke} strokeWidth={sw} />
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
      <path d={d} fill="none" stroke={brand ? C.brand : C.body} strokeWidth={1.25} markerEnd={`url(#${id}-${brand ? "b" : "g"})`} />
      {label && <text x={lx} y={ly} textAnchor="middle" fontSize={9.5} fill={brand ? C.brand : C.mut} letterSpacing="0.04em">{label}</text>}
    </g>
  );
}

/* A label as its own small pill, centred on the line it belongs to, over the
   line (Mike, 2026-09-11: "should these have their own little connecting
   pills?"). Width from the text length at 9.5px with letter-spacing. */
function Tag({ x, y, text, brand }: { x: number; y: number; text: string; brand?: boolean }) {
  const w = Math.round(text.length * 5.9 + 22);
  const h = 22;
  return (
    <g>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={h / 2} fill={C.white} stroke={brand ? C.brand : "#9aa3b2"} strokeWidth={1} />
      <text x={x} y={y + 3.5} textAnchor="middle" fontSize={9.5} fill={brand ? C.brand : C.body} letterSpacing="0.04em">{rich(text, 9.5)}</text>
    </g>
  );
}

export function HowFigure() {
  const id = "how";
  return (
    <figure style={{ margin: "12px 0 32px" }}>
      {/* One shaded card holds the drawing and its caption, caption inside,
          left-set (Mike, 2026-09-11). The device lane is white on the card's
          grey so the two lanes still read as two. */}
      <div style={{ border: "1px solid #dfe3e8", borderRadius: "var(--radius-card)", background: "rgba(0,101,164,0.06)", padding: "20px 20px 18px" }}>
        {/* Only the drawing scrolls on a phone; the caption below wraps and
            stays put (Mike, 2026-09-11). */}
        <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 760 }} role="img" aria-label="Two lanes, your device over the enclave. In the enclave lane, position N is opened first from a hardware nonce while no digest exists, and its signed slot record goes down to your device. In the device lane, your file becomes new bytes that carry a commitment to N, built on your device. Their digest H goes back up to the enclave and is committed under N, signed and attested; N is consumed. The proof comes back down and leaves with the file. N was held, unspent, between opening and commit.">
          <svg viewBox="0 0 1000 436" width="100%" style={{ display: "block", fontFamily: "inherit" }}>
            <defs>
              <marker id={`${id}-g`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill={C.body} />
              </marker>
              <marker id={`${id}-b`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill={C.brand} />
              </marker>
            </defs>

            {/* the two lanes: where each step happens */}
            <rect x={20} y={20} width={960} height={176} rx={12} fill={C.white} stroke={C.line} strokeWidth={1} />
            <text x={44} y={50} fontSize={9} fontWeight={700} letterSpacing="0.09em" fill={C.ink}>YOUR DEVICE</text>
            <rect x={20} y={240} width={960} height={176} rx={12} fill={C.white} stroke={C.brand} strokeWidth={1} />
            <text x={44} y={270} fontSize={9} fontWeight={700} letterSpacing="0.09em" fill={C.brand}>ENCLAVE / TEE</text>

            {/* enclave lane: 1 opens N, 3 commits under it; between them N is held */}
            <Box x={115} y={306} w={270} h={64} title="1. Open a position" sub={["a signed slot record: nonce, counter, epoch", "no digest exists yet"]} stroke={C.brand} />
            <path d="M 385 338 L 615 338" fill="none" stroke={C.brand} strokeWidth={1} strokeDasharray="3 4" />
            <Tag x={500} y={338} text="position held, unspent" brand />
            <Box x={615} y={306} w={270} h={64} title="3. Commit under the position" sub={["the digest, signed and attested", "the position is consumed, once"]} stroke={C.brand} />

            {/* device lane: the file becomes new bytes that carry N */}
            <Box x={115} y={86} w={120} h={64} title="Your file" sub={["any bytes"]} />
            <Arrow id={id} d="M 235 118 L 259 118" />
            <Box x={263} y={86} w={270} h={64} title="2. New bytes" sub={["the file + a commitment to the position", "built here, never uploaded"]} />

            {/* first: the slot record goes down into the bytes */}
            <Arrow id={id} d="M 320 306 L 320 154" brand />
            <Tag x={320} y={218} text="first: the signed slot record, into the bytes" brand />

            {/* then: the digest of the new bytes goes back up, under N */}
            <Arrow id={id} d="M 533 118 L 680 118 L 680 302" />
            <Tag x={680} y={218} text="then: the digest of the new bytes" />

            {/* the proof comes back down and leaves with the file */}
            <Arrow id={id} d="M 825 306 L 825 154" brand />
            <Box x={765} y={86} w={120} h={64} title="Proof" sub={["with the file,", "verifies offline"]} stroke={C.brand} sw={1.5} />
          </svg>
        </div>
        </div>
        <p style={{ fontSize: 13.5, lineHeight: 1.65, color: "#374151", textAlign: "left", margin: "18px 0 0", padding: "0 4px", textWrap: "pretty" }}>
          {/* Plain words, no symbol: N lasted an afternoon and needed
              defining twice (Mike, 2026-09-11: "should N just be replaced by
              position?"). */}
          The bytes name the position, and the position names the bytes. The position was open before the bytes were final, so they could not have been finished before it. The commit spends the position on exactly those bytes in one indivisible step, so it can never name any&nbsp;others.
        </p>
      </div>
    </figure>
  );
}
