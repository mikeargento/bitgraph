"use client";

import { useState } from "react";
import { FileDrop } from "@/components/file-drop";

/**
 * Get the Ethereum anchors for a BitGraph you already hold.
 *
 * The case this exists for (Mike, 2026-09-15): "they have a proof and the
 * original files but need the eth proof because they dont have it or they need
 * a record of it for their files." A recording exported before its anchors
 * landed carries none, and a proof handed to someone else may never have had
 * them. The holder knows nothing except what is inside their proof.json, and
 * what is inside it is enough: an epoch and a counter.
 *
 * ⚠️ THE ANCHOR ROUTES ARE KEYED BY COUNTER AND EPOCH, NEVER BY DIGEST. That
 * is why they survived the 2026-09-08 cutover when the by-digest index did
 * not, and it is why this works for a recording whose own proof page no longer
 * resolves. Nothing about the file is sent: an epoch id and a counter leave
 * this page, and the proof is read in the browser.
 *
 * ⚠️ AN ABSENCE SAYS WHICH KIND IT IS. "No anchor has landed on this side yet"
 * and "we could not reach the ledger" are opposite claims and only one is
 * about the holder. The route's own `bound` note is shown verbatim rather than
 * flattened into "not found".
 */

type Side = "before" | "after";

interface Found {
  side: Side;
  proof?: Record<string, unknown>;
  blockNumber?: number;
  blockTimeISO?: string;
  counter?: string;
  /** Present instead of a proof: the ledger's own words for why there is none. */
  note?: string;
  state?: string;
}

const b64url = (s: string) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  /* Freed on the next tick; revoking straight away races the download in
     Safari, which has not read the blob yet when click() returns. */
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AnchorRecovery() {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [position, setPosition] = useState<string | null>(null);
  const [found, setFound] = useState<Found[] | null>(null);

  async function onFile(file: File) {
    setBusy(true);
    setProblem(null);
    setFound(null);
    setPosition(null);
    try {
      const text = await file.text();
      let proof: { commit?: { counter?: unknown; epochId?: unknown } };
      try {
        proof = JSON.parse(text) as typeof proof;
      } catch {
        setProblem("That file is not JSON, so there is no position in it to look up.");
        return;
      }
      const counter = proof.commit?.counter;
      const epochId = proof.commit?.epochId;
      if (typeof counter !== "string" || typeof epochId !== "string") {
        setProblem("That JSON carries no commit counter and epoch, so it is not a BitGraph proof.");
        return;
      }
      setPosition(counter);

      const epoch = b64url(epochId);
      const sides: Side[] = ["before", "after"];
      const out: Found[] = [];
      for (const side of sides) {
        const url = `/api/proofs/anchors?counter=${encodeURIComponent(counter)}&epoch=${encodeURIComponent(epoch)}${side === "before" ? "&before=1" : ""}`;
        let res: Response;
        try {
          res = await fetch(url);
        } catch {
          /* Ours, not the ledger's. It must not read as "no anchor exists". */
          out.push({ side, note: "This side could not be fetched. That is not a statement about whether an anchor exists.", state: "unavailable" });
          continue;
        }
        if (!res.ok) {
          out.push({ side, note: `The ledger answered ${res.status}. That is not a statement about whether an anchor exists.`, state: "unavailable" });
          continue;
        }
        const body = await res.json() as {
          anchors?: Array<Record<string, unknown>>;
          bound?: { state?: string; note?: string };
        };
        const anchor = body.anchors?.[0];
        if (!anchor) {
          out.push({ side, note: body.bound?.note ?? "The ledger returned no anchor for this side.", state: body.bound?.state });
          continue;
        }
        const commit = anchor.commit as { counter?: string; anchor?: { blockNumber?: number } } | undefined;
        const meta = anchor.metadata as { anchor?: { blockNumber?: number; blockTimeISO?: string } } | undefined;
        out.push({
          side,
          proof: anchor,
          counter: commit?.counter,
          blockNumber: meta?.anchor?.blockNumber ?? commit?.anchor?.blockNumber,
          blockTimeISO: meta?.anchor?.blockTimeISO,
        });
      }
      setFound(out);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 34 }}>
      <div className="bg-page-title" style={{ marginBottom: 6 }}>Get the anchors for a BitGraph</div>
      <p style={{ fontSize: 15, lineHeight: 1.65, color: "var(--text)", margin: "0 0 14px", maxWidth: 640 }}>
        Drop a <code>proof.json</code> and this finds the two Ethereum anchors that bracket its
        position, to download and keep beside your files. The proof is read here; only its epoch
        and counter are sent.
      </p>

      <div className="bitgraph-camera">
        <FileDrop
          onFile={(f: File) => { void onFile(f); }}
          accept="application/json,.json"
          disabled={busy}
          headline={busy ? "Reading the ledger…" : "Drop a proof.json"}
          hint="Nothing about your file leaves this page"
        />
      </div>

      {problem && (
        <p style={{ fontSize: 14, color: "var(--err)", margin: "14px 0 0" }}>{problem}</p>
      )}

      {found && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 13, color: "var(--dim)", marginBottom: 8 }}>
            Position #{position}
          </div>
          {found.map((f) => (
            <div
              key={f.side}
              style={{
                border: "1px solid var(--line)", borderRadius: "var(--radius-card)",
                background: "var(--panel)", padding: "14px 16px", marginBottom: 10,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--ink)", marginBottom: 6 }}>
                {f.side === "before" ? "The anchor below it" : "The anchor above it"}
              </div>
              {f.proof ? (
                <>
                  <div style={{ fontSize: 15, color: "var(--text)" }}>
                    Position #{f.counter}
                    {f.blockNumber !== undefined && <> · Ethereum block {f.blockNumber.toLocaleString()}</>}
                    {f.blockTimeISO && (
                      <> · {new Date(f.blockTimeISO).toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short" })}</>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 8 }}>
                    <button
                      className="bg-action-link"
                      style={{ margin: 0 }}
                      onClick={() => download(
                        f.blockNumber ? `ethereum-anchor-${f.blockNumber}.json` : `anchor-${f.side}.json`,
                        f.proof,
                      )}
                    >
                      <span>Download JSON</span>
                      <span className="arrow" aria-hidden>&darr;</span>
                    </button>
                    {f.blockNumber !== undefined && (
                      <a
                        className="bg-action-link"
                        style={{ margin: 0 }}
                        href={`https://etherscan.io/block/${f.blockNumber}`}
                        target="_blank"
                        rel="noopener"
                      >
                        Etherscan
                      </a>
                    )}
                  </div>
                </>
              ) : (
                /* ⚠️ THE LEDGER'S OWN WORDS. Not "not found". */
                <div style={{ fontSize: 14, color: "var(--dim)" }}>{f.note}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
