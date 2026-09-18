import { Arrow, Chip, Fig, Others, OthersV, Pos, Span, SpanV, Svg, T } from "./fig";

/**
 * Where time comes from. Ethereum blocks above; the sequence below. Each
 * anchor is a position whose file is a block's hash. The anchor before a
 * position is its floor (a time); the anchor after it is its ceiling (a
 * place). Illustrative numbers shaped like real ones.
 */
export function AnchorFigure() {
  const caption = (
    <>
      Illustrative numbers. An anchor is made after the block it carries, so an anchor&rsquo;s position is later than its block&rsquo;s time. That is why the floor is exact (the block was mined before the slot was allocated, and the slot record says which block) and why the next anchor&rsquo;s block time is not an upper bound: the record can sit after that block was mined and still before the anchor took its position. The ceiling is the anchor&rsquo;s position, which is a fact about the sequence, not about the clock.
    </>
  );

  const y = 214;
  const wide = (
    <Svg w={960} h={268} title="Three Ethereum blocks drawn above a sequence of positions. Each block's hash is committed as an anchor on the sequence, slightly later than the block. A record sits between the first and second anchors. Brackets mark the floor, from the first anchor's block to the record, and the ceiling, from the record to the second anchor.">
      <T x={0} y={18} cls="ttl">ETHEREUM · public blocks, read only</T>
      {/* Each block sits straight above the anchor that carries it (Mike, 2026-09-18: "why are those arrows
          angled at all? it should all just line up"). The slant was meant to say an anchor comes after its
          block, but the two rows share no time axis, so it only read as crooked; the caption says it in words. */}
      {[[190, "block 25,984,342", "17:25:47 UTC"], [640, "block 25,984,343", "17:25:59 UTC"], [870, "block 25,984,344", "17:26:11 UTC"]].map(([x, b, t]) => (
        <g key={String(x)}>
          <rect className="box-b" x={Number(x) - 85} y={36} width={170} height={52} />
          <text className="num" x={Number(x)} y={58} textAnchor="middle" style={{ fill: "var(--accent)", fontSize: 11.5 }}>{b}</text>
          <text className="lbl" x={Number(x)} y={76} textAnchor="middle" style={{ fontSize: 11 }}>mined {t}</text>
        </g>
      ))}
      <Arrow d="M 190 90 L 190 172" tone="b" />
      <Arrow d="M 640 90 L 640 172" tone="p" />
      <Arrow d="M 870 90 L 870 172" tone="b" />
      <T x={202} y={136} cls="lbl" size={11}>the block hash, committed as a file</T>

      <T x={0} y={164} cls="ttl">THE BITGRAPH SEQUENCE</T>
      <line className="rule" x1={0} y1={y} x2={960} y2={y} />
      <Others y={y} xs={[40, 82, 124, 260, 302, 344, 500, 542, 584, 720, 762, 804, 922]} />
      <Pos cx={190} cy={y} kind="anchor" size={20} />
      <Pos cx={400} cy={y} kind="spent" size={20} />
      <Pos cx={442} cy={y} kind="commit" size={20} />
      <Pos cx={640} cy={y} kind="ceil" size={20} />
      <Pos cx={870} cy={y} kind="anchor" size={20} />
      <Chip cx={190} cy={y - 30} text="anchor #4,190" tone="b" />
      <Chip cx={421} cy={y - 30} parts={[{ text: "slot #4,201", tone: "w" }, { text: " · ", tone: "d" }, { text: "commit #4,202", tone: "g" }]} />
      <Chip cx={640} cy={y - 30} text="anchor #4,210" tone="p" />
      <Chip cx={870} cy={y - 30} text="anchor #4,230" tone="b" />
      <Span x1={190} x2={400} y={y + 26} label="floor: after 17:25:47 UTC" tone="b" />
      <Span x1={442} x2={640} y={y + 26} label="ceiling: before position 4,210" tone="p" />
    </Svg>
  );

  const x = 40;
  const narrow = (
    <Svg w={360} h={600} title="A vertical sequence of positions with Ethereum blocks drawn to the right. Each block's hash is committed as an anchor slightly later. A record sits between the first and second anchors, with floor and ceiling brackets.">
      <T x={0} y={16} cls="ttl" size={10}>SEQUENCE</T>
      <T x={228} y={16} cls="ttl" size={10}>ETHEREUM BLOCKS</T>
      <line className="rule" x1={x} y1={26} x2={x} y2={600} />
      {/* Level with the anchor that carries it, as on a desktop the block sits straight above it. */}
      {[[124, "25,984,342", "17:25:47"], [392, "25,984,343", "17:25:59"], [560, "25,984,344", "17:26:11"]].map(([yy, b, t]) => (
        <g key={String(yy)}>
          <rect className="box-b" x={228} y={Number(yy) - 23} width={128} height={46} />
          <text className="num" x={292} y={Number(yy) - 4} textAnchor="middle" style={{ fill: "var(--accent)", fontSize: 11 }}>block {b}</text>
          <text className="lbl" x={292} y={Number(yy) + 12} textAnchor="middle" style={{ fontSize: 10.5 }}>mined {t} UTC</text>
        </g>
      ))}
      <OthersV x={x} ys={[50, 80]} />
      <Pos cx={x} cy={124} kind="anchor" size={20} />
      <Chip cx={x + 74} cy={124} text="anchor #4,190" tone="b" />
      <Arrow d="M 228 124 L 170 124" tone="b" />
      <OthersV x={x} ys={[160, 190]} />
      <Pos cx={x} cy={232} kind="spent" size={20} />
      <Chip cx={x + 68} cy={232} text="slot #4,201" tone="w" />
      <Pos cx={x} cy={268} kind="commit" size={20} />
      <Chip cx={x + 74} cy={268} text="commit #4,202" tone="g" />
      <OthersV x={x} ys={[304, 334]} />
      <Pos cx={x} cy={392} kind="ceil" size={20} />
      <Chip cx={x + 74} cy={392} text="anchor #4,210" tone="p" />
      <Arrow d="M 228 392 L 170 392" tone="p" />
      <OthersV x={x} ys={[430, 460, 490]} />
      <Pos cx={x} cy={560} kind="anchor" size={20} />
      <Chip cx={x + 74} cy={560} text="anchor #4,230" tone="b" />
      <Arrow d="M 228 560 L 170 560" tone="b" />
      <SpanV y1={136} y2={222} x={176} label="floor" tone="b" />
      <SpanV y1={280} y2={366} x={176} label="ceiling" tone="p" />
    </Svg>
  );

  return <Fig wide={wide} narrow={narrow} caption={caption} label="Ethereum blocks above the sequence, anchors below" />;
}
