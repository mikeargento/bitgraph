"use client";

// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The ledger's one control (2026-10-17): find a BitGraph by its hash. Every
 * BitGraph is kept, and the hash is the lookup, so the ledger is private: there
 * is no list to browse, and a record is found only by someone who holds its
 * file, its SHA-256 or a link its maker shared (the 2026-10-09 ruling against a
 * browsable ledger stands).
 *
 * A file is hashed here, in the browser; its bytes never leave the machine.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

function bytesToB64Url(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A SHA-256 typed or pasted as hex or base64 (either alphabet), as the proof page's URL form; null when it is not one. */
function digestFromText(raw: string): string | null {
  const t = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(t)) {
    const b = new Uint8Array(32);
    for (let i = 0; i < 32; i++) b[i] = parseInt(t.slice(i * 2, i * 2 + 2), 16);
    return bytesToB64Url(b);
  }
  const u = t.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return /^[A-Za-z0-9_-]{43}$/.test(u) ? u : null;
}

export function LedgerLookup() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const go = (digest: string) => router.push(`/proof/${digest}`);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const d = digestFromText(text);
    if (d === null) { setError("That is not a SHA-256: 64 hex characters, or 43 to 44 base64."); return; }
    setError(null);
    go(d);
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <form onSubmit={onSubmit} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          aria-label="SHA-256 of the bits"
          placeholder="SHA-256, hex or base64"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          style={{ flex: "1 1 320px", minWidth: 0, fontFamily: "var(--font-mono)", fontSize: 15, padding: "12px 14px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--paper, #fff)", color: "var(--ink)" }}
        />
        <button type="submit" className="bg-action-link" style={{ flex: "none", margin: 0 }}>Find</button>
      </form>
      {error ? <p role="alert" style={{ margin: "14px 0 0", color: "var(--err)" }}>{error}</p> : null}
    </div>
  );
}
