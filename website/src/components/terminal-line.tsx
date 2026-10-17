// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The line at the top of the home page (Mike, 2026-10-17: "position commitment for
 * all of computing ... it shouldnt be written as a headline"), at a terminal prompt in
 * code text, at text size. It typed itself for an hour; Mike: "forget the typing".
 * It is the page's heading for screen readers.
 */
export function TerminalLine({ text }: { text: string }) {
  return (
    <div className="term-line" role="heading" aria-level={1}>
      <span className="term-prompt" aria-hidden="true">%</span>
      <span className="term-text">{text}</span>
    </div>
  );
}
