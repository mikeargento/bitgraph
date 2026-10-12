// Copyright (c) 2024-2026 Argento Computing Inc. All rights reserved.
/**
 * What one click on a demo page does, in three cards under its button (Mike, 2026-10-12): the home page's cards,
 * the same width and look ("cards dont match home"), without links. A sibling of the demo in the page's frame, so they
 * span the frame as home's do; CSS hides them once the click runs (the demo's button block folds away).
 */
export function DemoSteps({ steps }: { steps: ReadonlyArray<{ title: string; text: string }> }) {
  return (
    <div className="home-cards demo-steps">
      {steps.map((s) => (
        <div key={s.title} className="home-card demo-step">
          <h2>{s.title}</h2>
          <p>{s.text}</p>
        </div>
      ))}
    </div>
  );
}
