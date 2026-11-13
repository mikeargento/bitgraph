/* ── The ledger calendar: one page per UTC day since the running ledger began, as a month grid.
   No fetches and no counts: every past day has a page, and one with no BitGraphs says so on its own page. ── */

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
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page ledger-page">
      <div className="home-hero"><h1 className="sr-only">Calendar.</h1></div>
      <section className="home-section" aria-labelledby="cal-h">
        <p className="home-kicker">Ledger</p>
        <h2 id="cal-h">Calendar.</h2>
        <p>One ledger page per UTC day. Today&rsquo;s is still open.</p>
        <MonthShelf>
          {months.map((mo) => (
            <MonthCalendar key={mo.label} title={mo.label} leading={mo.leading} days={mo.days} />
          ))}
        </MonthShelf>
      </section>
    </div>
  );
}
