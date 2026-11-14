// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The demos as cards. Three make two BitGraphs as bookends: A opens, the work is made from A's nonce, B closes. The
 * fourth is one picture in three files, each with its own BitGraph. Every result is a real BitGraph and checks
 * offline. The Demos page shows them two to a row, and one to a row on phones: each a white card with its number, whether it
 * runs live, its title and one line about it, and a strip at its foot.
 *
 * The home page has its own three cards in a row under the pictures: the three places a visitor goes next, which are
 * making a BitGraph, the ledger, and the demos.
 */
import { GoArrow } from "@/components/go-arrow";

const DEMOS: Card[] = [
  { href: "/jev", title: "Ask AI", body: "Two questions made from A’s nonce, answered by an AI, and bound as B.", live: true },
  { href: "/generate", title: "Generate image", body: "A picture drawn by code from A’s nonce and bound as B.", live: true },
  { href: "/exam", title: "Sealed exam", body: "Twenty benchmark questions made from A’s nonce, a model’s answers bound as B, checked offline.", live: false },
  { href: "/pictures", title: "Copies", body: "One photograph saved three times. Three files that look alike, each with its own BitGraph.", live: false },
];
const HOME = [
  { href: "/demos", title: "Drop a file", body: "Drop any file. Its hash is bound at the next place in line, and the file stays with you." },
  { href: "/#t-mech", title: "How it works", body: "One sealed step puts each file in its place in line, checkable by anyone." },
  { href: "/examples", title: "Demos", body: "Working examples, each built on real BitGraphs you can check." },
];

/** `live` is set on a demo: true when a click makes new BitGraphs, false when the page shows ones already made. */
type Card = { href: string; title: string; body: string; live?: boolean };

function Cards({ cards, row }: { cards: Card[]; row: boolean }) {
  return (
    <div className={`sx-cards is-stack${row ? " is-row" : " is-two"}`}>
      {cards.map((d, i) => d.live === undefined ? (
        <a key={d.href} className="tl-card sx-link" href={d.href}>
          <h3>{d.title}</h3>
          <p>{d.body}</p>
          <svg className="card-go" viewBox="0 0 30 14" width="30" height="14" aria-hidden="true" focusable="false">
            <path d="M1 7h27M22 1l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" />
          </svg>
        </a>
      ) : (
        // A demo's card: its number and whether it runs live at the top, and a strip at its foot that says what a click does.
        <a key={d.href} className="tl-card sx-link demo-card" href={d.href}>
          <div className="demo-card-body">
            <div className="demo-card-top">
              <span>{String(i + 1).padStart(2, "0")}</span>
              <span className={d.live ? "demo-card-kind is-live" : "demo-card-kind"}>{d.live ? "Live" : "Recorded"}</span>
            </div>
            <h3>{d.title}</h3>
            <p>{d.body}</p>
          </div>
          <div className="demo-card-foot"><span>{d.live ? "Run the demo" : "See the proofs"}</span><GoArrow /></div>
        </a>
      ))}
    </div>
  );
}

export function DemoCards() {
  return <Cards cards={DEMOS} row={false} />;
}

export function HomeCards() {
  return <Cards cards={HOME} row />;
}
