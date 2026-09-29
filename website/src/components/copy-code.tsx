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
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {copied ? (
          <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <>
            {/* Two rounded sheets (Material's content_copy): the front one is filled with the
                button's own white so it covers the back one. */}
            <rect x="8.5" y="3" width="12.5" height="14" rx="3" stroke="currentColor" strokeWidth="2" />
            <rect x="3" y="7.5" width="12.5" height="13.5" rx="3" fill="#fff" stroke="currentColor" strokeWidth="2" />
          </>
        )}
      </svg>
      <span className="code-copy-label">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
