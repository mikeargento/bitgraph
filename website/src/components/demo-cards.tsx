// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The three demos as cards. Each makes two BitGraphs as bookends: A opens, the work is made from A's nonce, B closes.
 * Every result is a real BitGraph and checks offline. The Demos page stacks them one per row.
 *
 * The home page has its own three cards in a row under the pictures: the three places a visitor goes next, which are
 * making a BitGraph, the ledger, and the demos.
 */
const DEMOS = [
  { href: "/jev", title: "Ask AI", body: "Demo: Two questions made from A’s nonce, answered by an AI, and bound as B." },
  { href: "/generate", title: "Generate image", body: "Demo: A picture drawn by code from A’s nonce and bound as B." },
  { href: "/exam", title: "Sealed exam", body: "Demo: Twenty benchmark questions made from A’s nonce, a model’s answers bound as B, checked offline." },
];
const HOME = [
  { href: "/demos", title: "Make a BitGraph", body: "Drop any file. Its hash is bound at the next place in line, and the file stays with you." },
  { href: "/ledger", title: "View the ledger", body: "Every BitGraph in order, each one checkable by anyone." },
  { href: "/examples", title: "Demos", body: "Three things made between two BitGraphs: an AI’s answers, a picture, and a sealed exam." },
];

type Card = { href: string; title: string; body: string };

function Cards({ cards, row }: { cards: Card[]; row: boolean }) {
  return (
    <div className={`sx-cards is-stack${row ? " is-row" : ""}`}>
      {cards.map((d) => (
        <a key={d.href} className="tl-card sx-link" href={d.href}>
          <h3>{d.title}</h3>
          <p>{d.body}</p>
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
