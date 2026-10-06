"use client";

/**
 * The image generator (Mike, 2026-10-05): one button. Each click opens a position, shows its
 * commitment, draws an image from that commitment alone (bitgraph-art/1), records the image in
 * that same position, and reads the proof back before saying so. See lib/art-position.ts for the
 * order and lib/commitment-art.ts for the drawing rules.
 *
 * Claims, exactly: the success line says the image was generated from its position commitment
 * and recorded in that position. The technical details say the commitment-bearing file could not
 * have been completed before the commitment existed, under the protocol's unpredictability
 * assumptions. Nothing here claims originality, authorship, a camera, an AI, or anything about
 * what this browser did.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createArtImage, verifyArtFile, ArtError, type ArtStage, type ArtVerification, type MadeArtImage, type OpenedPosition } from "@/lib/art-position";
import { buildCarrierForProof } from "@/lib/carrier-site";
import { PUBLISHED_PCR0S } from "@/lib/enclave-measurements";
import { ART_ALGORITHM } from "@/lib/commitment-art";

const STEPS: Array<{ key: ArtStage; label: string }> = [
  { key: "opening", label: "Opening position" },
  { key: "generating", label: "Generating image" },
  { key: "recording", label: "Recording image" },
  { key: "ready", label: "Ready" },
];
const stepIndex = (s: ArtStage | null) => (s === null ? -1 : s === "verifying" ? 2 : STEPS.findIndex((x) => x.key === s));
const urlSafe = (b64: string) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const RESULT_WORD: Record<string, string> = { TRUE: "Passes", FALSE: "Fails", UNDETERMINED: "Not yet determined" };

type Built = { bytes: Uint8Array; fileName: string; ceilingInTime: string; ceiling: string };

export function ArtMaker() {
  const [stage, setStage] = useState<ArtStage | null>(null);
  const [failedAt, setFailedAt] = useState<number>(-1);
  const stageRef = useRef<ArtStage | null>(null);
  const [position, setPosition] = useState<OpenedPosition | null>(null);
  const [made, setMade] = useState<MadeArtImage | null>(null);
  const [error, setError] = useState<{ message: string; recorded: boolean } | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [built, setBuilt] = useState<Built | null>(null);
  const [building, setBuilding] = useState(false);
  const [verification, setVerification] = useState<{ result: ArtVerification; source: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const busy = useRef(false);

  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl]);

  const create = useCallback(async () => {
    if (busy.current) return; // one image at a time: a second click while one is running does nothing
    busy.current = true;
    setError(null); setMade(null); setBuilt(null); setVerification(null); setPosition(null); setFailedAt(-1);
    if (imageUrl) { URL.revokeObjectURL(imageUrl); setImageUrl(null); }
    try {
      const r = await createArtImage({ onStage: (s, p) => { stageRef.current = s; setStage(s); if (p) setPosition(p); } });
      setMade(r);
      setImageUrl(URL.createObjectURL(new Blob([r.png as BlobPart], { type: "image/png" })));
    } catch (e) {
      setFailedAt(stepIndex(stageRef.current));
      setStage(null);
      setError(e instanceof ArtError ? { message: e.message, recorded: e.recorded } : { message: e instanceof Error ? e.message : String(e), recorded: false });
    } finally {
      busy.current = false;
    }
  }, [imageUrl]);

  /** The image with its proof inside, built from what followed the commit (anchors, the Base block). */
  const buildDownload = useCallback(async (): Promise<Built | null> => {
    if (!made) return null;
    if (built) return built;
    setBuilding(true);
    try {
      const b = await buildCarrierForProof(made.png, made.proof as never, `bitgraph-image-${made.position.slotCounter}.png`, { waitForCeilingMs: 20_000 });
      const out = { bytes: b.bytes, fileName: b.fileName, ceilingInTime: b.ceilingInTime, ceiling: b.ceiling };
      setBuilt(out);
      return out;
    } catch (e) {
      setError({ message: `The download could not be built: ${e instanceof Error ? e.message : String(e)}`, recorded: true });
      return null;
    } finally {
      setBuilding(false);
    }
  }, [made, built]);

  const download = useCallback(async () => {
    const b = await buildDownload();
    if (!b) return;
    const url = URL.createObjectURL(new Blob([b.bytes as BlobPart], { type: "image/png" }));
    const a = document.createElement("a");
    a.href = url; a.download = b.fileName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, [buildDownload]);

  const verifyThis = useCallback(async () => {
    setChecking(true);
    try {
      const b = await buildDownload();
      if (b) setVerification({ result: await verifyArtFile(b.bytes, PUBLISHED_PCR0S), source: "this image, with the proof built into its download" });
    } finally {
      setChecking(false);
    }
  }, [buildDownload]);

  const verifyDropped = useCallback(async (file: File) => {
    setChecking(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setVerification({ result: await verifyArtFile(bytes, PUBLISHED_PCR0S), source: file.name });
    } finally {
      setChecking(false);
    }
  }, []);

  const running = stage !== null && stage !== "ready";
  const at = stepIndex(stage);

  return (
    <div className="art">
      <button type="button" className="bg-action-link is-make art-go" onClick={create} disabled={running} aria-busy={running}>
        {made ? "Create another" : "Create a BitGraph image"}
      </button>

      {(stage !== null || error) && (
        <ol className="art-steps" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s.key} className={i === failedAt ? "failed" : i < at || i < failedAt || stage === "ready" ? "done" : i === at ? "now" : ""}>{s.label}</li>
          ))}
        </ol>
      )}

      {position && (
        <div className="art-commitment">
          <div className="art-label">Position commitment, BitGraph position {Number(position.slotCounter).toLocaleString("en-US")}, opened after Ethereum block {position.floorBlock.toLocaleString("en-US")}</div>
          <code className="break">{position.commitment}</code>
        </div>
      )}

      {error && (
        <div className="art-error" role="alert">
          <p>{error.message}</p>
          {error.recorded && made && <p>A proof was returned for this image; it is not called verified here. <a href={`/proof/${urlSafe(made.digestB64)}`}>Open its proof page</a>.</p>}
        </div>
      )}

      {made && imageUrl && (
        <div className="art-result">
          <figure className="art-figure">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} width={1024} height={1056} alt={`Abstract geometric image drawn from position commitment ${made.position.commitment}`} />
            <figcaption>Preview of the recorded image. The download is the same image with its proof inside.</figcaption>
          </figure>
          <p className="art-success">This image was generated from its position commitment and recorded in that position.</p>
          <div className="actions art-actions">
            <button type="button" className="bg-action-link is-make" onClick={download} disabled={building}>{building ? "Building the download" : "Download image and proof"}</button>
            <button type="button" className="bg-action-link" onClick={verifyThis} disabled={checking || building}>{checking ? "Verifying" : "Verify"}</button>
            <a className="bg-action-link" href={`/proof/${urlSafe(made.digestB64)}`}>Proof page</a>
          </div>

          <details className="art-details">
            <summary>Technical details</summary>
            <p>Under the protocol&rsquo;s unpredictability assumptions, this exact commitment-bearing artifact could not have been completed before the commitment became available.</p>
            <p>The commitment is the drawing&rsquo;s only input. Every shape, colour and position is read from a SHA-256 stream over it, with the algorithm, the size and the palettes fixed by {ART_ALGORITHM}. The strip along the bottom spells the commitment&rsquo;s 256 bits, one 4-pixel cell each. Anyone can redraw the image from the commitment and compare it pixel for pixel; nobody could have drawn it before the commitment existed.</p>
            <p>This says nothing about who made the image, whether it is original, or what any program or browser did. It shows when, at the earliest, these bytes could have been finished, and the position they were recorded in.</p>
            <dl>
              <dt>Algorithm</dt><dd><code>{made.manifest.algorithm}</code>, {made.manifest.width} x {made.manifest.height}</dd>
              <dt>Position</dt><dd>{Number(made.position.slotCounter).toLocaleString("en-US")}, epoch <code>{made.position.epochId.slice(0, 8)}</code>, after Ethereum block {made.position.floorBlock.toLocaleString("en-US")}</dd>
              <dt>Commitment</dt><dd><code className="break">{made.position.commitment}</code></dd>
              <dt>Recipe SHA-256</dt><dd><code className="break">{made.manifest.recipeSha256}</code></dd>
              <dt>Pixels SHA-256</dt><dd><code className="break">{made.manifest.pixelsSha256}</code></dd>
              <dt>Recorded file SHA-256</dt><dd><code className="break">{made.digestB64}</code> (base64)</dd>
            </dl>
          </details>
        </div>
      )}

      {verification && <VerificationReport v={verification.result} source={verification.source} />}

      <label className="art-drop">
        <span>Check a downloaded image</span>
        <input type="file" accept="image/png,.png" disabled={checking} onChange={(e) => { const f = e.target.files?.[0]; if (f) void verifyDropped(f); e.target.value = ""; }} />
      </label>
    </div>
  );
}

function VerificationReport({ v, source }: { v: ArtVerification; source: string }) {
  const rows: Array<{ name: string; result: string; detail: string }> = [
    { name: "The exact file matches its recorded digest", result: v.digest.result, detail: v.digest.detail },
    { name: "The position, the binding, the signatures and the anchors pass the published verifier", result: v.protocol.result, detail: v.protocol.ceiling === "present" ? v.protocol.detail : `${v.protocol.detail} The closing anchor or the Base block is not in this file yet, so anchoring is pending.` },
    { name: "Regenerating the image from the authenticated commitment gives these pixels", result: v.regenerated.result, detail: v.regenerated.detail },
    { name: "The pixel strip decodes to that same commitment", result: v.strip.result, detail: v.strip.detail },
  ];
  const headline = v.overall === "complete" ? "Every check passes." : v.overall === "pending" ? "Not complete yet: nothing fails, and at least one check is still pending." : "This file does not verify.";
  return (
    <section className={`art-verify art-verify-${v.overall}`} aria-live="polite">
      <h2>{headline}</h2>
      <p className="art-label">Checked on this machine: {source}</p>
      <ul>
        {rows.map((r) => (
          <li key={r.name}>
            <span className={`art-result-word art-${r.result.toLowerCase()}`}>{RESULT_WORD[r.result] ?? r.result}</span>
            <span className="art-check-name">{r.name}</span>
            <span className="art-check-detail">{r.detail}</span>
          </li>
        ))}
      </ul>
      {v.commitment && <p className="art-label">Authenticated commitment: <code className="break">{v.commitment}</code></p>}
    </section>
  );
}
