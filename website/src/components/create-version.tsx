"use client";
// Copyright (c) 2024-2026 Mike Argento. All rights reserved.

/**
 * Create a Version — one action, no form.
 *
 * The row exists only while the ORIGINAL BYTES are in hand: the proof
 * page sets cachedFile only after hashing a supplied file against this
 * proof's digest, so the row's presence means the possession hash is
 * computable. A link-reached reader has no bytes and no row. No file,
 * no version.
 *
 * The click does everything: mint, download, record. No message box,
 * no confirm step — a version is a thing, not a statement, and JUST
 * the cryptography differentiates it: the salt is the sole difference
 * between siblings at the bytes level, the recording's position the
 * sole difference on the chain. Words belong to the custody layer.
 *
 * Custody precedes permanence: the download comes before the
 * recording, because a recorded digest whose bytes were lost is
 * permanently mute.
 */

import { useState } from "react";
import { commitDigest } from "@/lib/bitgraph";
import { mintVersionClient } from "@/lib/version-client";

type Stage =
  | { kind: "idle" }
  | { kind: "working"; step: string }
  | { kind: "done"; recorded: boolean }
  | { kind: "error"; message: string };

export default function CreateVersion({ data }: { fileName: string; data: ArrayBuffer }) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });

  async function run() {
    try {
      setStage({ kind: "working", step: "Minting…" });
      const minted = await mintVersionClient(new Uint8Array(data));

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

  if (stage.kind === "idle") {
    return (
      <>
        <button type="button" className="bg-action-link" onClick={() => void run()}>
          <span>Create a Version</span>
          <span className="arrow" aria-hidden>&rarr;</span>
        </button>
        <div style={{ fontSize: 12.5, color: "#4b5563", paddingBottom: 6 }}>
          A sealed one-of-a-kind file referencing this BitGraph: downloaded to you, then recorded
          at its own causal position
        </div>
      </>
    );
  }

  if (stage.kind === "working") {
    return <div style={{ fontSize: 14, color: "#374151", padding: "8px 0" }}>{stage.step}</div>;
  }

  if (stage.kind === "error") {
    return <div style={{ fontSize: 14, color: "#dc2626", padding: "8px 0" }}>{stage.message}</div>;
  }

  return (
    <div style={{ fontSize: 14, color: "#374151", padding: "8px 0" }}>
      <div style={{ fontWeight: 600, color: "#111827", marginBottom: 4 }}>
        {stage.recorded ? "Version created." : "Version minted and downloaded."}
      </div>
      {stage.recorded ? (
        <p style={{ margin: 0 }}>
          Keep <code>bitgraph-version.json</code>: the version IS that file, sealed until you show
          it. Its recording is permanent.
        </p>
      ) : (
        <p style={{ margin: 0 }}>
          Recording did not land (the recorder may be rotating). The version is safe: drop the
          downloaded <code>bitgraph-version.json</code> on the home page to record it.
        </p>
      )}
    </div>
  );
}
