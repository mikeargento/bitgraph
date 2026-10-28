// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The two pictures the site is (2026-10-17: everything on the site that is
 * not one of these was turned off and stripped away).
 *
 *   1. The primitive: inside the enclave, one atomic action counts twice, a
 *      nonce nobody sees and then the payload bound after it. What the payload
 *      is decides what is proven: a block hash, a Merkle root, an action or
 *      record, a prior BitGraph.
 *   2. The sandwich: BitGraph A, the records, BitGraph B. Everything between
 *      was bound after A and before B (no clock: "opens" and "closes", 2026-10-17).
 *
 * 0. The flow (2026-10-17, the simpler graphic): content, its SHA-256,
 *    then the enclave's one action (1: nonce, 2: bind the digest, signed), then
 *    the proof, checked offline. The digest goes straight to step 2: the nonce
 *    is drawn without it. This is the home page's one picture.
 *
 * Drawn in HTML so they stay sharp and reflow: on a phone each row stacks and
 * its arrows turn downward. Styles are the .pf- rules in globals.css.
 */
import { Fragment, type ReactNode } from "react";

const PAYLOADS: Array<{ title: string; sub: string }> = [
  { title: "Block hash", sub: "Places it in time" },
  { title: "Merkle root", sub: "Any amount of data" },
  { title: "Action or record", sub: "Proved after nonce" },
  { title: "Prior BitGraph", sub: "Links moments" },
];

function Arrow() {
  return <span className="pf-arrow" aria-hidden="true" />;
}

export function PrimitiveFigure() {
  return (
    <figure className="pf-figure" aria-label="Inside the enclave, one atomic action: count 1 is a nonce nobody can see or predict, count 2 is the payload, bound after it. The payload can be a block hash, a Merkle root, an action or record, or a prior BitGraph.">
      <div className="pf-enclave">
        <div className="pf-enclave-label">Enclave (TEE): one atomic action</div>
        <div className="pf-row pf-row-two">
          <div className="pf-box pf-purple">
            <div className="pf-title">Count 1: nonce</div>
            <div className="pf-sub">Unseen, unpredictable</div>
          </div>
          <Arrow />
          <div className="pf-box pf-green">
            <div className="pf-title">Count 2: payload</div>
            <div className="pf-sub">Bound after the nonce</div>
          </div>
        </div>
      </div>
      <div className="pf-fan">
        {PAYLOADS.map((p) => (
          <div key={p.title} className="pf-box pf-grey">
            <div className="pf-title">{p.title}</div>
            <div className="pf-sub">{p.sub}</div>
          </div>
        ))}
      </div>
    </figure>
  );
}

interface Step { title: string; sub?: string }
const RECORDS: Step[] = [{ title: "Work" }, { title: "Work" }, { title: "Work" }];

/** Two BitGraphs as bookends. The home draws the general case; a demo names its own steps (2026-10-17). */
/** "The request" → "the request", for "BitGraph A: the request". */
const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

export function SandwichFigure({
  a = "Opens", b = "Closes", steps = RECORDS, caption = <>Everything here is bound after A and before&nbsp;B.</>,
  label = "BitGraph A, then the work, then BitGraph B. Everything between is bound after A and before B.",
  progress,
}: { a?: string; b?: string; steps?: Step[]; caption?: ReactNode; label?: string; progress?: number } = {}) {
  /* A demo can show where it is (2026-10-18: the drawing moves as the demo runs): `progress` is the index
     of the box being worked on (A is 0, the steps 1.., B last); every box before it is done. Past the last box, all
     are done. Undefined: a plain drawing. */
  const state = (i: number) => (progress === undefined ? "" : i < progress ? " is-done" : i === progress ? " is-active" : " is-waiting");
  const last = steps.length + 1;
  return (
    <figure className={`pf-figure${progress !== undefined ? " pf-live" : ""}`} aria-label={label}>
      <div className="pf-row pf-row-sandwich">
        {/* A and B are the bold words, their role below (2026-10-21: "record" and "stop" read as a specific action
            taken, so they went, and the red dot and the stop square with them). */}
        <div className={`pf-box pf-purple pf-end${state(0)}`}>
          <div className="pf-title">BitGraph A</div>
          <div className="pf-sub">{lowerFirst(a)}</div>
        </div>
        {steps.map((st, i) => (
          <Fragment key={i}>
            <Arrow />
            <div className={`pf-box pf-grey pf-record${state(i + 1)}`}>
              <div className="pf-title pf-plain">{st.title}</div>
              {st.sub && <div className="pf-sub">{st.sub}</div>}
            </div>
          </Fragment>
        ))}
        <Arrow />
        <div className={`pf-box pf-purple pf-end${state(last)}`}>
          <div className="pf-title">BitGraph B</div>
          <div className="pf-sub">{lowerFirst(b)}</div>
        </div>
      </div>
      <div className="pf-bracket" aria-hidden="true" />
      <figcaption className="pf-caption">{caption}</figcaption>
    </figure>
  );
}

/** Work between two (2026-10-19, a second diagram with examples of mixed content): BitGraph A, then the work made from
 *  its nonce, any kind of work (the three stacked examples read as "or", the demos' own three), then BitGraph B binding the
 *  result. A fan, not a line, so it does not repeat the sandwich above it. */
const RecordIcon = () => (
  <svg className="pf-icon pf-icon-record" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="7" /></svg>
);
const StopIcon = () => (
  <svg className="pf-icon pf-icon-stop" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect width="12" height="12" /></svg>
);

export function WorkFigure() {
  return (
    // A is record, B is stop (2026-10-20: BitGraph A works like a record button and BitGraph B like a stop button;
    // the red record dot and the stop square, labels "Start the recording" / "Stop the recording").
    <figure className="pf-figure pf-work" aria-label="BitGraph A starts the recording: its nonce becomes the input to the work, a question, an image, or an AI's task. BitGraph B stops the recording and binds the result.">
      <div className="pf-row pf-row-work">
        <div className="pf-box pf-purple pf-end">
          {/* Record and Stop are the bold words, the BitGraphs the subtext (2026-10-20). */}
          <div className="pf-title"><RecordIcon />Record</div>
          <div className="pf-sub">BitGraph A starts the recording</div>
        </div>
        <Arrow />
        {/* No articles: "A question" beside BitGraph A read as A's (2026-10-20). */}
        <div className="pf-choices">
          <div className="pf-box pf-grey"><div className="pf-title pf-plain">Question</div></div>
          <div className="pf-box pf-grey"><div className="pf-title pf-plain">Image</div></div>
          <div className="pf-box pf-grey"><div className="pf-title pf-plain">AI task</div></div>
          <div className="pf-choices-label">made from A&rsquo;s nonce</div>
        </div>
        <Arrow />
        <div className="pf-box pf-purple pf-end">
          <div className="pf-title"><StopIcon />Stop</div>
          <div className="pf-sub">BitGraph B stops the recording</div>
        </div>
      </div>
    </figure>
  );
}

/** The sequence (2026-10-21: nothing has to be chosen in advance; BitGraph everything and pick the pair to check
 *  later): a run of BitGraphs, two of them picked out after the fact, and the work between them in order. Drawn as one
 *  SVG so it is the same picture at every width. */
function SequenceRow({ n, a, b, first = 41, className }: { n: number; a: number; b: number; first?: number; className: string }) {
  const w = 72, gap = 24, x0 = 32, y0 = 60, h = 48;
  const cx = (i: number) => x0 + i * (w + gap) + w / 2;
  const width = x0 * 2 + n * (w + gap) - gap + 36;
  return (
    <svg className={className} viewBox={`0 0 ${width} 214`} width="100%" role="img" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => {
        const picked = i === a || i === b;
        return (
          <g key={i} className={picked ? "pf-seq-pick" : "pf-seq-one"}>
            <rect x={x0 + i * (w + gap)} y={y0} width={w} height={h} />
            <text x={cx(i)} y={y0 + h / 2 + 6} textAnchor="middle">#{first + i}</text>
          </g>
        );
      })}
      <text className="pf-seq-note" x={cx(a)} y={40} textAnchor="middle">any earlier one</text>
      <text className="pf-seq-note" x={cx(b)} y={40} textAnchor="middle">any later one</text>
      <g className="pf-seq-bracket">
        <line x1={cx(a)} y1={y0 + h + 14} x2={cx(a)} y2={y0 + h + 34} />
        <line x1={cx(b)} y1={y0 + h + 14} x2={cx(b)} y2={y0 + h + 34} />
        <line x1={cx(a)} y1={y0 + h + 34} x2={cx(b)} y2={y0 + h + 34} />
      </g>
      <text className="pf-seq-note" x={(cx(a) + cx(b)) / 2} y={y0 + h + 72} textAnchor="middle">the work between them, in order</text>
      <text className="pf-seq-more" x={x0 + n * (w + gap) - gap + 8} y={y0 + h / 2 + 6}>…</text>
    </svg>
  );
}

/** The sequence (2026-10-21: nothing has to be chosen in advance; BitGraph everything and pick the pair to check
 *  later): a run of BitGraphs, all alike, two of them picked out after the fact, and the work between them in order.
 *  Drawn as SVG so it is the same picture at every width; phones get a shorter row so the numbers stay readable. */
export function SequenceFigure() {
  return (
    <figure className="pf-figure pf-seq" aria-label="A row of BitGraphs, numbered. Two of them are picked out after the fact: any earlier one is the start, any later one is the stop, and the work between them is in order.">
      <SequenceRow n={10} a={2} b={7} className="pf-seq-desk" />
      <SequenceRow n={6} a={1} b={4} className="pf-seq-phone" />
    </figure>
  );
}

/** The simple picture: content → [enclave: 1 nonce → 2 bind] → proof, the content entering at step 2 (2026-10-17: simplified to content alone). */
export function FlowFigure() {
  return (
    <figure className="pf-figure pf-flow" aria-label="The content's SHA-256 goes into the enclave, which runs one atomic action: count N takes a fresh hardware nonce, count N+1 binds the digest right after it, both signed and attested. The result is a proof anyone can check offline.">
      <div className="pf-box pf-grey pf-f-content"><div className="pf-title">SHA-256</div><div className="pf-sub">Of any data</div></div>
      <span className="pf-arrow pf-f-a1" aria-hidden="true" />
      <div className="pf-f-enclave" aria-hidden="true" />
      <div className="pf-enclave-label pf-f-label">Measured AWS Nitro enclave</div>
      <div className="pf-box pf-purple pf-f-nonce"><div className="pf-title">Count N: nonce</div><div className="pf-sub">Fresh from the hardware RNG</div></div>
      <span className="pf-arrow pf-f-a2" aria-hidden="true" />
      <div className="pf-box pf-green pf-f-bind"><div className="pf-title">Count N+1: digest</div><div className="pf-sub">Bound right after, signed together</div></div>
      {/* Inside the enclave, under its two steps (2026-10-17), since the text describes the TEE's action. */}
      <div className="pf-f-note">One atomic action. If any step fails, nothing is released and the counter does not move.</div>
      <span className="pf-arrow pf-f-a3" aria-hidden="true" />
      <div className="pf-box pf-green pf-f-proof"><div className="pf-title">Attested proof</div><div className="pf-sub">Checks offline, by anyone</div></div>
    </figure>
  );
}
