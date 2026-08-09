import type { Metadata } from "next";
import { CameraExplainer } from "@/components/camera-explainer";

export const metadata: Metadata = {
  title: "Overview",
  description:
    "How a BitGraph is made — the digital frame exists first, and the file exposes it once — and why that is different.",
};

export default function OverviewPage() {
  return (
    <article className="overview" style={{ padding: "0 0 80px", maxWidth: "none" }}>
      {/* ── The camera explainer, whole, moved here from /camera (2026-08-06,
          Mike: "this whole thing to the top of overview left aligned"). The
          axiom is the page's headline, the diagram shows it, the film pair
          closes it, and only then does the prose Overview begin. /camera now
          redirects here and home's title links here. ── */}
      <h1 style={{ margin: "0 0 4px" }}>
        The frame exists first.
      </h1>
      {/* The deck used to read "An exposure cannot come before its frame."
          It was cut once the mechanics moved here: the h1 already makes that
          claim, and the paragraph below makes it again with the substance to
          back it, so the line was the same idea a third time before the reader
          reached anything new.

          Inline styles throughout this block: .overview's own h1/p rules are
          unlayered and would otherwise restyle it (the same trap family as
          .prose-doc, see the 2026-08-03 handoff). */}
      <p style={{ fontSize: 16, lineHeight: 1.75, color: "#1f2937", margin: "18px 0 24px", textWrap: "pretty" }}>
        Digital files have no unique place in space or time. BitGraph first creates a blank digital frame. Your file&rsquo;s exact bits are the light, and the fingerprint they condense to is what exposes that frame. Your data itself never appears in it. Each frame can be exposed only once. The exposed frame becomes a portable record. Anyone with the file and its BitGraph can later verify, bit for bit, that those exact bits exposed that frame.
      </p>
      <CameraExplainer />
      {/* No closing couplet under the diagram. The film pair that used to be
          here now sits inside the two result cells, each half under its own
          subject, so the diagram ends on its own payoff. A line beneath it
          would be the same comparison a second time.

          The prose line that also said it ("Just as a photograph captures
          photons through the constraint of a single frame of film...") was
          removed with it. */}
      {/* The example link lived here briefly and moved to the home page,
          under the drop box: it is the no-commitment alternative to the box's
          ask, so it belongs beside the action it substitutes for. Here it sat
          between the closer and the prose and pulled the reader away exactly
          where the diagram had just paid off. */}
      {/* ── The prose Overview, exactly as it was, a beat down the page. An
          h2 element (one h1 per page) wearing the h1's exact clothes inline,
          because .overview h2 would otherwise shrink it to 1.25rem. ── */}
      <h2 className="bg-page-title" style={{ margin: "72px 0 24px" }}>
        Overview
      </h2>

      <p>
        BitGraphs are not labels or metadata added after the fact. They are new computations created when your file&rsquo;s hash <em>fills</em> a pre-existing cryptographic slot, constraining the commitment so it cannot be retroactively constructed. This occurs entirely off-chain and produces a proof file permanently bound to the original.
      </p>

      <p>
        Origin can be enforced or it can be claimed. Most digital provenance systems claim it. They produce an artifact and then attach a signature, a timestamp, or a metadata block describing where the artifact came from. The claim arrives after the artifact already exists, which is the wrong end of the timeline.
      </p>

      <p>
        BitGraph enforces origin.
      </p>

      <p>
        A measured trusted execution environment creates an unpredictable cryptographic slot before the artifact&rsquo;s hash is known. The artifact&rsquo;s hash arrives later and is bound into the slot. The slot is consumed and cannot be reused. What emerges is not a description of provenance but a proof of construction.
      </p>

      <blockquote>
        This exact digital state was committed through this measured process, in this order, under these constraints.
      </blockquote>

      <h2>The primitive</h2>

      <p>Nonce first. Hash second. Atomic binding third.</p>

      <p>
        The TEE generates hardware entropy inside the enclave. That entropy becomes a slot, signed with the enclave&rsquo;s key, with an identity no attacker could have precomputed. The slot exists as a cryptographic object before any artifact hash has been seen.
      </p>

      <p>
        The artifact hash arrives. The TEE binds the hash into the slot, signs the binding, and advances its internal order. The slot becomes consumed.
      </p>

      <blockquote>
        UNUSED slot exists first. Artifact hash enters later. TEE binds the hash to the slot. Slot becomes CONSUMED. Proof travels with the artifact.
      </blockquote>

      <p>
        The atomicity is the whole guarantee. The slot is allocated and signed before the hash is known. The slot can be consumed exactly once by a single binding operation. The artifact itself can be produced anywhere, by any process, using any tools. What matters is that when the hash arrives, the slot is already there waiting.
      </p>

      <p>
        Most systems say: &ldquo;Here is a file hash. Now let&rsquo;s sign it.&rdquo; BitGraph says: &ldquo;Here is a pre-existing origin slot. Now this file hash has occupied it.&rdquo;
      </p>

      <h2>Why nonce-first matters</h2>

      <p>
        If a nonce, timestamp, or credential is added after the hash is already witnessed, it is just a label. It can prove someone signed something. It can prove a record existed by some moment. It cannot constrain the artifact&rsquo;s origin, because the artifact already existed before the nonce entered the picture.
      </p>

      <p>
        That leaves a forgery window. A malicious actor can prepare old hashes, replay prior material, backfill records, or attach fresh randomness to something never produced through the claimed path. The label looks valid. The construction was never constrained.
      </p>

      <p>
        BitGraph closes the window by requiring the slot to exist first. The slot is not evidence added afterward. It is the condition the artifact must satisfy.
      </p>

      <h2>What a BitGraph proof contains</h2>

      <p>
        A BitGraph proof is a portable proof object, a JSON document, that travels with the artifact. It can include:
      </p>

      <table>
        <thead>
          <tr>
            <th>Component</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Artifact hash</td><td>Identifies the exact file or digital state</td></tr>
          <tr><td>Nonce</td><td>Hardware entropy giving the slot an identity nobody could precompute</td></tr>
          <tr><td>Slot counter</td><td>Shows the slot was allocated before the commit</td></tr>
          <tr><td>Commit counter</td><td>Shows the artifact consumed the slot later</td></tr>
          <tr><td>Epoch ID</td><td>Groups an ordered run of commitments</td></tr>
          <tr><td>Previous hash link</td><td>Connects proofs into a chain</td></tr>
          <tr><td>Signer public key</td><td>Identifies the proof-signing authority</td></tr>
          <tr><td>Signature</td><td>Verifies the proof was issued by the enclave-controlled key</td></tr>
          <tr><td>TEE measurement</td><td>Shows what code and environment produced the proof</td></tr>
          <tr><td>Attestation</td><td>Shows the proof came from measured hardware</td></tr>
          <tr><td>Public anchor</td><td>Tethers BitGraph logical time to a public reference</td></tr>
        </tbody>
      </table>

      <p>
        The result is not &ldquo;a file was signed.&rdquo; It is: this hash was committed into this causal slot, by this measured environment, at this position in logical order, under this signing identity.
      </p>

      <h2>Logical time</h2>

      <p>
        Every proof has order. Every slot and commit has a position. The system can prove that this happened after that, that this slot existed before this hash was bound, that this proof came before the next, that this epoch has an internal cryptographic history.
      </p>

      <p>BitGraph proves causal order. It does not assert a clock time.</p>

      <h2>Ethereum: the backward seal</h2>

      <p>
        BitGraph&rsquo;s internal ordering does not require Ethereum. The chain creates internal order through slot allocation, consumption, counters, signatures, and chained proof history. Ethereum anchors add a different property on top: a public backward seal that any third party can independently verify.
      </p>

      <p>
        An Ethereum block hash that becomes available after the artifact has been committed could not have been known at the moment of commitment. This produces an entropy sandwich:
      </p>

      <ol>
        <li>Private TEE entropy before the artifact.</li>
        <li>Artifact commitment in the middle.</li>
        <li>Public blockchain entropy after it.</li>
      </ol>

      <p>
        The artifact was committed after the TEE-created slot existed and before the later Ethereum block was knowable. That bounds the commitment in adversary-resistant entropy, witnessed in a public timeline anyone can check years later.
      </p>

      <p>
        Ethereum is not asked to prove the artifact&rsquo;s origin. BitGraph does that. Ethereum provides the backward seal that makes the commitment publicly verifiable.
      </p>

      <h2>Compromise and containment</h2>

      <p>
        BitGraph assumes the boundary can be compromised and bounds the damage instead of claiming it cannot happen.
      </p>

      <p>
        The signing key exists only in enclave memory. Every restart destroys it and begins a new epoch with a fresh key and a fresh counter. Proofs from prior epochs were signed by keys that no longer exist, so a compromise cannot reach backward.
      </p>

      <p>
        Forgery requires more than key theft. Every proof carries a hardware attestation whose user_data must equal the hash of that exact proof body, and only the enclave&rsquo;s secure module can produce one. A useful breach must execute inside the running enclave, and it dies at the next restart.
      </p>

      <p>
        Damage control is precise. Every proof names its epoch permanently, so a suspect window is identified exactly: rotate the epoch, publish the affected epochId as quarantined, and every other epoch is untouched. Verifiers that pin measurements and track epochs account for the gap.
      </p>

      <p>
        The production deployment makes rotation routine rather than exceptional: the boundary restarts every day at 23:59 UTC, destroying the epoch key and starting a fresh one, so each epoch is exactly one UTC calendar day. A breach that depends on staying resident inside the enclave cannot outlive the day without freshly re-compromising a new enclave. The schedule is deliberately public: rotation times are visible on the ledger regardless, and the protection comes from the key dying, not from anyone guessing when.
      </p>

      <h2>The trust model</h2>

      <p>
        BitGraph does not depend on blind trust in any single component. Not the operator, the TEE, Ethereum, the clock, a certificate authority, or a live server. Each layer adds an independently verifiable property.
      </p>

      <table>
        <thead>
          <tr>
            <th>Layer</th>
            <th>What it contributes</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>TEE</td><td>Measured execution and protected key use</td></tr>
          <tr><td>Nonce-first slot</td><td>Causal precondition</td></tr>
          <tr><td>Atomic binding</td><td>Prevents post-hoc attachment</td></tr>
          <tr><td>Counters</td><td>Internal logical order</td></tr>
          <tr><td>Proof chain</td><td>Historical continuity</td></tr>
          <tr><td>Ethereum anchor</td><td>Public backward seal</td></tr>
          <tr><td>Epoch rotation</td><td>Damage containment</td></tr>
          <tr><td>Portable verification</td><td>Independence from the original server</td></tr>
        </tbody>
      </table>

      <h2>Multiple copies of the same original</h2>

      <p>
        Physical originality depended on singularity. There was one canvas, one negative, one signed paper, and the object&rsquo;s uniqueness was how you knew it came from the author&rsquo;s hand. Digital files broke that. Perfect copies are indistinguishable from the source, so the physical anchor for originality stopped working.
      </p>

      <p>
        BitGraph restores verifiable originality by separating it from the object. The artifact&rsquo;s hash is the proof&rsquo;s anchor, so any exact copy of the bytes carries the same causal provenance. The proof object itself can travel with the file, stay on the server that issued it, or be stored anywhere, and each can have multiple copies. Verification doesn&rsquo;t depend on where it lives. Originality moves from physical container to causal proof. Singularity is no longer required.
      </p>

      <h2>What BitGraph applies to</h2>

      <p>
        BitGraph works on any digital state that can be hashed. The same primitive applies whether the artifact is a photograph, a contract, a model output, a dataset, or a software release.
      </p>

      <p>
        <strong>Media.</strong> Photos, videos, audio, edited files, generative outputs. The question shifts from &ldquo;is this real?&rdquo; to &ldquo;what origin path does this artifact satisfy?&rdquo;
      </p>

      <p>
        <strong>AI outputs.</strong> Model results bound to authenticated identity and causal position without requiring the model to run inside an enclave.
      </p>

      <p>
        <strong>Software supply chain.</strong> Build artifacts, releases, model weights, and deployment packages bound to a measured construction path.
      </p>

      <p>
        <strong>Legal and clinical records.</strong> Contracts, filings, telehealth session manifests, lab results, and consent forms with independently verifiable causal ordering.
      </p>

      <p>
        <strong>Research and IP.</strong> Datasets, experimental outputs, and possession proofs that commit to a hash without requiring the file to leave the user&rsquo;s device.
      </p>

      <h2>How BitGraph differs from existing approaches</h2>

      <p>
        BitGraph is often confused with adjacent systems. The differences are structural:
      </p>

      <table>
        <thead>
          <tr>
            <th>System</th>
            <th>Says</th>
            <th>BitGraph says</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Signatures</td>
            <td>This key signed this data</td>
            <td>This key was controlled by a measured environment that consumed an unused slot</td>
          </tr>
          <tr>
            <td>Timestamps</td>
            <td>This hash existed by time T</td>
            <td>This hash consumed a pre-existing slot at this position in causal order</td>
          </tr>
          <tr>
            <td>C2PA</td>
            <td>Here are signed claims about this content</td>
            <td>Here is the construction path this content satisfied</td>
          </tr>
          <tr>
            <td>Blockchains</td>
            <td>Public ordering of shared transactions</td>
            <td>Private origin coordinates with optional public anchoring</td>
          </tr>
        </tbody>
      </table>

      <p>
        Signatures, timestamps, content credentials, and blockchains all answer &ldquo;who claimed what, when?&rdquo; BitGraph answers &ldquo;what construction path did this exact artifact satisfy?&rdquo; They are complementary, not competing. A signature can be inside a BitGraph proof. A timestamp can decorate one. Content credentials can ride alongside one. None of them, alone, do what BitGraph does.
      </p>

      <h2>The simplest version</h2>

      <p>
        A measured TEE creates a random unused slot before the artifact hash arrives. The hash arrives. The TEE binds it to the slot, consumes the slot, signs the result, and links it into an ordered chain. Every restart begins a new epoch with a new key, so a compromised boundary is bounded, never retroactive. The same mechanism periodically commits an Ethereum block hash, sealing everything before it in a public timeline.
      </p>

      {/* No page-local footer: the site footer already says Patent Pending,
          and this was the one docs page repeating it. The closing line above
          is the page's last word. */}
      <p>
        The result is a provenance system that does not say &ldquo;someone signed this.&rdquo; It says: this exact artifact occupied this origin coordinate.
      </p>
    </article>
  );
}
