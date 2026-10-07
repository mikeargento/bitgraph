import { Arrow, Chip, Fig, Others, OthersV, Pos, Span, SpanV, Svg, T } from "./fig";

/**
 * Where time comes from. Base blocks above; the sequence below. When a
 * position opens, the enclave binds the newest Base block into it: the
 * floor, a time. After the commit, BitGraph's writer puts a Merkle root over
 * the proof hash into a Base transaction: the ceiling, a time. The next
 * BitGraph in the chain carries this proof's hash: order, not a time.
 * Illustrative numbers shaped like real ones; no window length is implied.
 * (Component name kept so imports do not break: it once drew Ethereum anchors.)
 */
export function AnchorFigure() {
  const caption = (
    <>
      Illustrative numbers. The enclave binds the newest Base block into the position when it opens, from a header it hashes and checks itself, and signs it into the proof: the record was made after that block. Seconds after the commit, BitGraph writes a Merkle root over the proof&rsquo;s hash into a Base transaction: the record existed by that block&rsquo;s time. The next BitGraph in the chain carries this proof&rsquo;s hash, so it came after; that is a fact about the sequence, not about the clock. Proofs made before the switch stand on an Ethereum anchor instead.
    </>
  );

  const y = 214;
  const wide = (
    <Svg w={960} h={268} title="Base blocks drawn above a sequence of positions. The first Base block is bound into a position when it opens: the floor. A record is committed into that position. A later Base transaction holds a Merkle root over the record's proof hash: the ceiling. The next BitGraph in the sequence follows the record in order.">
      <T x={0} y={18} cls="ttl">BASE · public blocks, every 2 seconds</T>
      {/* Each box sits straight above the position it belongs to (Mike, 2026-09-18: "why are those arrows
          angled at all? it should all just line up"). */}
      {[[190, "block 52,271,417", "made 17:25:47 UTC"], [640, "a later Base block", "transaction: Merkle root"]].map(([x, b, t]) => (
        <g key={String(x)}>
          <rect className="box-b" x={Number(x) - 85} y={36} width={170} height={52} />
          <text className="num" x={Number(x)} y={58} textAnchor="middle" style={{ fill: "var(--accent)", fontSize: 11.5 }}>{b}</text>
          <text className="lbl" x={Number(x)} y={76} textAnchor="middle" style={{ fontSize: 11 }}>{t}</text>
        </g>
      ))}
      <Arrow d="M 190 90 L 190 172" tone="b" />
      <Arrow d="M 640 172 L 640 90" tone="p" />
      <T x={202} y={136} cls="lbl" size={11}>its header, hashed in the enclave, bound at the position</T>
      <T x={652} y={136} cls="lbl" size={11}>ceiling: the proof hash, written to Base</T>

      <T x={0} y={164} cls="ttl">THE BITGRAPH SEQUENCE</T>
      <line className="rule" x1={0} y1={y} x2={960} y2={y} />
      <Others y={y} xs={[40, 82, 124, 260, 302, 344, 500, 542, 584, 720, 762, 804, 922]} />
      <Pos cx={190} cy={y} kind="spent" size={20} />
      <Pos cx={640} cy={y} kind="commit" size={20} />
      <Pos cx={870} cy={y} kind="other" size={20} />
      <Chip cx={190} cy={y - 30} text="position #4,201" tone="w" />
      <Chip cx={640} cy={y - 30} text="commit #4,209" tone="g" />
      <Chip cx={870} cy={y - 30} text="next BitGraph" tone="d" />
      <Span x1={190} x2={640} y={y + 26} label="floor: after block 52,271,417 (17:25:47 UTC)" tone="b" />
      <Span x1={640} x2={870} y={y + 26} label="order: the next proof chains its hash" tone="w" />
    </Svg>
  );

  const x = 40;
  const narrow = (
    <Svg w={360} h={600} title="A vertical sequence of positions with Base blocks drawn to the right. The first Base block is bound into a position when it opens: the floor. The record is committed, and a later Base transaction holds its proof hash: the ceiling. The next BitGraph follows in order.">
      <T x={0} y={16} cls="ttl" size={10}>SEQUENCE</T>
      <T x={228} y={16} cls="ttl" size={10}>BASE BLOCKS</T>
      <line className="rule" x1={x} y1={26} x2={x} y2={600} />
      {/* Level with the position it belongs to, as on a desktop the block sits straight above it. */}
      {[[124, "block 52,271,417", "made 17:25:47 UTC"], [392, "a later block", "ceiling: Merkle root"]].map(([yy, b, t]) => (
        <g key={String(yy)}>
          <rect className="box-b" x={228} y={Number(yy) - 23} width={128} height={46} />
          <text className="num" x={292} y={Number(yy) - 4} textAnchor="middle" style={{ fill: "var(--accent)", fontSize: 11 }}>{b}</text>
          <text className="lbl" x={292} y={Number(yy) + 12} textAnchor="middle" style={{ fontSize: 10.5 }}>{t}</text>
        </g>
      ))}
      <OthersV x={x} ys={[50, 80]} />
      <Pos cx={x} cy={124} kind="spent" size={20} />
      <Chip cx={x + 68} cy={124} text="position #4,201" tone="w" />
      <Arrow d="M 228 124 L 170 124" tone="b" />
      <OthersV x={x} ys={[160, 190, 232, 268, 304, 334]} />
      <Pos cx={x} cy={392} kind="commit" size={20} />
      <Chip cx={x + 74} cy={392} text="commit #4,209" tone="g" />
      <Arrow d="M 170 392 L 228 392" tone="p" />
      <OthersV x={x} ys={[430, 460, 490]} />
      <Pos cx={x} cy={560} kind="other" size={20} />
      <Chip cx={x + 74} cy={560} text="next BitGraph" tone="d" />
      <SpanV y1={136} y2={380} x={176} label="floor" tone="b" />
      <SpanV y1={404} y2={548} x={176} label="order" tone="w" />
    </Svg>
  );

  return <Fig wide={wide} narrow={narrow} caption={caption} label="Base blocks above the sequence: the floor bound at the position, the ceiling written after the commit" />;
}
