"use client";
import { useState } from "react";
import { commitmentForProof, type BitGraphProof } from "@mikeargento/bitgraph-verify";
import { ART_ALGORITHM_V11, ART_ALGORITHM_V12, ART_ALGORITHM_V13, artSize, toBase64Url } from "@/lib/commitment-art";
import { makePrint, PRINTABLE, printSizeOf } from "@/lib/art-print";

/**
 * A Reprint pill in the header of a picture the proof page redrew from its proof (Mike, 2026-10-08: "proof pages
 * are what ill share", then "its messy": one pill, no paragraphs). Anyone holding the link can make it. A reprint is
 * the same drawing redrawn larger from the same commitment; it is not the recorded file, so the proof covers
 * the recorded file, and the note says so.
 */
export function ArtReprint({ proof, algorithm }: { proof: BitGraphProof; algorithm: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const portrait = algorithm === ART_ALGORITHM_V11 || algorithm === ART_ALGORITHM_V12 || algorithm === ART_ALGORITHM_V13;
  const noun = portrait ? "portrait" : "picture";
  const rec = artSize(algorithm), ps = printSizeOf(algorithm);
  const printable = PRINTABLE.includes(algorithm);
  const reprint = async () => {
    if (busy || !proof.slotAllocation) return;
    setBusy(true); setErr("");
    try {
      const commitment = toBase64Url(commitmentForProof(proof, proof.slotAllocation as never));
      const counter = Number(proof.commit?.counter ?? 0);
      const bytes = await makePrint({ commitment, counter, digestB64: proof.artifact.digestB64, algorithm });
      const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: "image/png" }));
      const a = document.createElement("a");
      a.href = url; a.download = `bitgraph-${noun}-${counter}-reprint-${ps.width}x${ps.height}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setErr(`The reprint could not be drawn: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(false); }
  };
  if (!printable) return null;
  return (
    <button type="button" className="bg-action-link pv-pill" onClick={reprint} disabled={busy} style={{ flexShrink: 0 }}
      title={err || `Drawn again from the proof at ${ps.width.toLocaleString("en-US")} \u00d7 ${ps.height.toLocaleString("en-US")} for printing. The proof covers the recorded ${rec.width.toLocaleString("en-US")} \u00d7 ${rec.height.toLocaleString("en-US")} file, not the reprint.`}>
      {busy ? "Drawing\u2026" : err ? "Try again" : "Save for print"}
    </button>
  );
}
