// Copyright (c) 2024-2026 Argento Computing Inc. All rights reserved.
/**
 * What one click on a demo page does, in three cards under its button (Mike, 2026-10-12): the home page's cards,
 * the same width and look ("cards dont match home"), without links. A sibling of the demo in the page's frame, so they
 * span the frame as home's do; CSS hides them once the click runs (the demo's button block folds away).
 */
export function DemoSteps({ steps }: { steps: ReadonlyArray<{ title: string; text: string; link?: { href: string; label: string } }> }) {
  return (
    <div className="home-cards demo-steps">
      {steps.map((s, i) => (
        <div key={s.title} className="home-card demo-step">
          {/* Numbered (2026-10-14): the three cards are an order, and order is what the page proves. */}
          <span className="demo-step-n" aria-hidden="true">{i + 1}</span>
          <h2>{s.title}</h2>
          <p>{s.text}{s.link && <> <a href={s.link.href}>{s.link.label}</a>.</>}</p>
        </div>
      ))}
    </div>
  );
}
