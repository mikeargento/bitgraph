import type { Metadata } from "next";

/** Try it (2026-10-27): the live mechanism, as evidence. Make, Check and the ledger are the working service; the three
 *  demos are two BitGraphs as bookends: A opens, the work is made from A's nonce, B closes. Every result is a real
 *  BitGraph and checks offline. */
export const metadata: Metadata = {
  title: "Try it",
  description: "The BitGraph mechanism running live: make a BitGraph, check a file, browse the public ledger, and three demos of work bracketed by two BitGraphs.",
};

const LIVE = [
  { href: "/make", label: "Make", title: "Record a BitGraph of your files", body: "Drop files. Only the hash leaves your browser. A file already recorded opens its BitGraph; a picture recorded before names its first." },
  { href: "/ledger", label: "Ledger", title: "Every BitGraph, as it is made", body: "The public sequence, newest first." },
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
          Everything here is the production service. Every result is a real BitGraph, and every one checks offline.
        </p>
        <div className="sx-cards is-1">
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
