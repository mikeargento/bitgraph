import type { Metadata } from "next";

/** The three demos, stacked one per row. Each makes two BitGraphs as bookends: A opens, the work is made from A's
 *  nonce, B closes. Every result is a real BitGraph and checks offline. */
export const metadata: Metadata = {
  title: "Demos",
  description: "Three demos of work bracketed by two BitGraphs: made after A, bound by B.",
};

const DEMOS = [
  { href: "/jev", label: "Demo 1", title: "Ask AI", body: "Two questions made from A’s nonce, answered by an AI, and bound as B." },
  { href: "/generate", label: "Demo 2", title: "Generate image", body: "A picture drawn by code from A’s nonce and bound as B." },
  { href: "/exam", label: "Demo 3", title: "Sealed exam", body: "Twenty benchmark questions made from A’s nonce, a model’s answers bound as B, checked offline." },
];

export default function ExamplesPage() {
  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page">
      <div className="home-hero"><h1 className="sr-only">Demos.</h1></div>
      <section className="home-section" aria-labelledby="demos-h">
        <p className="home-kicker">Demos</p>
        <h2 id="demos-h">The power of instant cryptographic order.</h2>
        <div className="sx-cards is-stack">
          {DEMOS.map((d) => (
            <a key={d.href} className="tl-card sx-link" href={d.href}>
              <p className="tl-label">{d.label}</p>
              <h3>{d.title}</h3>
              <p>{d.body}</p>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
