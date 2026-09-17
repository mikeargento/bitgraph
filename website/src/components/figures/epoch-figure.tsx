import { Chip, Fig, Others, OthersV, Pos, Svg, T } from "./fig";

/**
 * Epochs. Each enclave lifetime is a sealed compartment with its own key and
 * its own counter, one UTC day in production. Keys are destroyed at the
 * boundary, so nothing inside a closed epoch can be re-signed. Anchors name
 * increasing Ethereum blocks, which is what orders one epoch against another.
 */
export function EpochFigure() {
  const caption = (
    <>
      Each compartment is one enclave lifetime: a fresh key generated in enclave memory and a counter starting at zero. In production the enclave restarts every day at 23:59 UTC, so an epoch is one calendar day. When it ends, its key is destroyed and cannot sign again; that is what makes a closed epoch fixed rather than merely append-only. Counters mean nothing across epochs. What relates one epoch to the next is public: each anchor names an Ethereum block, and the blocks increase.
    </>
  );

  /* Three compartments 253 wide with 100 between them: the gap has to hold the
     two-line label for the key's destruction without touching either box
     (Mike, 2026-09-18: it overlapped the borders at 40). */
  const BOX_W = 253;
  const wide = (
    <Svg w={960} h={240} top={22} title="Three compartments side by side, labelled as three consecutive UTC days, each with its own key and a counter that restarts. Inside each, a short sequence with blue anchors at both ends. Between compartments: 23:59 UTC, key destroyed. Below, the Ethereum block numbers named by the anchors increase from left to right.">
      {/* The rule first, so the block chips sit on top of it. */}
      <T x={0} y={178} cls="ttl">ETHEREUM BLOCKS NAMED BY THE ANCHORS</T>
      <line className="rule-2" x1={0} y1={200} x2={960} y2={200} />
      {[["14 Sep 2026", "key A", 0, "25,970,120", "25,977,300"], ["15 Sep 2026", "key B", 353, "25,977,302", "25,984,480"], ["16 Sep 2026", "key C", 706, "25,984,482", "25,991,660"]].map(([day, key, x0, b1, b2]) => {
        const x = Number(x0);
        const first = x + 30, last = x + 223;
        const step = (last - first) / 7;
        return (
          <g key={String(day)}>
            <rect className="box" x={x} y={30} width={BOX_W} height={110} />
            <T x={x + 14} y={52} cls="lbl-ink" size={12}>Epoch: {day} (UTC)</T>
            <T x={x + 14} y={68} cls="lbl" size={11}>{key} · counter restarts at 0</T>
            <line className="rule" x1={x + 14} y1={104} x2={x + BOX_W - 14} y2={104} />
            <Pos cx={first} cy={104} kind="anchor" size={16} />
            <Others y={104} xs={[1, 2, 3, 4, 5, 6].map((i) => Math.round(first + i * step))} size={16} />
            <Pos cx={last} cy={104} kind="anchor" size={16} />
            <text className="num" x={first} y={128} textAnchor="middle" style={{ fontSize: 10 }}>#2</text>
            <text className="num" x={last} y={128} textAnchor="middle" style={{ fontSize: 10 }}>#12,406</text>
            <Chip cx={x + 46} cy={200} text={String(b1)} tone="b" />
            <Chip cx={x + BOX_W - 46} cy={200} text={String(b2)} tone="b" />
          </g>
        );
      })}
      {[303, 656].map((cx) => (
        <g key={cx}>
          <T x={cx} y={98} anchor="middle" cls="lbl" size={10}>23:59 UTC</T>
          <T x={cx} y={113} anchor="middle" cls="lbl t-r" size={10.5}>key destroyed</T>
        </g>
      ))}

      <T x={480} y={230} anchor="middle" cls="lbl" size={10.5}>increasing left to right: the public order of the epochs</T>
    </Svg>
  );

  const narrow = (
    <Svg w={360} h={512} title="Three compartments stacked, labelled as three consecutive UTC days, each with its own key and a restarting counter, with anchors at the start and end. The Ethereum block numbers named by the anchors increase from top to bottom.">
      {[["14 Sep 2026", "key A", 10, "25,970,120", "25,977,300"], ["15 Sep 2026", "key B", 180, "25,977,302", "25,984,480"], ["16 Sep 2026", "key C", 350, "25,984,482", "25,991,660"]].map(([day, key, y0, b1, b2]) => {
        const y = Number(y0);
        return (
          <g key={String(day)}>
            <rect className="box" x={10} y={y} width={340} height={128} />
            <T x={22} y={y + 22} cls="lbl-ink" size={12}>Epoch: {day} (UTC)</T>
            <T x={22} y={y + 38} cls="lbl" size={11}>{key} · counter restarts at 0</T>
            <line className="rule" x1={22} y1={y + 72} x2={336} y2={y + 72} />
            <Pos cx={40} cy={y + 72} kind="anchor" size={16} />
            <Others y={y + 72} xs={[76, 108, 140, 172, 204, 236, 268]} size={16} />
            <Pos cx={318} cy={y + 72} kind="anchor" size={16} />
            <text className="num" x={40} y={y + 96} textAnchor="start" style={{ fontSize: 10, fill: "var(--accent)" }}>block {b1}</text>
            <text className="num" x={336} y={y + 96} textAnchor="end" style={{ fontSize: 10, fill: "var(--accent)" }}>block {b2}</text>
            <text className="num" x={40} y={y + 112} textAnchor="start" style={{ fontSize: 10 }}>#2</text>
            <text className="num" x={336} y={y + 112} textAnchor="end" style={{ fontSize: 10 }}>#12,406</text>
          </g>
        );
      })}
      <T x={180} y={162} anchor="middle" cls="lbl" size={10}>23:59 UTC: <tspan className="t-r">key destroyed</tspan></T>
      <T x={180} y={332} anchor="middle" cls="lbl" size={10}>23:59 UTC: <tspan className="t-r">key destroyed</tspan></T>
      <T x={180} y={502} anchor="middle" cls="lbl" size={10.5}>block numbers increase down the page</T>
    </Svg>
  );

  return <Fig wide={wide} narrow={narrow} caption={caption} label="Three epochs, each a compartment, ordered by the Ethereum blocks their anchors name" />;
}
