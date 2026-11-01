import type { Metadata } from "next";
import { MechanismFigure } from "@/components/mechanism-figure";
import { DemoRow, HeroVideo } from "@/components/demo-row";

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
  "A portable proof of where your digital record stands in a counted sequence. The proof checks offline; public block reads place it between two blockchain blocks, seconds apart, which anyone can confirm on the chains.";

export const metadata: Metadata = {
  title: { absolute: "BitGraph: Order before time" },
  description: DESCRIPTION,
  openGraph: { title: "Order before time.", description: DESCRIPTION },
  twitter: { title: "Order before time.", description: DESCRIPTION },
};

/* Facts about the system itself, each checkable, not live counts: how many files one proof holds (the million-file run
   on Technology, not a limit), what a record costs on chain, and how long a proof takes to come back (it waits on no
   block; 0.47 s, 0.41 s and 0.34 s from hash to proof, measured on the live site on 2026-10-31). */
const FACTS = [
  { big: "1,000,000+", small: "files in one proof" },
  { big: "$0", small: "transaction fees per record" },
  { big: "\u2248\u20090\u2009s", small: "to get a proof back: under 0.5\u2009s, measured" },
];

/* Reads, never writes (2026-10-31): the block timeline binds a read of every Base and Ethereum block into the same
   sequence, so each record sits between two public blocks with nothing written to any chain for it. Technology carries
   three more: the hash off chain, two chains, and checking it all. */
const NO_WRITES = [
  { title: "No wallet required.", body: "Send a hash. Get a proof. No wallet to connect, tokens to buy or balance to maintain." },
  { title: "No gas per record.", body: "Recording a file requires no blockchain transaction, so there\u2019s no gas fee for each record." },
  { title: "A bracket in seconds.", body: "Your proof arrives when the record is bound. Its time bracket closes when the next qualifying block is read\u2014usually within a few seconds." },
];

export default function HomePage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page is-landing is-short">
      <section className="sx-hero" aria-labelledby="home-h">
        <HeroVideo />
        {/* The first screen is the claim and its one-line definition (2026-10-31), centred; How it works scrolls to the proofs. */}
        <h1 id="home-h">Order before&nbsp;time.</h1>
        <p className="sx-sub hero-sub">A BitGraph is proof of your file&rsquo;s place in&nbsp;line.</p>
        <div className="sx-cta">
          <a className="bg-action-link is-make" href="/demos">Try it</a>
          <a className="bg-action-link" href="#how">How it works</a>
        </div>
      </section>

      <section id="how" className="home-section" aria-labelledby="home-demo">
        <p className="home-kicker">Three files, three proofs</p>
        <h2 id="home-demo">Same picture. Different bytes. Different&nbsp;proofs.</h2>
        <p>Each proof covers its file&rsquo;s exact bytes. Open one and check it yourself.</p>
        <DemoRow />
      </section>

      <section className="home-section" aria-labelledby="home-reads">
        <p className="home-kicker">Public time, without per-record transactions</p>
        <h2 id="home-reads">Blockchain order, without the&nbsp;blockchain.</h2>
        <p>Every record lands between two public blocks, seconds apart, with nothing written to any chain for&nbsp;it.</p>
        <div className="sx-cards is-3">
          {NO_WRITES.map((r) => (
            <article key={r.title} className="tl-card">
              <h3>{r.title}</h3>
              <p>{r.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-section home-facts-sec" aria-labelledby="home-facts">
        <p className="home-kicker" id="home-facts">By the numbers</p>
        <div className="home-facts">
          {FACTS.map((f) => (
            <div key={f.small} className="home-fact"><div className="home-fact-big">{f.big}</div><div className="home-fact-small">{f.small}</div></div>
          ))}
        </div>
      </section>

      {/* Made after its proof (2026-10-31): the bridge is drawn (bitgraph-art/19) from the nonce the enclave drew for BitGraph
          #12,526, and the finished PNG is recorded as #12,530. Redrawing from that nonce gives the same pixels. The image shown
          is the recorded file itself (public/demo/bridge.png). */}
      <section className="home-section home-art" aria-labelledby="home-art">
        <p className="home-kicker">Made after its proof</p>
        <h2 id="home-art">This picture couldn&rsquo;t exist before its BitGraph&nbsp;did.</h2>
        <p>Every shape is drawn from the unpredictable value BitGraph #12,526 drew. Nobody could have made it in advance, not even us. The finished picture is BitGraph&nbsp;#12,530.</p>
        <figure className="art-figure">
          <img src="/demo/bridge.png" width={1920} height={1080} alt="The Golden Gate Bridge drawn in rectangles, from the unpredictable value of BitGraph #12,526" loading="lazy" />
          <figcaption className="demo-links">
            <a href="/proof/STRmGI7e-mk_HXjr7DREuTpPgWjjdmLQXAkZyEg_1ys?counter=12526&amp;epoch=HVhtPS0i7hkDWO6zI_7UJG1VLekCC3ouJaYomAqeSPc">#12,526, the position</a>
            <a href="/proof/E301gTl5CQkxYjhCsn8RZJcv26nR3EeWMyohutOe4F4?counter=12530&amp;epoch=HVhtPS0i7hkDWO6zI_7UJG1VLekCC3ouJaYomAqeSPc">#12,530, the picture</a>
          </figcaption>
        </figure>
      </section>

      <section className="home-section" aria-labelledby="home-mech">
        <p className="home-kicker">The mechanism</p>
        <h2 id="home-mech">The position comes first.</h2>
        <p>Hardware draws an unpredictable value at count N. Your digest is bound at N+1. Both are signed together, in one action.</p>
        <MechanismFigure />
        <div className="sx-cta"><a className="bg-action-link" href="/technology">Read the technology</a></div>
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
      </section>

      <section className="home-section" aria-labelledby="home-end">
        <h2 id="home-end">Give your customers a proof they can check&nbsp;themselves.</h2>
        <div className="sx-cta">
          <a className="bg-action-link is-make" href="/evaluate">Request a technical evaluation</a>
          <a className="bg-action-link" href="/licensing">Licensing</a>
        </div>
      </section>
    </div>
  );
}
