import type { Metadata } from "next";
import Link from "next/link";
import { StateFigure } from "@/components/figures/state-figure";

/**
 * Home orients three readers: the newcomer, the engineer and the sceptic.
 * One column, one rhythm: a heading, prose, a figure where a picture says it
 * better, a plain list where the items are parallel. The full explanation
 * lives at /docs/overview; this page does not repeat it.
 */
export const metadata: Metadata = {
  title: "BitGraph",
  description:
    "A BitGraph is a verifiable receipt for anything digital: check that content matches exactly what was recorded, and see where it sits in a sequence of records. The receipt is a small file you keep, and it verifies offline.",
};

export default function HomePage() {
  return (
    <div className="frame home prose">
      <h1>BitGraph gives bits a&nbsp;place.</h1>
      <p className="home-sub">Create portable proof that is free to verify offline, forever.</p>
      <p className="lede">
        A BitGraph is a verifiable receipt for anything digital. It lets you check that the content matches exactly what was recorded, and see where it sits in a sequence of records. Public time references connect that sequence to <span style={{ whiteSpace: "nowrap" }}>real-world</span> time. It works with documents, photos, logs and AI outputs.
      </p>
      <p>
        The receipt is a small JSON file you keep beside the record. Anyone holding both can check them together, offline, without contacting BitGraph. The record itself never leaves your machine; only its fingerprint does.
      </p>
      {/* The two ways in, as the secondary buttons every action on the site
          wears (2026-09-17). They were a sentence of inline links, which read
          as prose rather than as the page's actions, and gave these two
          destinations different names than the doors at the foot of the page.
          The words are the agreed ones: "Make a BitGraph", never "Try it". */}
      <div className="actions">
        <Link href="/docs/try" className="bg-action-link">Make a BitGraph</Link>
        <Link href="/docs/overview" className="bg-action-link">How it works</Link>
      </div>

      <section className="home-section" aria-labelledby="h-why">
        <h2 id="h-why">Why that is useful</h2>
        <p>
          An AI agent, a build pipeline or a trading system writes its own log, and the log can be rewritten by the same party whose conduct it describes. Whatever the log says about its own time and order is that party&rsquo;s claim. A BitGraph position is issued by a boundary the writer does not control, before the record&rsquo;s fingerprint exists, and it cannot be moved afterwards. An agent connected to BitGraph over MCP can take a position before it starts a task, put the position&rsquo;s commitment into its own record, and commit the record when it finishes.
        </p>
        <p>
          The same holds for any record someone may dispute later: a decision, an evaluation result, a delivery note, a contract draft. The question that arrives later is which version existed when, and in what order. A proof made at the time answers the order question from the file and the proof alone, years later, with no service to consult and no clock to argue about. It says nothing about whether the record was right.
        </p>
        <h3>One example, read as a receipt</h3>
        <p>
          A team keeps a record of each automated loan decision. The record is written by the system that made the decision. Before the system finishes the record it takes a BitGraph position; when the record is final it commits the fingerprint. Illustrative values below, in the shape of a real proof.
        </p>
        <div className="receipt" aria-label="An illustrative proof, read as a receipt">
          <div className="receipt-head">decision-4471.json · illustrative · bitgraph/1</div>
          <div className="receipt-row"><b>Fingerprint</b><span>sha256 jYl9NHJP0VcRVh6OMEIU5VAGva6cu5kdrnPrlNr/RnU=</span></div>
          <div className="receipt-row"><b>Slot</b><span>#4,201, allocated unused, signed by the enclave</span></div>
          <div className="receipt-row"><b>Commit</b><span>#4,202 in the epoch of 15 September 2026 (one UTC day), linked to the position before it</span></div>
          <div className="receipt-row"><b>Floor</b><span>Ethereum block 25,984,342, mined 17:25:47 UTC, signed into the slot record</span></div>
          <div className="receipt-row"><b>Ceiling</b><span>anchor #4,210, the next anchor in the sequence</span></div>
          <div className="receipt-row"><b>Enclave</b><span>measured-tee, PCR0 eccfc1c7…05c72b (published, reproducible)</span></div>
          <div className="receipt-row"><b>Shows</b><span className="prose-val">These exact bytes were committed at position 4,202 of that day&rsquo;s sequence, after 17:25:47 UTC on 15 September 2026 (block 25,984,342) and before anchor 4,210, by an enclave running the published image.</span></div>
          <div className="receipt-row"><b>Does not show</b><span className="prose-val">That the decision was correct, who wrote the record, that no earlier draft existed elsewhere, or the exact minute of the commit.</span></div>
        </div>
        <p className="note">
          More cases, each with the existing record, the verification problem, and what the proof adds, on the <Link href="/subjects">use cases</Link> page.
        </p>
      </section>

      <section className="home-section" aria-labelledby="h-first">
        <h2 id="h-first">What happens first, and what happens afterward</h2>
        <p>
          BitGraph allocates an unused position before it receives a file&rsquo;s SHA-256 fingerprint. It then binds the fingerprint to that position and marks it consumed. Unused first, consumed second: the place is fixed before the fingerprint is bound to it.
        </p>
        <StateFigure />
        <h3>Five things, five words</h3>
        <p>
          Every claim on this site is made with these, and each has one name here: what stays on your machine, what crosses to the enclave, what exists there before it arrives, the step that binds the two, and what you keep afterward. Keep them apart and the rest of the site reads easily.
        </p>
        <dl className="terms">
          <dt>The file</dt>
          <dd>Any bytes: a document, a photo, a log, a decision record an agent wrote. BitGraph never receives it.</dd>
          <dt>The fingerprint</dt>
          <dd>The file&rsquo;s SHA-256 digest, 32 bytes. The only thing about the file that is sent. Change one byte and the fingerprint changes.</dd>
          <dt>The position</dt>
          <dd>A place in a signed sequence, allocated by the enclave before it has received any fingerprint. The protocol calls an allocated position a <em>slot</em>.</dd>
          <dt>The commit</dt>
          <dd>The single step that binds the fingerprint to the slot, consumes the slot, and signs the result. A slot can be consumed once, and never reused.</dd>
          <dt>The proof</dt>
          <dd>The signed record of that commit, returned to whoever asked. It carries the slot record, both counters, the signature, a hardware attestation and the floor.</dd>
        </dl>
        <p>
          A database can also mark a row <em>unused</em> and then <em>consumed</em>. What makes this evidence rather than bookkeeping is who enforces it and what they leave behind. The allocation and the commit both run inside a measured AWS Nitro enclave whose code identity (a hash of the enclave image, called PCR0) is public and reproducible. The slot record is signed at allocation, so it provably contains no fingerprint. The commit signature covers a hash of that slot record, so the slot cannot be swapped afterwards. And every proof carries a hardware attestation that ties the signing key to that enclave image. A verifier does not take the words <em>unused</em> and <em>consumed</em> on trust; it checks the signatures, the binding and the attestation itself.
        </p>
      </section>

      <section className="home-section" aria-labelledby="h-check">
        <h2 id="h-check">What the proof lets someone else check</h2>
        <p>From the proof and the file alone, offline:</p>
        <ul className="facts">
          <li><b>Identity</b><span>The file in hand has exactly the fingerprint the proof names.</span></li>
          <li><b>Order</b><span>The slot was allocated before the commit that consumed it, and the proof links to the position before it.</span></li>
          <li><b>Origin of the proof</b><span>The signature verifies, and the attestation chains to the AWS Nitro root for an enclave image the verifier chooses to accept.</span></li>
          <li><b>Floor</b><span>The proof names an Ethereum block that had already been mined when the slot was allocated. The position was placed after that block&rsquo;s time.</span></li>
        </ul>
        <p>
          At a cadence the operator sets, as often as once per Ethereum block, the same enclave makes a BitGraph of the hash of a recent block. Those positions are called anchors. A block hash cannot be known before its block is mined, so an anchor, and everything the sequence placed after it, came after that block. Nothing is written to Ethereum; it is read, as a public clock that no party to a dispute controls. The anchor after a position is its ceiling in the sequence: a place, not a time.
        </p>
        <p className="note">
          Verification runs in an open verifier, <code>@mikeargento/bitgraph-verify</code>, with no network call. The <Link href="/docs/verification">verification page</Link> lists every check and what each result means.
        </p>
      </section>

      <section className="home-section" aria-labelledby="h-limits">
        <h2 id="h-limits">What it leaves unproven</h2>
        <ul className="facts">
          <li><b>Truth</b><span>A record can be wrong in exactly the form it was committed.</span></li>
          <li><b>Authorship</b><span>The proof names the enclave that committed the fingerprint, not the person or program that made the file.</span></li>
          <li><b>First creation</b><span>The same bytes may have existed elsewhere earlier. The position bounds when they were placed here, not when they were made.</span></li>
          <li><b>Exact time</b><span>The floor is a time; the ceiling is a position. There is no wall-clock upper bound, and no field in a proof is a trusted timestamp.</span></li>
          <li><b>A universal order</b><span>Positions are ordered within one BitGraph sequence. Two unrelated sequences are related only through the Ethereum blocks their anchors name.</span></li>
        </ul>
        <p className="note">The full list, with the reasoning, is on the <Link href="/docs/what-bitgraph-is-not">limits</Link> page. The assumptions and failure modes are on the <Link href="/docs/trust-model">trust model</Link>.</p>
      </section>

      <section className="home-section" aria-labelledby="h-next">
        <h2 id="h-next">Where to go next</h2>
        <ul className="doors">
          <li><Link href="/docs/try">Make a BitGraph</Link><span>Drop any file in your browser. Only its fingerprint leaves your machine, and the proof comes back to you.</span></li>
          <li><Link href="/docs/overview">How it works</Link><span>The full explanation: the state transition, fused files, anchors and time, epochs.</span></li>
          <li><Link href="/docs/integration">Integration guide</Link><span>What to send, what comes back, what to store. SDK, CLI and two HTTP calls.</span></li>
          <li><Link href="/docs/mcp">MCP server</Link><span>Connect an agent with one URL and let it make proofs of its own files.</span></li>
          <li><Link href="/docs/trust-model">Trust model</Link><span>What is assumed, what is enforced, what is detected, and what is not.</span></li>
          <li><Link href="/contact">Contact</Link><span>Michael Argento built BitGraph. Licensing, evaluation and questions go here.</span></li>
        </ul>
      </section>
    </div>
  );
}
