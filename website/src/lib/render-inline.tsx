import React from "react";

/**
 * Splits a string on backticks and renders the odd-indexed segments as
 * monospace inline code. Lets docs prose include code identifiers without
 * needing JSX everywhere.
 *
 * Usage:
 *   renderInline("Verifiers should pin `allowedMeasurements` to known-good values.")
 */
// STAGING ONLY: ⟦new words⟧ render red for review. Strip before push.
function stageNew(text: string, key: string): React.ReactNode {
  if (!text.includes("⟦")) return text;
  return text.split(/⟦|⟧/).map((t, j) => (j % 2 ? <span key={`${key}-${j}`} className="copy-new">{t}</span> : t));
}
export function renderInline(text: string): React.ReactNode {
  return text.split("`").map((part, i) =>
    i % 2 === 1 ? (
      <code
        key={i}
        className="font-mono text-[0.95em] bg-[color:var(--code-bg)] text-[color:var(--accent)] px-1.5 py-0.5"
      >
        {part}
      </code>
    ) : (
      <React.Fragment key={i}>{stageNew(part, String(i))}</React.Fragment>
    ),
  );
}
