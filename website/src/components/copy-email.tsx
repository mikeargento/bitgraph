"use client";

import { useState } from "react";

/* The contact surface (2026-08-28): the address itself, with a copy action.
   Replaces the restored Resend form, which lived one day this time (its
   second death: cut 2026-06-25, restored 2026-08-27, cut 2026-08-28). An
   email address is the honest enterprise door: no form to babysit, no
   delivery dependency, and the reply thread starts in the buyer's own mail.
   The address is a mailto link in the action voice; Copy flips to Copied
   for a beat and asks nothing else. */

const EMAIL = "mike@bitgraph.ing";

export function CopyEmail({ fontSize = 14 }: { fontSize?: number }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(EMAIL);
      ok = true;
    } catch {
      /* The async API can refuse (permissions, embedded contexts). The old
         selection path still works there. */
      try {
        const ta = document.createElement("textarea");
        ta.value = EMAIL;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        ta.remove();
      } catch {
        /* Both refused: the mailto link beside this still works, and the
           address is selectable text. */
      }
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 10 }}>
      <a
        href={`mailto:${EMAIL}`}
        style={{ fontSize, fontWeight: 600, letterSpacing: "-0.01em", color: "#0065A4", textDecoration: "none" }}
      >
        {EMAIL}
      </a>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : `Copy ${EMAIL}`}
        style={{
          appearance: "none",
          border: "none",
          background: "none",
          padding: 0,
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: fontSize - 1,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          color: copied ? "#4b5563" : "#0065A4",
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
