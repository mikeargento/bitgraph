"use client";

import { useRef, useState } from "react";

/**
 * The copy control for a code block, sitting in the block's header row.
 *
 * It takes no text. On click it reads the block's own `pre`, so a snippet is
 * never written twice: the thing on screen and the thing on the clipboard
 * cannot drift, and adding the control to a block is one self-closing tag with
 * nothing to keep in sync.
 *
 * A white pill with the two-sheet mark and the word Copy, the site's button shape since the
 * postseason look (2026-09-29). It turns green and says Copied for a moment after a click.
 */
export function CopyCode() {
  const ref = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);

  return (
    <button
      ref={ref}
      type="button"
      className={copied ? "code-copy is-copied" : "code-copy"}
      aria-label={copied ? "Copied" : "Copy this snippet"}
      title={copied ? "Copied" : "Copy"}
      onClick={() => {
        const pre = ref.current?.closest(".code-block")?.querySelector("pre");
        if (!pre) return;
        // Say Copied only when the clipboard took it; a refused write (an unfocused window,
        // a denied permission) leaves the button as it was instead of throwing.
        navigator.clipboard.writeText(pre.textContent ?? "").then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }, () => {});
      }}
    >
      {/* An icon in the block's corner, the common chat-app copy button (2026-10-18): two
          outlined sheets, then a check for a moment after the copy. */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {copied ? (
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        ) : (
          <>
            <rect x="9" y="9" width="12" height="12" rx="2.5" />
            <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
          </>
        )}
      </svg>
      <span className="code-copy-label">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
