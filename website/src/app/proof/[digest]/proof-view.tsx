"use client";

/**
 * The proof page's presentation (2026-09-30 overhaul: all of the same
 * information, laid out as simply as it can be). The page (page.tsx) still loads, caches,
 * matches drops, binds sets and builds downloads; this file only shows.
 *
 * Five sections, top to bottom, each a raised card on the grey ground:
 *
 *   1. The record        what this is: its number and epoch, the instant it was
 *                        recorded, the file (or the box that finds it), what the
 *                        file says about itself (set members)
 *   2. Where it sits     the window: the floor in time, the recorded instant, the
 *                        ceiling in time, the ceiling in position, in that order,
 *                        each with its public link (a Base floor, enclave v10: the
 *                        first three only; no anchor follows it)
 *   3. What holds        one line per claim, computed here in the browser from the
 *                        same evidence a download carries, each saying what it rests
 *                        on; the reading is written from the results
 *   4. Take it with you  the BitGraphed file and the other downloads, the offline
 *                        command, and recording again
 *   5. Details           every raw field, folded: hashes, positions, the position
 *                        record, the commit, the signature, the enclave, the raw JSON
 *
 * Claim discipline is unchanged: floor in time, ceiling in position, ceiling in
 * time; the attested instant leads and wears its root; block times are the
 * blocks' own, in UTC, so they match Etherscan and Basescan; nothing here says
 * "proves when".
 */

import { TreeFileList } from "@/components/tree-file-list";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { TimeChip, longDateTz, stampTz, timeTz, sameDayTz } from "@/lib/format-time";
import type { BitGraphProof } from "@/lib/bitgraph";
import type { CarrierClaim } from "@mikeargento/bitgraph-verify";
import { decodeNitroAttestation, floorTimeIsBound, treeMemberOf } from "@mikeargento/bitgraph-verify";
import { CopyIcon, useCopied } from "@/components/copy-icon";
import { toUrlSafeB64, truncateHash } from "@/lib/explorer";
import type { C2PAReadResult } from "@/lib/c2pa-reader";

/** The first Base ceiling write (2026-09-29 22:43 UTC). Records made before it have no ceiling in time. */
const BASE_CEILING_START_MS = Date.UTC(2026, 8, 29, 22, 43);

const mono = "var(--font-mono), 'SF Mono', SFMono-Regular, monospace";
const safe = (s: string) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export interface AnchorSideView {
  counter: string;
  blockNumber: number | null;
  blockHash: string | null;
  etherscanUrl: string | null;
  blockTime?: string | null;
  digestB64?: string | null;
  /** When BitGraph recorded the anchor: its attestation's timestamp. */
  recordedMs: number | null;
}

export interface CeilingTimeView {
  status: "pending" | "included" | "safe" | "finalized";
  anchor: { txHash: string; blockNumber: number; blockTimestamp: number } | null;
  floor?: { blockNumber: number; blockTimestamp: number } | null;
  /** The Ethereum block that committed the Base batch data, once the writer attached it. */
  settlement?: { l1?: { blockNumber?: number; blockTimestamp?: number; txHash?: string; blockHash?: string } } | null;
}

export interface ChecksView {
  state: "idle" | "running" | "done" | "failed";
  claims: CarrierClaim[];
  reading: string | null;
  verdict: "TRUE" | "FALSE" | "UNDETERMINED" | null;
  /** Why the checks could not be assembled, when they could not. */
  note: string | null;
  bytesInHand: boolean;
  confirming: boolean;
  confirmed: boolean;
}

export interface PositionRowView {
  key: string;
  num: string;
  viewing: boolean;
  href: string;
  roleLine: string;
  timeNode: ReactNode;
}

export interface SetRowView {
  key: string;
  ordinal: number;
  viewing: boolean;
  href: string;
  placement: string;
  originDigestB64: string;
}

export interface DownloadView {
  label: string;
  busyLabel: string;
  onClick: () => void;
  busy: boolean;
  primary?: boolean;
  /** One line under the name: what this download is. */
  desc?: ReactNode;
}

export interface FieldView {
  label: string;
  value: string;
  mono?: boolean;
  link?: boolean;
  highlight?: boolean;
}

export interface ProofViewModel {
  kind: "file" | "anchor" | "interval";
  proof: BitGraphProof;
  recordName: string;
  epochFull: string | null;
  attestedMs: number | null;
  /** The lead when the attestation cannot be read: the floor's block time. */
  leadFallback: ReactNode;
  /** The file pane: the preview, the drop box, or for an anchor the block row. */
  filePane: ReactNode;
  /** The hosted original (components/source-link): the line in the strip for everyone, and the holder's field under the pane. */
  sourceField?: ReactNode;
  /** The shown photo at full size, opened in a new tab beside the downloads. */
  openUrl?: string | null;
  /** The open file's type (from its name), so it shows in place: a picture, a PDF, text, video or audio. */
  openType?: string | null;
  /** The file's size in bytes, when it is in hand: past a size it opens only on request. */
  openSize?: number | null;
  /** The file in hand, by name (2026-10-30): a receipt line beside its hash. */
  fileName?: string | null;
  /** The file in hand's Content Credentials (C2PA), read from the file itself: what its signed manifest says. */
  c2pa?: C2PAReadResult | null;
  /** A set, or a tree/1 (whose page can list only the file in hand, once placed: a tree's members are known file by file, from evidence). */
  set: { kind: "set/1" | "set/2" | "tree/1"; count: number; root: string | null; rows: SetRowView[] } | null;
  /** Anchors: which Ethereum block this anchor recorded, and its Etherscan link. */
  anchorBlock: { number: string | null; minedMs: number | null; etherscanUrl: string | null } | null;
  anchorsBackHref: string | null;
  floor: AnchorSideView | null;
  /**
   * Enclave v10: the Base block the proof signs as its floor (commit.slotFloor), read from the
   * signed proof. When set, `floor`, `ceilingPos` and `commitAfter` are null and `ethWait` false:
   * no anchor stands on either side, and order after the record is the next BitGraph in the chain.
   */
  baseFloor?: { blockNumber: number; blockHash: string; blockTimestamp: number } | null;
  /** A sentence about what the floor covers, for a tree/1 record (every file recorded after it; a file kept as is not dated by it). */
  floorNote?: string | null;
  /** The anchor before the commit when it is later than the signed floor: a tighter bound on the commit by hash order. */
  commitAfter: { counter: string; blockNumber: number; blockTime: string | null; digestB64: string | null } | null;
  ceilingPos: AnchorSideView | null;
  /** The ceiling in position has not landed yet and the page is asking. */
  ethWait: boolean;
  ceilingTime: CeilingTimeView | null;
  /** The Base plugin's floor: BitGraph 1, which bound the latest Base block before this record, in the same epoch (app/api/floors). */
  floorLink?: { floor: { bitgraph: { digestB64: string; epochId: string; counter: string }; blockNumber: number; blockHash: string; blockTimestamp: number } } | null;
  /** This proof is itself a floor: it binds base-floor.json, the latest Base block, read for the record bound right after it. */
  floorOf?: { floor: { blockNumber: number; blockHash: string; blockTimestamp: number }; record: { digestB64: string; epochId: string; counter: string } } | null;
  /** This proof is its epoch's first BitGraph, a read of the latest Base block; the file hashed to its digest here. */
  epochStart?: { blockNumber: number; blockHash: string; blockTimestamp: number; baseChecked: boolean | null; fileUrl: string; genesis?: { txHash: string; writer: string } | null } | null;
  /** The floor leaf of this file's tree (2026-10-20): base-block.json, checked into the root this proof binds. */
  treeFloor?: { blockNumber: number; blockHash: string; blockTimestamp: number; fileUrl: string } | null;
  /** The block timeline's bracket (app/api/timeline/bracket): the block reads before and after this record. When it
   *  has them, the floor and ceiling show their blocks' times and link to the block reads' own BitGraphs. */
  timeline?: {
    state: "verified" | "unconfirmed" | "failed" | "pending" | "none";
    epochUrl: string;
    floor: { chain: "base" | "ethereum"; number: number; timestamp: number; counter: string; digestB64: string } | null;
    ceiling: { chain: "base" | "ethereum"; number: number; timestamp: number; counter: string; digestB64: string } | null;
  } | null;
  /** This BitGraph is a block read: the block its file names, which hashed here to its digest. */
  /** A block read's block, and the exact block file it binds (its content), checked to hash to the digest. */
  blockRead?: { chain: "base" | "ethereum"; number: number; hash: string; timestamp: number; file?: string } | null;
  ceilingFileHref: string | null;
  checks: ChecksView;
  onConfirm: () => void;
  /** ONE export per position (2026-10-04, a single master button): what the
   *  button downloads depends on the kind of position, and the person makes no
   *  choice. Null while nothing can be exported yet (a tree still binding). */
  exportAction: DownloadView | null;
  /** The export's row name: what the one download is, for this kind of position. */
  exportName: string;
  /** One line under it: what the export holds. */
  exportInside: ReactNode;
  /** The pieces on their own, as small text links: the proof, the anchors, the
   *  original, the BitGraphed file. For the few who want one part. */
  pieces: DownloadView[];
  downloadNotes: ReactNode[];
  /** The BitGraphed file's last download, as it went: shown under its button. */
  carrierNote?: string | null;
  /** No file in hand and the content box's pickers are on the page: the second button connects the file. */
  canConnect?: boolean;
  /** Every BitGraph of this file's exact bytes, oldest first; `current` is this page's. */
  bindings?: Array<{ counter: number; ms: number | null; href: string; epochId: string; current?: boolean }>;
  /** "Check it anywhere": the command that matches this kind of export, or null. */
  checkText: ReactNode | null;
  checkCommand: ReactNode | null;
  hashes: FieldView[];
  positions: { intro: string; rows: PositionRowView[] } | null;
  positionRecord: FieldView[];
  commitRows: FieldView[];
  signatureRows: FieldView[];
  enclaveRows: FieldView[];
  intervalRows: FieldView[];
  advisoryRows: FieldView[];
  noteRows: FieldView[];
}

/* ── Small pieces ─────────────────────────────────────────────────────────── */


/** A label and a value. The value's copy button copies it; a link opens in a new tab. */
function Row({ f }: { f: FieldView }) {
  // No copy icon (2026-10-30): nothing in a row is typed into another tool, the proof download carries it all, and
  // the text selects like any text.
  if (f.link) {
    return (
      <div className="pv-row">
        <div className="pv-row-label">{f.label}</div>
        <a className="pv-row-value pv-link" href={f.value} target="_blank" rel="noopener">{f.value}</a>
      </div>
    );
  }
  return (
    <div className="pv-row">
      <div className="pv-row-label">{f.label}</div>
      <div className={`pv-row-value${f.mono ? " pv-mono" : ""}${f.highlight ? " pv-strong" : ""}`}>
        {f.value}
      </div>
    </div>
  );
}

/** A folded group inside the details card. Opens in place; never scrolls. */
function Fold({ title, children, count }: { title: string; children: ReactNode; count?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`pv-fold${open ? " is-open" : ""}`}>
      <button type="button" className="pv-fold-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{title}{count !== undefined ? <span className="pv-fold-count"> {count}</span> : null}</span>
        <svg className="pv-chevron" width="18" height="18" viewBox="0 0 24 24" aria-hidden><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && <div className="pv-fold-body">{children}</div>}
    </div>
  );
}

/** True on a phone-width screen, read after mount (the server renders the wide layout). */
function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(max-width: 599px)");
    const on = () => setPhone(q.matches);
    on();
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return phone;
}

/** One group of checks, folded to its title and tally at every width (2026-10-05: the list
 *  was 3,700px tall at 375px, and desktop folds the same way for neatness); a group holding
 *  a failed check always starts open, so a failure is never folded away. */
function ChecksGroup({ title, rows }: { title: string; rows: CarrierClaim[] }) {
  const failed = rows.filter((x) => x.result === "FALSE").length;
  const held = rows.filter((x) => x.result === "TRUE").length;
  const byAudit = rows.filter(auditOnly).length;
  const reported = rows.filter((x) => noted(x)?.label === "reported").length;
  const unjudged = rows.length - held - failed - byAudit - reported;
  const [open, setOpen] = useState<boolean | null>(null);
  const isOpen = open ?? failed > 0;
  const tally = failed ? <>{failed} fail{failed === 1 ? "s" : ""}</> : <>{held} hold{byAudit ? <span className="pv-checks-unjudged"> · {byAudit} by the audit tool</span> : null}{reported ? <span className="pv-checks-unjudged"> · {reported} reported</span> : null}{unjudged ? <span className="pv-checks-unjudged"> · {unjudged} not judged</span> : null}</>;
  return (
    <details className="pv-checks-group" open={isOpen} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; if (o !== isOpen) setOpen(o); }}>
      <summary className="pv-checks-group-title">
        <span>{title}</span>
        <span className={`pv-checks-tally${failed ? " is-fail" : ""}`}>{tally}</span>
      </summary>
      {rows.map((x) => <ClaimRow key={x.id} x={x} />)}
    </details>
  );
}

/** The verdict in words. ISO times never break mid-stamp; on a phone it shows a few lines first. */
function Reading({ text, isFalse }: { text: string; isFalse: boolean }) {
  const phone = usePhone();
  const [all, setAll] = useState(false);
  const parts = text.split(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/);
  const clamp = phone && !all && text.length > 260;
  return (
    <div className={`pv-reading${isFalse ? " is-false" : ""}`}>
      <div className={clamp ? "pv-reading-clamp" : undefined}>
        {parts.map((p, i) => (i % 2 === 1 ? <span key={i} className="pv-nowrap">{p}</span> : p))}
      </div>
      {clamp && <button type="button" className="pv-reading-more" onClick={() => setAll(true)}>Show all</button>}
    </div>
  );
}

function Pill({ href, children, external, download }: { href: string; children: ReactNode; external?: boolean; download?: boolean | string }) {
  return (
    <a href={href} className="bg-action-link pv-pill" {...(external ? { target: "_blank", rel: "noopener" } : {})} {...(download ? { download: typeof download === "string" ? download : true } : {})}>
      <span>{children}</span>
      {!external && <span className="arrow" aria-hidden>{download ? "↓" : "→"}</span>}
    </a>
  );
}

const fmtNum = (n: number | string | null | undefined) => (n === null || n === undefined ? "?" : Number(n).toLocaleString("en-US"));

/** A block's own time beside the recorded instant: the time alone on the same day, else the full stamp. */
function whenBeside(ms: number, ref: number | null): string {
  const d = new Date(ms);
  const s = ref !== null && sameDayTz(d, new Date(ref)) ? timeTz(d) : stampTz(d);
  // "7:22:57 PM EDT" is one reading: never let the zone or the AM/PM wrap onto a line of its own.
  return s.replace(/(\d{1,2}:\d{2}(?::\d{2})?) (AM|PM)(?: ([A-Z]{2,5}|UTC))?/, (_m, t, ap, z) => `${t}\u00a0${ap}${z ? `\u00a0${z}` : ""}`);
}

/* ── The view ─────────────────────────────────────────────────────────────── */

/** XML, though not a picture that happens to be XML (SVG shows as the picture it is). */
const isXmlType = (t: string) => t === "application/xml" || t === "text/xml" || (t.endsWith("+xml") && !t.startsWith("image/"));

/**
 * XML laid out for reading: one element to a line, nested ones indented, and a short value kept on its element's line.
 * It works on the text alone, tag by tag, so a file cut off partway (the preview reads the first 200 KB) still lays
 * out as far as it goes. Each line comes back in pieces, markup and text apart, so the page can set the markup back
 * and let the values stand out. This is a way of showing the file; the proof covers its bytes as they are.
 */
function layOutXml(src: string): Array<Array<{ markup: boolean; s: string }>> {
  const tokens = src.replace(/\r\n?/g, "\n").match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/[^>]+>|<[^>]+>|[^<]+/g) ?? [];
  const lines: Array<Array<{ markup: boolean; s: string }>> = [];
  const pad = (d: number) => ({ markup: true, s: "  ".repeat(d) });
  const flat = (x: string) => x.trim().replace(/\s+/g, " ");
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (!t.startsWith("<")) {
      const text = flat(t);
      if (text) lines.push([pad(depth), { markup: false, s: text }]);
      continue;
    }
    if (t.startsWith("</")) {
      depth = Math.max(0, depth - 1);
      lines.push([pad(depth), { markup: true, s: t }]);
      continue;
    }
    const tag = flat(t);
    const closed = t.endsWith("/>") || t.startsWith("<?") || t.startsWith("<!");
    const next = tokens[i + 1], after = tokens[i + 2];
    // <name>value</name> stays on one line when the value is short.
    if (!closed && next !== undefined && !next.startsWith("<") && after?.startsWith("</") && flat(next).length <= 120) {
      lines.push([pad(depth), { markup: true, s: tag }, { markup: false, s: flat(next) }, { markup: true, s: after }]);
      i += 2;
      continue;
    }
    // <name></name>, nothing inside.
    if (!closed && next?.startsWith("</")) {
      lines.push([pad(depth), { markup: true, s: tag + next }]);
      i += 1;
      continue;
    }
    lines.push([pad(depth), { markup: true, s: tag }]);
    if (!closed) depth++;
  }
  return lines;
}

/**
 * The file in hand, opened in place under its content hash (2026-10-31): a picture, a PDF, text, XML laid out for
 * reading, a page (sandboxed, no scripts), video or audio shows here; anything else is offered as a download. A link
 * still opens it in a tab.
 */
function FileInPlace({ url, type, name }: { url: string; type: string | null; name: string | null }) {
  const t = type ?? "";
  const [text, setText] = useState<string | null>(null);
  const isXml = isXmlType(t);
  const isText = t.startsWith("text/plain") || t === "application/json";
  useEffect(() => {
    if (!isText && !isXml) return;
    let gone = false;
    void fetch(url).then((r) => r.blob()).then((b) => b.slice(0, 200_000).text()).then((x) => { if (!gone) setText(x); }).catch(() => {});
    return () => { gone = true; };
  }, [url, isText, isXml]);
  const frame = { width: "100%", height: "70vh", border: "1px solid var(--line)", background: "var(--panel)" } as const;
  const pre = { margin: 0, maxHeight: "60vh", overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 13 } as const;
  let body: ReactNode;
  if (t.startsWith("image/")) body = <img src={url} alt={name ?? "The file"} style={{ display: "block", maxWidth: "100%", maxHeight: "75vh", margin: "0 auto" }} />;
  else if (t === "application/pdf") body = <iframe src={url} title={name ?? "The file"} style={frame} />;
  else if (t === "text/html") body = <iframe src={url} title={name ?? "The file"} sandbox="" style={{ ...frame, background: "#fff" }} />;
  else if (t.startsWith("video/")) body = <video src={url} controls preload="metadata" style={{ display: "block", maxWidth: "100%", maxHeight: "75vh", margin: "0 auto" }} />;
  else if (t.startsWith("audio/")) body = <audio src={url} controls preload="metadata" style={{ width: "100%" }} />;
  else if (isXml) body = text === null ? <pre className="pv-mono" style={pre}>{"Reading the file\u2026"}</pre> : (
    <>
      {/* Markup set back, values in ink, so the record reads through its tags. */}
      <pre className="pv-mono" style={pre}>
        {layOutXml(text).map((line, i) => (
          <Fragment key={i}>{line.map((part, j) => <span key={j} style={{ color: part.markup ? "var(--dim)" : "var(--ink)" }}>{part.s}</span>)}{"\n"}</Fragment>
        ))}
      </pre>
      <div className="pv-note" style={{ marginTop: 10 }}>Laid out for reading. The proof covers the file exactly as it is.</div>
    </>
  );
  else if (isText) body = <pre className="pv-mono" style={pre}>{text ?? "Reading the file\u2026"}</pre>;
  else body = <div className="pv-note">This kind of file does not show in the browser. <a className="pv-link" href={url} download={name ?? undefined}>Download it</a>.</div>;
  return (
    <div className="pv-row pv-file-open" style={{ gridColumn: "1 / -1" }}>
      {/* The file shows here, in place; no separate tab (2026-10-31). No label over it: the File row names it. */}
      <div className="pv-row-value">{body}</div>
    </div>
  );
}

/* A file in hand shows open (2026-11-01) when the browser can display it and it is not large; the rest wait for Open
   file. Media never plays on its own: the player shows, the visitor presses play. */
const OPEN_BY_DEFAULT_MAX = 25 * 1024 * 1024;
function showsOpen(type: string | null | undefined, size: number | null | undefined): boolean {
  const t = type ?? "";
  const displayable = t.startsWith("image/") || t.startsWith("video/") || t.startsWith("audio/") || t === "application/pdf" || t.startsWith("text/plain") || t === "application/json" || isXmlType(t);
  return displayable && (size == null || size <= OPEN_BY_DEFAULT_MAX);
}

export function ProofView({ m }: { m: ProofViewModel }) {
  // The visitor's own choice wins once made; until then the file follows showsOpen.
  const [fileChoice, setFileChoice] = useState<boolean | null>(null);
  const fileOpen = fileChoice ?? showsOpen(m.openType, m.openSize);
  const setFileOpen = (f: (v: boolean) => boolean) => setFileChoice(f(fileOpen));
  /* Stripped to the primitive (2026-10-17), with the Base floor and ceiling back (2026-10-18). Anchors, export
     packages and the position lists stay off the page; every old proof still opens, and all of it is in the raw JSON. */
  // When shows the recorded time alone (2026-11-06). The floor and the Base write are still read here, because
  // whether the record has them decides whether the group shows at all (showTime).
  const attested = m.attestedMs;
  const bf = m.kind !== "anchor" ? m.baseFloor ?? null : null;
  // Records made before 2026-10-07 carry an Ethereum floor instead: shown the same way, so old proofs keep their window.
  const ef = m.kind !== "anchor" && !bf ? m.floor ?? null : null;
  const fl = m.floorLink?.floor ?? null;
  const floorMs = fl ? fl.blockTimestamp * 1000 : bf ? (floorTimeIsBound(bf.blockTimestamp, attested).ok ? bf.blockTimestamp * 1000 : null) : ef?.blockTime ? new Date(ef.blockTime).getTime() : null;
  const sinceFloor = attested !== null && floorMs !== null ? Math.max(0, Math.floor((attested - floorMs) / 1000)) : null;
  const ct = m.ceilingTime;
  // Only a record that went to Base shows where it sits in time (2026-10-18: the floor had stayed on with the Base
  // switch off). Enclave v11 signs a Base floor into every bind; it shows here only beside a Base write (or one
  // waiting), i.e. when the Base switch was on. Enclave v12 drops the floor from plain binds altogether.
  const es = m.epochStart ?? null;
  const tf = m.treeFloor ?? null;
  const bitgraphed = m.pieces?.find((p) => p.label === "BitGraphed file") ?? null;
  // The content box comes into view once a search starts (2026-10-30), so its reading count shows the work.
  const [searching, setSearching] = useState(false);
  // The technical half of the receipt (the bind, its place in line, the signature, the verifier and the JSON) opens on
  // request; the file, when it was made and the proof to download show first.
  const [details, setDetails] = useState(false);
  const fo = m.floorOf ?? null;
  // A record written to Base shows that write and nothing from the block timeline: the timeline ran only between its
  // start and the return to per-record Base writes, and a later record of the same epoch would otherwise show the last
  // read before the switch as a floor, and a ceiling read that never comes.
  const tl = !ct && m.timeline && m.timeline.state !== "failed" ? m.timeline : null;
  // A drop's own floor (2026-11-02): the Base read bound on the counts right before this file, which its signed prevB64
  // names. Shown beside the Base write; a read further back (from before the switch) is not this file's floor.
  const own = m.timeline && m.timeline.state !== "failed" && m.timeline.floor && m.proof.commit.slotCounter
    && BigInt(m.timeline.floor.counter) + BigInt(1) === BigInt(m.proof.commit.slotCounter) ? m.timeline.floor : null;
  const showTime = ct !== null || fl !== null || es !== null || tf !== null || fo !== null || tl !== null || own !== null;
  const c = m.checks;
  const okCount = c.claims.filter((x) => x.result === "TRUE").length;
  const badCount = c.claims.filter((x) => x.result === "FALSE").length;
  const commit = m.proof.commit;
  const nonceCount = commit.slotCounter ?? null;
  const contentCount = commit.counter ?? null;
  const proofFile = `bitgraph-${contentCount ?? safe(m.proof.artifact.digestB64).slice(0, 12)}.json`;
  const download = () => {
    const blob = new Blob([JSON.stringify(m.proof, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = proofFile;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const checksBlock = (
        <div className="pv-sub">
          {c.state === "running" && <div className="pv-note">Checking the proof in your browser<span className="pv-dots" aria-hidden /></div>}
          {c.state === "failed" && <div className="pv-note">{c.note ?? "The proof could not be checked just now. That is not a finding about this BitGraph; try again in a moment."}</div>}
          {c.state === "idle" && <div className="pv-note">The check runs once the proof is in hand.</div>}
          {c.state === "done" && (
            <>
              <div className="pv-checks-summary">
                <span className={`pv-verdict pv-verdict-${(c.verdict ?? "UNDETERMINED").toLowerCase()}`}>{c.verdict === "TRUE" ? "\u2713 Valid proof" : c.verdict === "FALSE" ? "\u2717 Not a valid proof" : "Undetermined"}</span>
                <span className="pv-checks-count">{okCount} checks passed{badCount ? `, ${badCount} failed` : ""}</span>
              </div>
              {/* The verifier's reading talks floors and blocks; the verdict and the count are enough here (raw JSON has the rest). */}
            </>
          )}
        </div>
  );
  // The Base floor and Base write rows left the receipt on 2026-11-06, with the helpers that drew them.
  const chainName = (c: "base" | "ethereum") => (c === "base" ? "Base" : "Ethereum");
  const br = m.blockRead ?? null;
  const blockReadCell = br ? (
    <div className="pv-row">
      <div className="pv-row-label">Block read</div>
      <div className="pv-row-value">{chainName(br.chain)} block {fmtNum(br.number)}, <span className="pv-nowrap">{whenBeside(br.timestamp * 1000, attested)} <a className="pv-link" href={br.chain === "base" ? `https://basescan.org/block/${br.number}` : `https://etherscan.io/block/${br.number}`} target="_blank" rel="noopener">{br.chain === "base" ? "Basescan" : "Etherscan"}</a></span></div>
    </div>
  ) : null;
  // Its content is the block file itself, served with the page, so it downloads instead of asking for a file.
  const blockFileHref = br?.file ? `data:application/json;charset=utf-8,${encodeURIComponent(br.file)}` : null;
  /* The receipt in groups, each answering one question, its rows in the order things happen (2026-11-01): what this
     BitGraph is; when, with the enclave's time between the two block reads that bracket it; the bind, the two
     consecutive counts with nothing between them; its place in the chain; and the hardware's signature on it all. */
  const group = (title: string | null, rows: ReactNode[]) => rows.some(Boolean) ? (
    <div className="pv-receipt-group">
      {title && <div className="pv-section-title">{title}</div>}
      <div className="pv-counter-grid">{rows}</div>
    </div>
  ) : null;
  const prevB64 = (commit as { prevB64?: string }).prevB64;
  const receipt = (
    <section className="pv-card pv-receipt">
      {/* The card opens on its name, "BitGraph #38", with no eyebrow over it. */}
      {group(null, [
        /* The file opens from the top of the card, right of the number, and shows directly beneath it. */
        <div key="n" className="pv-row pv-row-head">
          <div className="pv-row-value pv-name">
            {`BitGraph #${fmtNum(m.proof.commit?.counter ?? "")}${es ? " · the epoch's first" : br ? ` · ${chainName(br.chain)} block read` : ""}`}
            {/* With the file open, the link in the corner goes back to the ledger (what people reach for there); a file
                that opens on request still gets its Open file button. */}
            {m.openUrl && fileOpen
              ? <a className="pv-link pv-open-link" href="/ledger">Back to the ledger</a>
              : m.openUrl ? <button type="button" className="pv-link-btn pv-open-link" aria-expanded={fileOpen} onClick={() => setFileOpen((v) => !v)}>Open file</button> : null}
          </div>
        </div>,
        fileOpen && m.openUrl ? <FileInPlace key="open" url={m.openUrl} type={m.openType ?? null} name={m.fileName ?? null} /> : null,
        m.fileName ? <Row key="file" f={{ label: "File", value: m.fileName }} /> : null,
        commit.epochId && commit.counter && !treeMemberOf(m.proof) ? <TreeFileList key="tree" digestB64={m.proof.artifact.digestB64} epochId={commit.epochId} counter={commit.counter} /> : null,
        blockReadCell ? <Fragment key="read">{blockReadCell}</Fragment> : null,
      ])}
      {/* When: the time the enclave recorded it, and nothing else (2026-11-06). The Base block read before it and the
          Base write after it are no longer rows here; both are still in the proof and its details. */}
      {group("When", [
        showTime && attested !== null ? <Row key="rec" f={{ label: "Recorded", value: stampTz(new Date(attested)) }} /> : null,
      ])}
      {/* Check it anywhere follows when: text links like the rest of the receipt, under their own eyebrow. The proof;
          and the BitGraphed file when the original is in hand, the epoch file on an epoch's first record, or Connect
          the file, which opens the drop box right under these lines. */}
      <div className="pv-receipt-group">
        <div className="pv-section-title">Check it anywhere</div>
        <div className="pv-sub-note" style={{ display: "grid", gap: 6, marginTop: 0 }}>
          <button type="button" className="pv-link pv-link-btn" onClick={download}>Download proof</button>
          {bitgraphed ? (
            <button type="button" className="pv-link pv-link-btn" disabled={bitgraphed.busy} onClick={bitgraphed.onClick}>{bitgraphed.busy ? "Assembling\u2026" : "Download BitGraphed file"}</button>
          ) : es ? (
            <a className="pv-link" style={{ width: "fit-content" }} href={es.fileUrl} download={es.genesis ? "epoch-genesis.json" : "epoch-floor.json"}>Download {es.genesis ? "epoch-genesis.json" : "epoch-floor.json"}</a>
          ) : blockFileHref ? (
            <a className="pv-link" style={{ width: "fit-content" }} href={blockFileHref} download="block-read.json">Download block-read.json</a>
          ) : m.canConnect ? (
            <button type="button" className="pv-link pv-link-btn" onClick={() => setSearching(true)}>Connect the file</button>
          ) : null}
        </div>
        {m.canConnect && !br && searching && <div style={{ marginTop: 14 }}>{m.filePane}</div>}
        {m.carrierNote && <div className="pv-offline-text" role="status">{m.carrierNote}</div>}
      </div>
      <div className="pv-receipt-group pv-details-toggle">
        <button type="button" className="pv-link pv-link-btn pv-details-btn" aria-expanded={details} onClick={() => setDetails((v) => !v)}><span className="pv-details-word">View details</span> <span className="pv-details-chev" aria-hidden="true">&rsaquo;</span></button>
      </div>
      {details && (
        <>
      {group("The bind", [
        nonceCount !== null ? <Row key="nonce" f={{ label: `#${fmtNum(nonceCount)}: Nonce`, value: commit.nonceB64, mono: true }} /> : null,
        contentCount !== null ? <Row key="hash" f={{ label: `#${fmtNum(contentCount)}: Content hash`, value: m.proof.artifact.digestB64, mono: true }} /> : null,
      ])}
      {/* Shown by its hash: proofs are not looked up by position, so the page cannot open the BitGraph before this one;
          whoever holds both proofs can check the link offline. */}
      {group("Its place in line", [
        es ? (
          <div key="gen" className="pv-row">
            <div className="pv-row-label">Genesis block {fmtNum(es.blockNumber)}</div>
            <div className="pv-row-value pv-mono">{es.blockHash} <a className="pv-link" href={es.genesis ? `https://basescan.org/tx/${es.genesis.txHash}` : `https://basescan.org/block/${es.blockNumber}`} target="_blank" rel="noopener">Basescan</a></div>
          </div>
        ) : null,
        commit.epochId ? <Row key="epoch" f={{ label: "Epoch", value: commit.epochId, mono: true }} /> : null,
        prevB64 ? <Row key="prev" f={{ label: "Previous BitGraph", value: prevB64, mono: true }} /> : null,
      ])}
      {/* Attest, then sign: the enclave's image and its attestation first, then the key, the signature and the hash. */}
      <div className="pv-receipt-group">
        <div className="pv-section-title">{m.proof.environment?.enforcement === "measured-tee" ? "Signed by the hardware" : "Signed in software"}</div>
        <div className="pv-counter-grid">
          {m.enclaveRows.map((f) => <Row key={f.label} f={f} />)}
          <EnclaveDecoded proof={m.proof} />
          {m.signatureRows.map((f) => <Row key={f.label} f={f} />)}
        </div>
      </div>
      {m.c2pa?.present && <div className="pv-receipt-group"><ContentCredentials c2pa={m.c2pa} /></div>}
      {/* Checking a proof without BitGraph is a step for people who want it: a link to how the open verifier works,
          not a command on a photo's page. */}
      <div className="pv-receipt-group">
        <a className="pv-link pv-details-btn" href="/technology#t-verify"><span className="pv-details-word">Check it offline</span> <span className="pv-details-chev" aria-hidden="true">&rsaquo;</span></a>
      </div>
      <div className="pv-receipt-group pv-details">
        <div className="pv-section-title">Raw JSON</div>
        <RawJson proof={m.proof} />
      </div>
        </>
      )}
    </section>
  );
  /* The recorded instant leads the page on its own (2026-10-29): the BitGraph's name at heading size and the time large. */
  const recordedCard = null;

  /* Every proof leads with its file (the photo, its BitGraphed file, any other file, or the drop box), one line
     saying what the BitGraph says, the downloads, and the proof itself in full. */
  {
    const verdictWord = c.state === "done" ? (c.verdict === "TRUE" ? "\u2713 Valid proof" : c.verdict === "FALSE" ? "\u2717 Not a valid proof" : "Undetermined") : c.state === "failed" ? "Not checked" : "Checking\u2026";
    return (
      <div className="pv">
        <h1 className="sr-only">BitGraph proof</h1>
        {/* The time card first (2026-10-29): the BitGraph's name and the instant it was made, then the content it covers. */}
        {/* The downloads first (2026-10-30), then one open receipt: every line of the record in one list. */}
        {receipt}
        {/* No content card when there is nothing to put in it (2026-10-29: the epoch's first record). */}
        {/* With no file in hand the content box is only the pickers the "Search this computer" button opens (2026-10-30):
            it stays mounted, out of sight, and no empty card shows. */}
        {m.canConnect && !searching && <div hidden>{m.filePane}</div>}
        {!(m.canConnect && !(c.state === "done" && c.verdict === "FALSE") && !m.sourceField) && ((c.state === "done" && c.verdict === "FALSE") || m.filePane || m.sourceField) && (
        <section className="pv-card pv-photo">
          {/* The content card (2026-10-29): the picture or file and its buttons, and a proof that fails says so here, never
              folded away. The receipt names the BitGraph (2026-11-01), so this card no longer carries the name while the
              time loads; that fallback showed a card for a moment and took it away again. */}
          {c.state === "done" && c.verdict === "FALSE" && (
            <div className="pv-photo-strip">
              <div className="pv-verdict pv-verdict-false">{verdictWord}</div>
            </div>
          )}
          {!m.canConnect && m.filePane}
          {m.sourceField}
        </section>
        )}
        {/* A failed check is never folded: its tally shows in full here, outside the receipt's details. */}
        {(
          <>
            {!(c.state === "done" && c.verdict === "TRUE") && <section className="pv-card">{checksBlock}</section>}
            {/* The same bytes bound more than once: a footnote, one folded line, a log of them all oldest first, the first
                (the original, the one that counts) and this page marked. */}
            {m.bindings && m.bindings.length > 1 && (
              <details className="pv-log">
                <summary>{`This file has been BitGraphed ${fmtNum(m.bindings.length)} times`}</summary>
                <ol aria-label="Every BitGraph of this file, oldest first">
                  {m.bindings.map((b, i) => (
                    <li key={`${b.epochId}:${b.counter}`}>
                      <span className="pv-log-n">{`${i + 1}.`}</span>
                      <span className="pv-log-body">
                        {b.current ? <span className="pv-log-here">BitGraph #{fmtNum(b.counter)}</span> : <a href={b.href}>BitGraph #{fmtNum(b.counter)}</a>}
                        {b.ms !== null && <span>{`${longDateTz(new Date(b.ms))}, ${timeTz(new Date(b.ms))}`}</span>}
                        {(i === 0 || b.current) && <span className="pv-log-tag">{[i === 0 ? "original" : null, b.current ? "this page" : null].filter(Boolean).join(", ")}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </>
        )}
      </div>
    );
  }
}

function Moment({ label, title, note, children, accent, chain }: { label: string; title: ReactNode; note?: ReactNode; children?: ReactNode; accent?: boolean; chain?: "eth" | "base" }) {
  return (
    <div className={`pv-moment${accent ? " is-accent" : ""}`}>
      <div className="pv-moment-rail" aria-hidden><span className="pv-moment-dot" /></div>
      <div className="pv-moment-body">
        <div className="pv-moment-label">{chain && <span className={`pv-chain pv-chain-${chain}`} role="img" aria-label={chain === "eth" ? "Ethereum" : "Base"} />}{label}</div>
        <div className="pv-moment-title">{title}</div>
        {note && <div className="pv-moment-note">{note}</div>}
        {children && <div className="pv-moment-actions">{children}</div>}
      </div>
    </div>
  );
}

/* Claims this page does not judge by design, said plainly instead of as a question mark (2026-10-05: the
   question mark read as a leftover). Still listed, so every claim is shown. One the audit tool
   checks; one a status BitGraph's Base node reported, never proven by the file. */
const NOTED: Record<string, { label: string; text: (x: CarrierClaim) => string }> = {
  "settlement.blobs.decoded": {
    label: "checked by the audit tool",
    text: () => "This needs Base's raw batch data from Ethereum, which the audit tool checks with the data kept beside each download. The browser holds only the pointer to it.",
  },
  "ceiling.time.status": {
    label: "reported",
    text: (x) => {
      const status = /says "([^"]+)"/.exec(x.detail)?.[1];
      return `Base's status when this proof was written, as BitGraph's Base server reported it${status ? `: ${status}` : ""}. Reported, not proven: the settlement check below is the proof.`;
    },
  },
};
const noted = (x: CarrierClaim) => (x.result === "UNDETERMINED" ? NOTED[x.id] ?? null : null);
const auditOnly = (x: CarrierClaim) => noted(x)?.label === "checked by the audit tool";

function ClaimRow({ x }: { x: CarrierClaim }) {
  const [open, setOpen] = useState(false);
  const note = noted(x);
  const glyph = x.result === "TRUE" ? "✓" : x.result === "FALSE" ? "✗" : x.result === "NOT_CARRIED" || note ? "–" : "?";
  return (
    <div className={`pv-claim pv-claim-${x.result.toLowerCase().replace("_", "-")}${open ? " is-open" : ""}`}>
      <button type="button" className="pv-claim-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="pv-claim-glyph" aria-hidden>{glyph}</span>
        <span className="pv-claim-name">{x.name}</span>
        {x.result === "TRUE" && x.restsOn ? <span className="pv-claim-rests">{x.restsOn}</span> : null}
        {x.result === "NOT_CARRIED" ? <span className="pv-claim-rests">not carried</span> : null}
        {x.result === "UNDETERMINED" ? <span className="pv-claim-rests">{note ? note.label : "not judged"}</span> : null}
        {x.result === "FALSE" ? <span className="pv-claim-rests">fails</span> : null}
        <svg className="pv-chevron pv-claim-chev" width="18" height="18" viewBox="0 0 24 24" aria-hidden><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && <div className="pv-claim-detail">{note ? note.text(x) : x.detail}</div>}
    </div>
  );
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  trainedAlgorithmicMedia: "Generated by AI",
  compositeWithTrainedAlgorithmicMedia: "Contains AI-generated elements",
  digitalCapture: "Camera capture",
};

/** "lightroom_classic/15.3.1" -> "Lightroom Classic 15.3.1"; the structured generator info first, then the User-Agent string. */
function formatGenerator(c2pa: C2PAReadResult): string | undefined {
  const prettify = (s: string) => s.replace(/[_-]+/g, " ").trim().replace(/\b\w/g, (ch) => ch.toUpperCase());
  const info = c2pa.claimGeneratorInfo?.find((g) => g.name);
  if (info?.name) return info.version ? `${prettify(info.name)} ${info.version}` : prettify(info.name);
  const raw = c2pa.claimGenerator;
  if (!raw) return undefined;
  const [namePart, version] = (raw.split(/\s+/)[0] ?? "").split("/");
  return version ? `${prettify(namePart ?? "")} ${version}` : prettify(namePart ?? "");
}

function ContentCredentials({ c2pa }: { c2pa: C2PAReadResult }) {
  const src = c2pa.digitalSourceType ? (SOURCE_TYPE_LABELS[c2pa.digitalSourceType] ?? c2pa.digitalSourceType.split("/").pop() ?? c2pa.digitalSourceType) : null;
  const gen = formatGenerator(c2pa) ?? null;
  const rows: FieldView[] = [];
  if (src) rows.push({ label: "Source", value: src });
  if (gen) rows.push({ label: "Made with", value: gen });
  if (c2pa.creator) rows.push({ label: "Creator", value: c2pa.creator });
  if (c2pa.signatureIssuer) rows.push({ label: "Signed by", value: c2pa.signatureIssuer });
  (c2pa.chain ?? []).forEach((link, i) => rows.push({ label: i === 0 ? "Chain" : "", value: `${link.relationship ?? "ingredient"} \u00b7 ${link.signer ?? "unsigned"}` }));
  const openai = /openai|chatgpt|dall/i.test(`${c2pa.claimGenerator ?? ""} ${c2pa.signatureIssuer ?? ""}`);
  return (
    <div className="pv-sub pv-c2pa">
      <div className="pv-section-title">Content Credentials (C2PA)</div>
      {/* Rows, no thumbnail (2026-10-29): what the signed manifest says, and where to check it. The signature is
          verified in the browser before Signed by is shown; the open verifier does the same for anyone. */}
      {rows.map((f, i) => <Row key={`${f.label}-${i}`} f={f} />)}
      {/* Stacked, one link per line (2026-10-30). */}
      <div className="pv-sub-note" style={{ display: "grid", gap: 6 }}>
        <a className="pv-link" href="https://contentcredentials.org/verify" target="_blank" rel="noopener" style={{ width: "fit-content" }}>Check C2PA</a>
        {openai && <a className="pv-link" href="https://openai.com/research/verify/" target="_blank" rel="noopener" style={{ width: "fit-content" }}>Verify with OpenAI</a>}
      </div>
    </div>
  );
}

const PCR_MEANING: Record<string, string> = {
  "1": "Linux kernel and boot",
  "2": "application",
  "3": "IAM role of the parent instance; changes if that role changes",
  "4": "ID of the parent instance; changes when the enclave runs on a different instance",
};

/** The attestation decoded, beside the values it must equal; the checks above judge it. */
function EnclaveDecoded({ proof }: { proof: BitGraphProof }) {
  const rep = proof.environment?.attestation?.reportB64;
  if (typeof rep !== "string" || rep.length === 0) return null;
  let d: ReturnType<typeof decodeNitroAttestation> | null = null;
  try { d = decodeNitroAttestation(rep); } catch { d = null; }
  if (!d) return <div className="pv-sub-note">The attestation document could not be decoded.</div>;
  const rows: FieldView[] = [];
  if (d.doc.moduleId) rows.push({ label: "Module", value: d.doc.moduleId, mono: true });
  if (d.doc.timestampMs !== null) rows.push({ label: "Timestamp, signed by AWS Nitro hardware", value: stampTz(new Date(d.doc.timestampMs)) });
  if (d.doc.userData) rows.push({ label: "user_data (the signed body's SHA-256)", value: Buffer.from(d.doc.userData).toString("base64"), mono: true });
  for (const i of ["1", "2", "3", "4"]) {
    const v = d.doc.pcrs[Number(i)];
    if (v && v.replace(/0/g, "").length > 0) rows.push({ label: `PCR${i}: ${PCR_MEANING[i]}`, value: v, mono: true });
  }
  return <>{rows.map((f) => <Row key={f.label} f={f} />)}</>;
}

function RawJson({ proof }: { proof: BitGraphProof }) {
  const [copied, copy] = useCopied();
  const text = JSON.stringify(proof, null, 2);
  return (
    <div className="pv-raw pv-row-copyable">
      <CopyIcon copied={copied} onCopy={() => copy(text)} label="the raw JSON" />
      <pre>{text}</pre>
    </div>
  );
}

