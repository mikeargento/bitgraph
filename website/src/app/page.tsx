import type { Metadata } from "next";
import Link from "next/link";
import { StateFigure } from "@/components/figures/state-figure";
import { BoundaryFigure } from "@/components/figures/boundary-figure";


/**
 * Home, written for AI audit (Mike, 2026-09-18: "rewrite the entire homepage
 * section by section heading by heading with AI audit"). The reader is someone
 * who already runs, or is building, a system that proves what an AI ran: signed
 * trust records, attested runtimes, transparency logs, evaluation harnesses.
 * BitGraph is placed BESIDE that system, never against it: it adds one fact such
 * a system cannot give its own records, a position outside its own trust domain.
 *
 * h1 (Mike, 2026-09-18): "Conduct verifiable AI audits." It replaced "BitGraph gives
 * bits a place.", which read as a slogan once the page was about AI audit.
 *
 * ⚠️ Claim discipline, from the review that shaped this (the TRACE thread):
 * - No named standard is said to support this. A public proposal is the limit,
 *   and even that is kept off this page.
 * - It does not replace witnesses or transparency logs. Say so.
 * - Floor in time, ceiling in position (canon §3.6). Never "proves when".
 * - Missing evidence is not a contradiction: three results, not two, named as
 *   /docs/verification names them (valid, invalid, unverifiable).
 * - The copied-commitment case fails only because the proof must also commit
 *   THIS record; that clause is the reason the pattern is sound, so it is stated.
 * - A slot waits two minutes for its commit (SLOT_TTL_MS in the enclave).
 */
export const metadata: Metadata = {
  title: "BitGraph",
  description:
    "BitGraph gives an AI audit record a position its producer could not choose: a portable BitGraph that commits the exact record, sits after a public Ethereum block, and verifies offline. It works beside the audit system you already run.",
};

export default function HomePage() {
  return (
    <div className="frame home prose">
      <h1>Make your AI audit records <span style={{ whiteSpace: "nowrap" }}>self-verify</span> offline,&nbsp;forever.</h1>
      <p className="home-sub">Create portable proof of exactly what your existing system recorded, and where it&nbsp;stood.</p>
      {/* The WHY, before the WHAT (2026-09-18 brief: "we want the WHY to land earlier"). The limit lives in
          "Before anyone weighs the record": judging the content stays with the people deciding. */}
      <p className="lede">
        To keep innovating quickly, decisions about AI, from shipping a model to halting an agent, have to rest on records. If the audited party or its auditor can still edit those records without detection, you are trusting them. Before anyone weighs the record, it has to be checkable outside either system: the exact bytes committed, in a place neither controls.
      </p>
      {/* The WHY's close, on its own line (Mike, 2026-09-18: "should that line be alone?"): it gets a beat of its
          own and hinges into what a BitGraph is. Bold on his word; equal space above and below keeps it from
          reading as a heading. */}
      <p className="lede"><strong>The most trusted auditors will be the ones whose records don&rsquo;t have to be trusted.</strong></p>
      <p>
        A BitGraph is a verifiable receipt for an AI audit record: a trust record, a log, an evaluation result, an agent&rsquo;s account of its own run. It proves the record is exactly what was committed, gives it a position in a sequence its producer does not control, and ties that sequence to public time. It replaces nothing you already run. It adds the one thing your records cannot give themselves: a provable place outside your system.
      </p>
      <p>
        The BitGraph is a small JSON file you keep alongside the record. Anyone holding both can verify them together, offline, without contacting anyone, forever. The record never leaves your machine; only its fingerprint does. Records get a BitGraph without being shared, and the BitGraph can be stored privately or out in the open: it holds the record&rsquo;s fingerprint, not its contents.
      </p>

      {/* The whole story in one picture, straight after the opening that describes it (Mike, 2026-09-18:
          "should it be ABOVE the heading"); the section below then argues it without interruption. */}
      <BoundaryFigure />

      <section className="home-section" aria-labelledby="h-gap">
        <h2 id="h-gap">What an AI audit cannot prove about itself without a&nbsp;BitGraph</h2>
        <p>
          Systems that prove what an AI ran are good at what happens inside their own boundary. A signed record says what the run claims. An attested runtime says what code ran. A transparency log says what was registered, and in what order it arrived.
        </p>
        <p>
          What none of them can give their own record is a position outside that boundary. The time inside a record is signed by the same key that would sign a backdated one. A log kept by the system under review can be regenerated in full before anyone looks. A freshness window can tell you a record looks too old; it cannot tell you whether the record&rsquo;s claimed time agrees with anything outside it, and a small enough backdate passes any window.
        </p>
        <p>
          In an AI audit, every label refers back to its issuer, the party under review: the time on a record, its place in a log the issuer keeps, the tags attached to it. A label can be changed, removed or moved to another record, and nothing shows it. The exception is a record fused with its BitGraph: the record carries its slot&rsquo;s commitment and the BitGraph carries the record&rsquo;s fingerprint, so changing either one breaks the pair.
        </p>
        <p>
          BitGraph adds that one fact. The position is issued by a separate measured boundary, before the record&rsquo;s fingerprint reaches it, and it cannot be moved afterwards. It is a second ordering signal from a different trust domain, not a replacement for the first.
        </p>
      </section>

      <section className="home-section" aria-labelledby="h-fit">
        <h2 id="h-fit">How it fits into an audit record</h2>
        <p>The commitment goes inside the record before the record is signed, so the finished record depends on a position that existed before it.</p>
        <ol className="steps">
          <li><strong>Take a position.</strong> The system asks BitGraph for a slot and receives the slot&rsquo;s commitment.</li>
          <li><strong>Put the commitment in the record.</strong> It is written into the record like any other field, before signing.</li>
          <li><strong>Sign the record.</strong> Only now does the record&rsquo;s final fingerprint exist.</li>
          <li><strong>Commit the fingerprint to the same slot.</strong> Within two minutes, the slot is consumed and the BitGraph binds the two.</li>
        </ol>
        <p>
          The signed record now contains a commitment to a position that existed before the record&rsquo;s own fingerprint, and that position is committed by this exact record. The record could not have been finished before the slot, and it cannot be moved to another place afterwards. An agent connected over MCP does this for its own task records.
        </p>
      </section>

      <section className="home-section" aria-labelledby="h-verifier">
        <h2 id="h-verifier">What a verifier gets</h2>
        <p>From the record and its BitGraph alone, offline:</p>
        <ul className="facts">
          <li><b>Integrity</b><span>The record in hand is exactly the one that was committed. Change one byte and it no longer matches.</span></li>
          <li><b>Position</b><span>The commitment inside the record points to a slot that existed before the record was signed, and the BitGraph commits this record. A commitment copied from another record fails, because its BitGraph commits a different one.</span></li>
          <li><b>Floor</b><span>The slot names an Ethereum block that had already been mined when the slot was allocated. The record could not have been finished before that block.</span></li>
          <li><b>Origin of the BitGraph</b><span>The signature verifies, and a hardware attestation ties the signing key to a published, reproducible enclave image the verifier chooses to accept.</span></li>
        </ul>
        <h3>Three answers, not two</h3>
        <p>
          A record that carries a commitment has one of three results, in the verifier&rsquo;s own words. <em>Valid</em> when the BitGraph checks out and commits this record. <em>Invalid</em> when a BitGraph is present and contradicts the record. <em>Unverifiable</em> when there is no BitGraph to check. Missing evidence is never read as tampering, and tampering is never read as missing evidence.
        </p>
        <p className="note">
          Verification runs in an open verifier, <code>@mikeargento/bitgraph-verify</code>, with no network call. The <Link href="/docs/verification">verification page</Link> lists every check and what each result means.
        </p>
      </section>

      <section className="home-section" aria-labelledby="h-receipt">
        <h2 id="h-receipt">One run, read as a receipt</h2>
        <p>
          An agent writes a trust record for each task it runs. Before it signs the record it takes a BitGraph position and writes the commitment into the record; once the record is signed, it commits the fingerprint. Illustrative values below, in the shape of a real BitGraph.
        </p>
        <div className="receipt" aria-label="An illustrative BitGraph for one agent run">
          <div className="receipt-head">run-7731.trust-record.json · illustrative · bitgraph/1</div>
          <div className="receipt-row"><b>Fingerprint</b><span>sha256 jYl9NHJP0VcRVh6OMEIU5VAGva6cu5kdrnPrlNr/RnU=</span></div>
          <div className="receipt-row"><b>Slot</b><span className="prose-val">#4,201, allocated unused, signed by the enclave; its commitment is inside the record</span></div>
          <div className="receipt-row"><b>Commit</b><span className="prose-val">#4,202 in the epoch of 15 September 2026 (one UTC day), linked to the position before it</span></div>
          <div className="receipt-row"><b>Floor</b><span className="prose-val">Ethereum block 25,984,342, mined 17:25:47 UTC, signed into the slot</span></div>
          <div className="receipt-row"><b>Ceiling</b><span className="prose-val">anchor #4,210, the next anchor in the sequence</span></div>
          <div className="receipt-row"><b>Enclave</b><span className="prose-val"><span className="mono">measured-tee</span>, PCR0 <span className="mono">eccfc1c7…05c72b</span> (published, reproducible)</span></div>
          <div className="receipt-row"><b>Shows</b><span className="prose-val">This exact signed record contains a commitment to position 4,201 and was committed at position 4,202, after 17:25:47 UTC on 15 September 2026 (block 25,984,342) and before anchor 4,210, by an enclave running the published image.</span></div>
          <div className="receipt-row"><b>Does not show</b><span className="prose-val">That the agent did what the record says, that its output was correct, which model ran, or the exact minute of the run.</span></div>
        </div>
        <p className="note">
          More cases, each with the existing record, the verification problem, and what a BitGraph adds, on the <Link href="/subjects">use cases</Link> page.
        </p>
      </section>

      <section className="home-section" aria-labelledby="h-first">
        <h2 id="h-first">Underneath: one position, used once</h2>
        <p>
          BitGraph allocates an unused position before it receives a record&rsquo;s SHA-256 fingerprint. It then binds the fingerprint to that position and marks it consumed. Unused first, consumed second: the place is fixed before the fingerprint is bound to it.
        </p>
        <StateFigure />
        <h3>Five things, five words</h3>
        <p>
          Every claim on this site is made with these, and each has one name here: what stays on your machine, what crosses to the enclave, what exists there before it arrives, the step that binds the two, and what you keep afterward.
        </p>
        <dl className="terms">
          <dt>The record</dt>
          <dd>Any file: a trust record, a log, an evaluation result, a model output. BitGraph never receives it.</dd>
          <dt>The fingerprint</dt>
          <dd>The record&rsquo;s SHA-256 digest, 32 bytes. The only thing about the record that is sent. Change one byte and the fingerprint changes.</dd>
          <dt>The position</dt>
          <dd>A place in a signed sequence, allocated by the enclave before it has received any fingerprint. The protocol calls an allocated position a <em>slot</em>.</dd>
          <dt>The commit</dt>
          <dd>The single step that binds the fingerprint to the slot, consumes the slot, and signs the result. A slot can be consumed once, and never reused.</dd>
          <dt>The BitGraph</dt>
          <dd>Also called the proof: the signed result of that commit, returned to whoever asked. It carries the signed slot, both counters, the signature, a hardware attestation and the floor.</dd>
        </dl>
        <p>
          A database can also mark a row <em>unused</em> and then <em>consumed</em>. What makes this evidence rather than bookkeeping is who enforces it and what they leave behind. The allocation and the commit both run inside a measured AWS Nitro enclave whose code identity (a hash of the enclave image, called PCR0) is public and reproducible. The slot is signed at allocation, so it provably contains no fingerprint. The commit signature covers a hash of that signed slot, so the slot cannot be swapped afterwards. And every BitGraph carries a hardware attestation that ties the signing key to that enclave image.
        </p>
        <p>
          At a cadence the operator sets, as often as once per Ethereum block, the same enclave makes a BitGraph of the hash of a recent block. Those positions are called anchors. A block hash cannot be known before its block is mined, so an anchor, and everything the sequence placed after it, came after that block. Nothing is written to Ethereum; it is read, as a public clock that no party to a dispute controls. The anchor after a position is its ceiling in the sequence: a place, not a time.
        </p>
      </section>

      <section className="home-section" aria-labelledby="h-limits">
        <h2 id="h-limits">What it leaves unproven</h2>
        <ul className="facts">
          <li><b>Truth</b><span>A record can be wrong in exactly the form it was committed.</span></li>
          <li><b>Behavior</b><span>It does not show that the model or agent did what the record says. That stays with whatever attests the run.</span></li>
          <li><b>Authorship</b><span>The BitGraph names the enclave that committed the fingerprint, not the system or person that wrote the record.</span></li>
          <li><b>Completeness</b><span>A record that was never made leaves no trace, and an unused slot can be abandoned. BitGraph shows the order of what was committed, not that everything was.</span></li>
          <li><b>Exact time</b><span>The floor is a time; the ceiling is a position. There is no wall-clock upper bound, and no field in a BitGraph is a trusted timestamp.</span></li>
          <li><b>A replacement for witnesses</b><span>It adds an ordering signal from a separate trust domain. It does not replace transparency logs, witnesses or the attestation of the run itself.</span></li>
        </ul>
        <p className="note">The full list, with the reasoning, is on the <Link href="/docs/what-bitgraph-is-not">limits</Link> page. The assumptions and failure modes are on the <Link href="/docs/trust-model">trust model</Link>.</p>
      </section>

      <section className="home-section" aria-labelledby="h-next">
        <h2 id="h-next">Where to go next</h2>
        <ul className="doors">
          <li><Link href="/docs/integration">Integration guide</Link><span>Put a commitment in a record, sign it, commit its fingerprint. SDK, CLI and two HTTP calls.</span></li>
          <li><Link href="/docs/mcp">MCP server</Link><span>Connect an agent with one URL. It takes a position before a task and commits its record after.</span></li>
          <li><Link href="/docs/verification">Verification</Link><span>Every check a verifier runs, and what each result means.</span></li>
          <li><Link href="/docs/try">Make a BitGraph</Link><span>Drop any file in your browser. Only its fingerprint leaves your machine, and the BitGraph comes back to you.</span></li>
          <li><Link href="/subjects">Use cases</Link><span>Agent records, evaluations, regulated decisions, and records that cross organizations.</span></li>
          <li><Link href="/docs/trust-model">Trust model</Link><span>What is assumed, what is enforced, what is detected, and what is not.</span></li>
          <li><Link href="/contact">Contact</Link><span>Michael Argento built BitGraph. Licensing, evaluation and questions go here.</span></li>
        </ul>
      </section>
    </div>
  );
}
