import type { Metadata } from "next";

/** Try it (2026-10-27): the live mechanism, as evidence. Make, Check and the ledger are the working service; the three
 *  demos are two BitGraphs as bookends: A opens, the work is made from A's nonce, B closes. Every result is a real
 *  BitGraph and checks offline. */
export const metadata: Metadata = {
  title: "Try it",
  description: "The BitGraph mechanism running live: make a BitGraph, check a file, browse the public ledger, and three demos of work bracketed by two BitGraphs.",
};

const LIVE = [
  { href: "/make", label: "Make", title: "Bind files in a BitGraph", body: "Drop files. They are hashed in your browser and only the SHA-256 is sent; the enclave binds it and the proof comes back. Many files become one tree and one BitGraph." },
  { href: "/check", label: "Check", title: "Check any file", body: "Drop a file to find its proof by its exact bytes. A photo copy is read for its watermark, which leads to the original's proof. Nothing is ever made here." },
  { href: "/find", label: "Find", title: "Find a photo's proof by its looks", body: "Drop a screenshot or a stripped copy. It is matched, in your browser, against the fingerprint record the original's own tree binds; no watermark, only a 64-bit hash is sent." },
  { href: "/ledger", label: "Ledger", title: "Every BitGraph, as it is made", body: "The public sequence, newest first: each BitGraph's number, its two counts, the SHA-256 it bound and the enclave's signed time." },
];

const DEMOS = [
  { href: "/jev", title: "Ask AI", body: "Two questions made from A’s nonce, answered by an AI, and bound as B." },
  { href: "/generate", title: "Generate image", body: "A picture drawn by code from A’s nonce and bound as B." },
  { href: "/exam", title: "Sealed exam", body: "Twenty benchmark questions made from A’s nonce, a model’s answers bound as B, checked offline." },
];

export default function DemosPage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page">
      <div className="home-hero"><h1 className="sr-only">Try it.</h1></div>
      <section className="home-section" aria-labelledby="try-h">
        <p className="home-kicker">Try it</p>
        <h2 id="try-h">The mechanism, running.</h2>
        <p>
          Everything here is the production service, not a mock-up. Each result is a real BitGraph, signed inside the enclave and
          attested by the hardware, and every one checks offline with the published verifier.
        </p>
        <div className="sx-cards">
          {LIVE.map((d) => (
            <a key={d.href} className="tl-card sx-link" href={d.href}>
              <p className="tl-label">{d.label}</p>
              <h3>{d.title}</h3>
              <p>{d.body}</p>
            </a>
          ))}
        </div>
      </section>
      <section className="home-section" aria-labelledby="demos-h">
        <p className="home-kicker">Demos</p>
        <h2 id="demos-h">Work that could not exist before BitGraph&nbsp;A.</h2>
        <p>
          Each demo makes two BitGraphs. A&rsquo;s nonce, unseen until A is bound, is the input to the work; the result is bound as B,
          after A in the same sequence. The work is bracketed: made after A, bound by B.
        </p>
        <div className="sx-cards">
          {DEMOS.map((d) => (
            <a key={d.href} className="tl-card sx-link" href={d.href}>
              <h3>{d.title}</h3>
              <p>{d.body}</p>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
