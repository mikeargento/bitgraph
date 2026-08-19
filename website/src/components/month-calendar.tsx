/* ── The month calendar: one sheet per month, used by /rolls (the shelf of
   every day's roll) and by a dropped Folder's shelf (folder-roll.tsx), so the
   two cannot drift (Mike, 2026-08-19: "yes i like the more informational
   calendars ... grid left to right depending on page width ... white
   backgrounds to separate, with light strokes").

   No hooks and no "use client": /rolls renders it on the server with plain
   hrefs, the Folder's shelf renders it on the client with onPick handlers. A
   day is whatever the caller says it is; this file only knows how to draw a
   month.

   The look, in the site's idiom (type + hairlines, square corners, brand blue
   in text): a white card with a light stroke per month; the month line with
   an optional total on the right; hairline weeks under a ruled header, so
   the digits read as a ledger page rather than floating; 40px rows, 14px
   mono digits; idle days a legible grey, days still to come lighter; a
   recorded day in brand blue carrying its count in the corner when the
   caller has one; today outlined, the one open frame on a shelf of closed
   ones. ── */

import type { ReactNode } from "react";

export type CalendarDay = {
  n: number;
  /** idle: a past day with nothing to open. future: not yet. recorded: has a
   *  roll (or recordings) and opens. today: the live one. */
  kind: "idle" | "future" | "recorded" | "today";
  /** Recorded that day, when the caller knows (a dropped Folder does; /rolls
   *  deliberately does not fetch). */
  count?: number;
  href?: string;
  onPick?: () => void;
  ariaLabel?: string;
};

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const MONO = "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace";

/** The responsive shelf the months sit on: as many across as fit, two at the
 *  800px column, one on a phone. Newest month first, reading left to right. */
export function MonthShelf({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16, alignItems: "start" }}>
      {children}
    </div>
  );
}

export function MonthCalendar({ title, total, leading, days }: {
  /** "August 2026" */
  title: string;
  /** The right-hand side of the month line, e.g. "62 recordings · 10 days".
   *  Omitted on /rolls, which carries no data by design. */
  total?: string;
  /** Blank cells before the 1st (Sunday-start week). */
  leading: number;
  days: CalendarDay[];
}) {
  const cell: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center",
    height: 40, fontSize: 14, borderBottom: "1px solid #eef0f1",
    fontFamily: MONO, fontVariantNumeric: "tabular-nums", position: "relative",
  };
  // A recorded day and today are the same control (a link or a button) in
  // the same clothes; only the outline differs.
  const openable: React.CSSProperties = {
    ...cell, color: "#0065A4", fontWeight: 700, textDecoration: "none",
    background: "none", border: 0, borderBottom: "1px solid #eef0f1", cursor: "pointer", padding: 0, width: "100%",
  };
  // Always six week rows, padded with blank cells, so every month card is the
  // same height and side-by-side months line up (Mike, 2026-08-19: "calendar
  // should have longest white box even without more days so they match"). Six
  // is the most any month needs (31 days after a Saturday 1st is 37 cells).
  const trailing = 6 * 7 - leading - days.length;
  return (
    <section style={{ background: "#fff", border: "1px solid #d0d5dd", padding: "14px 16px 6px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em", color: "#111827" }}>{title}</div>
        {total && (
          <div style={{ fontSize: 12.5, color: "#4b5563", fontFamily: MONO, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{total}</div>
        )}
      </div>
      <div className="bg-month-grid" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderTop: "1px solid #d0d5dd" }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={`h${i}`} style={{ ...cell, height: 26, fontSize: 10.5, fontWeight: 600, color: "#6b7280", letterSpacing: "0.04em", borderBottom: "1px solid #d0d5dd" }}>{d}</div>
        ))}
        {Array.from({ length: leading }, (_, i) => <div key={`b${i}`} style={cell} />)}
        {days.map((d) => {
          if (d.kind === "recorded" || d.kind === "today") {
            const style = d.kind === "today" ? { ...openable, boxShadow: "inset 0 0 0 1.5px #0065A4" } : openable;
            const inner = (
              <>
                {d.n}
                {d.count !== undefined && d.count > 0 && (
                  <span aria-label={`${d.count} recording${d.count === 1 ? "" : "s"}`}
                    style={{ position: "absolute", right: 5, top: 4, fontSize: 9.5, fontWeight: 500, color: "#6b7280", letterSpacing: 0 }}>
                    {d.count}
                  </span>
                )}
              </>
            );
            return d.href ? (
              <a key={d.n} href={d.href} className="bg-month-day" aria-label={d.ariaLabel} style={style}>{inner}</a>
            ) : (
              <button key={d.n} type="button" className="bg-month-day" aria-label={d.ariaLabel} onClick={d.onPick} style={style}>{inner}</button>
            );
          }
          return (
            <div key={d.n} style={{ ...cell, color: d.kind === "future" ? "#d1d5db" : "#9ca3af" }}>{d.n}</div>
          );
        })}
        {Array.from({ length: trailing }, (_, i) => <div key={`t${i}`} style={cell} />)}
      </div>
    </section>
  );
}
