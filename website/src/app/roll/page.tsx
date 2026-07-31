import { Explorer } from "@/components/explorer";

/* ── BitGraph Roll — the ledger stream, on its own page. Every recording in
   causal order, newest first, with search. The camera's roll: the home page
   takes BitGraphs, this is where they live.

   Day rolls: since the 23:59 UTC rotation (2026-07-30) each epoch is one UTC
   calendar day, so past days are browsed as sealed rolls — /roll?day=YYYY-MM-DD
   — navigated by quiet prev/next links, never a picker. Days are named by
   DATE, deliberately not by an epoch ordinal: epochs carry no numbers and
   relate only through anchors. Before the rotation an epoch spanned many days;
   the day feed slices those by anchor time, so one mechanism covers both. ── */

// The ledger's first day (BitGraph cutover). No roll exists before it.
const EARLIEST_DAY = "2026-05-15";

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

// "July 30" / "July 30, 2026" — always UTC: epochs are UTC calendar days.
function shortLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric" });
}
function longLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
}

function parseDay(raw: string | undefined, todayUTC: string): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== raw) return null;
  if (raw >= todayUTC || raw < EARLIEST_DAY) return null; // today IS the live Roll
  return raw;
}

const linkStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em",
  color: "#0065A4", textDecoration: "none", whiteSpace: "nowrap",
};

export default async function RollPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const { day: rawDay } = await searchParams;
  const todayUTC = new Date().toISOString().slice(0, 10);
  const day = parseDay(rawDay, todayUTC);

  const prev = day ? shiftDay(day, -1) : shiftDay(todayUTC, -1);
  const next = day ? shiftDay(day, 1) : null;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--c-text)" }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
        /* The nav line is one stratum and must never wrap: on phones the
           All-rolls label collapses and the calendar glyph carries the link. */
        @media (max-width: 600px) { .bg-allrolls-label { display: none; } }
      `}</style>
      <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "40px 0 80px", animation: "fadeIn .3s ease-out" }}>
        <Explorer
          day={day ?? undefined}
          // The shelf: the month-grid index of every day's roll, sitting with
          // the anchors toggle so both read as properties of the Roll itself.
          // On phones the label collapses and the calendar glyph carries it —
          // the one-stratum nav line must never wrap.
          aside={
            <a href="/rolls" className="bg-arrow-link" aria-label="All rolls" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#0065A4", textDecoration: "none", whiteSpace: "nowrap" }}>
              {/* Square-cornered calendar glyph, same stroke voice as the row
                  chevrons (miter joins, square caps, no fill, no radius). */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="square" strokeLinejoin="miter" aria-hidden>
                <rect x="3.5" y="5" width="17" height="15.5" />
                <path d="M3.5 10.5 H20.5" />
                <path d="M8 2.5 V7" />
                <path d="M16 2.5 V7" />
              </svg>
              <span className="bg-allrolls-label">All rolls <span className="arrow" aria-hidden>&rarr;</span></span>
            </a>
          }
          title={
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", color: "#111827" }}>
                BitGraph Roll
              </div>
              <div style={{ fontSize: 13, fontWeight: 400, color: "#4b5563", marginTop: 2 }}>
                {day ? `The roll for ${longLabel(day)} (UTC).` : "Every recording, newest first."}
              </div>
            </div>
          }
          // The day-flip stepper — back before forward, sitting together on
          // the nav line's left like ‹ › on a pager. Dated labels everywhere
          // ("← July 30", not "yesterday") so live and day pages read alike;
          // "Today's roll" closes the loop from the most recent sealed day.
          subnav={
            day ? (
              <>
                {prev >= EARLIEST_DAY && (
                  <a href={`/roll?day=${prev}`} style={linkStyle}><span aria-hidden>&larr;</span> {shortLabel(prev)}</a>
                )}
                {next && (next >= todayUTC ? (
                  <a href="/roll" className="bg-arrow-link" style={linkStyle}>
                    Today&rsquo;s roll <span className="arrow" aria-hidden>&rarr;</span>
                  </a>
                ) : (
                  <a href={`/roll?day=${next}`} className="bg-arrow-link" style={linkStyle}>
                    {shortLabel(next)} <span className="arrow" aria-hidden>&rarr;</span>
                  </a>
                ))}
              </>
            ) : (
              prev >= EARLIEST_DAY && (
                <a href={`/roll?day=${prev}`} style={linkStyle}>
                  <span aria-hidden>&larr;</span> {shortLabel(prev)}
                </a>
              )
            )
          }
        />
      </div>
    </div>
  );
}
