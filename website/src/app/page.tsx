import type { Metadata } from "next";
import Link from "next/link";

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
        A BitGraph is a small JSON file you keep alongside the record. It is a verifiable receipt for an AI audit record: a trust record, a log, an evaluation result, an agent&rsquo;s account of its own run. It proves the record is exactly what was committed, gives it a position in a sequence its producer does not control, and ties that sequence to public time. It replaces nothing you already run. It adds the one thing your records cannot give themselves: a provable place outside your system.
      </p>
      <p>
        Anyone holding the record and its BitGraph can verify them together, offline, without contacting anyone, forever. The record never leaves your machine; only its fingerprint does. Records get a BitGraph without being shared, and the BitGraph can be stored privately or out in the open: it holds the record&rsquo;s fingerprint, not its contents.
      </p>

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

      <section className="home-section" aria-labelledby="h-next">
        <h2 id="h-next">Where to go next</h2>
        <ul className="doors">
          {/* Restored first (Mike, 2026-09-18: "shouldnt this have a link to the how it works? Learn more?"): home is the
              summary of Understand, and this is its full version. It was the one home link to /docs/overview kept on
              09-17 when the top buttons came out; the AI-audit rewrite (12fcba6c) dropped it by accident. The label is
              the menu's, not "Learn more", so the row names where it goes like every other row. */}
          <li><Link href="/docs/overview">How it works</Link><span>The full explanation: the slot, fused records, anchors and time, epochs.</span></li>
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
