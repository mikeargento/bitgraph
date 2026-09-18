import { Chip, Doc, Fig, Others, Pos, Svg, T } from "./fig";

/**
 * Four boxes, in the order things happen (Mike, 2026-09-18: "this should be 4 boxes. 1st is
 * slot, then robot, then the records of what ran, then bitgraph proof"), all the same size
 * ("make all boxes same size"). BitGraph on both ends, in blue; the AI and its records in
 * the middle, inside the system under review. The slot exists before the work, and the
 * proof closes it after: the inversion he wanted to show ("bitgraph box should go in middle
 * to show the inversion, the 'interception'").
 *
 * Box 1 carries the nonce and its one property, in words of existence, not knowledge (canon
 * rung 1). Box 4 carries what the proof shows (Mike: "that info is there and hasnt changed
 * or moved and is verifiable offline").
 *
 * ⚠️ A slot is held for 120 seconds: the record that carries its commitment is written,
 * signed and committed inside that window. So there is no "before the run / after the run"
 * label under the ends; the step numbers carry the order and the caption states the window.
 * ⚠️ The middle box names no system ("like TRACE" is the kind; naming it is a claim about
 * someone else's work until the v0.3 field is public).
 * ⚠️ Outlined boxes stay one unit inside the drawing: the SVG clips at its viewBox, and a
 * stroke centred on the edge loses its outer half (Mike, same day: "renders weird").
 * Numbers are illustrative, as in the receipt.
 */

/** One record: a document, its name, and what it says, on one or two lines. */
function Evidence({ x, y, name, says }: { x: number; y: number; name: string; says: string[] }) {
  return (
    <>
      <Doc x={x} y={y} w={18} h={22} />
      <T x={x + 32} y={y + 10} cls="lbl-ink">{name}</T>
      {says.map((line, i) => <T key={i} x={x + 32} y={y + 26 + i * 16}>{line}</T>)}
    </>
  );
}

/** A robot's head, in the Doc icon's line: outlined head and ears, an antenna, ink eyes. */
function Robot({ cx, cy, s = 1 }: { cx: number; cy: number; s?: number }) {
  const w = 48 * s, h = 40 * s, x = cx - w / 2, y = cy - h / 2;
  const ink = { fill: "var(--ink)" };
  return (
    <g>
      <line className="doc" x1={cx} y1={y} x2={cx} y2={y - 12 * s} />
      <circle className="doc" cx={cx} cy={y - 15 * s} r={3.5 * s} />
      <rect className="doc" x={x - 6 * s} y={cy - 8 * s} width={6 * s} height={16 * s} />
      <rect className="doc" x={x + w} y={cy - 8 * s} width={6 * s} height={16 * s} />
      <rect className="doc" x={x} y={y} width={w} height={h} rx={8 * s} />
      <circle cx={cx - 10 * s} cy={cy - 3 * s} r={4 * s} style={ink} />
      <circle cx={cx + 10 * s} cy={cy - 3 * s} r={4 * s} style={ink} />
      <line className="doc" x1={cx - 8 * s} y1={cy + 9 * s} x2={cx + 8 * s} y2={cy + 9 * s} />
    </g>
  );
}

/** A green tick and a line: one thing the proof shows. */
function Check({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <>
      <path d={`M ${x} ${y - 4} l 4 4 l 8 -9`} style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }} />
      <T x={x + 20} y={y} cls="lbl-ink">{children}</T>
    </>
  );
}

const Arrowed = ({ d }: { d: string }) => <path className="arrow" d={d} markerEnd="url(#m-dim)" />;

/* Wide: four boxes 220 wide with 26 between them, one unit in from each edge.
   Left edges 1, 247, 493, 739; centres 111, 357, 603, 849. */
const W = 220, TOP = 30, H = 204;

export function BoundaryFigure() {
  const caption = (
    <>
      Illustrative. BitGraph issues the slot first, and a record that carries its commitment was made after it. Within two minutes the records&rsquo; fingerprints fill the slot; anyone holding the records and the BitGraph can then check both, offline.
    </>
  );

  const wide = (
    <Svg w={960} h={244} title="Four boxes in order. One, BitGraph: a slot, empty, holding a nonce of fresh random bits; nothing made before it can contain it. Two: the AI runs. Three: the audit records, a signed record, an attested runtime and a transparency log, inside the system under review. Four: the BitGraph, the same slot now filled: the same bytes, nothing changed; the same slot, nothing moved; checked offline, by anyone.">
      {/* 1. BitGraph: a slot, first */}
      <T x={0} y={16} cls="ttl">1. BITGRAPH: A SLOT</T>
      <rect className="lane-enc" x={1} y={TOP} width={W} height={H} />
      <T x={111} y={52} anchor="middle">a separate, measured enclave</T>
      <line className="rule" x1={13} y1={88} x2={209} y2={88} />
      <Others y={88} xs={[25, 55]} />
      <Pos cx={111} cy={88} kind="open" size={22} />
      <Others y={88} xs={[167, 197]} />
      <Chip cx={111} cy={122} text="slot #4,201 · UNUSED" tone="w" />
      <T x={111} y={154} anchor="middle">a nonce: fresh random bits</T>
      <T x={111} y={170} anchor="middle">drawn on the spot.</T>
      <T x={111} y={198} anchor="middle" cls="lbl-ink">Nothing made before it</T>
      <T x={111} y={214} anchor="middle" cls="lbl-ink">can contain it.</T>
      <Arrowed d="M 225 132 L 243 132" />

      {/* 2. the AI runs */}
      <T x={247} y={16} cls="ttl">2. THE AI RUNS</T>
      <rect className="box" x={247} y={TOP} width={W} height={H} />
      <Robot cx={357} cy={108} />
      <T x={357} y={166} anchor="middle" cls="lbl-ink">an AI agent</T>
      <T x={357} y={182} anchor="middle">or model, at work</T>
      <Arrowed d="M 471 132 L 489 132" />

      {/* 3. the audit records */}
      <T x={493} y={16} cls="ttl">3. THE AUDIT RECORDS</T>
      <rect className="box" x={493} y={TOP} width={W} height={H} />
      {/* Centred in the box, each entry the same length, a name and two lines, so the documents sit at even intervals (Mike: "if each line had the same length prose it would align the file graphics better"), and
          the same short arrow in the gap as every other step (Mike, 2026-09-18: "this can be more centered in box
          and have same arrow as others"). The box as a whole points into BitGraph, like each step before it. */}
      <Evidence x={533} y={48} name="signed record" says={["what the run claims,", "by its own clock"]} />
      <Evidence x={533} y={109} name="attested runtime" says={["what code ran,", "on what hardware"]} />
      <Evidence x={533} y={170} name="transparency log" says={["what was registered,", "in arrival order"]} />
      <Arrowed d="M 717 132 L 735 132" />

      {/* 4. BitGraph: the proof */}
      <T x={739} y={16} cls="ttl">4. THE BITGRAPH</T>
      <rect className="lane-enc" x={739} y={TOP} width={W} height={H} />
      <line className="rule" x1={751} y1={88} x2={947} y2={88} />
      <Others y={88} xs={[763, 793]} />
      <Pos cx={849} cy={88} kind="spent" size={22} />
      <Others y={88} xs={[905, 935]} />
      <Chip cx={849} cy={122} text="slot #4,201 · CONSUMED" tone="w" />
      <Check x={751} y={158}>same bytes: nothing changed</Check>
      <Check x={751} y={182}>same slot: nothing moved</Check>
      <Check x={751} y={206}>checked offline, by anyone</Check>
    </Svg>
  );

  /* Narrow: the four boxes stacked, full width and the same height, 176. */
  const narrow = (
    <Svg w={360} h={896} title="Four boxes stacked in order. One, BitGraph: a slot, empty, holding a nonce of fresh random bits. Two: the AI runs. Three: the audit records, inside the system under review. Four: the BitGraph, the same slot filled: nothing changed, nothing moved, checked offline by anyone.">
      <T x={0} y={16} cls="ttl">1. BITGRAPH: A SLOT</T>
      <rect className="lane-enc" x={1} y={28} width={358} height={176} />
      <T x={16} y={48}>a separate, measured enclave</T>
      <line className="rule" x1={16} y1={86} x2={344} y2={86} />
      <Others y={86} xs={[28, 60, 92, 124]} />
      <Pos cx={180} cy={86} kind="open" size={22} />
      <Others y={86} xs={[236, 268, 300, 332]} />
      <Chip cx={180} cy={122} text="slot #4,201 · UNUSED" tone="w" />
      <T x={180} y={152} anchor="middle">a nonce: fresh random bits drawn on the spot.</T>
      <T x={180} y={176} anchor="middle" cls="lbl-ink">Nothing made before it can contain it.</T>
      {/* Short arrows, centred (Mike, 2026-09-18: "you can center these arrows", after trying them a little right of centre), in the gap above the next step's title (Mike, 2026-09-18: "you can
          just make normal arrows on the mobile robot graph now"; they ran down the right edge only while
          box 3 had a bracket leaving from there). */}
      <Arrowed d="M 180 210 L 180 232" />

      <T x={0} y={248} cls="ttl">2. THE AI RUNS</T>
      <rect className="box" x={1} y={256} width={358} height={176} />
      <Robot cx={180} cy={322} />
      <T x={180} y={380} anchor="middle" cls="lbl-ink">an AI agent</T>
      <T x={180} y={396} anchor="middle">or model, at work</T>
      <Arrowed d="M 180 438 L 180 460" />

      <T x={0} y={476} cls="ttl">3. THE AUDIT RECORDS</T>
      <rect className="box" x={1} y={484} width={358} height={176} />
      <Evidence x={67} y={508} name="signed record" says={["what the run claims, by its own clock"]} />
      <Evidence x={67} y={559} name="attested runtime" says={["what code ran, on what hardware"]} />
      <Evidence x={67} y={610} name="transparency log" says={["what was registered, in arrival order"]} />
      <Arrowed d="M 180 666 L 180 688" />

      <T x={0} y={704} cls="ttl">4. THE BITGRAPH</T>
      <rect className="lane-enc" x={1} y={712} width={358} height={176} />
      <line className="rule" x1={16} y1={752} x2={344} y2={752} />
      <Others y={752} xs={[28, 60, 92, 124]} />
      <Pos cx={180} cy={752} kind="spent" size={22} />
      <Others y={752} xs={[236, 268, 300, 332]} />
      <Chip cx={180} cy={786} text="slot #4,201 · CONSUMED" tone="w" />
      <Check x={18} y={822}>same bytes: nothing changed</Check>
      <Check x={18} y={846}>same slot: nothing moved</Check>
      <Check x={18} y={870}>checked offline, by anyone</Check>
    </Svg>
  );

  return <Fig wide={wide} narrow={narrow} caption={caption} label="A slot first, then the AI and its records inside the system under review, then the proof" />;
}
