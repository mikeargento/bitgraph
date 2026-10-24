"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The copy button every copyable field wears, Ask AI's included (2026-10-21): the two outlined sheets from the
 * code blocks, a check for a moment after the copy. Shared by the proof page and the demo pages.
 */
import { useState } from "react";

export function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  return [copied, (text: string) => {
    try { void navigator.clipboard.writeText(text); } catch { /* not available */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }];
}

export function CopyIcon({ copied, onCopy, label }: { copied: boolean; onCopy: () => void; label: string }) {
  return (
    <button type="button" className={`pv-copy${copied ? " is-copied" : ""}`} aria-label={copied ? "Copied" : `Copy ${label}`} title={copied ? "Copied" : "Copy"} onClick={(e) => { e.stopPropagation(); onCopy(); }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {copied ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <><rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" /></>}
      </svg>
    </button>
  );
}
