"use client";

/* The folder's Ledger, extracted so it has more than one address: the home
 * page renders it for a one-off drop, and /folder renders it for the folder
 * you keep. Everything here is a READ of bytes already on the machine.
 */

import { useMemo, useState } from "react";
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
const CHECKED_ROW_H = 34;

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
  /* ❄️ NO THUMBNAILS, AND useFileThumbs IS GONE WITH THEM. Each row carried a
     48px thumb decoded from the dropped bytes, which is why the row was 80px.
     Mike asked for a flat text list, and at forty thousand rows he is plainly
     right: a picture of file-18930.txt tells you nothing, and the decode
     pipeline behind it — four in flight, batched publishes, object URLs
     revoked on unmount, all of it hard-won after it froze a 6,000 file drop —
     was machinery serving that nothing. Nothing else called it. */

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
          <div>
            {visible.map(({ r, groupKey }, k) => {
              const i = rowFirst + k;
              // Every row opens its proof now: the page is a viewer, so a row
              // the ledger never heard of still has somewhere to go.
              const clickable = !!r.digestUrlSafe;
              const when = fmtRowWhen(r.ts ? r.ts * 1000 : r.writeTime);
              const verdict = r.ok === true ? "" : r.ok === false ? (r.failure ?? "") : "checking\u2026";
              const right = (r.counter != null ? `#${Number(r.counter).toLocaleString()}` : "\u2014")
                + (when ? ` \u00b7 ${when}` : "");
              return (
                <div
                  key={`${groupKey}:${r.dirName}:${i}`}
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={clickable ? () => onOpen(r) : undefined}
                  onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(r); } } : undefined}
                  className={clickable ? "bitgraph-file-row" : undefined}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    height: CHECKED_ROW_H, padding: "0 14px", overflow: "hidden",
                    borderTop: i > 0 ? "1px solid #eef0f1" : "none",
                    cursor: clickable ? "pointer" : "default",
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13.5, color: "#111827" }}>
                    {r.fileName ?? r.dirName}
                  </span>
                  {/* Only a row with something WRONG says anything here. "matches
                      the ledger" on forty thousand lines is forty thousand
                      repetitions of the normal case; the exceptions are the
                      information. An unchecked row keeps the quiet grey: nothing
                      is wrong with it, we simply have no answer. */}
                  {verdict && (
                    <span style={{
                      flexShrink: 0, maxWidth: "45%", fontSize: 12.5, textAlign: "right",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      color: r.ok === false ? (isUnchecked(r) ? "#6b7280" : "#dc2626") : "#9ca3af",
                    }}>{verdict}</span>
                  )}
                  <span style={{
                    flexShrink: 0, fontSize: 13, fontVariantNumeric: "tabular-nums",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontWeight: r.counter != null ? 700 : 400,
                    color: r.ok === false && !isUnchecked(r) ? "#dc2626" : r.counter != null ? "#0065A4" : "#4b5563",
                  }}>{right}</span>
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
