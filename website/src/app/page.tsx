import type { Metadata } from "next";
import { MechanismFigure } from "@/components/mechanism-figure";
import { CopyCode } from "@/components/copy-code";

/**
 * The home page (2026-10-27): BitGraph sold as a mechanism to companies that already sell proof. It says what the
 * mechanism is, what it adds under an existing product, that the evidence checks without us, and the paths to evaluate
 * and license it. The claims are the Technology page's, short; each is in the v13 enclave and the verifier.
 *
 * ⚠️ Claim discipline, unchanged: bound by a time and after an unpredictable value, never "created at"; it says when
 * bits were bound, not how old they are or who made them.
 */

const DESCRIPTION =
  "Send a hash. Get a proof that stands on its own. Your customers can verify it independently, offline, without relying on your servers or ours. One call. No new infrastructure. Your product, backed by evidence anyone can check.";

export const metadata: Metadata = {
  title: { absolute: "BitGraph: a stronger proof for the products you already sell" },
  description: DESCRIPTION,
  openGraph: { title: "Every proof you issue just got stronger.", description: DESCRIPTION },
  twitter: { title: "Every proof you issue just got stronger.", description: DESCRIPTION },
};

const PROPERTIES = [
  { title: "Unpredictable position", body: "Each record takes the count right after a fresh nonce from the hardware's random number generator, drawn after the digest arrives. A position cannot be reserved ahead and filled later." },
  { title: "Enforced binding", body: "Nonce and digest are signed together in one indivisible action. If any step fails, nothing is released and the counter does not move. No count is ever given out twice." },
  { title: "Verifiable sequence", body: "Every record carries the hash of the one before it. Counts climb in order, gaps show, and anything bound between two records was bound after the first and before the second." },
  { title: "Portable evidence", body: "Each proof carries an AWS Nitro attestation naming the published, reproducible enclave build that made it. It checks offline with an open-source verifier, without asking us." },
];

const RELIEF = [
  { title: "One call.", body: "Send a SHA-256 over HTTP, the SDK or MCP. No new infrastructure, nothing to host." },
  { title: "Your files stay yours.", body: "Only the 32-byte digest leaves your systems. We never see the content." },
  { title: "Proofs outlive us.", body: "Each one checks offline with an open-source verifier, even if BitGraph disappeared tomorrow." },
  { title: "Any size.", body: "A million records bind as one in 6 seconds, measured, and each still checks on its own." },
  { title: "Your brand, your customers.", body: "BitGraph sits underneath. Nobody has to learn a new product." },
  { title: "Pay for records, not servers.", body: "Usage-based through the service, or a license to run it yourself." },
];

const FITS = [
  { href: "/applications#c2pa", title: "Content Credentials", body: "Bind the asset and its manifest together: the credential gains an independent recording." },
  { href: "/applications#watermark", title: "Finding the original", body: "A copy finds the record, by watermark or by looks; the original's bytes prove it." },
  { href: "/applications#capture", title: "Trusted capture", body: "How it was captured, plus when its bytes were recorded." },
  { href: "/applications#ai", title: "AI agents and audit", body: "Two records bracket a run, every record between them in counted order." },
];

export default function HomePage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page">
      <section className="sx-hero" aria-labelledby="home-h">
        {/* The first screen says what the buyer gains (2026-10-28): they already issue proofs; now each one rests on hardware,
            in one call, with nothing to run. Competent already, stronger now. */}
        <h1 id="home-h">Every proof you issue<br />just got&nbsp;stronger.</h1>
        <p className="sx-sub">
          Send a hash. Get a proof that stands on its own. Your customers can verify it independently, offline, without relying on
          your servers or ours. One call. No new infrastructure. Your product, backed by evidence anyone can check.
        </p>
        <div className="sx-cta">
          <a className="bg-action-link is-make" href="/evaluate">See it work in two minutes</a>
          <a className="bg-action-link" href="/technology">How it works</a>
          <a className="bg-action-link" href="/proof/MXkV_2WRyBSlQV_BdOio2gc1NSrd2Wxl8zW0OrACCDk?counter=26&epoch=NihRUA1VRsV4cqmwWDO_4viNR7YhJRdCb75lGASeV3E">View a proof</a>
        </div>
      </section>

      <section className="home-section" aria-labelledby="home-easy">
        <p className="home-kicker">Nothing changes but the proof</p>
        <h2 id="home-easy">Keep your product. Upgrade your&nbsp;proof.</h2>
        <div className="sx-cards is-3">
          {RELIEF.map((r) => (
            <article key={r.title} className="tl-card">
              <h3>{r.title}</h3>
              <p>{r.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-section" aria-labelledby="home-mech">
        <p className="home-kicker">The mechanism</p>
        <h2 id="home-mech">The recording step is what matters.</h2>
        <p>
          A signature proves a key signed. A timestamp authority vouches for a time. Content Credentials carry a signer&rsquo;s
          assertions. BitGraph constrains the recording itself: a specific, published enclave build binds each digest at a counted,
          chained position, and the hardware attests to every proof.
        </p>
        <MechanismFigure />
        <div className="sx-cards">
          {PROPERTIES.map((p) => (
            <article key={p.title} className="tl-card">
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-section" aria-labelledby="home-fit">
        <p className="home-kicker">Applications</p>
        <h2 id="home-fit">Where it fits in what you already&nbsp;sell.</h2>
        <p>
          BitGraph does not compete with your product; it strengthens the evidence it produces. Your system sends a digest and keeps
          the proof beside its own record. Your customers, brand and interface stay yours.
        </p>
        <div className="sx-cards is-2x2">
          {FITS.map((f) => (
            <a key={f.href} className="tl-card sx-link" href={f.href}>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </a>
          ))}
        </div>
        <p className="sx-fine" style={{ marginTop: 16 }}>Integration patterns, not announced partnerships. <a href="/applications">All applications</a>.</p>
      </section>

      <section className="home-section" aria-labelledby="home-verify">
        <div className="sx-split">
          <div>
            <p className="home-kicker">Verification</p>
            <h2 id="home-verify">The evidence travels.</h2>
            <p>
              A proof is a small JSON file. With the data it covers, anyone can check it on their own machine: the AWS signature and
              certificate chain, the enclave&rsquo;s published measurement, the digest, the signature, the position. Nothing of BitGraph
              has to be running.
            </p>
            <div className="sx-cta"><a className="bg-action-link" href="/evaluate">Verify a real proof</a></div>
          </div>
          <div>
            <div className="code-block mk-code">
              <pre className="hiw-code">{`$ npx @mikeargento/bitgraph-sdk verify sample.txt \\
    --proof sample.txt.bitgraph.json
TRUE

  These exact bytes are file 2 of a tree of 2,
  whose root was bound by BitGraph's published
  enclave image v13, as the AWS Nitro hardware
  attests, at 2026-10-21T01:37:40.960Z.`}</pre>
              <CopyCode />
            </div>
          </div>
        </div>
      </section>

      <section className="home-section" aria-labelledby="home-scale">
        <p className="home-kicker">Scale</p>
        <h2 id="home-scale">One record, or a million in one.</h2>
        <p>
          A collection is bound as one Merkle tree in one action, and each item proves its own inclusion without the others being
          disclosed. Measured on the current flow: one million files hashed and built into a tree in 4.6 seconds on a laptop, and bound
          as one BitGraph 6.1 seconds after the drop.
        </p>
        <div className="sx-cta"><a className="bg-action-link" href="/technology#t-trees">How collections work</a></div>
      </section>

      <section className="home-section" aria-labelledby="home-limits">
        <p className="home-kicker">Plainly</p>
        <h2 id="home-limits">What a BitGraph does not prove.</h2>
        <ul className="docs-list">
          <li><strong>When content was created.</strong> An old file can be bound today; the proof fixes when it was bound.</li>
          <li><strong>Who made it, or that it is true.</strong> It binds bytes, not authorship or meaning.</li>
          <li><strong>That nothing else exists.</strong> It proves a record was made, not that no other was.</li>
        </ul>
        <p>What it rests on: AWS Nitro hardware, a published enclave build anyone can rebuild, and standard cryptography. <a href="/technology#t-threat">The threat model</a>.</p>
      </section>

      <section className="home-section" aria-labelledby="home-paths">
        <p className="home-kicker">Ways to adopt it</p>
        <h2 id="home-paths">Call it, license it, or build it in with us.</h2>
        <div className="sx-cards">
          <a className="tl-card sx-link" href="/integrate">
            <p className="tl-label">Managed recording</p>
            <h3>Call the service.</h3>
            <p>Send digests over HTTP, the SDK or MCP; store the proofs. Nothing to operate.</p>
          </a>
          <a className="tl-card sx-link" href="/licensing">
            <p className="tl-label">Mechanism license</p>
            <h3>Run it under your control.</h3>
            <p>License the recording mechanism for your own infrastructure and product.</p>
          </a>
          <a className="tl-card sx-link" href="/licensing">
            <p className="tl-label">Custom integration</p>
            <h3>Build it in together.</h3>
            <p>Engineering work for your workflow: collections, credentials, agents, verification.</p>
          </a>
        </div>
      </section>


      <section className="home-section" aria-labelledby="home-end">
        <p className="home-kicker">Argento Computing Inc.</p>
        <h2 id="home-end">The next time a customer asks why they should believe you, you&rsquo;ll have a better&nbsp;answer.</h2>
        <p>Verify a real proof in two minutes, read the mechanism, and talk with us about putting it under what you already sell.</p>
        <div className="sx-cta">
          <a className="bg-action-link is-make" href="/evaluate">Request a technical evaluation</a>
          <a className="bg-action-link" href="/licensing">Licensing</a>
        </div>
      </section>
    </div>
  );
}
