/* ── Rolls — the shelf. One roll per UTC day since the ledger began; this page
   is the index of them, a month-grid contact sheet. Deliberately zero data:
   anchors have run continuously since the cutover, so every past day HAS a
   roll (a day with no files says so honestly on its own page). Every cell is
   just a date link — no fetches, no counts, no dashboard. Days are named by
   date, never an epoch ordinal (epochs carry no numbers; Canon). ── */

export const dynamic = "force-dynamic"; // "today" must not freeze at build time

const EARLIEST_DAY = "2026-05-15"; // ledger genesis (BitGraph cutover)

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const pad2 = (n: number) => String(n).padStart(2, "0");

type MonthGrid = {
  label: string;          // "July 2026"
  leading: number;        // blank cells before the 1st (Sunday-start week)
  days: Array<{ n: number; iso: string }>;
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
      days: Array.from({ length: daysInMonth }, (_, i) => ({
        n: i + 1,
        iso: `${y}-${pad2(m)}-${pad2(i + 1)}`,
      })),
    });
  }
  return months;
}

export default function RollsPage() {
  const todayISO = new Date().toISOString().slice(0, 10);
  const months = buildMonths(todayISO);
  const mono = "var(--font-mono), 'SF Mono', SFMono-Regular, monospace";

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--c-text)" }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
        .roll-day { display:flex; align-items:center; justify-content:center; aspect-ratio:1; font-size:13px; }
        a.roll-day { color:#0065A4; font-weight:600; text-decoration:none; }
        @media (hover:hover){ a.roll-day:hover { background:#f0f6ff; } }
      `}</style>
      <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "40px 0 80px", animation: "fadeIn .3s ease-out" }}>
        {/* The one title size every page header uses. */}
        <div className="bg-page-title">Rolls</div>
        <div style={{ fontSize: 14, fontWeight: 400, color: "#4b5563", marginTop: 2 }}>
          One roll per day (UTC). Today&rsquo;s is still open.
        </div>

        {months.map((mo) => (
          <section key={mo.label} style={{ marginTop: 32, maxWidth: 340 }}>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em", color: "#111827", marginBottom: 8 }}>
              {mo.label}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", fontFamily: mono, fontVariantNumeric: "tabular-nums" }}>
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <div key={`h${i}`} className="roll-day" style={{ fontSize: 10.5, color: "#9ca3af", aspectRatio: "auto", paddingBottom: 4 }}>{d}</div>
              ))}
              {Array.from({ length: mo.leading }, (_, i) => <div key={`b${i}`} className="roll-day" />)}
              {mo.days.map((d) => {
                if (d.iso === todayISO) {
                  // Today's roll is the live Roll — outlined, not filled: the
                  // one open frame on a shelf of sealed ones.
                  return (
                    <a key={d.iso} href="/roll" className="roll-day" aria-label="Today's roll"
                      style={{ boxShadow: "inset 0 0 0 1px #0065A4" }}>{d.n}</a>
                  );
                }
                if (d.iso >= EARLIEST_DAY && d.iso < todayISO) {
                  return <a key={d.iso} href={`/roll?day=${d.iso}`} className="roll-day">{d.n}</a>;
                }
                return <div key={d.iso} className="roll-day" style={{ color: "#c7ccd1" }}>{d.n}</div>;
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
