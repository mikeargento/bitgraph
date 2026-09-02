import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Overview",
  description:
    "How a BitGraph is made: the position is reserved before your file's fingerprint arrives, and consumed once. Why that is different from signing something afterward.",
};

export default function OverviewPage() {
  return (
    <article className="overview" style={{ padding: "0 0 80px", maxWidth: "none" }}>
      {/* ── The mechanics, in plain terms, then the prose Overview. This block
          used to open with the six-card film/photograph diagram (components/
          camera-explainer.tsx, deleted 2026-08-18, recoverable from ff99b437).

          Mike cut it, and the reason is worth keeping: the analogy's payoff
          line was "BitGraph is film for data", but film RECORDS THE LIGHT and
          BitGraph does not record the file. Only the digest crosses the
          boundary. The intro paragraph had to walk the slogan back one sentence
          after making it ("your file's exact bits are the light" ... "your data
          itself never appears in it"), which is the tell that an analogy is
          costing more than it earns: a reader who keeps only the slogan keeps
          something false, about the exact thing buyers care most about.

          Two of the six steps were also inert. "Ones and zeros are everywhere,
          unwitnessed" states no fact, and the lens mapping ran backwards, since
          a lens focuses light but a file condenses nothing, the hash does.

          What the analogy WAS uniquely good at is the frame existing before the
          exposure, i.e. allocate-before-bind, which is the counterintuitive
          mechanic and the whole difference from sign-it-afterward systems. That
          survives here in words, and if it ever wants a picture again the thing
          to draw is the slot strip alone (reserved, occupied, next) with no film
          vocabulary anywhere on it. Not six cards.

          ⚠️ THE POLAROID OPENER CAME AND WENT (built 2026-08-18, cut
          2026-08-26 on Mike's word). Three paragraphs stood here: the
          who/when/where Polaroid, "every copy is the same file", and a
          position-in-a-public-sequence summary. On 08-18 they earned the slot
          by doing what the rest of the page could not; on 08-26 home grew its
          own porch (the under-box what-happens line, and "Hashed in your
          browser, never uploaded" in the frame), so the opener's jobs moved
          one page upstream and the duplication argument that killed the
          mechanics opener now killed the Polaroid too. Two organs were kept:
          the who/when/where separation (the one job nothing else on the page
          does: signatures answer who, timestamps answer when, nobody else
          answers where) compressed into the triad below, and "your file never
          leaves your device", transplanted into the first prose paragraph for
          readers who arrive without passing home. Do not rebuild the Polaroid
          or any film vocabulary here; if a picture is ever wanted, draw the
          slot strip (see above).

          ⚠️ Do not re-explain "sequence" (Mike, 2026-08-18: "i hate this"): a
          position in a sequence is ordered by definition. The ordering payoff
          lives in the Logical time section.

          Inline styles here: .overview's own h1/p rules are unlayered and
          would otherwise restyle these (same trap family as .prose-doc, see
          the 2026-08-03 handoff). ── */}
      {/* 24 below the h1: the 4px it wore before was paid for by the opener
          paragraph's own 18px top margin, and the opener is gone. */}
      <h1 style={{ margin: "0 0 24px" }}>
        A BitGraph gives bits a place.
      </h1>
      {/* The who/when/where triad lived here for one evening (2026-08-26,
          built with the Polaroid cut, removed the same night, Mike: "just
          cut this"). It fought its typography all evening (an orphaned
          "where", a mid-sentence balance break, a word swap that missed the
          column by 5px) and the fight outweighed the line. The separation it
          stated is still made where the prose does the work: claimed-vs-
          enforced covers who, and the forgery-window and wall-clock sections
          cover when. The h1 now opens straight onto "BitGraphs are not
          labels", which was Mike's original instinct for this page. */}
      {/* ⚠️ THE H1 IS THE THESIS, AND IT APPEARS ONCE (Mike, 2026-08-18).
          It spent an hour as a bolded standalone line at the foot of this
          opener, under an h1 reading "Who, when, and where are different
          facts". Mike moved it up. The objection to promoting it was that the
          title poses the question the tagline answers, so moving the answer up
          leaves nothing asking; that was a false choice, because the question
          moved into the body as the paragraph's first sentence, where it still
          does the Content Credentials work (they answer who, timestamps answer
          when, nobody answers where). A docs page states its claim and then
          proves it rather than withholding it for four paragraphs. Do NOT
          restore the standalone copy underneath: one instance, in the h1.

          It also briefly sat in the prose below as a replacement for "BitGraph
          enforces origin", which does not work: that paragraph sets up
          enforced-versus-claimed, so its payoff has to land on one of those two
          words or the setup dangles. "Enforces" folded into the paragraph that
          follows the setup instead.

          ⚠️ "ORIGIN" WAS RETIRED FROM THIS PAGE, 2026-08-18. Not a style
          preference: origin implies FIRST EXISTENCE, and BitGraph does not
          prove that. An old file can be committed into a slot allocated this
          minute. The proof fixes where the commitment sits, never when the
          bytes were made, and the forgery-window paragraph now says so out
          loud. The vocabulary is place -> position -> slot -> occupy -> order,
          and every other word (provenance, originality, construction) may
          describe a consequence of that primitive but must not compete with
          it. "Proof of construction" went the same way and for the same
          reason: it contradicted "the artifact itself can be produced
          anywhere, by any process, using any tools" two sections down.
          "Original" and "originality" survive only in the copies section,
          where they mean uniqueness of an object, a different idea. */}
      {/* ── The prose Overview follows the triad directly. The "Overview" h2
          that stood here left with the Polaroid opener (2026-08-26): with no
          opener above it, a page-width "Overview" title directly under the h1
          was furniture. ── */}
      <p>
        BitGraphs are not labels or metadata added after the fact. They are new computations created when your file&rsquo;s hash <em>fills</em> a pre-existing cryptographic slot, constraining the commitment so it cannot be retroactively constructed. This occurs entirely off-chain and produces a proof permanently bound to that exact digital state. Your file never leaves your device to get one.
      </p>

      <p>
        Provenance can be enforced or it can be claimed. Most systems claim it: they bind a statement about the content to the content itself. That binding can be cryptographically strong, and it can be made at the moment of capture rather than afterward, so the weakness is not timing. The weakness is that a claim is something a trusted signer can attach to any artifact at all. The artifact does not have to satisfy any prior condition to receive one.
      </p>

      <p>
        BitGraph enforces it instead. A measured trusted execution environment creates an unpredictable cryptographic slot before the artifact&rsquo;s hash reaches it. The artifact&rsquo;s hash arrives later and is bound into the slot. The slot is consumed and cannot be reused. What emerges is not a description of provenance but a proof of placement.
      </p>

      <blockquote>
        This exact digital state was committed through this measured process, in this order, under these constraints.
      </blockquote>

      <h2>The primitive</h2>

      <p>Nonce first. Hash second. Atomic binding third.</p>

      <p>
        The TEE generates hardware entropy inside the enclave. That entropy becomes a slot, signed with the enclave&rsquo;s key, with an identity that could not feasibly have been predicted. The slot exists as a cryptographic object before it has seen any artifact hash.
      </p>

      <p>
        The artifact hash arrives. The TEE binds the hash into the slot, signs the binding, and advances its internal order. The slot becomes consumed.
      </p>

      <blockquote>
        UNUSED slot exists first. Artifact hash enters later. TEE binds the hash to the slot. Slot becomes CONSUMED. Proof travels with the artifact.
      </blockquote>

      <p>
        The atomicity is the whole guarantee, and it constrains the record rather than the artifact. The artifact itself can be produced anywhere, by any process, using any tools. What matters is that when the hash arrives, the slot is already there waiting.
      </p>

      <p>
        Most systems begin with the bits. BitGraph begins with the place. They say: &ldquo;Here is a file hash. Now let&rsquo;s sign it.&rdquo; BitGraph says: &ldquo;Here is a pre-existing position. Now this file hash has occupied it.&rdquo;
      </p>

      <h2>Why nonce-first matters</h2>

      <p>
        If a nonce, timestamp, or credential is added after the hash is already witnessed, it is just a label. It can prove someone signed something. It can prove a record existed by some moment. It cannot impose a prior condition merely by being attached afterward. The credential may describe where the artifact came from, but the artifact never had to consume a pre-existing, single-use position in order to receive one.
      </p>

      <p>
        That leaves a forgery window. A malicious actor can prepare old hashes, replay prior material, backfill records, or attach fresh randomness to something never produced through the claimed path. The label looks valid. Nothing had to be true before it was attached.
      </p>

      <p>
        BitGraph narrows that window by requiring the slot to exist first. It does not stop an old file being committed today: the hash occupies a slot allocated today, and the position claims nothing about when the bytes were made. What it stops is a position being invented after the fact, or occupied twice. The slot is not evidence added afterward. It is the condition the artifact must satisfy.
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
          <tr><td>Nonce</td><td>Hardware entropy giving the slot an identity that cannot feasibly be predicted</td></tr>
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
        Taken together: this hash was committed into this causal slot, by this measured environment, at this position in logical order, under this signing identity.
      </p>

      <h2>Logical time</h2>

      <p>
        Every proof has order. Every slot and commit has a position. The system can prove that this happened after that, that this slot existed before this hash was bound, that this proof came before the next, that this epoch has an internal cryptographic history.
      </p>

      <p>BitGraph proves causal order. It does not assert a clock time.</p>

      <h2>Establishing wall clock time</h2>

      <p>
        BitGraph&rsquo;s internal ordering does not require Ethereum. The chain creates internal order through slot allocation, consumption, counters, signatures, and chained proof history. What that order lacks, on its own, is a clock. The enclave keeps no trusted one; any clock reading inside a proof is advisory.
      </p>

      <p>
        Ethereum is where the order meets the wall clock. An anchor is an ordinary proof on the same chain whose artifact is the hash of a recent Ethereum block. A block hash does not exist before its block is produced, so the anchor, and every proof chained after it, came after that block and its public date. Anchors recur throughout every epoch. This is the wall-clock statement every proof page shows, and it runs in one direction: provably no earlier than. The other side of the window narrows through the chain&rsquo;s cadence, measured enclave behavior rather than public data, which is why it is narrowed, not closed.
      </p>

      <p>
        The anchors also fix history backward, through content. Each anchor is hash-linked to everything before it, so once an anchor exists, the history behind it is fixed: alter any earlier proof and the chain no longer reaches the anchor. When the epoch ends, its signing key is destroyed, and the set closes.
      </p>

      <p>
        Ethereum is not asked to be a good source of randomness, and it is not asked to establish the artifact&rsquo;s position. BitGraph establishes the position. Ethereum ties the positions to the public timeline, so anyone, years later, can check the order and the earliest date each position could have existed.
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
        The production deployment makes rotation routine rather than exceptional: the boundary restarts every day at 23:59 UTC, destroying the epoch key and starting a fresh one, so a normally operating epoch runs about a day. An unexpected restart ends one early and a failed rotation extends one; either way the boundary is recorded in the proofs themselves. A breach that depends on staying resident inside the enclave cannot outlive its epoch without freshly re-compromising a new one. The schedule is deliberately public: rotation times are visible on the ledger regardless, and the protection comes from the key dying, not from anyone guessing when.
      </p>

      <h2>The trust model</h2>

      <p>
        BitGraph does not ask for blind trust in any single component. It has real dependencies, and the point is that each one is inspectable rather than assumed: the enclave&rsquo;s attestation chains to the AWS Nitro Attestation PKI root, and the measurement it carries is published, so both are things you check rather than things you take on faith. Each layer adds an independently verifiable property.
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
          <tr><td>Ethereum anchor</td><td>Public wall-clock bound</td></tr>
          <tr><td>Epoch rotation</td><td>Damage containment</td></tr>
          <tr><td>Portable verification</td><td>Independence from the original server</td></tr>
        </tbody>
      </table>

      <h2>Every copy carries the same position</h2>

      <p>
        Physical originality depended on singularity. There was one canvas, one negative, one signed paper, and the object&rsquo;s uniqueness was how you knew it came from the author&rsquo;s hand. Digital files broke that. Perfect copies are indistinguishable from the source, so the physical anchor for originality stopped working.
      </p>

      <p>
        BitGraph does not restore originality. It makes it unnecessary. The artifact&rsquo;s hash is the proof&rsquo;s anchor, so any exact copy of the bytes carries the same position, and no copy has to be the special one. The proof object itself can travel with the file, stay on the server that issued it, or be stored anywhere, and each of those can have copies too. Verification does not depend on where anything lives. What used to need a unique object now needs only the exact bytes.
      </p>

      <h2>What BitGraph applies to</h2>

      <p>
        BitGraph works on any digital state that can be hashed. The same primitive applies whether the artifact is a photograph, a contract, a model output, a dataset, or a software release.
      </p>

      <p>
        <strong>Media.</strong> Photos, videos, audio, edited files, generative outputs. The question shifts from &ldquo;is this real?&rdquo; to &ldquo;what position does this exact digital state occupy?&rdquo;
      </p>

      <p>
        <strong>AI outputs.</strong> Model results bound to a causal position, and optionally to a key that authorized the recording, without requiring the model to run inside an enclave.
      </p>

      <p>
        <strong>Software supply chain.</strong> Build artifacts, releases, model weights, and deployment packages bound to a position in a measured sequence.
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
            <td>This exact digital state occupied this pre-existing position</td>
          </tr>
          <tr>
            <td>Blockchains</td>
            <td>Public ordering of shared transactions</td>
            <td>Ordering established inside a measured enclave, then anchored publicly</td>
          </tr>
        </tbody>
      </table>

      <p>
        Signatures, timestamps, content credentials, and blockchains all answer &ldquo;who claimed what, when?&rdquo; BitGraph answers &ldquo;what position does this exact digital state occupy?&rdquo; They are complementary, not competing. A signature can be inside a BitGraph proof. A timestamp can decorate one. Content credentials can ride alongside one. None of them, alone, do what BitGraph does.
      </p>

      <h2>The simplest version</h2>

      {/* No page-local footer: the site footer already says Patent Pending,
          and this was the one docs page repeating it. The closing line above
          is the page's last word. */}
      <p style={{ marginBottom: "0.75rem" }}>
        The result is a protocol that does not say &ldquo;someone signed this.&rdquo;
      </p>
      {/* The page's last word, and the only bold statement line on it now that
          the tagline is the h1. Same treatment the tagline carried when it sat
          in the opener: weight 600 at the heading colour, NOT a new size. The
          setup above it is tightened to 0.75rem so the pair reads as one beat
          rather than two paragraphs that happen to be adjacent. */}
      <p style={{ fontWeight: 600, color: "#111827" }}>
        It proves: these exact bits occupy this position.
      </p>
    </article>
  );
}
