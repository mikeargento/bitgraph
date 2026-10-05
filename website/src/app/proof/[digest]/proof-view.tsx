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
 *                        each with its public link
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
import { decodeNitroAttestation } from "@mikeargento/bitgraph-verify";
import { toUrlSafeB64, truncateHash } from "@/lib/explorer";
import { CopyCode } from "@/components/copy-code";

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
  desc?: string;
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
  /** A sentence about what the floor covers, for a tree/1 record (every file recorded after it; a file kept as is not dated by it). */
  floorNote?: string | null;
  /** The anchor before the commit when it is later than the signed floor: a tighter bound on the commit by hash order. */
  commitAfter: { counter: string; blockNumber: number; blockTime: string | null; digestB64: string | null } | null;
  ceilingPos: AnchorSideView | null;
  /** The ceiling in position has not landed yet and the page is asking. */
  ethWait: boolean;
  ceilingTime: CeilingTimeView | null;
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
  exportInside: string;
  /** The pieces on their own, as small text links: the proof, the anchors, the
   *  original, the BitGraphed file. For the few who want one part. */
  pieces: DownloadView[];
  downloadNotes: string[];
  /** "Check it anywhere": the command that matches this kind of export, or null. */
  checkText: string | null;
  checkCommand: string | null;
  againNode: ReactNode;
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

function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  return [copied, (text: string) => {
    try { void navigator.clipboard.writeText(text); } catch { /* not available */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }];
}

/** A label and a value. Clicking a value copies it; a link opens in a new tab. */
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
    <div className="pv-row" onClick={() => copy(f.value)} title="Click to copy">
      <div className="pv-row-label">{f.label}</div>
      <div className={`pv-row-value${f.mono ? " pv-mono" : ""}${f.highlight ? " pv-strong" : ""}`}>
        {f.value}
        {copied && <span className="pv-copied">Copied</span>}
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

/** One group of checks, folded to its title and tally at every width (Mike, 2026-10-05: the list
 *  was 3,700px tall at 375px, "collapse like that for neatness on desktop too"); a group holding
 *  a failed check always starts open, so a failure is never folded away. */
function ChecksGroup({ title, rows }: { title: string; rows: CarrierClaim[] }) {
  const failed = rows.filter((x) => x.result === "FALSE").length;
  const held = rows.filter((x) => x.result === "TRUE").length;
  const unjudged = rows.length - held - failed;
  const [open, setOpen] = useState<boolean | null>(null);
  const isOpen = open ?? failed > 0;
  const tally = failed ? <>{failed} fail{failed === 1 ? "s" : ""}</> : <>{held} hold{unjudged ? <span className="pv-checks-unjudged"> · {unjudged} not judged</span> : null}</>;
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

function Pill({ href, children, external, download }: { href: string; children: ReactNode; external?: boolean; download?: boolean }) {
  return (
    <a href={href} className="bg-action-link pv-pill" {...(external ? { target: "_blank", rel: "noopener" } : {})} {...(download ? { download: true } : {})}>
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
  const isAnchor = m.kind === "anchor";
  const attested = m.attestedMs;
  const floorMs = m.floor?.blockTime ? new Date(m.floor.blockTime).getTime() : null;
  // Whole seconds, floored, so the count agrees with the two clock readings shown beside it.
  const sinceFloor = attested !== null && floorMs !== null ? Math.max(0, Math.floor((attested - floorMs) / 1000)) : null;
  const ct = m.ceilingTime;
  const ctMs = ct?.anchor ? ct.anchor.blockTimestamp * 1000 : null;
  const settle = ct?.settlement?.l1;
  const posMined = m.ceilingPos?.blockTime ? new Date(m.ceilingPos.blockTime).getTime() : null;
  const blockMs = m.anchorBlock?.minedMs ?? null;
  const sinceBlock = attested !== null && blockMs !== null ? Math.max(0, Math.floor((attested - blockMs) / 1000)) : null;
  const c = m.checks;
  const okCount = c.claims.filter((x) => x.result === "TRUE").length;
  const badCount = c.claims.filter((x) => x.result === "FALSE").length;
  const groups: Array<[string, (id: string) => boolean]> = [
    ["The bytes", (id) => id.startsWith("bytes.") || id.startsWith("tree.") || id === "proof.fused" || id === "block"],
    ["The proof", (id) => id === "proof.signature" || id === "proof.hash"],
    ["The hardware", (id) => id.startsWith("attestation.")],
    ["The floor", (id) => id.startsWith("floor.") || id === "confirmed.floor"],
    ["The ceilings", (id) => id.startsWith("ceiling.") || id.startsWith("settlement.") || id === "confirmed.ceiling.time" || id === "confirmed.ceiling.position" || id === "confirmed.settlement"],
    ["The pins", (id) => id === "pins"],
  ];

  return (
    <div className="pv">
      <h1 className="sr-only">BitGraph Record</h1>

      {/* ── 1. The record ── */}
      <section className="pv-card">
        <div className="pv-head">
          <div className="pv-head-main">
            <div className="pv-title">
              {m.recordName}
              {isAnchor && <span className="pv-kind">Ethereum anchor</span>}
              {m.kind === "interval" && <span className="pv-kind">Interval</span>}
              {m.set && <span className="pv-kind">{m.set.kind === "tree/1" ? (m.set.count === 1 ? "Tree of one" : `Tree of ${fmtNum(m.set.count)}`) : `Set of ${fmtNum(m.set.count)}`}</span>}
            </div>
            {m.epochFull && (
              <div className="pv-epoch" title={m.epochFull}>epoch <span className="pv-mono">{m.epochFull}</span></div>
            )}
            <div className="pv-when">
              {attested !== null ? (
                <>
                  <span className="pv-when-label">Recorded </span>
                  <TimeChip date={new Date(attested)} withDate />
                </>
              ) : m.leadFallback}
            </div>
          </div>
          {m.anchorsBackHref && (
            <div className="pv-head-side"><Pill href={m.anchorsBackHref}>All floors</Pill></div>
          )}
        </div>

        {m.filePane}

        {m.c2pa?.present && <ContentCredentials c2pa={m.c2pa} />}

        {/* A tree of one whose file is shown above needs no Files list: it would only repeat it. */}
        {m.set && m.set.kind === "tree/1" && !(m.set.count === 1 && m.set.rows.length === 1) && (
          <div className="pv-sub">
            <div className="pv-sub-title">Files</div>
            {m.set.rows.length === 0 ? (
              <div className="pv-sub-note">
                {m.set.count === 1
                  ? <>One file under this position, tree root <span className="pv-mono">{truncateHash(m.set.root ?? "", 16)}</span>. Drop the file above to check it: a tree of one needs nothing else.</>
                  : <>{fmtNum(m.set.count)} files under one position, tree root <span className="pv-mono">{truncateHash(m.set.root ?? "", 16)}</span>. A file&rsquo;s own export, or its recovery entry, shows whether it is one of them: drop the file with its export above.</>}
              </div>
            ) : m.set.rows.map((r) => (
              <div key={r.key} className="pv-list-row">
                <span className="pv-list-num">{r.ordinal} of {fmtNum(m.set!.count)}</span>
                <span className="pv-list-mid pv-mono">{truncateHash(r.originDigestB64, 12)}</span>
                <span className="pv-list-dim pv-mono">{r.placement}</span>
                <span className="pv-list-viewing">Viewing</span>
              </div>
            ))}
          </div>
        )}
        {m.set && m.set.kind !== "tree/1" && (
          <div className="pv-sub">
            <div className="pv-sub-title">Members</div>
            {m.set.rows.length === 0 ? (
              <div className="pv-sub-note">
                {fmtNum(m.set.count)} members under one position{m.set.root ? <>, set root <span className="pv-mono">{truncateHash(m.set.root, 16)}</span></> : null}. A member&rsquo;s row comes with the member: drop one of the files above.
              </div>
            ) : m.set.rows.map((r) => (
              <div key={r.key} className="pv-list-row">
                <span className="pv-list-num">{r.ordinal} of {fmtNum(m.set!.count)}</span>
                <span className="pv-list-mid pv-mono">{truncateHash(r.originDigestB64, 12)}</span>
                <span className="pv-list-dim pv-mono">{r.placement}</span>
                {r.viewing ? <span className="pv-list-viewing">Viewing</span> : <a className="pv-list-link" href={r.href}>View <span aria-hidden>&rarr;</span></a>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── 2. Where it sits in time ── */}
      <section className="pv-card">
        <div className="pv-section-title">Where it sits in time</div>
        <div className="pv-moments">
          {isAnchor && m.anchorBlock && (
            <Moment label="Ethereum block" title={<>Block {m.anchorBlock.number ? `#${fmtNum(m.anchorBlock.number)}` : "#?"}{m.anchorBlock.minedMs !== null ? <span className="pv-moment-dim"> · mined {whenBeside(m.anchorBlock.minedMs, attested)}</span> : null}</>} note="This anchor is a BitGraph of that block's hash. The block existed before it, so everything placed after this anchor came after the block.">
              {m.anchorBlock.etherscanUrl && <Pill href={m.anchorBlock.etherscanUrl} external>Etherscan</Pill>}
            </Moment>
          )}

          {!isAnchor && m.floor && (
            <Moment
              label="Floor in time" chain="eth"
              title={<>Recorded after Ethereum block #{fmtNum(m.floor.blockNumber)}{floorMs !== null ? <span className="pv-moment-dim"> · mined {whenBeside(floorMs, attested)}</span> : null}</>}
              note={<>Fixed by the enclave when the position opened and signed into the proof; a block hash cannot be known before its block exists.{m.floor.recordedMs !== null ? <> Recorded as anchor #{fmtNum(m.floor.counter)} at {whenBeside(m.floor.recordedMs, attested)}.</> : null}{m.commitAfter ? <> The commit also follows anchor #{fmtNum(m.commitAfter.counter)}, Ethereum block #{fmtNum(m.commitAfter.blockNumber)}{m.commitAfter.blockTime ? <> (mined {whenBeside(new Date(m.commitAfter.blockTime).getTime(), attested)})</> : null}, by the chain of proof hashes: a tighter bound on the commit, not on the bytes.</> : null}{m.floorNote ? <> {m.floorNote}</> : null}</>}
            >
              {m.floor.etherscanUrl && <Pill href={m.floor.etherscanUrl} external>Etherscan</Pill>}
              {m.floor.digestB64 && <Pill href={`/proof/${encodeURIComponent(safe(m.floor.digestB64))}`}>Anchor #{fmtNum(m.floor.counter)}</Pill>}
            </Moment>
          )}

          {!isAnchor && attested !== null && (
            <Moment
              label="Recorded"
              title={<>{whenBeside(attested, floorMs)}{sinceFloor !== null ? <span className="pv-moment-dim"> · {sinceFloor} s after the floor block</span> : null}</>}
              note="The instant of the commit, per the enclave platform's signed clock, carried in the attestation under Details."
              accent
            />
          )}

          {!isAnchor && ct && ct.anchor && ctMs !== null && (
            <Moment
              label="Ceiling in time" chain="base"
              title={<>Existed by Base block #{fmtNum(ct.anchor.blockNumber)}<span className="pv-moment-dim"> · {whenBeside(ctMs, attested)}</span></>}
              note={<>
                A Merkle root over this record&rsquo;s proof hash, in that block.{" "}
                {settle && typeof settle.blockNumber === "number"
                  ? <>Its batch data is on Ethereum: block #{fmtNum(settle.blockNumber)}{typeof settle.blockTimestamp === "number" ? <> ({whenBeside(settle.blockTimestamp * 1000, attested)})</> : null}.</>
                  : ct.status === "finalized" ? "Final on Ethereum, as BitGraph's Base node last reported."
                  : ct.status === "safe" ? "Posted to Ethereum, as BitGraph's Base node last reported."
                  : "Relies on Base's sequencer until it is posted to Ethereum."}
              </>}
            >
              <Pill href={`https://basescan.org/tx/${ct.anchor.txHash}`} external>Basescan</Pill>
              {settle?.txHash && <Pill href={`https://etherscan.io/tx/${settle.txHash}`} external>Ethereum batch</Pill>}
            </Moment>
          )}
          {!isAnchor && ct && !ct.anchor && (
            <Moment label="Ceiling in time" chain="base" title={<span className="pv-moment-dim">Queued for the next Base write<span className="pv-dots" aria-hidden /></span>} note="The writer puts a root over new records on Base seconds after each commit. This page keeps asking." />
          )}

          {!isAnchor && m.ceilingPos && (
            <Moment
              label="Ceiling in position" chain="eth"
              title={<>Committed before anchor #{fmtNum(m.ceilingPos.counter)}{m.ceilingPos.recordedMs !== null ? <span className="pv-moment-dim"> · recorded {whenBeside(m.ceilingPos.recordedMs, attested)}</span> : null}</>}
              note={<>The next anchor in the sequence, carrying Ethereum block #{fmtNum(m.ceilingPos.blockNumber)}{posMined !== null ? <> (mined {whenBeside(posMined, attested)})</> : null}. A bound in position, not a clock time: an anchor is made after the block it carries.</>}
            >
              {m.ceilingPos.etherscanUrl && <Pill href={m.ceilingPos.etherscanUrl} external>Etherscan</Pill>}
              {m.ceilingPos.digestB64 && <Pill href={`/proof/${encodeURIComponent(safe(m.ceilingPos.digestB64))}`}>Anchor #{fmtNum(m.ceilingPos.counter)}</Pill>}
            </Moment>
          )}
          {!isAnchor && !m.ceilingPos && m.ethWait && (
            <Moment label="Ceiling in position" chain="eth" title={<span className="pv-moment-dim">Waiting for the next anchor<span className="pv-dots" aria-hidden /></span>} note="An anchor lands about every 12 seconds. This page keeps asking." />
          )}
          {isAnchor && attested !== null && (
            <Moment label="Recorded" title={<>{whenBeside(attested, blockMs)}{sinceBlock !== null ? <span className="pv-moment-dim"> · {sinceBlock} s after the block</span> : null}</>} note="The instant the enclave signed this anchor, per the enclave platform's signed clock: after the block it carries." accent />
          )}
        </div>
      </section>

      {/* ── 3. What holds ── */}
      <section className="pv-card">
        <div className="pv-section-title">What holds, and what it rests on</div>
        {c.state === "running" && <div className="pv-note">Checking the evidence in your browser<span className="pv-dots" aria-hidden /></div>}
        {c.state === "failed" && <div className="pv-note">{c.note ?? "The evidence could not be assembled just now. That is not a finding about this BitGraph; try again in a moment."}</div>}
        {c.state === "idle" && <div className="pv-note">The checks run once the proof and its anchors are in hand.</div>}
        {c.state === "done" && (
          <>
            <div className="pv-checks-summary">
              <span className={`pv-verdict pv-verdict-${(c.verdict ?? "UNDETERMINED").toLowerCase()}`}>{c.verdict === "TRUE" ? "Holds" : c.verdict === "FALSE" ? "Does not hold" : "Undetermined"}</span>
              <span className="pv-checks-count">{okCount} checks passed{badCount ? `, ${badCount} failed` : ""}{c.bytesInHand ? "" : m.set ? " · the set's root document is not in hand, so the two checks that need its bytes are not run here" : " · the file's own bytes are not in hand, so the two checks that need them are not run here"}</span>
            </div>
            {c.reading && <Reading text={c.reading} isFalse={c.verdict === "FALSE"} />}
            {groups.map(([title, pick]) => {
              const rows = c.claims.filter((x) => pick(x.id));
              if (rows.length === 0) return null;
              return <ChecksGroup key={title} title={title} rows={rows} />;
            })}
            {/* The blocks against the chains, asked automatically (no button): one line says how it went. */}
            {(() => {
              const online = c.claims.filter((x) => x.level === "confirmed");
              const bad = online.some((x) => x.result === "FALSE");
              const unanswered = online.some((x) => x.result === "UNDETERMINED");
              const state = !c.confirmed || c.confirming ? "asking" : bad ? "mismatch" : unanswered ? "unreached" : "confirmed";
              return (
                <div className={`pv-confirm pv-confirm-${state}`}>
                  {state === "asking" && <span>Checking the blocks with Ethereum and Base…</span>}
                  {state === "confirmed" && <span><span aria-hidden>&#10003; </span><span className="pv-wide">Blocks c</span><span className="pv-narrow">C</span>onfirmed with Ethereum and&nbsp;Base</span>}
                  {state === "mismatch" && <span>A block does not match what Ethereum or Base reports</span>}
                  {state === "unreached" && (
                    <>
                      <span>Couldn&rsquo;t reach the public nodes just now. The offline checks still hold.</span>
                      <button type="button" className="pv-confirm-retry" onClick={m.onConfirm}>Try again</button>
                    </>
                  )}
                  {(state === "confirmed" || state === "mismatch") && <span className="pv-confirm-src">Asked from this browser: <span className="pv-host">ethereum-rpc.publicnode.com</span> and <span className="pv-host">mainnet.base.org</span>.</span>}
                </div>
              );
            })()}
          </>
        )}
      </section>

      {/* ── 4. Take it with you ── */}
      <section className="pv-card">
        <div className="pv-section-title">Take it with you</div>
        {/* One export, one button (Mike, 2026-10-04: "a master button"), laid out as
            an assets list, the structure the Positions list below already uses: the
            export is the first row and the only filled button; the pieces are rows
            under it with a text link each. Before this, four pills in a row. */}
        <div className="pv-take">
          {m.exportAction && (
            <div className="pv-take-row is-main">
              <div className="pv-take-text">
                <div className="pv-take-name">{m.exportName}</div>
                <div className="pv-take-desc">{m.exportInside}</div>
              </div>
              <button type="button" onClick={m.exportAction.onClick} disabled={m.exportAction.busy} className="bg-action-link pv-dl is-primary">
                <span>{m.exportAction.busy ? m.exportAction.busyLabel : m.exportAction.label}</span>
              </button>
            </div>
          )}
          {m.pieces.map((d) => (
            <div key={d.label} className="pv-take-row">
              <div className="pv-take-text">
                <div className="pv-take-name">{d.label}</div>
                {d.desc && <div className="pv-take-desc">{d.desc}</div>}
              </div>
              <button type="button" onClick={d.onClick} disabled={d.busy} className="pv-take-link">{d.busy ? d.busyLabel : "Download"} <span aria-hidden>&darr;</span></button>
            </div>
          ))}
          {m.ceilingFileHref && (
            <div className="pv-take-row">
              <div className="pv-take-text">
                <div className="pv-take-name">Ceiling file</div>
                <div className="pv-take-desc">The Base ceiling: the transaction that carries the root, its block header, and the settlement pointer.</div>
              </div>
              <a href={m.ceilingFileHref} download className="pv-take-link">Download <span aria-hidden>&darr;</span></a>
            </div>
          )}
        </div>
        {m.downloadNotes.length > 0 && (
          <div className="pv-note">{m.downloadNotes.map((n, i) => <div key={i}>{n}</div>)}</div>
        )}
        {m.checkCommand && (
          <div className="pv-offline">
            <div className="pv-sub-title">Check it anywhere</div>
            {m.checkText && <div className="pv-offline-text">{m.checkText}</div>}
            <div className="code-block pv-code">
              <div className="code-block-header"><span>Shell</span><CopyCode /></div>
              <pre><code>{m.checkCommand}</code></pre>
            </div>
          </div>
        )}
        {m.againNode && <div className="pv-again">{m.againNode}</div>}
      </section>

      {/* ── 5. Details ── */}
      <section className="pv-card pv-details">
        <div className="pv-section-title">Details</div>
        {m.hashes.length > 0 && (
          <Fold title="Hashes">{m.hashes.map((f) => <Row key={f.label} f={f} />)}</Fold>
        )}
        {m.positions && (
          <Fold title="Positions" count={m.positions.rows.length}>
            <div className="pv-sub-note">{m.positions.intro}</div>
            {m.positions.rows.map((r) => (
              <div key={r.key} className="pv-list-row pv-list-row-tall">
                <span className="pv-list-num">BitGraph <span className="pv-mono">#{r.num}</span></span>
                <span className="pv-list-mid">{r.roleLine}</span>
                <span className="pv-list-dim pv-mono">{r.timeNode}</span>
                {r.viewing ? <span className="pv-list-viewing">Viewing</span> : <a className="pv-list-link" href={r.href}>View <span aria-hidden>&rarr;</span></a>}
              </div>
            ))}
          </Fold>
        )}
        {m.positionRecord.length > 0 && (
          <Fold title="Position record">{m.positionRecord.map((f) => <Row key={f.label} f={f} />)}</Fold>
        )}
        <Fold title="Commit">{m.commitRows.map((f) => <Row key={f.label} f={f} />)}</Fold>
        <Fold title="Signature">{m.signatureRows.map((f) => <Row key={f.label} f={f} />)}</Fold>
        <Fold title={m.proof.environment?.enforcement === "measured-tee" ? "Hardware enclave" : "Software"}>
          {m.enclaveRows.map((f) => <Row key={f.label} f={f} />)}
          <EnclaveDecoded proof={m.proof} />
        </Fold>
        {m.intervalRows.length > 0 && <Fold title="Interval">{m.intervalRows.map((f) => <Row key={f.label} f={f} />)}</Fold>}
        {m.advisoryRows.length > 0 && <Fold title="Advisory timestamp">{m.advisoryRows.map((f) => <Row key={f.label} f={f} />)}</Fold>}
        {m.noteRows.length > 0 && <Fold title="Submitter's note">{m.noteRows.map((f) => <Row key={f.label} f={f} />)}</Fold>}
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

function ClaimRow({ x }: { x: CarrierClaim }) {
  const [open, setOpen] = useState(false);
  const glyph = x.result === "TRUE" ? "✓" : x.result === "FALSE" ? "✗" : x.result === "NOT_CARRIED" ? "–" : "?";
  return (
    <div className={`pv-claim pv-claim-${x.result.toLowerCase().replace("_", "-")}${open ? " is-open" : ""}`}>
      <button type="button" className="pv-claim-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="pv-claim-glyph" aria-hidden>{glyph}</span>
        <span className="pv-claim-name">{x.name}</span>
        {x.result === "TRUE" && x.restsOn ? <span className="pv-claim-rests">{x.restsOn}</span> : null}
        {x.result === "NOT_CARRIED" ? <span className="pv-claim-rests">not carried</span> : null}
        {x.result === "UNDETERMINED" ? <span className="pv-claim-rests">not judged</span> : null}
        {x.result === "FALSE" ? <span className="pv-claim-rests">fails</span> : null}
        <svg className="pv-chevron pv-claim-chev" width="18" height="18" viewBox="0 0 24 24" aria-hidden><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && <div className="pv-claim-detail">{x.detail}</div>}
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
      <div className="pv-sub-note">Read from the file&rsquo;s own bytes: a description the file carries, not something BitGraph checked.</div>
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
    <div className="pv-raw" onClick={() => copy(text)} title="Click to copy">
      {copied && <div className="pv-raw-copied">Copied</div>}
      <pre>{text}</pre>
    </div>
  );
}

