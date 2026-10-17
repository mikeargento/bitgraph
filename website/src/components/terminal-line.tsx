// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The line at the top of the home page (Mike, 2026-10-17: "position commitment for
 * all of computing ... it shouldnt be written as a headline"), in
 * code text, at text size. It typed itself for an hour; Mike: "forget the typing".
 * A true h1 since 2026-10-17 (Mike: "make this a true h1 now not toooooo big though"). No % prompt (Mike, 2026-10-17: "% drop these").
 */
export function TerminalLine({ text }: { text: string }) {
  return (
    <h1 className="term-line">
      <span className="term-text">{text}</span>
    </h1>
  );
}
