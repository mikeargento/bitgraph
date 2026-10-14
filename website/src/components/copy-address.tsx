"use client";
import { useState } from "react";

/** Copies the contact address (Mike, 2026-10-14: "give them a copy button"); says Copied for a moment when the clipboard took it. */
export function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="contact-copy"
      aria-label={copied ? "Copied" : "Copy the email address"}
      onClick={() => {
        navigator.clipboard.writeText(address).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }).catch(() => { /* a refused write (an unfocused window): the address is right there to select */ });
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="1.5" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></svg>
      {copied ? "Copied" : "Copy email address"}
    </button>
  );
}
