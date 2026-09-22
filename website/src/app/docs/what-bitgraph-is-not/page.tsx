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

      <h2 id="catches">What a BitGraph proof catches, and what it does not</h2>
      <div>
        <p>
          Five things someone can do to a record, and whether the BitGraph proof shows it. Two of the five it shows, one it shows only in part, and two it cannot see at all.
        </p>
        <div className="table-scroll">
          <table className="verdict-table">
            <thead><tr><th>What is done to the record</th><th>Does the BitGraph proof show it?</th></tr></thead>
            <tbody>
              <tr><td className="k">A false record is written, then committed</td><td className="v-no"><b className="v-word">No.</b> A false record is committed exactly like a true one. Nothing in a proof inspects content.</td></tr>
              <tr><td className="k">The record is changed after it was committed</td><td className="v-yes"><b className="v-word">Yes.</b> The bytes no longer hash to the committed fingerprint, so the check fails for anyone holding the record and the proof.</td></tr>
              <tr><td className="k">The record is claimed to be older than it is</td><td className="v-yes"><b className="v-word">Yes.</b> The slot names an Ethereum block that had already been mined, so the position cannot be moved earlier than that block.</td></tr>
              <tr><td className="k">The record is destroyed after it was committed</td><td className="v-part"><b className="v-word">In part.</b> The position stays in the sequence, so its absence is visible. What the record said is gone.</td></tr>
              <tr><td className="k">The record is never written at all</td><td className="v-no"><b className="v-word">No.</b> Nothing that was never committed leaves a trace.</td></tr>
            </tbody>
          </table>
        </div>
        <p>
          The second row is the one that is hard to settle without evidence like this. In August 2026 METR published an independent investigation into the incident in which OpenAI agents attacked Hugging Face. Agents there worked at editing their own transcript logs after the fact, and the investigators reported detecting no case where that succeeded while stating they could not rule one out, partly because the container resets the agents were trying to trigger would themselves have erased the evidence. That is the question a committed position answers, and it is answered by the reader rather than by an investigator with privileged access. <a href="https://metr.org/blog/2026-08-26-openai-hugging-face-incident-investigation/">The report is here</a>. METR has no association with BitGraph and proposes no remedy of this kind.
        </p>
      </div>

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
            <tr><td className="k">A secure clock</td><td>A server or a piece of hardware signs the time it reports, and chained requests can catch a server whose answers disagree.</td><td>A signed reading is still an assertion by whoever holds the clock, and it is applied to bytes that already exist. BitGraph reads time from a block nobody signs, and the position it gives out exists before the bytes&rsquo; fingerprint reaches it.</td></tr>
            <tr><td className="k">Blockchain notarization</td><td>This digest existed no later than block N.</td><td>Any bytes from any source can be committed after the fact. BitGraph gives a floor as well, from the anchor signed into the slot, and writes nothing to a blockchain.</td></tr>
            <tr><td className="k">A beacon and blockchain sandwich</td><td>A portable proof holding a public randomness value and a blockchain anchor: the proof was assembled after that value was published, and the record existed by that block.</td><td>The closest neighbour, and the bounds sit differently. Its lower bound covers the assembly of the proof rather than the record, because nothing is issued to the holder before they submit, so the record itself can carry nothing. BitGraph allocates the position first, signs it, and returns it before the digest arrives.</td></tr>
            <tr><td className="k">A transparency log</td><td>An append-only, publicly audited record of entries, with inclusion and consistency proofs.</td><td>Stronger against equivocation than BitGraph&rsquo;s per-verifier fork check; weaker on the position side, because entries are submitted after they exist.</td></tr>
            <tr><td className="k">A hash-chained audit log</td><td>Each entry commits to the one before it, so altering an entry breaks every link after it.</td><td>It detects an edit, not a rebuild. Whoever holds the log can recompute the whole chain and present a consistent one, unless the head was published somewhere they cannot reach. Publishing the head outside the operator is what BitGraph does for every proof.</td></tr>
            <tr><td className="k">A ledger database</td><td>Rows in a table are hash-chained inside the database, so an altered or deleted row is detectable there.</td><td>The chain is built and held by the operator running the database, and its head goes nowhere else. Whoever can rewrite the history can rewrite the chain over it. BitGraph&rsquo;s sequence is signed inside a measured enclave and its anchors read a public chain, so the operator is not the witness.</td></tr>
            <tr><td className="k">Write-once storage</td><td>Stored bytes cannot be overwritten or deleted until a retention period expires.</td><td>It prevents an edit in the place the bytes are kept and says nothing about when they were made. The guarantee belongs to the operator and does not travel with a copy. BitGraph keeps its own copy this way for the same reason anyone would, and no claim in a proof rests on it: a proof is checked against bytes you hold.</td></tr>
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
