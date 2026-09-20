import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Limits",
  description:
    "The limits of a BitGraph proof, stated one by one: not truth, not authorship, not ownership, not first creation, not an exact time, not a universal order. And how BitGraph differs from the systems it is mistaken for.",
};

/**
 * The definitive list of non-claims, then the neighbouring systems. Every
 * page that makes a claim links here for its qualification, so this page
 * states the limits fully and does not soften them.
 */
export default function LimitsPage() {
  return (
    <article className="prose">
      <h1>Limits</h1>
      <p className="lede">
        A BitGraph proof establishes one narrow thing: these exact bytes were committed at this position in one sequence, the position existed before their digest arrived, and the position was placed after the Ethereum block its floor names. A reader tends to assume neighbouring claims. None of them follow, and this page says which ones.
      </p>

      <h2 id="not">Not established by any proof</h2>
      <ul className="facts">
        <li><b>Truth</b><span>A recorded document can be wrong in exactly the form it was recorded. The proof binds bytes, not their meaning.</span></li>
        <li><b>Authorship</b><span>A proof attests the boundary that committed the digest, not the person or program that made the file. A signed attribution is a note bound into the proof, not a verified identity.</span></li>
        <li><b>Ownership</b><span>Nothing in the protocol touches rights. Holding a proof of some bytes says nothing about being entitled to them.</span></li>
        <li><b>First creation</b><span>The same bytes may have existed elsewhere before, and an old file can be committed today. What is fixed is the position the bytes took here. A fused file carries a bound on its own bytes, not on the original it was built from.</span></li>
        <li><b>An exact time</b><span>The floor is a time: the block named in the slot record was mined before the slot existed. The ceiling is a position: the next anchor in the sequence. There is no wall-clock upper bound, and no field in a proof is a trusted timestamp.</span></li>
        <li><b>Completeness</b><span>A record that was never made leaves no trace, and an allocated position can be abandoned unused. What is shown is the order of what was committed, never that everything was.</span></li>
        <li><b>A universal order</b><span>Order is total within one epoch of one sequence. Two unrelated sequences, or two epochs of the same one, are related only through the Ethereum blocks their anchors name, at the resolution of the anchor cadence.</span></li>
        <li><b>That an action occurred</b><span>A record of a delivery, a signing or a decision is placed; whether the thing it describes happened is for whatever produced the record.</span></li>
        <li><b>Physical capture</b><span>The enclave receives a digest. It has no sensor path, so it cannot say a photograph was taken by a camera, or when.</span></li>
        <li><b>Human intent</b><span>Nothing in a proof identifies a person or their intent. The optional agency envelope can bind a device key to a commit; that is actor binding, not authorship.</span></li>
        <li><b>Correct input</b><span>If the client hashes the wrong bytes, or a compromised client hashes whatever it likes, BitGraph positions that digest faithfully.</span></li>
        <li><b>Legal effect</b><span>A proof is evidence a reader can check. Whether a jurisdiction admits it or gives it weight is not something the protocol establishes.</span></li>
      </ul>

      <h2 id="record-vs-fused">Recording existing bytes versus building a fused file</h2>
      <p>
        Recording a file that already exists gives its digest a position. The bound is on the placement: the bytes existed no later than the commit. It says nothing about whether they could have existed before the slot. Building a fused file writes a commitment to the slot into new bytes, so the new bytes could not have been finished before the slot was allocated. That bound reaches the new bytes and stops there: the original inside them can be any age. Neither operation says when the content was made, whether it is authentic, or whether what it describes happened. The <Link href="/docs/overview#fused">overview</Link> shows the difference.
      </p>

      <h2 id="neighbours">Systems BitGraph is mistaken for</h2>
      <p>
        Each of these is good at what happens inside its own boundary, and each labels a record with something that refers back to its issuer: the time on the record, its place in a log the issuer keeps, the tags attached to it. A label can be changed, removed or moved to another record, and nothing shows it. What none of them gives its own record is a position issued outside that boundary.
      </p>
      <div className="table-scroll">
        <table>
          <thead><tr><th>System</th><th>What it establishes</th><th>How BitGraph differs</th></tr></thead>
          <tbody>
            <tr><td className="k">A digital signature</td><td>A key holder endorsed these bytes.</td><td>The signer chooses when to sign and can sign anything at any time. BitGraph&rsquo;s position exists before the digest is received and cannot be occupied twice.</td></tr>
            <tr><td className="k">A timestamp authority</td><td>A trusted party saw this digest at its stated time.</td><td>One-sided, and a trusted third party in the verification path. BitGraph&rsquo;s floor comes from a public block nobody signs; its verification contacts no one.</td></tr>
            <tr><td className="k">Blockchain notarisation</td><td>This digest existed no later than block N.</td><td>Any bytes from any source can be committed after the fact. BitGraph gives a floor as well, from the anchor signed into the slot, and writes nothing to a blockchain.</td></tr>
            <tr><td className="k">A transparency log</td><td>An append-only, publicly audited record of entries, with inclusion and consistency proofs.</td><td>Stronger against equivocation than BitGraph&rsquo;s per-verifier fork check; weaker on the position side, because entries are submitted after they exist.</td></tr>
            <tr><td className="k">Content credentials (C2PA)</td><td>A signed manifest of claims about origin and edits, attached to the file.</td><td>A packaging and disclosure layer that can be stripped in transit. BitGraph is external to the file, survives stripping, and carries no identity of its own. Complementary, not competing.</td></tr>
            <tr><td className="k">A watermark</td><td>A mark hidden in the content.</td><td>BitGraph hides nothing. A fused file&rsquo;s commitment is documented, placed in a registered spot, and the original is never modified.</td></tr>
            <tr><td className="k">DRM</td><td>Control over copying.</td><td>BitGraph prevents nothing. Every copy of the bytes carries the same position, and no copy is the special one.</td></tr>
            <tr><td className="k">A blockchain</td><td>Global consensus over shared transactions.</td><td>No consensus, no tokens, no global order. One boundary constrains one sequence; Ethereum is read as a clock, never written to.</td></tr>
            <tr><td className="k">A freshness window</td><td>A record was seen recently enough to fall inside an accepted window.</td><td>It can say a record looks too old. It cannot say whether the record&rsquo;s claimed time agrees with anything outside it, and a small enough backdate passes any window.</td></tr>
            <tr><td className="k">Hardware attestation alone</td><td>Specific code ran inside specific hardware.</td><td>Attestation is evidence BitGraph carries, per proof. The protocol is the commit path the attestation fits into.</td></tr>
          </tbody>
        </table>
      </div>

      <h2 id="with">What other evidence can add</h2>
      <p>
        These limits are boundaries, not gaps to be papered over. Authorship and intent can be approached with the optional agency envelope, which binds a device key that required user verification to the commit; that raises the claim to &ldquo;this key authorised this commit&rdquo; and no further. Content credentials can ride beside a proof and say who signed a manifest. A transparency log can hold the same digest. None of these convert into BitGraph claims; they are separate evidence a reader may combine, and the proof stays honest about what it alone establishes.
      </p>

      <h2 id="next">Where next</h2>
      <ul className="doors">
        <li><Link href="/docs/trust-model">Trust model</Link><span>The assumptions behind the claims that do hold, and how they fail.</span></li>
        <li><Link href="/docs/verification">Verification</Link><span>What a verifier checks and what each result means.</span></li>
        <li><Link href="/subjects">Use cases</Link><span>Where a position is worth proving despite these limits.</span></li>
      </ul>
    </article>
  );
}
