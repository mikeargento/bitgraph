/* ── The Base calendar (Mike, 2026-10-11: "base block page doesnt have a calendar"): one page per UTC day since the
   ceiling writer began, as a month grid, the same shelf as the anchor calendar (app/ledger/archive). No fetches and no
   counts: every past day has a page, and one with no Base blocks says so on its own page. Drawn by
   components/month-calendar.tsx, shared with the anchor calendar so the two cannot drift. ── */

import { MonthCalendar, MonthShelf, MONTH_NAMES, type CalendarDay } from "@/components/month-calendar";

export const dynamic = "force-dynamic"; // "today" must not freeze at build time
export const metadata = { title: "Base calendar" };

const EARLIEST_DAY = "2026-09-29"; // the ceiling writer's first day (app/ceilings)

const pad2 = (n: number) => String(n).padStart(2, "0");

type MonthGrid = { label: string; leading: number; days: CalendarDay[] };

function buildMonths(todayISO: string): MonthGrid[] {
  const [ey, em] = EARLIEST_DAY.split("-").map((x) => parseInt(x, 10));
  const [ty, tm] = todayISO.split("-").map((x) => parseInt(x, 10));
  const months: MonthGrid[] = [];
  for (let y = ty, m = tm; y > ey || (y === ey && m >= em); m === 1 ? (y--, m = 12) : m--) {
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    months.push({
      label: `${MONTH_NAMES[m - 1]} ${y}`,
      leading: new Date(Date.UTC(y, m - 1, 1)).getUTCDay(),
      days: Array.from({ length: daysInMonth }, (_, i) => {
        const iso = `${y}-${pad2(m)}-${pad2(i + 1)}`;
        if (iso === todayISO) return { n: i + 1, kind: "today", href: "/ceilings", ariaLabel: "Today" } as CalendarDay;
        if (iso >= EARLIEST_DAY && iso < todayISO) return { n: i + 1, kind: "recorded", href: `/ceilings?day=${iso}` } as CalendarDay;
        return { n: i + 1, kind: iso > todayISO ? "future" : "idle" } as CalendarDay;
      }),
    });
  }
  return months;
}

export default function BaseCalendarPage() {
  const todayISO = new Date().toISOString().slice(0, 10);
  const months = buildMonths(todayISO);
  return (
    <div className="frame" style={{ padding: "56px 0 96px", maxWidth: "var(--measure)" }}>
      <h1 className="bg-page-title" style={{ margin: 0 }}>Base calendar</h1>
      <div style={{ fontSize: 14, fontWeight: 400, color: "var(--dim)", marginTop: 2, marginBottom: 24 }}>
        One page per UTC day. Today&rsquo;s is still open.
      </div>
      <MonthShelf>
        {months.map((mo) => (
          <MonthCalendar key={mo.label} title={mo.label} leading={mo.leading} days={mo.days} />
        ))}
      </MonthShelf>
    </div>
  );
}
