// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The three demos as cards. Each makes two BitGraphs as bookends: A opens, the work is made from A's nonce, B closes.
 * Every result is a real BitGraph and checks offline. The Demos page stacks them one per row; the home page sets them
 * in a row under the three pictures.
 */
const DEMOS = [
  { href: "/jev", title: "Ask AI", body: "Two questions made from A’s nonce, answered by an AI, and bound as B." },
  { href: "/generate", title: "Generate image", body: "A picture drawn by code from A’s nonce and bound as B." },
  { href: "/exam", title: "Sealed exam", body: "Twenty benchmark questions made from A’s nonce, a model’s answers bound as B, checked offline." },
];

export function DemoCards({ row = false }: { row?: boolean }) {
  return (
    <div className={`sx-cards is-stack${row ? " is-row" : ""}`}>
      {DEMOS.map((d) => (
        <a key={d.href} className="tl-card sx-link" href={d.href}>
          <h3>{d.title}</h3>
          <p>{d.body}</p>
        </a>
      ))}
    </div>
  );
}
