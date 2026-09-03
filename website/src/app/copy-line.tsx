"use client";

import { useState } from "react";

/**
 * A command line you can take with you: the text, and a copy control on its
 * right. The same idiom as the docs' CopyUrl (an action link rendered as a
 * button, never a button-shaped button), sitting inside the line's own hairline
 * box rather than above it, because these boxes have no header row.
 *
 * `label` is what the reader sees; `text` is what lands on the clipboard, which
 * is the command without its shell prompt.
 */
export function CopyLine({
  text,
  prompt = "$ ",
  note,
  style,
}: {
  text: string;
  /** Shown before the command, never copied. "" for a URL, which has no prompt. */
  prompt?: string;
  /** A trailing comment, in the prompt's grey. Not copied. */
  note?: string;
  style?: React.CSSProperties;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="install" style={style}>
      <span className="install-text">
        {prompt ? <span className="prompt">{prompt}</span> : null}
        {text}
        {note ? <span className="prompt">{`  ${note}`}</span> : null}
      </span>
      <button
        type="button"
        className="install-copy"
        aria-label={copied ? "Copied" : `Copy ${text}`}
        title={copied ? "Copied" : "Copy"}
        onClick={() => {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {/* Square corners, like everything else here. The front sheet is filled
            with the box's own white so it occludes the back one, which is what
            makes the glyph read as two sheets rather than a grid. */}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          {copied ? (
            <path d="M2.5 8.5 L6 12 L13.5 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
          ) : (
            <>
              <rect x="5.75" y="1.75" width="8.5" height="8.5" stroke="currentColor" strokeWidth="1.3" />
              <rect x="1.75" y="5.75" width="8.5" height="8.5" fill="#fff" stroke="currentColor" strokeWidth="1.3" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
}
