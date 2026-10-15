// Copyright (c) 2024-2026 Argento Computing Inc. All rights reserved.
/**
 * What one click on a demo page does, in the home page's structure (Mike, 2026-10-15: "should these set up pages just
 * mimic home style?"): a hairline, the kicker, "Three steps." and three numbered cards in a row, the home's own classes
 * (.home-section, .home-kicker, .home-cards.home-steps). A sibling of the demo in the page's frame; CSS hides the section
 * once the click runs (the demo's button block folds away). Before 2026-10-15 these were cards beside the headline, and
 * before that a strip under it (2026-10-12).
 */
export function DemoSteps({ steps }: { steps: ReadonlyArray<{ title: string; text: string; link?: { href: string; label: string } }> }) {
  return (
    <section className="home-section demo-section section-grey" aria-label="What happens">
      <p className="home-kicker">What happens</p>
      <h2>Three steps.</h2>
      <div className="home-cards home-steps">
        {steps.map((s) => (
          <div key={s.title} className="home-card">
            <h3>{s.title}</h3>
            <p>{s.text}{s.link && <> <a href={s.link.href}>{s.link.label}</a>.</>}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
