import type { Metadata } from "next";
import { MechanismFigure } from "@/components/mechanism-figure";
import { DemoRow } from "@/components/demo-row";

/**
 * The home page, redesigned 2026-11-03 for one reader: an engineer or product lead at a company that sells proof
 * (capture provenance, content credentials, evidence platforms). It says what BitGraph adds under their product, shows a
 * real proof checking, explains the one step, states what a proof does and does not establish, and offers the ways in.
 *
 * Claim discipline: a BitGraph shows where in an enclave's count and when bytes were bound, after a value nobody could
 * know beforehand. It never says when or how content was made, who made it, or that it is true.
 */

const DESCRIPTION =
  "BitGraph binds a file's SHA-256 hash to a counted position inside an attested AWS Nitro enclave. Proof platforms add it under their product; their customers verify each proof offline.";

export const metadata: Metadata = {
  title: { absolute: "BitGraph: Verifiable bits" },
  description: DESCRIPTION,
  openGraph: { title: "Verifiable bits", description: DESCRIPTION },
  twitter: { title: "Verifiable bits", description: DESCRIPTION },
};

const QUESTIONS = [
  "Can anything other than the bind produce a proof that passes?",
  "Can the host have the key sign any statement it chooses?",
  "Can an existing file be given an earlier place?",
  "Can one step be completed or replayed apart from the rest?",
  "Can the counter be rolled back to reuse a count?",
  "Does the verifier take the proof\u2019s word about its hardware?",
  "Does it claim more than the hardware enforces?",
];

export default function HomePage() {
  return (
    <div className="frame home prose sx-page is-landing hz">
      <section className="hz-hero" aria-labelledby="home-h">
        <div className="hz-hero-copy">
          <h1 id="home-h">Verifiable bits.</h1>
          <p className="hz-sub">A fixed place in a sequence for every record, enforced by attested hardware.</p>
          <p className="hz-lead">Built for provenance, content credentials and audit trails. Your customers keep the proof and can verify it offline, without your servers or&nbsp;ours.</p>
          <div className="hz-cta">
            <a className="bg-action-link is-make" href="/evaluate">Run the evaluation</a>
            <a className="bg-action-link" href="/technology">Read the technology</a>
          </div>
        </div>
        {/* A picture and its proof, shown like the demos below: a bridge drawn from BitGraph #42's nonce, bound as #44. */}
        <figure className="hz-receipt" aria-label="A bridge drawn from the nonce of BitGraph #42, with a link to its proof">
          <a className="hz-receipt-media" href="/proof/M_VIzEkRow0oomvDkaZ7iuiYm5bFhOXzgMd3Lr4U-bs" tabIndex={-1} aria-hidden="true">
            <img className="hz-receipt-img" src="/demo/bridge-44.png" alt="" />
          </a>
          <figcaption>
            <span className="hz-receipt-cap">Drawn from the nonce of BitGraph&nbsp;#42</span>
            <a className="hz-receipt-link" href="/proof/M_VIzEkRow0oomvDkaZ7iuiYm5bFhOXzgMd3Lr4U-bs">View proof</a>
          </figcaption>
        </figure>
      </section>

      <section className="hz-sec" aria-labelledby="home-gate">
        <p className="hz-kicker">Why it exists</p>
        <h2 id="home-gate"><span className="hz-line">A signature shows who held the key.</span> <span className="hz-line">Not which path the bytes&nbsp;took.</span></h2>
        <p className="hz-text">
          Keys in a TEE, an HSM or a phone&rsquo;s secure element sign whatever digest the host hands them. That proves custody
          of a key, not the order or moment of anything. BitGraph&rsquo;s key can only sign as part of one fixed step, inside
          measured hardware, so every proof also proves the step&nbsp;ran.
        </p>
        <div className="hz-vs">
          <div className="hz-side">
            <p className="hz-side-label">A key in a TEE, HSM or secure element</p>
            <ul>
              <li>Signs any digest it is given</li>
              <li>The host chooses what and when</li>
              <li>Order lives in your database</li>
            </ul>
          </div>
          <div className="hz-side is-us">
            <p className="hz-side-label">The BitGraph enclave</p>
            <ul>
              <li>Signs only the whole bind step</li>
              <li>A fresh nonce takes count N, your hash count N+1</li>
              <li>Each proof is chained to the one before</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="hz-sec" aria-labelledby="home-mech">
        <p className="hz-kicker">The mechanism</p>
        <h2 id="home-mech">One atomic step in a measured&nbsp;enclave</h2>
        <p className="hz-text">
          The enclave draws a nonce from the Nitro hardware RNG, takes count N, binds your digest at count N+1, signs both
          together, asks the hardware to attest the signed body, and only then advances. If any step fails, nothing is released
          and the count does not&nbsp;move.
        </p>
        <MechanismFigure />
      </section>

      <section className="hz-sec" aria-labelledby="home-proves">
        <p className="hz-kicker">What a proof establishes</p>
        <h2 id="home-proves">Two statements, each checkable by&nbsp;anyone</h2>
        <div className="hz-grid2">
          <div className="hz-cell">
            <h3>Position</h3>
            <p>These exact bytes were bound at count N+1 of one enclave&rsquo;s sequence, right after a nonce nobody could predict. Missing proofs show as&nbsp;gaps.</p>
          </div>
          <div className="hz-cell">
            <h3>Origin of the proof</h3>
            <p>The binding was made by a published, reproducible enclave image, attested per proof by AWS Nitro&nbsp;hardware.</p>
          </div>
        </div>
        <p className="hz-not"><strong>Public time:</strong> through bitgraph.ing, each proof is also placed between two Base blocks seconds apart, the newest block before it and the block it is written into. You never handle a wallet or a&nbsp;fee.</p>
        <p className="hz-not"><strong>Not claimed:</strong> who made the content, when it was made, or that it is true. Those stay with your&nbsp;product.</p>
      </section>

      <section className="hz-sec" aria-labelledby="home-demo">
        <p className="hz-kicker">Real files, real proofs</p>
        <h2 id="home-demo">Same picture, different bytes, different&nbsp;proofs</h2>
        <p className="hz-text">Three versions of one image, each bound in production. Open any proof and check it&nbsp;yourself.</p>
        <DemoRow />
      </section>

      <section className="hz-sec" aria-labelledby="home-q">
        <p className="hz-kicker">Due diligence</p>
        <h2 id="home-q">Seven questions to ask any proof&nbsp;system</h2>
        <p className="hz-text">Including us. <a href="/evaluate#e-q">Our answers, and how to check them</a></p>
        <ol className="hz-qs">
          {QUESTIONS.map((q) => <li key={q}><span>{q}</span><b>No</b></li>)}
        </ol>
      </section>

      <section className="hz-sec" aria-labelledby="home-paths">
        <p className="hz-kicker">Ways in</p>
        <h2 id="home-paths">Use the service, license the mechanism, or build it&nbsp;together</h2>
        <div className="sx-cards">
          <a className="tl-card sx-link" href="/integrate">
            <p className="tl-label">Managed</p>
            <h3>Use the service</h3>
            <p>Send digests over HTTP, the SDK or MCP. Nothing to operate.</p>
          </a>
          <a className="tl-card sx-link" href="/licensing">
            <p className="tl-label">License</p>
            <h3>Run it under your build</h3>
            <p>The recording step inside your own measured enclave.</p>
          </a>
          <a className="tl-card sx-link" href="/licensing">
            <p className="tl-label">Partner</p>
            <h3>Build it into your product</h3>
            <p>Engineering with us for your capture or evidence pipeline.</p>
          </a>
        </div>
      </section>

      <section className="hz-sec hz-end" aria-labelledby="home-end">
        <h2 id="home-end">Check it before you talk to&nbsp;us</h2>
        <p className="hz-text">Verify a production proof offline, try to break it, and rebuild the enclave measurement. About ten&nbsp;minutes.</p>
        <div className="hz-cta">
          <a className="bg-action-link is-make" href="/evaluate">Run the evaluation</a>
          <a className="bg-action-link" href="/contact">Talk to us</a>
        </div>
      </section>
    </div>
  );
}
