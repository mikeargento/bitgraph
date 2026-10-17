// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The two pictures the site is (Mike, 2026-10-17: "turn off and strip away
 * everything on the site that isnt just this").
 *
 *   1. The primitive: inside the enclave, one atomic action counts twice, a
 *      nonce nobody sees and then the payload bound after it. What the payload
 *      is decides what is proven: a block hash, a Merkle root, an action or
 *      record, a prior BitGraph.
 *   2. The sandwich: BitGraph A, the records, BitGraph B. Everything between
 *      was bound after A and before B, minutes or weeks.
 *
 * 0. The flow (Mike, 2026-10-17, "a simpler graphic"): content, its SHA-256,
 *    then the enclave's one action (1: nonce, 2: bind the digest, signed), then
 *    the proof, checked offline. The digest goes straight to step 2: the nonce
 *    is drawn without it. This is the home page's one picture.
 *
 * Drawn in HTML so they stay sharp and reflow: on a phone each row stacks and
 * its arrows turn downward. Styles are the .pf- rules in globals.css.
 */

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

export function SandwichFigure() {
  return (
    <figure className="pf-figure" aria-label="BitGraph A, the start moment, then records, then BitGraph B, the end moment. Everything between is bound after A and before B, minutes or weeks.">
      <div className="pf-row pf-row-sandwich">
        <div className="pf-box pf-purple pf-end">
          <div className="pf-title">BitGraph A</div>
          <div className="pf-sub">Start moment</div>
        </div>
        <Arrow />
        <div className="pf-box pf-grey pf-record"><div className="pf-title pf-plain">Record</div></div>
        <Arrow />
        <div className="pf-box pf-grey pf-record"><div className="pf-title pf-plain">Record</div></div>
        <Arrow />
        <div className="pf-box pf-grey pf-record"><div className="pf-title pf-plain">Record</div></div>
        <Arrow />
        <div className="pf-box pf-purple pf-end">
          <div className="pf-title">BitGraph B</div>
          <div className="pf-sub">End moment</div>
        </div>
      </div>
      <div className="pf-bracket" aria-hidden="true" />
      <figcaption className="pf-caption">Everything here is bound after A and before B: minutes or&nbsp;weeks</figcaption>
    </figure>
  );
}

/** The simple picture: content → [enclave: 1 nonce → 2 bind] → proof, the content entering at step 2 (Mike, 2026-10-17: "simplify ... only keep content"). */
export function FlowFigure() {
  return (
    <figure className="pf-figure pf-flow" aria-label="Content goes into the enclave and runs straight through one atomic action: step 1 draws a fresh, unused nonce, step 2 binds the content right after it and signs both. The result is a proof anyone can check offline.">
      <div className="pf-box pf-grey pf-f-content"><div className="pf-title">Content</div><div className="pf-sub">Any bits</div></div>
      <span className="pf-arrow pf-f-a1" aria-hidden="true" />
      <div className="pf-f-enclave" aria-hidden="true" />
      <div className="pf-enclave-label pf-f-label">Enclave: one atomic action</div>
      <div className="pf-box pf-purple pf-f-nonce"><div className="pf-title">1: nonce</div><div className="pf-sub">Unused</div></div>
      <span className="pf-arrow pf-f-a2" aria-hidden="true" />
      <div className="pf-box pf-green pf-f-bind"><div className="pf-title">2: bind</div><div className="pf-sub">Content, signed</div></div>
      <span className="pf-arrow pf-f-a3" aria-hidden="true" />
      <div className="pf-box pf-green pf-f-proof"><div className="pf-title">Proof</div><div className="pf-sub">Offline check</div></div>
    </figure>
  );
}
