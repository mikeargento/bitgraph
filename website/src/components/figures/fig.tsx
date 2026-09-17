/**
 * The site's figure grammar. Every figure is drawn twice: a wide SVG for
 * desktops and a narrow one that reflows for phones. CSS (globals.css, .fig)
 * chooses which is shown, and gives every class its colour, so a figure never
 * carries a literal colour and always matches the page.
 *
 * The one motif: THE SEQUENCE. A line of positions, left to right (or top to
 * bottom on a phone). A square is a position. Dotted amber is open and
 * unspent; filled ink is consumed; grey is somebody else's; blue is an
 * Ethereum anchor (a floor); purple is the anchor that follows (a ceiling).
 * A label and its square wear the same colour (Mike, 2026-09-18): the slot is
 * amber, dotted while open and solid once spent; the commit that spends it is
 * green. Panel titles are NOT coloured (Mike decided, same day): every figure's
 * titles wear one label colour, the two-lane figure's.
 */
import type { ReactNode } from "react";

export type PosKind = "open" | "held" | "spent" | "commit" | "done" | "other" | "anchor" | "ceil";

export function Fig({ wide, narrow, caption, label }: { wide: ReactNode; narrow: ReactNode; caption?: ReactNode; label: string }) {
  return (
    <figure className="fig" role="group" aria-label={label}>
      {/* The well (Mike, 2026-09-18: "should diagrams sit on darker background with a
          light stroke to separate them??"). One step darker than the page with a
          hairline round it, the opposite of a code block's lighter box, so a drawing
          reads as one object. The caption sits inside it, under the drawing. */}
      <div className="fig-well">
        <div className="fig-wide">{wide}</div>
        <div className="fig-narrow">{narrow}</div>
        {/* Inside the well, under a hairline (Mike, 2026-09-18: "shouldnt the diagrams
            descriptions be inside black?"; the two-lane figure has carried its caption
            inside its card since 2026-09-11). */}
        {caption && <figcaption>{caption}</figcaption>}
      </div>
    </figure>
  );
}

export function Svg({ w, h, top = 0, children, title }: { w: number; h: number; top?: number; children: ReactNode; title: string }) {
  return (
    <svg viewBox={`0 ${top} ${w} ${h - top}`} role="img" aria-label={title} style={{ fontFamily: "inherit" }}>
      <defs>
        <marker id="m-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--dim)" />
        </marker>
        <marker id="m-b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--accent)" />
        </marker>
        <marker id="m-w" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--warn)" />
        </marker>
        <marker id="m-p" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--ceil)" />
        </marker>
      </defs>
      {children}
    </svg>
  );
}

/** A position on the sequence: a square centred on (cx, cy). */
export function Pos({ cx, cy, kind, size = 18 }: { cx: number; cy: number; kind: PosKind; size?: number }) {
  const s = kind === "other" ? size * 0.55 : size;
  if (kind === "open") {
    /* An open position: a dotted outline fitted to the square (Mike, 2026-09-18: "could this
       look better???", then "why not dots instead of dashes"). A 22px square has room for
       two dashes a side, which reads chunky and ends ragged at the corners; round dots give
       it five marks a side and no corner problem. A zero-length dash with a round cap is a
       dot; the spacing divides the side exactly, and the outline starts at the top-left
       corner, so a dot lands on every corner. The dots scale with the square (no
       non-scaling stroke here) so the fit holds at every width, and the square is filled
       with the well's colour so the sequence line stops at its edges instead of running
       through an empty position. */
    const n = Math.max(3, Math.round(s / 4.4));
    return (
      <rect
        className="pos-open"
        x={cx - s / 2} y={cy - s / 2} width={s} height={s}
        /* In style, not as attributes: a stylesheet rule outranks an SVG presentation attribute. */
        style={{ vectorEffect: "none", strokeDasharray: `0 ${s / n}`, strokeLinecap: "round", strokeWidth: 2.2 }}
      />
    );
  }
  return <rect className={`pos-${kind}`} x={cx - s / 2} y={cy - s / 2} width={s} height={s} />;
}

/** A run of grey positions along a horizontal line. */
export function Others({ y, xs, size = 18 }: { y: number; xs: number[]; size?: number }) {
  return <>{xs.map((x) => <Pos key={x} cx={x} cy={y} kind="other" size={size} />)}</>;
}

/** A run of grey positions down a vertical line. */
export function OthersV({ x, ys, size = 18 }: { x: number; ys: number[]; size?: number }) {
  return <>{ys.map((y) => <Pos key={y} cx={x} cy={y} kind="other" size={size} />)}</>;
}

/** A document outline with a folded corner. */
export function Doc({ x, y, w = 34, h = 42 }: { x: number; y: number; w?: number; h?: number }) {
  const f = Math.round(w * 0.3);
  return <path className="doc" d={`M${x} ${y} H${x + w - f} L${x + w} ${y + f} V${y + h} H${x} Z M${x + w - f} ${y} V${y + f} H${x + w}`} strokeLinejoin="miter" />;
}

/** A small filled chip with mono text, centred on (cx, cy). */
type ChipTone = "b" | "w" | "p" | "g" | "c" | "d";

/** One label, one chip. `parts` sets differently toned runs inside a single chip: two
    neighbouring positions get ONE chip naming both, never two chips side by side, which
    overlapped by a few pixels and puffed up where they met (Mike, 2026-09-18). */
export function Chip({ cx, cy, text, tone, w, parts }: { cx: number; cy: number; text?: string; tone?: ChipTone; w?: number; parts?: { text: string; tone?: ChipTone }[] }) {
  const full = parts ? parts.map((p) => p.text).join("") : (text ?? "");
  const width = w ?? Math.round(full.length * 6.6 + 18);
  return (
    <g>
      {/* Outlined in its tone, like the two-lane figure's pills; a chip of mixed tones keeps the neutral line. */}
      <rect className={`chip${!parts && tone ? ` chip-${tone}` : ""}`} x={cx - width / 2} y={cy - 10} width={width} height={20} />
      <text className={`num ${tone ? `t-${tone}` : "num-ink"}`} x={cx} y={cy + 4} textAnchor="middle" style={{ fontFamily: "var(--font-data)", fontSize: 11 }}>
        {parts ? parts.map((p, i) => <tspan key={i} className={p.tone ? `t-${p.tone}` : "num-ink"}>{p.text}</tspan>) : text}
      </text>
    </g>
  );
}

export function Arrow({ d, tone = "dim" }: { d: string; tone?: "dim" | "b" | "w" | "p" }) {
  const cls = tone === "b" ? "arrow-b" : "arrow";
  const stroke = tone === "w" ? "var(--warn)" : tone === "p" ? "var(--ceil)" : undefined;
  return <path className={cls} d={d} markerEnd={`url(#m-${tone})`} style={stroke ? { stroke } : undefined} />;
}

/** A square bracket under a span of the sequence, with a label. */
export function Span({ x1, x2, y, label, tone, above = false }: { x1: number; x2: number; y: number; label: string; tone: "b" | "p" | "w"; above?: boolean }) {
  const stroke = tone === "b" ? "var(--accent)" : tone === "p" ? "var(--ceil)" : "var(--warn)";
  const t = above ? -1 : 1;
  return (
    <g>
      <path d={`M${x1} ${y - 6 * t} V${y} H${x2} V${y - 6 * t}`} fill="none" stroke={stroke} strokeWidth={1} />
      <text className={`lbl t-${tone}`} x={(x1 + x2) / 2} y={above ? y - 12 : y + 16} textAnchor="middle" style={{ fontSize: 11.5 }}>{label}</text>
    </g>
  );
}

/** The vertical form of Span: a bracket to the right of a vertical span. */
export function SpanV({ y1, y2, x, label, tone, labelY }: { y1: number; y2: number; x: number; label: string; tone: "b" | "p" | "w"; labelY?: number }) {
  const stroke = tone === "b" ? "var(--accent)" : tone === "p" ? "var(--ceil)" : "var(--warn)";
  return (
    <g>
      <path d={`M${x - 6} ${y1} H${x} V${y2} H${x - 6}`} fill="none" stroke={stroke} strokeWidth={1} />
      <text className={`lbl t-${tone}`} x={x + 10} y={labelY ?? (y1 + y2) / 2 + 4} style={{ fontSize: 11.5 }}>{label}</text>
    </g>
  );
}

export function T({ x, y, children, cls = "lbl", anchor = "start", size }: { x: number; y: number; children: ReactNode; cls?: string; anchor?: "start" | "middle" | "end"; size?: number }) {
  return <text className={cls} x={x} y={y} textAnchor={anchor} style={size ? { fontSize: size } : undefined}>{children}</text>;
}
