"use client";

import { useState } from "react";

/**
 * Copy control for the MCP endpoint URL. Styled as an arrow-link action
 * (product rule: actions are blue arrow links, not buttons), rendered as a
 * <button> element for keyboard and screen-reader access.
 */
export function CopyUrl({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 600,
        fontFamily: "inherit",
        color: copied ? "#111827" : "#0065A4",
      }}
    >
      {copied ? "Copied" : "Copy →"}
    </button>
  );
}
