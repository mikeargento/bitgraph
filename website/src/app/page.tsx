import type { Metadata } from "next";
import { MechanismFigure } from "@/components/mechanism-figure";
import { DemoRow } from "@/components/demo-row";

/**
 * The home page (2026-10-27; made short 2026-10-31): the claim and a one-line definition over a proven video, then
 * evidence rather than explanation: the proven pictures, blockchain order without writes, three facts, the mechanism figure with one line, the
 * ways to adopt it. The explaining lives on Technology. The claims are the Technology page's, short; each is in the v13
 * enclave and the verifier.
 *
 * ⚠️ Claim discipline, unchanged: bound by a time and after an unpredictable value, never "created at"; it says when
 * bits were bound, not how old they are or who made them.
 */

const DESCRIPTION =
  "BitGraph binds a file's SHA-256 hash to a counted position inside attested hardware. The result is a portable proof your customers can verify offline, without relying on your service or BitGraph.";

export const metadata: Metadata = {
  title: { absolute: "BitGraph: Upgrade your proof." },
  description: DESCRIPTION,
  openGraph: { title: "Upgrade your proof.", description: DESCRIPTION },
  twitter: { title: "Upgrade your proof.", description: DESCRIPTION },
};

export default function HomePage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page is-landing is-short">
      <section className="sx-hero" aria-labelledby="home-h">
        {/* The first screen is the claim and its one-line definition (2026-10-31), centred; How it works scrolls to the proofs. */}
        <h1 id="home-h">Upgrade your proof.</h1>
        <p className="sx-sub hero-sub">BitGraph binds a file&rsquo;s SHA-256 hash to a counted position inside attested hardware. The result is a portable proof your customers can verify offline, without relying on your service or&nbsp;BitGraph.</p>
        <div className="sx-cta">
          <a className="bg-action-link is-make" href="/evaluate">Evaluate it</a>
          <a className="bg-action-link" href="/technology">Learn more</a>
        </div>
      </section>

      <section className="home-section" aria-labelledby="home-demo">
        <p className="home-kicker">Real files, real proofs</p>
        <h2 id="home-demo">Everything digital is already a&nbsp;copy&hellip;</h2>
        <p>Same picture. Different bytes. Different proofs. Open any proof and check for&nbsp;yourself.</p>
        <DemoRow />
      </section>

      <section className="home-section" aria-labelledby="home-mech">
        <p className="home-kicker">The mechanism</p>
        <h2 id="home-mech">One atomic action in a measured&nbsp;enclave.</h2>
        <p>An AWS Nitro enclave draws a fresh hardware nonce at count N and binds your digest at count N+1. Both are signed together, attested by the hardware, and chained to the previous proof. Only the hash reaches BitGraph. <a href="/technology">Read the technology.</a></p>
        <MechanismFigure />
      </section>

      <section className="home-section" aria-labelledby="home-reads">
        <p className="home-kicker">Public time</p>
        <h2 id="home-reads">A time window on&nbsp;Base.</h2>
        <p>A proof verifies on its own, with no blockchain. Through bitgraph.ing, each file is also placed between two Base blocks seconds apart: the newest block, bound just before the file, and the block its proof is written into.</p>
        <p><strong>You never handle a wallet or a&nbsp;fee.</strong></p>
      </section>

      <section className="home-section" aria-labelledby="home-paths">
        <p className="home-kicker">Ways to adopt it</p>
        <h2 id="home-paths">Use it, license it, or build on it with us.</h2>
        <div className="sx-cards">
          <a className="tl-card sx-link" href="/integrate">
            <p className="tl-label">Managed recording</p>
            <h3>Use the service.</h3>
            <p>Send digests over HTTP, the SDK or MCP. Nothing to operate.</p>
          </a>
          <a className="tl-card sx-link" href="/licensing">
            <p className="tl-label">Mechanism license</p>
            <h3>License the mechanism.</h3>
            <p>Run the recording step under your own measured build.</p>
          </a>
          <a className="tl-card sx-link" href="/licensing">
            <p className="tl-label">Custom integration</p>
            <h3>Build on it together.</h3>
            <p>Engineering work for your workflow.</p>
          </a>
        </div>
        <p className="home-paths-more">Not sure where it fits your product? <a href="/applications">See the products it sits&nbsp;under</a>.</p>
      </section>

      <section className="home-section" aria-labelledby="home-end">
        <h2 id="home-end">Talk with us about your&nbsp;platform.</h2>
        <div className="sx-cta">
          <a className="bg-action-link is-make" href="/evaluate">Request a technical evaluation</a>
          <a className="bg-action-link" href="/contact">Contact</a>
        </div>
      </section>
    </div>
  );
}
