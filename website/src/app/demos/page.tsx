import type { Metadata } from "next";

/** The demos (Mike, 2026-10-17: "Demos" in the footer). Both are two BitGraphs as bookends: A opens, the work is made
 *  from A's nonce, B closes. */
export const metadata: Metadata = {
  title: "Demos",
  description: "Two BitGraphs as bookends: work made from BitGraph A's nonce and bound as BitGraph B.",
};

const DEMOS = [
  { href: "/jev", title: "Ask AI", body: "Two questions made from A’s nonce, answered by an AI, and bound as B." },
  { href: "/generate", title: "Generate image", body: "A picture drawn by code from A’s nonce and bound as B." },
  { href: "/exam", title: "Sealed exam", body: "Twenty benchmark questions made from A’s nonce, a model’s answers bound as B, checked offline." },
];

export default function DemosPage() {
  return (
    <div className="frame home home-typing prose home-scroll jev-page">
      <div className="home-hero">
        <h1 className="sr-only">Demos.</h1>
      </div>
      <section className="home-section" aria-labelledby="demos-h">
        <p className="home-kicker">Demos</p>
        <h2 id="demos-h">Work that could not exist before BitGraph&nbsp;A.</h2>
        <p style={{ marginTop: 24 }}>
          Each demo makes two BitGraphs. A&rsquo;s nonce, unseen until A is bound, is the input to the work; the result is
          bound as B, after A in the same sequence.
        </p>
      </section>
      {/* Each demo is its own card, like the four on Tools (Mike, 2026-10-19: "these each need their own cells"). */}
      <section className="home-section demos-item" aria-label="The demos">
        <div className="dm-grid">
          {/* The whole card is the link, and glows on hover like the drop box (Mike, 2026-10-19: "instead of try it try it
              try it each card should be a link with the glow property"). */}
          {DEMOS.map((d) => (
            <a key={d.href} className="dm-card" href={d.href}>
              <h3>{d.title}</h3>
              <p>{d.body}</p>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
