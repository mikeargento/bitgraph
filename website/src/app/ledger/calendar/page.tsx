/* ── The ledger calendar (Mike, 2026-10-17: "check is ledger and will have the calendar and all that jazz we had
   before"): one page per UTC day since the running ledger began, as a month grid, the shelf the Base calendar
   used. No fetches and no counts: every past day has a page, and one with no BitGraphs says so on its own page. ── */

import { MonthCalendar, MonthShelf, MONTH_NAMES, type CalendarDay } from "@/components/month-calendar";
import { LEDGER_FIRST_DAY } from "@/lib/running-ledger";

export const dynamic = "force-dynamic"; // "today" must not freeze at build time
export const metadata = { title: "Calendar" };

const pad2 = (n: number) => String(n).padStart(2, "0");

type MonthGrid = { label: string; leading: number; days: CalendarDay[] };

function buildMonths(todayISO: string): MonthGrid[] {
  const [ey, em] = LEDGER_FIRST_DAY.split("-").map((x) => parseInt(x, 10));
  const [ty, tm] = todayISO.split("-").map((x) => parseInt(x, 10));
  const months: MonthGrid[] = [];
  for (let y = ty!, m = tm!; y > ey! || (y === ey && m >= em!); m === 1 ? (y--, m = 12) : m--) {
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    months.push({
      label: `${MONTH_NAMES[m - 1]} ${y}`,
      leading: new Date(Date.UTC(y, m - 1, 1)).getUTCDay(),
      days: Array.from({ length: daysInMonth }, (_, i) => {
        const iso = `${y}-${pad2(m)}-${pad2(i + 1)}`;
        if (iso === todayISO) return { n: i + 1, kind: "today", href: "/ledger", ariaLabel: "Today" } as CalendarDay;
        if (iso >= LEDGER_FIRST_DAY && iso < todayISO) return { n: i + 1, kind: "recorded", href: `/ledger?day=${iso}` } as CalendarDay;
        return { n: i + 1, kind: iso > todayISO ? "future" : "idle" } as CalendarDay;
      }),
    });
  }
  return months;
}

export default function LedgerCalendarPage() {
  const todayISO = new Date().toISOString().slice(0, 10);
  const months = buildMonths(todayISO);
  return (
    <div className="frame" style={{ padding: "56px 0 96px", maxWidth: "var(--measure)" }}>
      <h1 className="bg-page-title" style={{ margin: 0 }}>Calendar</h1>
      <div style={{ color: "var(--dim)", marginTop: 2, marginBottom: 24 }}>
        One ledger page per UTC day. Today&rsquo;s is still open.
      </div>
      <MonthShelf>
        {months.map((mo) => (
          <MonthCalendar key={mo.label} title={mo.label} leading={mo.leading} days={mo.days} />
        ))}
      </MonthShelf>
    </div>
  );
}
