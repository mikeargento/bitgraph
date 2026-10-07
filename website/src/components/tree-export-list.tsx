"use client";

/* The verdicts on dropped export/1 files: a tree/1 BitGraph checked from the
 * drop alone (lib/folder-check.ts, checkTreeExports). One row per file an
 * export covers, or per export dropped without its files.
 *
 * Each row says the verdict and then the three time claims on their own lines,
 * never merged (SPEC.md section 1): the floor (every file recorded after a
 * Base block since enclave v10, an Ethereum block before; a placed file's committed bytes finished after it; a file
 * recorded as is not dated by it), the Base
 * ceiling (existed by a Base block, its time provisional until that block is
 * checked against Base), and the Ethereum ceiling (existed by an Ethereum
 * block, through Base's output root; Base's honesty is not needed).
 *
 * Fixed-height rows, windowed like the drop's own list: an owner's export
 * dropped with its folder is one row per file, and that can be thousands.
 */

import { useEffect, useRef, useState } from "react";
import { useWindowedRows } from "@/components/windowed-rows";
import { fmtRowWhen } from "@/components/folder-list";
import type { TreeExportRow } from "@/lib/folder-check";

/** One row: five lines of type and the padding around them. Phones wrap each line instead of
 *  cutting it off (Mike, 2026-10-05: "it cuts off"), so their rows are taller; still one fixed
 *  height per screen, which is what the windowing needs. */
const ROW_H_WIDE = 118;
const ROW_H_PHONE = 236;
/* Wrap whenever the list is narrower than its longest line needs (about 820px), not only on phones:
   a narrow desktop window or a tablet cut the floor and Base lines off too (Mike, 2026-10-05:
   "this should wrap it gets chopped"). Measured on the list itself, so it follows the layout. */
const WRAP_BELOW_PX = 820;
const ROW_H_MID = 168; // wrapped, between a phone and WRAP_BELOW_PX: lines take two rows at most
function useListWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const box = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1200));
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [box, width];
}

const verdictWord = (r: TreeExportRow): { text: string; color: string } =>
  r.verdict === "TRUE"
    ? { text: r.scope === "file" ? "Verified" : "Proof verified", color: "var(--accent)" }
    : r.verdict === "FALSE"
      ? { text: "Does not verify", color: "var(--err)" }
      : { text: "Not determined", color: "var(--dim)" };

const fmtBlock = (n: number) => n.toLocaleString("en-US");
const fmtTime = (unix: number) => fmtRowWhen(unix * 1000);

/**
 * The floor line, for what this row is about (SPEC.md 8.6). Every file was
 * recorded after the floor block (the record floor). A placed file's committed
 * bytes carry the commitment, so they were finished after it too (the content
 * floor); a file kept as is carries none, so its bytes are not dated. An export
 * alone, without a leaf of its own, can only say when the tree was committed.
 */
function floorLine(r: TreeExportRow): string {
  const f = r.times.floor;
  if (f === null) return "Not in this export";
  // The floor's own chain: a Base block since enclave v10, an Ethereum block before.
  const when = `${(f as { chain?: string }).chain === "base" ? "Base" : "Ethereum"} block ${fmtBlock(f.blockNumber)} · ${fmtTime(f.blockTimestamp)}`;
  if (r.floorCovers === "record" || r.member?.placement === "as-is") return `Recorded after ${when}; kept as is, so the bytes themselves are not dated`;
  if (r.member) return `Recorded after ${when}, and its committed bytes were finished after that block`;
  return `The tree was committed after ${when}`;
}

function baseLine(r: TreeExportRow): string {
  const b = r.times.ceilingBase;
  if (b !== null) return `Existed by Base block ${fmtBlock(b.blockNumber)} · ${fmtTime(b.blockTimestamp)}${b.provisional ? " (provisional until checked against Base)" : ""}`;
  return r.ceiling === "pending" ? "Pending when exported" : r.ceiling === "present" ? "Did not verify" : "Not in this export";
}

function ethereumLine(r: TreeExportRow): string {
  const e = r.times.ceilingEthereum;
  if (e !== null) return `Existed by Ethereum block ${fmtBlock(e.blockNumber)} · ${fmtTime(e.blockTimestamp)}`;
  return r.settlement === "pending" ? "Pending when exported" : r.settlement === "present" ? "Did not verify" : "Not in this export";
}

/** The second line: where the file sits, or why there is no file. */
function whereLine(r: TreeExportRow): string {
  const pos = r.counter != null ? `#${Number(r.counter).toLocaleString("en-US")}` : null;
  if (r.problems.length > 0 && r.verdict !== "TRUE") return r.problems[0]!;
  if (r.scope === "export" && r.member) {
    // One file's export, without the file.
    return `File ${(r.member.index + 1).toLocaleString("en-US")} of ${r.member.count.toLocaleString("en-US")} in the tree${pos ? ` at ${pos}` : ""}. The file was not in this drop: drop it with its export to check it.`;
  }
  if (r.scope === "export") {
    const size = r.count !== null ? `A tree of ${r.count.toLocaleString("en-US")} file${r.count === 1 ? "" : "s"}` : "A tree";
    return `${size}${pos ? ` at ${pos}` : ""}. None of its files was in this drop: drop them with the export to check them.`;
  }
  const m = r.member;
  const leaf = m ? `File ${(m.index + 1).toLocaleString("en-US")} of ${m.count.toLocaleString("en-US")} in the tree` : "In the tree";
  const placement = m ? (m.placement === "as-is" ? "as is" : m.placement) : null;
  return [leaf, placement, pos].filter(Boolean).join(" · ");
}

export function TreeExportList({ rows, onOpen }: { rows: TreeExportRow[]; onOpen: (r: TreeExportRow) => void }) {
  const [box, width] = useListWidth();
  const phone = width < WRAP_BELOW_PX; // wrap
  const ROW_H = !phone ? ROW_H_WIDE : width < 560 ? ROW_H_PHONE : ROW_H_MID;
  const { ref, first, last } = useWindowedRows(rows.length, ROW_H);
  const files = rows.filter((r) => r.scope === "file");
  const verified = files.filter((r) => r.verdict === "TRUE").length;
  const failed = rows.filter((r) => r.verdict === "FALSE").length;
  const alone = rows.length - files.length;
  const spec = rows.some((r) => r.spec === "other") ? "other" : rows.some((r) => r.spec === "pinned") ? "pinned" : null;
  const label = { fontSize: 12, color: "var(--faint)", width: 72, flexShrink: 0 } as const;
  const line = phone
    ? ({ fontSize: 12.5, color: "var(--dim)", minWidth: 0, lineHeight: 1.4 } as const)
    : ({ fontSize: 12.5, color: "var(--dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 } as const);
  return (
    <div ref={box} style={{ border: "1px solid var(--line)", borderRadius: "var(--radius-card)", overflow: "hidden", background: "var(--bg)" }}>
      <div style={{ background: "var(--panel)", padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>
          {files.length > 0
            ? `${verified} of ${files.length} file${files.length === 1 ? "" : "s"} verified`
            : `${rows.length} export${rows.length === 1 ? "" : "s"} checked`}
          {alone > 0 && files.length > 0 && <span style={{ fontWeight: 400, color: "var(--dim)" }}>{` · ${alone} export${alone === 1 ? "" : "s"} without ${alone === 1 ? "its" : "their"} file`}</span>}
        </span>
        {failed > 0 && <span style={{ fontSize: 13, fontWeight: 600, color: "var(--err)" }}>{failed} {failed === 1 ? "does" : "do"} not verify</span>}
      </div>
      {spec && (
        <div style={{ padding: "10px 16px", fontSize: 13, color: spec === "pinned" ? "var(--dim)" : "var(--err)", borderBottom: "1px solid var(--line-2)" }}>
          {spec === "pinned"
            ? "The SPEC.md beside it is the text the proof pins."
            : "A SPEC.md in this drop is not the text the proof pins: the proof names the rules it follows by their SHA-256."}
        </div>
      )}
      <div ref={ref}>
        <div style={{ height: first * ROW_H }} aria-hidden />
        {rows.slice(first, last).map((r, k) => {
          const i = first + k;
          const v = verdictWord(r);
          return (
            <div
              key={r.key}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(r)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(r); } }}
              className="bitgraph-file-row"
              style={{ height: ROW_H, padding: "10px 14px", overflow: "hidden", borderTop: i > 0 ? "1px solid var(--line-2)" : "none", cursor: "pointer", display: "flex", flexDirection: "column", gap: 3, boxSizing: "border-box" }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 15, color: "var(--ink)" }}>{r.fileName ?? r.exportName}</span>
                {/* The row opens the proof: say so (Mike, 2026-10-05: "no indication you can click"). */}
                <span style={{ flexShrink: 0, fontSize: 13, fontWeight: 700, color: v.color }}>{v.text}<span aria-hidden style={{ marginLeft: 6, color: "var(--faint)", fontWeight: 400 }}>&rsaquo;</span></span>
              </div>
              <div style={{ ...line, color: r.verdict === "FALSE" ? "var(--err)" : "var(--dim)" }}>{whereLine(r)}</div>
              <div style={{ display: "flex", gap: 8 }}><span style={label}>Floor</span><span style={line}>{floorLine(r)}</span></div>
              <div style={{ display: "flex", gap: 8 }}><span style={label}>Base</span><span style={line}>{baseLine(r)}</span></div>
              <div style={{ display: "flex", gap: 8 }}><span style={label}>Ethereum</span><span style={line}>{ethereumLine(r)}</span></div>
            </div>
          );
        })}
        <div style={{ height: Math.max(0, (rows.length - last) * ROW_H) }} aria-hidden />
      </div>
    </div>
  );
}
