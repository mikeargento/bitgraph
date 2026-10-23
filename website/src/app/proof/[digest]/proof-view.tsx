"use client";

/**
 * The proof page's presentation (2026-09-30, Mike: "completely overhaul the
 * proof pages ... including all of the same information in the MOST intuitive
 * and simple streamlined way"). The page (page.tsx) still loads, caches,
 * matches drops, binds sets and builds downloads; this file only shows.
 *
 * Five sections, top to bottom, each a raised card on the grey ground:
 *
 *   1. The record        what this is: its number and epoch, the instant it was
 *                        recorded, the file (or the box that finds it), what the
 *                        file says about itself (Content Credentials, set members)
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

import { useEffect, useState, type ReactNode } from "react";
import { TimeChip, stampTz, timeTz, sameDayTz } from "@/lib/format-time";
import type { BitGraphProof } from "@/lib/bitgraph";
import type { C2PAReadResult } from "@/lib/c2pa-reader";
import type { CarrierClaim } from "@mikeargento/bitgraph-verify";
import { baseTimeIsBound, decodeNitroAttestation, floorTimeIsBound } from "@mikeargento/bitgraph-verify";
import { CopyIcon, useCopied } from "@/components/copy-icon";
import { toUrlSafeB64, truncateHash } from "@/lib/explorer";
import { CopyCode } from "@/components/copy-code";

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
  c2pa: C2PAReadResult | null;
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
  epochStart?: { blockNumber: number; blockHash: string; blockTimestamp: number; baseChecked: boolean | null; fileUrl: string } | null;
  /** The floor leaf of this file's tree (2026-10-20): base-block.json, checked into the root this proof binds. */
  treeFloor?: { blockNumber: number; blockHash: string; blockTimestamp: number; fileUrl: string } | null;
  ceilingFileHref: string | null;
  checks: ChecksView;
  onConfirm: () => void;
  /** ONE export per position (Mike, 2026-10-04: "a master button"): what the
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
  const [copied, copy] = useCopied();
  if (f.link) {
    return (
      <div className="pv-row">
        <div className="pv-row-label">{f.label}</div>
        <a className="pv-row-value pv-link" href={f.value} target="_blank" rel="noopener">{f.value}<span aria-hidden> &#8599;</span></a>
      </div>
    );
  }
  return (
    <div className="pv-row pv-row-copyable">
      <div className="pv-row-label">{f.label}</div>
      <div className={`pv-row-value${f.mono ? " pv-mono" : ""}${f.highlight ? " pv-strong" : ""}`}>
        {f.value}
      </div>
      <CopyIcon copied={copied} onCopy={() => copy(f.value)} label={f.label} />
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

/** One group of checks, folded to its title and tally at every width (Mike, 2026-10-05: the list
 *  was 3,700px tall at 375px, "collapse like that for neatness on desktop too"); a group holding
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
      <span className="arrow" aria-hidden>{download ? "↓" : external ? "↗" : "→"}</span>
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

export function ProofView({ m }: { m: ProofViewModel }) {
  /* Stripped to the primitive (Mike, 2026-10-17), with the Base floor and ceiling back (2026-10-18). Anchors, export
     packages and the position lists stay off the page; every old proof still opens, and all of it is in the raw JSON. */
  // Where it sits in time, on Base (Mike, 2026-10-18: "the base write should be on proof page too along with floor and
  // ceiling time like we used to have it"): the floor signed into the proof, the recorded time, and the Base write.
  const attested = m.attestedMs;
  const bf = m.kind !== "anchor" ? m.baseFloor ?? null : null;
  // Records made before 2026-10-07 carry an Ethereum floor instead: shown the same way, so old proofs keep their window.
  const ef = m.kind !== "anchor" && !bf ? m.floor ?? null : null;
  const fl = m.floorLink?.floor ?? null;
  const floorMs = fl ? fl.blockTimestamp * 1000 : bf ? (floorTimeIsBound(bf.blockTimestamp, attested).ok ? bf.blockTimestamp * 1000 : null) : ef?.blockTime ? new Date(ef.blockTime).getTime() : null;
  const sinceFloor = attested !== null && floorMs !== null ? Math.max(0, Math.floor((attested - floorMs) / 1000)) : null;
  const ct = m.ceilingTime;
  const ctMs = ct?.anchor ? ct.anchor.blockTimestamp * 1000 : null;
  const ctStampOk = ctMs === null || baseTimeIsBound(ctMs / 1000, { floorTimestampSec: floorMs !== null ? floorMs / 1000 : null, attestedAtMs: attested }).ok;
  // Only a record that went to Base shows where it sits in time (Mike, 2026-10-18: "floor stays on even when base is
  // toggled off"). Enclave v11 signs a Base floor into every bind; it shows here only beside a Base write (or one
  // waiting), i.e. when the Base switch was on. Enclave v12 drops the floor from plain binds altogether.
  const es = m.epochStart ?? null;
  const tf = m.treeFloor ?? null;
  const bitgraphed = m.pieces?.find((p) => p.label === "BitGraphed file") ?? null;
  const fo = m.floorOf ?? null;
  const showTime = ct !== null || fl !== null || es !== null || tf !== null || fo !== null;
  const c = m.checks;
  const okCount = c.claims.filter((x) => x.result === "TRUE").length;
  const badCount = c.claims.filter((x) => x.result === "FALSE").length;
  const commit = m.proof.commit;
  const nonceCount = commit.slotCounter ?? null;
  const contentCount = commit.counter ?? null;
  const proofFile = `bitgraph-${contentCount ?? safe(m.proof.artifact.digestB64).slice(0, 12)}.json`;
  const command = `npx @mikeargento/bitgraph-sdk verify <file> --proof ${proofFile}`;
  const download = () => {
    const blob = new Blob([JSON.stringify(m.proof, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = proofFile;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="pv">
      <h1 className="sr-only">BitGraph proof</h1>

      {/* ── The BitGraph and its verdict ── */}
      <section className="pv-card">
        <div className="pv-head">
          <div className="pv-head-main">
            <div className="pv-title">
              {m.recordName}
              {m.kind === "anchor" && <span className="pv-kind">Ethereum anchor</span>}
              {m.kind === "interval" && <span className="pv-kind">Interval</span>}
            </div>
            {/* When it was made, by the enclave's own signed clock (Mike, 2026-10-17: "need time and date at top"). */}
            {m.attestedMs !== null && (
              <div className="pv-when"><TimeChip date={new Date(m.attestedMs)} withDate /></div>
            )}
          </div>
        </div>

        {m.filePane}
        {m.c2pa?.present && <ContentCredentials c2pa={m.c2pa} />}

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
      </section>

      {/* ── The counter: 1, the nonce itself (revealed); 2, the content's SHA-256 (the content never leaves its owner) ── */}
      <section className="pv-card">
        <div className="pv-section-title">Monotonic counter</div>
        {/* The previous BitGraph, named first, so the card reads as the chain it is (Mike, 2026-10-19: prevB64 is the key;
            "prevBitGraph" as the readers' name). Shown by its hash: proofs are not looked up by position (2026-10-09), so
            the page cannot open the BitGraph before this one; whoever holds both proofs can check the link offline. */}
        {(commit as { prevB64?: string }).prevB64 && (
          <Row f={{ label: "Previous BitGraph", value: (commit as { prevB64?: string }).prevB64!, mono: true }} />
        )}
        {nonceCount !== null && (
          <Row f={{ label: `#${fmtNum(nonceCount)}: Nonce`, value: commit.nonceB64, mono: true }} />
        )}
        {contentCount !== null && (
          <Row f={{ label: `#${fmtNum(contentCount)}: Content hash`, value: m.proof.artifact.digestB64, mono: true }} />
        )}
        {commit.epochId && <Row f={{ label: "Epoch", value: commit.epochId, mono: true }} />}
      </section>

      {/* ── Where it sits in time: the Base floor, the recorded time, the Base write ── */}
      {showTime && (
        <section className="pv-card">
          <div className="pv-section-title">Where it sits in time</div>
          <div className="pv-moments">
            {es && (
              <Moment
                label="Epoch start"
                title={<>This epoch began after Base block #{fmtNum(es.blockNumber)}<span className="pv-moment-dim"><span className="pv-sep"> · </span>{whenBeside(es.blockTimestamp * 1000, attested)}</span></>}
                note={<>The epoch&rsquo;s first BitGraph: a read of the latest Base block, epoch-floor.json.</>}
              >
                <Pill href={es.fileUrl} external>epoch-floor.json</Pill>
                <Pill href={`https://basescan.org/block/${es.blockNumber}`} external>Basescan</Pill>
              </Moment>
            )}
            {tf && (
              <Moment
                label="Floor in time"
                title={<>Bound after Base block #{fmtNum(tf.blockNumber)}<span className="pv-moment-dim"><span className="pv-sep"> · </span>{whenBeside(tf.blockTimestamp * 1000, attested)}</span></>}
                note={<>The latest Base block, read just before the bind and held in this file&rsquo;s tree.</>}
              >
                <Pill href={tf.fileUrl} download="base-block.json">base-block.json</Pill>
                <Pill href={`https://basescan.org/block/${tf.blockNumber}`} external>Basescan</Pill>
              </Moment>
            )}
            {fo && (
              <Moment
                label="Floor BitGraph"
                title={<>Binds Base block #{fmtNum(fo.floor.blockNumber)}<span className="pv-moment-dim"><span className="pv-sep"> · </span>{whenBeside(fo.floor.blockTimestamp * 1000, attested)}</span></>}
                note={<>A floor: its content is that block, read just before BitGraph #{fmtNum(fo.record.counter)} was bound at the next count.</>}
              >
                <Pill href={`/proof/${encodeURIComponent(safe(fo.record.digestB64))}?counter=${fo.record.counter}`}>BitGraph #{fmtNum(fo.record.counter)}</Pill>
                <Pill href={`https://basescan.org/block/${fo.floor.blockNumber}`} external>Basescan</Pill>
              </Moment>
            )}
            {fl && (
              <Moment
                label="Floor in time"
                title={<>Bound after Base block #{fmtNum(fl.blockNumber)}<span className="pv-moment-dim"><span className="pv-sep"> · </span>{whenBeside(fl.blockTimestamp * 1000, attested)}</span></>}
                note={<>Set by BitGraph #{fmtNum(fl.bitgraph.counter)}, which bound that block earlier in the same epoch, before this record.</>}
              >
                <Pill href={`/proof/${encodeURIComponent(safe(fl.bitgraph.digestB64))}?counter=${fl.bitgraph.counter}`}>BitGraph #{fmtNum(fl.bitgraph.counter)}</Pill>
                <Pill href={`https://basescan.org/block/${fl.blockNumber}`} external>Basescan</Pill>
              </Moment>
            )}
            {!fl && bf && (
              <Moment
                label="Floor in time"
                title={<>Bound after Base block #{fmtNum(bf.blockNumber)}{floorMs !== null ? <span className="pv-moment-dim"><span className="pv-sep"> · </span>{whenBeside(floorMs, attested)}</span> : null}</>}
                note="The latest Base block when the enclave made this BitGraph, signed into the proof."
              >
                <Pill href={`https://basescan.org/block/${bf.blockNumber}`} external>Basescan</Pill>
              </Moment>
            )}
            {!fl && ef && (
              <Moment
                label="Floor in time"
                title={<>Bound after Ethereum block #{fmtNum(ef.blockNumber)}{floorMs !== null ? <span className="pv-moment-dim"><span className="pv-sep"> · </span>{whenBeside(floorMs, attested)}</span> : null}</>}
                note="The Ethereum block the enclave fixed when this position opened, signed into the proof."
              >
                {ef.etherscanUrl && <Pill href={ef.etherscanUrl} external>Etherscan</Pill>}
              </Moment>
            )}
            {attested !== null && (
              <Moment
                label="Bound"
                title={<><span className="pv-time-box">{whenBeside(attested, floorMs)}</span>{sinceFloor !== null ? <span className="pv-moment-dim pv-moment-since"><span className="pv-sep"> · </span>{sinceFloor} s after the floor block</span> : null}</>}
                note="The instant of the bind, by the enclave's signed clock."
                accent
              />
            )}
            {ct && ct.anchor && ctMs !== null && (
              <Moment
                label="Ceiling in time"
                title={<>Written to Base in block #{fmtNum(ct.anchor.blockNumber)}{ctStampOk ? <span className="pv-moment-dim"><span className="pv-sep"> · </span>{whenBeside(ctMs, attested)}</span> : null}</>}
                note="This proof's hash is in that block on Base."
              >
                <Pill href={`https://basescan.org/tx/${ct.anchor.txHash}`} external>Basescan</Pill>
              </Moment>
            )}
            {ct && !ct.anchor && (
              <Moment label="Ceiling in time" title={<span className="pv-moment-dim">Waiting to be written to Base<span className="pv-dots" aria-hidden /></span>} note="This page keeps asking." />
            )}
          </div>
        </section>
      )}

      {/* ── Signature and enclave ── */}
      <section className="pv-card pv-details">
        <Fold title="Signature">{m.signatureRows.map((f) => <Row key={f.label} f={f} />)}</Fold>
        <Fold title={m.proof.environment?.enforcement === "measured-tee" ? "Hardware enclave" : "Software"}>
          {m.enclaveRows.map((f) => <Row key={f.label} f={f} />)}
          <EnclaveDecoded proof={m.proof} />
        </Fold>
      </section>

      {/* ── Check it anywhere ── */}
      <section className="pv-card">
        <div className="pv-section-title">Check it anywhere</div>
        <div className="pv-offline-text">Download the proof and check it offline, beside the file:</div>
        <div style={{ margin: "16px 0", display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button type="button" className="bg-action-link" style={{ margin: 0 }} onClick={download}>Download proof</button>
          {/* The BitGraphed file: the file with its proof inside, one file that checks with nothing else (2026-10-20). */}
          {bitgraphed && (
            <button type="button" className="bg-action-link" style={{ margin: 0 }} disabled={bitgraphed.busy} onClick={bitgraphed.onClick}>
              {bitgraphed.busy ? "Assembling\u2026" : "Download the BitGraphed file"}
            </button>
          )}
        </div>
        {/* The same copy tab as /make, so the site's code blocks look alike (Mike, 2026-10-17: "shouldnt the site stay congruent"). */}
        <div className="code-block mk-code">
          <pre className="hiw-code">{command}</pre>
          <CopyCode />
        </div>
      </section>

      {/* ── Raw JSON ── */}
      <section className="pv-card pv-details">
        <Fold title="Raw JSON"><RawJson proof={m.proof} /></Fold>
      </section>
    </div>
  );
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

/* Claims this page does not judge by design, said plainly instead of as a question mark (Mike, 2026-10-05:
   "is this one supposed to be there still?"). Still listed, so every claim is shown. One the audit tool
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
    <div className="pv-sub">
      <div className="pv-sub-title">Content Credentials (C2PA)</div>
      {rows.map((f, i) => <Row key={`${f.label}-${i}`} f={f} />)}
      {openai && <div className="pv-sub-note"><a className="pv-link" href="https://help.openai.com/en/articles/8912793" target="_blank" rel="noopener">Verify with OpenAI &#8599;</a></div>}
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

