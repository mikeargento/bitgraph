import type { Metadata } from "next";

/** The demos (Mike, 2026-10-17: "Demos" in the footer). Both are two BitGraphs as bookends: A opens, the work is made
 *  from A's nonce, B closes. */
export const metadata: Metadata = {
  title: "Demos",
  description: "Two BitGraphs as bookends: work made from BitGraph A's nonce and bound as BitGraph B.",
};

const DEMOS = [
  { href: "/jev", title: "Ask AI", body: "Two questions made from A’s nonce, answered by an AI, and recorded as B." },
  { href: "/generate", title: "Generate image", body: "A picture drawn from A’s nonce and bound as B." },
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
      {DEMOS.map((d) => (
        <section key={d.href} className="home-section demos-item">
          <h2>{d.title}</h2>
          <p style={{ marginTop: 12 }}>{d.body}</p>
          {/* A button, not a link in the heading (Mike, 2026-10-17: "those links should be buttons right"). */}
          <div style={{ marginTop: 20 }}><a className="bg-action-link" style={{ margin: 0 }} href={d.href}>Try it</a></div>
        </section>
      ))}
    </div>
  );
}
