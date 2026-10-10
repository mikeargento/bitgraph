"use client";

/**
 * The proof page's hosted files (?files=<https URL>, lib/hosted-files.ts): fetched, unzipped and
 * matched against the page's own proof in the browser, and shown only on an exact match, always
 * naming the host. Generic: no host, demo or record is named here.
 *
 * Display safety, since bitgraph.ing shows bytes from someone else's host: text is rendered as React
 * text (escaped, never HTML); raster images (PNG, JPEG, GIF, WebP, sniffed from their bytes, not their
 * names) go through blob URLs into <img>; everything else, SVG included, is a download only (an SVG
 * blob opened in a tab would run as a page on this origin). Downloads are typed
 * application/octet-stream, so a browser saves them rather than rendering them. No iframe, no
 * inline HTML, nothing executed.
 *
 * ⚠️ New words are staged in red (#d93025) until Mike approves them.
 */
import { useEffect, useMemo, useState } from "react";
import {
  HOSTED_FILES_PARAM, HOSTED_MAX_BYTES, HOSTED_TIMEOUT_MS,
  fetchHostedBundle, hostedSourceOf, matchHostedFiles, unzipHostedBundle,
  type HostedFile, type HostedProblem,
} from "@/lib/hosted-files";

export type HostedState =
  | { phase: "none" }
  | { phase: "working"; host: string }
  | { phase: "matched"; host: string; kind: "tree" | "file"; members: HostedFile[]; extras: string[] }
  | { phase: "failed"; host: string | null; problem: HostedProblem; status?: number };

const RED = { color: "#d93025" } as const;

/** Reads ?files= once; runs when the page's proof is in hand. The proof's own checks never see any of it. */
export function useHostedFiles(proof: { artifact?: { digestB64?: string } } | null): HostedState {
  const [raw] = useState<string | null>(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(HOSTED_FILES_PARAM)));
  const [state, setState] = useState<HostedState>({ phase: "none" });
  const digest = proof?.artifact?.digestB64 ?? null;
  useEffect(() => {
    if (raw === null || !proof || !digest) return;
    let live = true;
    void (async () => {
      const src = hostedSourceOf(raw, window.location.hostname);
      if (!src.ok) { setState({ phase: "failed", host: src.host, problem: src.problem }); return; }
      setState({ phase: "working", host: src.source.host });
      const got = await fetchHostedBundle(src.source);
      if (!live) return;
      if (!got.ok) { setState({ phase: "failed", host: got.host, problem: got.problem, ...(got.status !== undefined ? { status: got.status } : {}) }); return; }
      const files = unzipHostedBundle(got.bytes);
      if (!files) { setState({ phase: "failed", host: got.host, problem: "not-zip" }); return; }
      const m = await matchHostedFiles(proof, files).catch(() => ({ ok: false as const, problem: "mismatch" as const }));
      if (!live) return;
      setState(m.ok ? { phase: "matched", host: got.host, kind: m.kind, members: m.members, extras: m.extras } : { phase: "failed", host: got.host, problem: m.problem });
    })();
    return () => { live = false; };
    // The proof object is re-set as ceilings land; the digest is what the match is about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, digest]);
  return state;
}

const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function rasterType(b: Uint8Array): string | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

const TEXT_SHOWN = 20_000;
function asText(b: Uint8Array): string | null {
  try {
    const t = new TextDecoder("utf-8", { fatal: true }).decode(b);
    // Control characters other than tab, newline and carriage return: not a text file.
    return /[\u0000-\u0008\u000e-\u001f]/.test(t.slice(0, 8192)) ? null : t;
  } catch { return null; }
}

function HostedFileCard({ file }: { file: HostedFile }) {
  const name = file.name.split("/").pop() || file.name;
  const isSvg = /\.svg$/i.test(name) || /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(new TextDecoder().decode(file.bytes.slice(0, 256)));
  const image = isSvg ? null : rasterType(file.bytes);
  const text = image || isSvg ? null : asText(file.bytes);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [dlUrl, setDlUrl] = useState<string | null>(null);
  useEffect(() => {
    const d = URL.createObjectURL(new Blob([file.bytes.slice()], { type: "application/octet-stream" }));
    const i = image ? URL.createObjectURL(new Blob([file.bytes.slice()], { type: image })) : null;
    let live = true;
    void Promise.resolve().then(() => { if (live) { setDlUrl(d); setImgUrl(i); } });
    return () => { live = false; URL.revokeObjectURL(d); if (i) URL.revokeObjectURL(i); };
  }, [file, image]);
  return (
    <div className="pv-filecard">
      <div className="pv-filecard-head" style={{ borderBottom: image || text !== null ? "1px solid var(--line-2)" : "none" }}>
        <span className="pv-filecard-name"><strong>{name}</strong>{" · "}{fmtBytes(file.bytes.byteLength)}</span>
        {dlUrl && <a href={dlUrl} download={name} className="bg-action-link pv-pill" style={{ flexShrink: 0 }}><span style={RED}>Download</span></a>}
      </div>
      {image && imgUrl && (
        <div style={{ padding: 16, display: "flex", justifyContent: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imgUrl} alt={name} style={{ display: "block", maxWidth: "100%", maxHeight: "min(70vh, 720px)", height: "auto" }} />
        </div>
      )}
      {text !== null && (
        <pre style={{ margin: 0, padding: 16, fontFamily: "var(--font-mono)", fontSize: "clamp(11px, 3vw, 12.5px)", lineHeight: 1.6, color: "var(--text)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {text.length > TEXT_SHOWN ? text.slice(0, TEXT_SHOWN) + "\n…" : text}
        </pre>
      )}
    </div>
  );
}

/** One plain line under the title for each way the fetch can fail. */
function failLine(s: Extract<HostedState, { phase: "failed" }>): string {
  const h = s.host ?? "the host";
  switch (s.problem) {
    case "bad-url": return "The files link is not a web address.";
    case "not-https": return "Only https links are fetched.";
    case "status": return `${h} answered ${s.status ?? "with an error"}.`;
    case "too-large": return `The download is larger than ${Math.round(HOSTED_MAX_BYTES / 1024 / 1024)} MB.`;
    case "timeout": return `${h} did not answer within ${Math.round(HOSTED_TIMEOUT_MS / 1000)} seconds.`;
    case "unreachable": return `${h} could not be reached, or does not let bitgraph.ing read it.`;
    case "not-zip": return "The download is not a ZIP of files.";
    case "mismatch": return "None of them is shown.";
  }
}

/** The status and, on a match only, the files. Null when the link carries no ?files=. */
export function HostedFilesView({ state }: { state: HostedState }) {
  const box = useMemo(() => ({ display: "flex", flexDirection: "column" as const, alignItems: "center", textAlign: "center" as const, padding: "20px 16px", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12 }), []);
  if (state.phase === "none") return null;
  if (state.phase === "working") {
    return <div style={{ ...box, marginBottom: 16 }} role="status"><div className="dropbox-title" style={{ color: "var(--dim)" }}><span style={RED}>Fetching the files from {state.host}&hellip;</span></div></div>;
  }
  if (state.phase === "failed") {
    const title = state.problem === "mismatch" ? `The files at ${state.host} do not match this BitGraph`
      : state.problem === "bad-url" || state.problem === "not-https" ? "The files link was not followed"
      : `The files at ${state.host ?? "the host"} could not be ${state.problem === "not-zip" ? "read" : "fetched"}`;
    return (
      <div style={{ ...box, marginBottom: 16 }} role="status">
        <div className="dropbox-title" style={{ color: "var(--err)" }}><span style={RED}>{title}</span></div>
        <div className="dropbox-line"><span style={RED}>{failLine(state)} Nothing on this page relies on them.</span></div>
      </div>
    );
  }
  const n = state.members.length;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={box} role="status">
        <div className="dropbox-title" style={{ color: "var(--ok)" }}>
          {state.kind === "tree" ? <>All {n.toLocaleString()} file{n === 1 ? "" : "s"} match this BitGraph</> : <span style={RED}>This file matches this BitGraph</span>}
        </div>
        <div className="dropbox-line"><span style={RED}>
          {state.kind === "tree"
            ? <>Fetched from {state.host}, then rebuilt here into the tree this proof signs: every one is in it, unchanged.</>
            : <>Fetched from {state.host}; its SHA-256 is the digest this proof signs.</>}
        </span></div>
        {state.extras.length > 0 && (
          <div className="dropbox-quiet"><span style={RED}>Also in the ZIP, not among this BitGraph&rsquo;s files: {state.extras.slice(0, 10).map((x) => x.split("/").pop()).join(", ")}{state.extras.length > 10 ? `, and ${state.extras.length - 10} more` : ""}.</span></div>
        )}
      </div>
      {state.members.map((f, i) => <HostedFileCard key={`${i}:${f.name}`} file={f} />)}
    </div>
  );
}
