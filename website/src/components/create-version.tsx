"use client";
// Copyright (c) 2024-2026 Mike Argento. All rights reserved.

/**
 * Create a Version — the possession rule rendered as interface.
 *
 * The row exists only while the ORIGINAL BYTES are in hand: the proof
 * page sets cachedFile only after hashing a supplied file against this
 * proof's digest, so the row's presence means the possession hash is
 * computable. A link-reached reader has no bytes and no row. No file,
 * no version.
 *
 * A recording is public and unownable; a version is the holdable
 * object of the same work. Keyless and bearer: the salted file IS the
 * version, so custody precedes permanence — the download comes before
 * the recording, because a recorded digest whose bytes were lost is
 * permanently mute.
 *
 * Claims discipline: a version proves held and placed. The copy never
 * says owns, never says proves authorship. The body is free text,
 * sealed inside the version; only the digest is ever recorded.
 */

import { useState } from "react";
import { commitDigest } from "@/lib/bitgraph";
import { mintVersionClient } from "@/lib/version-client";

type Stage =
  | { kind: "collapsed" }
  | { kind: "form" }
  | { kind: "working"; step: string }
  | { kind: "done"; recorded: boolean }
  | { kind: "error"; message: string };

export default function CreateVersion({ fileName, data }: { fileName: string; data: ArrayBuffer }) {
  const [stage, setStage] = useState<Stage>({ kind: "collapsed" });

  async function run() {
    try {
      setStage({ kind: "working", step: "Minting…" });
      // No note, no form: JUST the cryptography differentiates a version.
      // The salt is the sole difference between siblings at the bytes
      // level; the recording's position is the sole difference on the
      // chain. A version says nothing except: one of one, of that work,
      // held at minting. Words belong to the custody layer, signed.
      const minted = await mintVersionClient(new Uint8Array(data));

      // Custody before permanence: the version leaves the browser first.
      const blob = new Blob([minted.bytes as BlobPart], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = minted.fileName;
      a.click();
      URL.revokeObjectURL(url);

      setStage({ kind: "working", step: "Version downloaded · recording…" });
      let recorded = true;
      try {
        await commitDigest(minted.digestB64);
      } catch {
        recorded = false;
      }
      setStage({ kind: "done", recorded });
    } catch (err) {
      setStage({ kind: "error", message: (err as Error).message });
    }
  }

  if (stage.kind === "collapsed") {
    return (
      <button type="button" className="bg-action-link" onClick={() => setStage({ kind: "form" })}>
        <span>Create a Version</span>
        <span className="arrow" aria-hidden>&rarr;</span>
      </button>
    );
  }

  return (
    <div style={{ background: "#fff", border: "1px solid #d0d5dd", padding: "16px 18px" }}>
      {stage.kind === "form" && (
        <>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#111827", marginBottom: 6 }}>
            Create a Version of {fileName}
          </div>
          <p style={{ fontSize: 14, color: "#374151", margin: "0 0 10px" }}>
            The recording is public; a version is yours to hold. This mints a small one-of-a-kind
            file that references this BitGraph, then records it at its own causal position. The
            file never leaves this browser; only the version&apos;s digest is recorded, and the
            version stays sealed until you show it. Versions carry no message: only the
            cryptography differentiates them.
          </p>
          <div style={{ display: "flex", gap: 18, marginTop: 10 }}>
            <button type="button" className="bg-action-link" style={{ padding: 0 }} onClick={() => void run()}>
              <span>Mint, download, and record it</span>
              <span className="arrow" aria-hidden>&rarr;</span>
            </button>
            <button
              type="button"
              onClick={() => setStage({ kind: "collapsed" })}
              style={{ background: "none", border: "none", color: "#6b7280", fontSize: 14, cursor: "pointer", padding: 0 }}
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {stage.kind === "working" && <div style={{ fontSize: 14, color: "#374151" }}>{stage.step}</div>}

      {stage.kind === "done" && (
        <div style={{ fontSize: 14, color: "#374151" }}>
          <div style={{ fontWeight: 600, color: "#111827", marginBottom: 6 }}>
            {stage.recorded ? "Version created." : "Version minted and downloaded."}
          </div>
          {stage.recorded ? (
            <p style={{ margin: 0 }}>
              Keep <code>bitgraph-version.json</code>: the version IS that file. Its recording is
              permanent; the file in your hands is the only readable copy until you choose to share
              it.
            </p>
          ) : (
            <p style={{ margin: 0 }}>
              Recording did not land (the recorder may be rotating). The version is safe: drop the
              downloaded <code>bitgraph-version.json</code> on the home page to record it.
            </p>
          )}
        </div>
      )}

      {stage.kind === "error" && <div style={{ fontSize: 14, color: "#dc2626" }}>{stage.message}</div>}
    </div>
  );
}
