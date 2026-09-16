import React from "react";

/**
 * Splits a string on backticks and renders the odd-indexed segments as
 * monospace inline code. Lets docs prose include code identifiers without
 * needing JSX everywhere.
 *
 * Usage:
 *   renderInline("Verifiers should pin `allowedMeasurements` to known-good values.")
 */
export function renderInline(text: string): React.ReactNode {
  return text.split("`").map((part, i) =>
    i % 2 === 1 ? (
      <code
        key={i}
        className="font-mono text-[0.95em] bg-[color:var(--code-bg)] text-[color:var(--accent)] px-1.5 py-0.5 rounded"
      >
        {part}
      </code>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    ),
  );
}
