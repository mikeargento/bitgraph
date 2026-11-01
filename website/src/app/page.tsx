import type { Metadata } from "next";
import { MechanismFigure } from "@/components/mechanism-figure";
import { DemoRow, HeroVideo } from "@/components/demo-row";

/**
 * The home page (2026-10-27; made short 2026-10-31): one claim over a proven video, then evidence rather than
 * explanation: the proven pictures, blockchain order without writes, three facts, the mechanism figure with one line, the
 * ways to adopt it. The explaining lives on
 * Technology. The claims are the Technology page's, short; each is in the v13 enclave and the verifier.
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

/* Facts about the system itself, each checkable, not live counts: what a record costs on chain, what verifying needs,
   and the usual window between the two block reads around a record. */
const FACTS = [
  { big: "$0", small: "transaction fees per record" },
  { big: "0", small: "servers needed to verify, ours or yours" },
  { big: "\u2248\u20092\u2009s", small: "public-time window, on Base" },
];

/* Reads, never writes (2026-10-31): the block timeline binds a read of every Base and Ethereum block into the same
   sequence, so each record sits between two public blocks with nothing written to any chain for it. The home page shows
   the first three; Technology carries the rest. */
const NO_WRITES = [
  { title: "No wallet required.", body: "Send a hash. Get a proof. No wallet to connect, tokens to buy or balance to maintain." },
  { title: "No gas per record.", body: "Recording a file requires no blockchain transaction, so there\u2019s no gas fee for each record." },
  { title: "A bracket in seconds.", body: "Your proof arrives when the record is bound. Its time bracket closes when the next qualifying block is read\u2014usually within a few seconds." },
  { title: "Your hash stays off chain.", body: "No file, file hash or batch root is written to a blockchain. Only the epoch ID is announced on Base, once per epoch." },
  { title: "Two public chains.", body: "Base provides frequent blocks. Ethereum keeps providing time brackets if Base is unavailable." },
  { title: "Independently verifiable.", body: "Check the hardware attestations, signatures and counted sequence, then confirm the bracketing blocks against the public chains." },
];

export default function HomePage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page is-landing is-short">
      <section className="sx-hero" aria-labelledby="home-h">
        <HeroVideo />
        {/* The first screen is the claim alone (2026-10-31), centred; How it works scrolls to what follows. */}
        <h1 id="home-h">Order before&nbsp;time.</h1>
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
          {NO_WRITES.slice(0, 3).map((r) => (
            <article key={r.title} className="tl-card">
              <h3>{r.title}</h3>
              <p>{r.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-section home-lead" aria-label="What a BitGraph is">
        <p className="sx-sub">A portable proof of where your record stands in a counted sequence. Anyone can check&nbsp;it, offline.</p>
      </section>

      <section className="home-section home-facts" aria-label="In numbers">
        {FACTS.map((f) => (
          <div key={f.small} className="home-fact"><div className="home-fact-big">{f.big}</div><div className="home-fact-small">{f.small}</div></div>
        ))}
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
