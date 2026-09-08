"use client";

/* The folder's Ledger, extracted so it has more than one address: the home
 * page renders it for a one-off drop, and /folder renders it for the folder
 * you keep. Everything here is a READ of bytes already on the machine.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { isUnchecked, type ExportCheckResult } from "@/lib/folder-check";
import { MonthCalendar, MonthShelf, type CalendarDay } from "@/components/month-calendar";
import { useWindowedRows } from "@/components/windowed-rows";

// Compact recorded time for a result row, e.g. "Jul 17, 9:22 PM" — the same
// format the ledger's rows use, so the two lists read as one system.
export const fmtRowWhen = (ms?: number | null) =>
  ms ? new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

/* ── The folder's Ledger — the viewer a dropped BitGraph folder loads into.
   The Folder generates no browsing pages of its own (1.9.0); this is where a
   folder is browsed AND checked, in one surface the site renders. Day
   grouping and causal order are the sheet's exact keys, computed here from
   the exports' own proof.json and witness files; thumbnails are object URLs
   over the dropped bytes, never uploaded, revoked on unmount. ── */

const IMAGE_THUMB_EXT = ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "svg"];

/** Tiny thumbs from in-hand bytes, for any list of dropped files: decode
 *  once, draw at 96px (2x the 48px cell), keep only the few-KB blob's object
 *  URL. Keyed by the FILE (stable across re-renders); URLs revoked on
 *  unmount. Four decodes in flight, in the caller's given order.
 *
 *  ⚠️ PASS ONLY THE ROWS ON SCREEN. This used to be handed every row in the
 *  folder and decoded all of them at full resolution, including rows nobody
 *  would ever scroll to.
 *
 *  ⚠️ AND IT PUBLISHED ONCE PER THUMBNAIL. `setThumbs(new Map(...))` after
 *  every decode re-rendered the whole list, so N thumbnails cost N renders of
 *  N rows: 425 rows was ~180,000 row renders, and a 6,000 recording folder
 *  would be 36 million. Same shape as the progress callback that walked the
 *  whole drop per event (2026-09-07) — per-item work must never be
 *  proportional to the list. Decodes now publish in batches, on a timer. */
export function useFileThumbs(files: Array<File | null | undefined>): Map<File, string> {
  const [thumbs, setThumbs] = useState<Map<File, string>>(() => new Map());
  const mapRef = useRef<Map<File, string>>(new Map());
  useEffect(() => () => { for (const u of mapRef.current.values()) URL.revokeObjectURL(u); }, []);
  // Re-run when WHICH files are wanted changes, not how many: a window that
  // scrolls keeps its length and would otherwise never ask for the new rows.
  const key = files.map((f) => (f ? `${f.name}:${f.size}:${f.lastModified}` : "-")).join("|");
  useEffect(() => {
    let dead = false;
    const list = files.filter((f): f is File => !!f);
    let next = 0;
    let dirty = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const publish = () => {
      timer = null;
      if (dead || !dirty) return;
      dirty = false;
      setThumbs(new Map(mapRef.current));
    };
    const mark = () => {
      dirty = true;
      // One render per batch of decodes rather than one per decode. The
      // last thumbnail still lands, because a final flush runs on cleanup.
      if (timer === null) timer = setTimeout(publish, 120);
    };
    const worker = async () => {
      while (!dead) {
        const i = next++;
        if (i >= list.length) return;
        const f = list[i];
        if (mapRef.current.has(f)) continue;
        const ext = f.name.slice(f.name.lastIndexOf(".") + 1).toLowerCase();
        if (!IMAGE_THUMB_EXT.includes(ext)) continue;
        try {
          const bmp = await createImageBitmap(f);
          const w = Math.min(96, bmp.width);
          const h = Math.max(1, Math.round((bmp.height / bmp.width) * w));
          const c = document.createElement("canvas");
          c.width = w; c.height = h;
          c.getContext("2d")?.drawImage(bmp, 0, 0, w, h);
          bmp.close();
          const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.75));
          if (!blob || dead || mapRef.current.has(f)) continue;
          mapRef.current.set(f, URL.createObjectURL(blob));
          mark();
        } catch { /* a row without a thumb shows its type label */ }
      }
    };
    void Promise.all(Array.from({ length: 4 }, worker));
    return () => {
      dead = true;
      if (timer !== null) clearTimeout(timer);
      // Whatever decoded before this window moved is still wanted.
      if (dirty) setThumbs(new Map(mapRef.current));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return thumbs;
}

/* The cachedThumbs / onThumb / cachedComplete plumbing that fed the /folder
   browser's IndexedDB memory was removed with that page (2026-08-07). This
   list renders drops whose bytes are in hand; thumbs are generated from
   those bytes and live for the visit. */
/**
 * One row's height, in pixels, including the 10px gap below it.
 *
 * Fixed on purpose: the window is measured in rows, so a row that grew with
 * its content would put the spacers and the scrollbar out of step with what
 * is on screen. 48px thumb + 10px padding top and bottom + 1px border each
 * side = 70, and the column's gap is 10.
 */
const CHECKED_ROW_H = 80;

export function CheckedList({ checked, onOpen, heading = "BitGraphs in this folder", aside }: {
  checked: ExportCheckResult[];
  onOpen: (r: ExportCheckResult) => void;
  /** The list's own title. null lets a caller's page header own the top. */
  heading?: string | null;
  /** Something for the right of the heading row (the camera's "Record or
   *  check more →" when this Ledger is the first thing on a results page). */
  aside?: React.ReactNode;
}) {
  // Causal order, newest first: lower-bound block, then counter; unsealed
  // (no block) lead. The same sort every surface in the product uses.
  const ordered = useMemo(() => [...checked].sort((x, y) => {
    const xb = x.block ?? 0, yb = y.block ?? 0;
    if (!xb !== !yb) return xb ? 1 : -1;
    if (xb !== yb) return yb - xb;
    return (parseInt(y.counter || "0", 10) || 0) - (parseInt(x.counter || "0", 10) || 0);
  }), [checked]);

  // Day groups along the causal walk: unsealed under today, ts-less sealed
  // rows inherit the open group. Local days, never UTC epochs.
  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; short: string; rows: ExportCheckResult[] }> = [];
    let openKey: string | null = null;
    for (const r of ordered) {
      const when = !r.block ? new Date() : r.ts ? new Date(r.ts * 1000) : null;
      if (when !== null) {
        const key = `${when.getFullYear()}-${when.getMonth()}-${when.getDate()}`;
        if (key !== openKey) {
          openKey = key;
          out.push({
            key,
            label: when.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }),
            short: when.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
            rows: [],
          });
        }
      }
      if (!out.length) {
        const now = new Date();
        out.push({
          key: `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`,
          label: now.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }),
          short: now.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
          rows: [],
        });
      }
      out[out.length - 1].rows.push(r);
    }
    return out;
  }, [ordered]);

  // The ledger's navigation, exactly (Mike: "i thought maybe you could just
  // use Ledger exactly for this"): the default view is every recording newest
  // first, and past days are walked one at a time with dated steppers - not
  // scrolled past under inline headers. `day` is which slice is open; null
  // is the live view. Steppers move between RECORDED days (a folder is
  // sparse where the ledger is continuous - the same knowing deviation the
  // old sheet made).
  const [day, setDay] = useState<string | null>(null);
  // The shelf: the ledger's /days month-grid calendar, client-side. Not
  // important at two days, load-bearing at two hundred (Mike's call).
  const [shelf, setShelf] = useState(false);
  const dayIdx = day === null ? -1 : groups.findIndex((g) => g.key === day);
  const view = day === null ? null : groups[dayIdx] ?? null;
  const shownGroups = useMemo(() => (view ? [view] : groups), [view, groups]);
  const older = day === null ? (groups.length > 1 ? groups[1] : null) : groups[dayIdx + 1] ?? null;
  const newer = day === null ? null : dayIdx > 0 ? groups[dayIdx - 1] : null;

  const stepLink: React.CSSProperties = { color: "#0065A4", fontWeight: 600, fontSize: 13.5, textDecoration: "none", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };

  /**
   * One flat list of rows, windowed, exactly like the drop's results list.
   *
   * ⚠️ THIS USED TO RENDER EVERY ROW. The day groups only wrap their rows in
   * a spacer div (the day itself is named by the stepper above, not by a
   * heading between rows), so flattening them changes nothing on screen and
   * lets the same window the drop uses apply here. 425 rows was survivable;
   * a folder of several thousand is the frozen tab this already cost once
   * (Mike, 2026-09-07: "didnt we just change this to list form?").
   */
  const flat = useMemo(
    () => shownGroups.flatMap((g) => g.rows.map((r) => ({ r, groupKey: g.key }))),
    [shownGroups],
  );
  const { ref: listRef, first: rowFirst, last: rowLast } = useWindowedRows(flat.length, CHECKED_ROW_H);
  const visible = flat.slice(rowFirst, rowLast);
  // Thumbs for the rows ON SCREEN, in render order, so pictures fill from the
  // top of what is visible and nothing decodes for a row nobody scrolls to.
  const thumbs = useFileThumbs(visible.map((v) => v.r.artifactFile));

  const okCount = checked.filter((c) => c.ok === true).length;
  const pending = checked.filter((c) => c.ok === null).length;
  // Rows the ledger could not be asked about. Counted apart from the failures
  // on purpose: they are not evidence against the recording, and lumping them
  // in is how a throttled sweep once reported 448 of this folder's recordings
  // as not matching when every one of them was on the ledger.
  const uncheckedCount = checked.filter(isUnchecked).length;
  const failCount = checked.length - okCount - pending - uncheckedCount;

  return (
    <div>
      {/* heading === null hands the WHOLE header to the caller: /folder has
          its own h1 and count line, and stacking a second title and a second
          count under them was three sizes of text saying two things. The
          day-view line survives regardless, because only this component
          knows which day is open. */}
      {heading && (
        /* The ledger's own title, at the one size every page title on the site
           uses (docs h1, /day, /folder), with the caller's aside on its right. */
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 }}>
          <div style={{ fontSize: "clamp(26px, 6vw, 32px)", fontWeight: 600, letterSpacing: "-0.03em", color: "#111827" }}>
            {heading}
          </div>
          {aside}
        </div>
      )}
      {(heading || view) && (
        <div style={{ fontSize: 14, color: "#4b5563", marginTop: 2, marginBottom: 10 }}>
          {view
            ? `The recordings for ${view.label}.`
            : `${checked.length.toLocaleString()} recording${checked.length === 1 ? "" : "s"} from your folder, newest first.`}
        </div>
      )}
      <div style={{ background: "#fff", border: "1px solid #d0d5dd", padding: "18px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 10 }}>
        {pending > 0 ? (
          <span style={{ fontSize: 15, fontWeight: 700, color: "#111827", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            Checking {checked.length - pending} of {checked.length}&hellip;
          </span>
        ) : (
          <span style={{ fontSize: 15, fontWeight: 700, color: "#111827", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {okCount} of {checked.length} {okCount === 1 ? "matches" : "match"} the ledger
          </span>
        )}
        <span style={{ display: "flex", gap: 14, whiteSpace: "nowrap" }}>
          {failCount > 0 && (
            <span style={{ fontSize: 13, fontWeight: 600, color: "#dc2626" }}>
              {failCount} {failCount === 1 ? "does" : "do"} not
            </span>
          )}
          {uncheckedCount > 0 && (
            <span style={{ fontSize: 13, fontWeight: 600, color: "#6b7280" }}>
              {uncheckedCount} not checked
            </span>
          )}
        </span>
      </div>
      {groups.length > 1 && !shelf && (
        <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, margin: "14px 0 4px" }}>
          <span style={{ display: "flex", gap: 20 }}>
            {older && (
              <button type="button" style={stepLink} onClick={() => setDay(older.key)}>
                <span aria-hidden>&larr;</span> {older.short}
              </button>
            )}
            {newer && (
              <button type="button" style={stepLink} onClick={() => setDay(newer.key)}>
                {newer.short} <span aria-hidden>&rarr;</span>
              </button>
            )}
          </span>
          <span style={{ display: "flex", gap: 20, marginLeft: "auto" }}>
            {view && (
              <button type="button" style={stepLink} onClick={() => setDay(null)}>
                All recordings <span aria-hidden>&rarr;</span>
              </button>
            )}
            <button type="button" style={stepLink} onClick={() => setShelf(true)}>
              All days <span aria-hidden>&rarr;</span>
            </button>
          </span>
        </nav>
      )}
      {shelf && (
        <CheckedShelf
          groups={groups}
          onPick={(key) => { setDay(key); setShelf(false); }}
          onLive={() => { setDay(null); setShelf(false); }}
        />
      )}
      {!shelf && (
        <div ref={listRef} style={{ marginTop: 10 }}>
          {/* The list keeps its true height from a spacer above and below, so
              the scrollbar behaves as if every row were mounted. */}
          <div style={{ height: rowFirst * CHECKED_ROW_H }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {visible.map(({ r, groupKey }, k) => {
              const i = rowFirst + k;
              const clickable = r.onLedger && !!r.digestUrlSafe;
              const thumb = r.artifactFile ? thumbs.get(r.artifactFile) : undefined;
              const ext = r.fileName ? r.fileName.slice(r.fileName.lastIndexOf(".") + 1).toUpperCase() : "";
              return (
                // ⚠️ The entrance animation is for the FIRST screenful only.
                // Windowed rows mount as you scroll, and staggering those
                // makes the list flicker its way down the page.
                <div key={`${groupKey}:${r.dirName}:${i}`} className="bitgraph-file-card" data-clickable={clickable} style={{ border: "1px solid #d0d5dd", height: CHECKED_ROW_H - 10, boxSizing: "border-box", ...(i < 12 ? { animation: `slideIn 0.2s ease-out ${i * 0.03}s both` } : {}) }}>
                  <div
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? () => onOpen(r) : undefined}
                    onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(r); } } : undefined}
                    className={`bitgraph-result-row${clickable ? " bitgraph-file-row" : ""}`}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px 10px 10px", cursor: clickable ? "pointer" : "default" }}
                  >
                    {/* The small thumb, from the dropped bytes themselves. A
                        non-image shows its type the way the sheet's cells
                        did; square corners, the card's own border. */}
                    {thumb ? (
                      <img src={thumb} alt="" style={{ width: 48, height: 48, objectFit: "cover", flexShrink: 0, border: "1px solid #e2e5e9", display: "block" }} />
                    ) : (
                      <span style={{ width: 48, height: 48, flexShrink: 0, border: "1px solid #e2e5e9", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#6b7280", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                        {ext.slice(0, 4)}
                      </span>
                    )}
                    {/* An unchecked row keeps the ordinary blue: nothing is
                        wrong with it, we simply did not get an answer. */}
                    <span style={{ flexShrink: 0, fontSize: 14, fontWeight: 700, color: r.ok === false && !isUnchecked(r) ? "#dc2626" : "#0065A4", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                      {r.counter != null ? `#${Number(r.counter).toLocaleString()}` : "\u2014"}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.fileName ?? r.dirName}
                    </span>
                    <span style={{ flexShrink: 0, fontSize: 12.5, color: "#4b5563", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }} className="bg-day-when">
                      {fmtRowWhen(r.ts ? r.ts * 1000 : r.writeTime)}
                    </span>
                    <span style={{ flexShrink: 0, maxWidth: "40%", fontSize: 12.5, fontWeight: 600, color: r.ok === true ? "#0065A4" : r.ok === false ? (isUnchecked(r) ? "#6b7280" : "#dc2626") : "#9ca3af", textAlign: "right" }}>
                      {r.ok === true ? "matches the ledger" : r.ok === false ? r.failure : "checking\u2026"}
                    </span>
                    {clickable && (
                      <span aria-label="Open" style={{ display: "inline-flex", flexShrink: 0, color: "#0065A4" }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="square" strokeLinejoin="miter"><path d="M9 6 L15 12 L9 18" /></svg>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ height: Math.max(0, (flat.length - rowLast) * CHECKED_ROW_H) }} />
        </div>
      )}
    </div>
  );
}

function CheckedShelf({ groups, onPick, onLive }: {
  groups: Array<{ key: string; label: string; short: string; rows: ExportCheckResult[] }>;
  onPick: (key: string) => void;
  onLive: () => void;
}) {
  /* The drawing is components/month-calendar.tsx, shared with /days. This
     shelf knows something /days does not: how many recordings each day
     holds (the rows are in hand), so each recorded day carries its count and
     the month line says the total. Local dates throughout, matching the day
     groups above, which are keyed the same way. */
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const recorded = new Map(groups.map((g) => [g.key, g]));
  const oldest = groups.length
    ? groups[groups.length - 1].key.split("-").map((x) => parseInt(x, 10))
    : [now.getFullYear(), now.getMonth()];
  const months: Array<{ label: string; y: number; m: number }> = [];
  for (let y = now.getFullYear(), m = now.getMonth();
       y > oldest[0] || (y === oldest[0] && m >= oldest[1]);
       m === 0 ? (y--, m = 11) : m--) {
    months.push({ label: new Date(y, m, 1).toLocaleDateString(undefined, { year: "numeric", month: "long" }), y, m });
  }
  return (
    <div style={{ marginTop: 18 }}>
      <MonthShelf>
        {months.map(({ label, y, m }) => {
          const daysIn = new Date(y, m + 1, 0).getDate();
          const lead = new Date(y, m, 1).getDay();
          let recordings = 0;
          let daysWith = 0;
          const days: CalendarDay[] = Array.from({ length: daysIn }, (_, i) => {
            const d = i + 1;
            const key = `${y}-${m}-${d}`;
            const g = recorded.get(key);
            if (g) { recordings += g.rows.length; daysWith += 1; }
            if (key === todayKey) {
              return { n: d, kind: "today", count: g?.rows.length, onPick: onLive, ariaLabel: "Today" };
            }
            if (g) return { n: d, kind: "recorded", count: g.rows.length, onPick: () => onPick(key) };
            const isFuture = new Date(y, m, d).getTime() > now.getTime();
            return { n: d, kind: isFuture ? "future" : "idle" };
          });
          const total = recordings
            ? `${recordings.toLocaleString()} recording${recordings === 1 ? "" : "s"} · ${daysWith} day${daysWith === 1 ? "" : "s"}`
            : undefined;
          return <MonthCalendar key={label} title={label} total={total} leading={lead} days={days} />;
        })}
      </MonthShelf>
    </div>
  );
}
