import { Arrow, Chip, Doc, Fig, Others, OthersV, Pos, Svg, T } from "./fig";

/**
 * The state transition, in two panels, named as the site's opening sentence names them
 * (Mike, 2026-09-17: "should EMPTY be UNUSED?"): the position allocated and unused, then
 * the same position consumed by a fingerprint. The commit itself takes the
 * next counter value, so the second panel shows two marks: the slot, now
 * filled, and the commit beside it. Numbers are illustrative.
 */
export function StateFigure() {
  const caption = (
    <>
      Numbers are illustrative. Position 4,201 is allocated while it holds nothing. The commit that fills it is the next event in the sequence, 4,202, and it is the one step in which the fingerprint is bound, the position is consumed and the result is signed. The proof carries both numbers, and the slot&rsquo;s is always the smaller.
    </>
  );

  const wide = (
    <Svg w={960} h={240} title="Two panels. First, unused: a sequence of positions ending in a dotted, unused position numbered 4,201, allocated before any fingerprint arrives. Second: the same position filled, consumed by the file's SHA-256 fingerprint, with the commit recorded at 4,202 beside it.">
      {/* panel 1 */}
      <T x={0} y={18} cls="ttl">1. UNUSED</T>
      <line className="rule" x1={0} y1={120} x2={430} y2={120} />
      <Others y={120} xs={[40, 82, 124, 166, 208, 250]} />
      <Pos cx={310} cy={120} kind="open" size={22} />
      <Chip cx={310} cy={158} text="slot #4,201" tone="w" />
      <T x={310} y={187} anchor="middle" cls="lbl">a nonce from hardware entropy, a counter,</T>
      <T x={310} y={203} anchor="middle" cls="lbl">the epoch, the enclave&rsquo;s key. Signed.</T>
      <T x={310} y={228} anchor="middle" cls="lbl-ink">No fingerprint has been received.</T>

      {/* between */}
      <Arrow d="M 456 120 L 496 120" />
      <T x={476} y={104} anchor="middle" cls="lbl" size={11}>later</T>

      {/* panel 2 */}
      <T x={520} y={18} cls="ttl">2. CONSUMED</T>
      <line className="rule" x1={520} y1={120} x2={960} y2={120} />
      <Others y={120} xs={[560, 602, 644, 686, 728]} />
      <Pos cx={790} cy={120} kind="spent" size={22} />
      <Pos cx={836} cy={120} kind="commit" size={22} />
      <Others y={120} xs={[880, 922]} />
      <Doc x={773} y={30} />
      <T x={816} y={48} cls="lbl-ink">the file</T>
      <T x={816} y={64} cls="lbl">stays with you</T>
      <Arrow d="M 790 76 L 790 104" />
      {/* The connector first and from the chip's edge, so it runs under the chip, never over its text. */}
      <line className="rule-2" x1={772} y1={90} x2={782} y2={90} />
      <Chip cx={700} cy={90} text="SHA-256 fingerprint" />
      <Chip cx={813} cy={158} parts={[{ text: "slot #4,201", tone: "w" }, { text: " · ", tone: "d" }, { text: "commit #4,202", tone: "g" }]} />
      <T x={813} y={187} anchor="middle" cls="lbl">fingerprint bound, slot deleted, body signed</T>
      <T x={813} y={203} anchor="middle" cls="lbl">and attested, in one step</T>
      <T x={813} y={228} anchor="middle" cls="lbl-ink">No partial state exists.</T>
    </Svg>
  );

  const narrow = (
    <Svg w={360} h={560} title="Two panels stacked. First, unused: a dotted, unused position numbered 4,201, allocated before any fingerprint arrives. Second: the same position filled, consumed by the file's SHA-256 fingerprint, with the commit recorded at 4,202 below it.">
      <T x={0} y={18} cls="ttl">1. UNUSED</T>
      <line className="rule" x1={40} y1={34} x2={40} y2={230} />
      <OthersV x={40} ys={[60, 96, 132]} />
      <Pos cx={40} cy={190} kind="open" size={22} />
      <Chip cx={122} cy={190} text="slot #4,201" tone="w" />
      <T x={64} y={222} cls="lbl">nonce, counter, epoch, key. Signed.</T>
      <T x={64} y={240} cls="lbl-ink">No fingerprint has been received.</T>

      <T x={0} y={296} cls="ttl">2. CONSUMED</T>
      <line className="rule" x1={40} y1={312} x2={40} y2={556} />
      <OthersV x={40} ys={[338, 374]} />
      <Doc x={140} y={330} w={30} h={38} />
      <T x={180} y={346} cls="lbl-ink">the file stays with you</T>
      <Arrow d="M 140 375 L 60 425" />
      <Chip cx={205} cy={392} text="SHA-256 fingerprint" />
      <Pos cx={40} cy={440} kind="spent" size={22} />
      <Chip cx={122} cy={440} text="slot #4,201" tone="w" />
      <Pos cx={40} cy={486} kind="commit" size={22} />
      <Chip cx={130} cy={486} text="commit #4,202" tone="g" />
      <T x={64} y={522} cls="lbl">bound, consumed, signed, attested: one step</T>
      <T x={64} y={540} cls="lbl-ink">No partial state exists.</T>
    </Svg>
  );

  return <Fig wide={wide} narrow={narrow} caption={caption} label="The position is allocated unused, then consumed" />;
}
