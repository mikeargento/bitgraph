/* ── Rolls — the shelf. One roll per UTC day since the ledger began; this page
   is the index of them, a month-grid contact sheet. Deliberately zero data:
   anchors have run continuously since the cutover, so every past day HAS a
   roll (a day with no files says so honestly on its own page). Every cell is
   just a date link — no fetches, no counts, no dashboard. Days are named by
   date, never an epoch ordinal (epochs carry no numbers; Canon).

   The drawing is components/month-calendar.tsx, shared with a dropped
   Folder's shelf (folder-roll.tsx) so the two cannot drift. That one knows
   its counts and says them; this one, by design, does not. ── */

import { MonthCalendar, MonthShelf, MONTH_NAMES, type CalendarDay } from "@/components/month-calendar";

export const dynamic = "force-dynamic"; // "today" must not freeze at build time

const EARLIEST_DAY = "2026-05-15"; // ledger genesis (BitGraph cutover)

const pad2 = (n: number) => String(n).padStart(2, "0");

type MonthGrid = {
  label: string;          // "July 2026"
  leading: number;        // blank cells before the 1st (Sunday-start week)
  days: CalendarDay[];
};

function buildMonths(todayISO: string): MonthGrid[] {
  const [ey, em] = EARLIEST_DAY.split("-").map((x) => parseInt(x, 10));
  const [ty, tm] = todayISO.split("-").map((x) => parseInt(x, 10));
  const months: MonthGrid[] = [];
  // Newest month first: the recent rolls are the ones people flip back to.
  for (let y = ty, m = tm; y > ey || (y === ey && m >= em); m === 1 ? (y--, m = 12) : m--) {
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    months.push({
      label: `${MONTH_NAMES[m - 1]} ${y}`,
      leading: new Date(Date.UTC(y, m - 1, 1)).getUTCDay(),
      days: Array.from({ length: daysInMonth }, (_, i) => {
        const iso = `${y}-${pad2(m)}-${pad2(i + 1)}`;
        if (iso === todayISO) {
          // Today's roll is the live Roll — outlined, not filled: the one
          // open frame on a shelf of sealed ones.
          return { n: i + 1, kind: "today", href: "/roll", ariaLabel: "Today's roll" } as CalendarDay;
        }
        if (iso >= EARLIEST_DAY && iso < todayISO) {
          return { n: i + 1, kind: "recorded", href: `/roll?day=${iso}` } as CalendarDay;
        }
        return { n: i + 1, kind: iso > todayISO ? "future" : "idle" } as CalendarDay;
      }),
    });
  }
  return months;
}

export default function RollsPage() {
  const todayISO = new Date().toISOString().slice(0, 10);
  const months = buildMonths(todayISO);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--c-text)" }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
      `}</style>
      <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "40px 0 80px", animation: "fadeIn .3s ease-out" }}>
        {/* The one title size every page header uses. */}
        <div className="bg-page-title">Rolls</div>
        <div style={{ fontSize: 14, fontWeight: 400, color: "#4b5563", marginTop: 2, marginBottom: 24 }}>
          One roll per day (UTC). Today&rsquo;s is still open.
        </div>
        <MonthShelf>
          {months.map((mo) => (
            <MonthCalendar key={mo.label} title={mo.label} leading={mo.leading} days={mo.days} />
          ))}
        </MonthShelf>
      </div>
    </div>
  );
}
