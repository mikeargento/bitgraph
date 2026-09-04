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
 * Square corners and the two-sheet mark, like the rest of the site. Grey until
 * hover so a header full of these stays quiet.
 */
export function CopyCode() {
  const ref = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);

  return (
    <button
      ref={ref}
      type="button"
      className="code-copy"
      aria-label={copied ? "Copied" : "Copy this snippet"}
      title={copied ? "Copied" : "Copy"}
      onClick={() => {
        const pre = ref.current?.closest(".code-block")?.querySelector("pre");
        if (!pre) return;
        void navigator.clipboard.writeText(pre.textContent ?? "");
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        {copied ? (
          <path d="M2.5 8.5 L6 12 L13.5 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
        ) : (
          <>
            {/* The front sheet is filled with the header's own background so it
                occludes the back one. That overlap is what makes the mark read
                as two sheets rather than as a grid. */}
            <rect x="5.75" y="1.75" width="8.5" height="8.5" stroke="currentColor" strokeWidth="1.3" />
            <rect x="1.75" y="5.75" width="8.5" height="8.5" fill="#f9fafb" stroke="currentColor" strokeWidth="1.3" />
          </>
        )}
      </svg>
    </button>
  );
}
