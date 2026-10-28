import type { Metadata } from "next";
import { FlowFigure } from "@/components/primitive-figures";
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
  "BitGraph is a recording mechanism for digital proof: one atomic action inside measured AWS Nitro hardware binds a SHA-256 at a counted position, right after a fresh random value, signed and attested. The proof checks offline. Integrate it under the products you already sell.";

export const metadata: Metadata = {
  title: { absolute: "BitGraph: a new primitive for digital proof" },
  description: DESCRIPTION,
  openGraph: { title: "A new primitive for digital proof.", description: DESCRIPTION },
  twitter: { title: "A new primitive for digital proof.", description: DESCRIPTION },
};

const PROPERTIES = [
  { title: "Unpredictable position", body: "Each record takes the count right after a fresh nonce from the hardware's random number generator, drawn after the digest arrives. A position cannot be reserved ahead and filled later." },
  { title: "Enforced binding", body: "Nonce and digest are signed together in one indivisible action. If any step fails, nothing is released and the counter does not move. No count is ever given out twice." },
  { title: "Verifiable sequence", body: "Every record carries the hash of the one before it. Counts climb in order, gaps show, and anything bound between two records was bound after the first and before the second." },
  { title: "Portable evidence", body: "Each proof carries an AWS Nitro attestation naming the published, reproducible enclave build that made it. It checks offline with an open-source verifier, without asking us." },
];

const FITS = [
  { href: "/applications#c2pa", title: "Content Credentials", body: "Bind the asset and its manifest together: the credential gains an independent recording." },
  { href: "/applications#watermark", title: "Watermark discovery", body: "The watermark finds the record; the original's bytes prove it." },
  { href: "/applications#capture", title: "Trusted capture", body: "How it was captured, plus when its bytes were recorded." },
  { href: "/applications#ai", title: "AI agents and audit", body: "Two records bracket a run, every step between them in counted order." },
];

export default function HomePage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page">
      <section className="sx-hero" aria-labelledby="home-h">
        <p className="home-kicker">Cryptographic recording infrastructure</p>
        <h1 id="home-h">A new primitive for digital&nbsp;proof.</h1>
        <p className="sx-sub">
          BitGraph gives digital information a verifiable position. Inside measured hardware, one atomic action binds its SHA-256
          right after a fresh random value, signed and attested. The proof travels, and checks without us. Build it into the products
          you already sell.
        </p>
        <div className="sx-cta">
          <a className="bg-action-link is-make" href="/evaluate">Evaluate the technology</a>
          <a className="bg-action-link" href="/technology">How it works</a>
          {/* The sample on Evaluate: a ChatGPT image and its OpenAI-signed Content Credentials, bound in one tree. */}
          <a className="bg-action-link" href="/proof/MXkV_2WRyBSlQV_BdOio2gc1NSrd2Wxl8zW0OrACCDk?counter=26&epoch=NihRUA1VRsV4cqmwWDO_4viNR7YhJRdCb75lGASeV3E">View a proof</a>
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
        <div style={{ marginTop: 32 }}><FlowFigure /></div>
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
        <p className="home-kicker">Built to sit underneath</p>
        <h2 id="home-fit">Keep your product. Upgrade your&nbsp;proof.</h2>
        <p>
          BitGraph does not compete with your product; it strengthens the evidence it produces. Your system sends a digest and keeps
          the proof beside its own record. Your customers, brand and interface stay yours.
        </p>
        <div className="sx-cards">
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
          disclosed. In a measured run, one million files were hashed in 4.2 seconds on a laptop and bound as a single record.
        </p>
        <div className="sx-cta"><a className="bg-action-link" href="/technology#t-trees">How collections work</a></div>
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

      <section className="home-section" aria-labelledby="home-end">
        <p className="home-kicker">Argento Computing Inc.</p>
        <h2 id="home-end">Give your proof a stronger foundation.</h2>
        <p>Inspect the mechanism, reproduce its guarantees, and talk to us about building it into your infrastructure.</p>
        <div className="sx-cta">
          <a className="bg-action-link is-make" href="/evaluate">Request a technical evaluation</a>
          <a className="bg-action-link" href="/licensing">Licensing</a>
        </div>
      </section>
    </div>
  );
}
