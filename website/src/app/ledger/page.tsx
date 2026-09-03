import { Explorer } from "@/components/explorer";
import { ledgerFeed, type LedgerFeedBody } from "@/lib/ledger-feed";

/* ── BitGraph Ledger — the ledger stream, on its own page. Every recording in
   causal order, newest first, with search. The camera's day: the home page
   makes BitGraphs, this is where they live.

   Day days: since the 23:59 UTC rotation (2026-07-30) each epoch is one UTC
   calendar day, so past days are browsed as sealed days — /day?day=YYYY-MM-DD
   — navigated by quiet prev/next links, never a picker. Days are named by
   DATE, deliberately not by an epoch ordinal: epochs carry no numbers and
   relate only through anchors. Before the rotation an epoch spanned many days;
   the ledger feed slices those by anchor time, so one mechanism covers both. ── */

// The ledger's first day (BitGraph cutover). No day exists before it.
const EARLIEST_DAY = "2026-05-15";

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

// "July 30" / "July 30, 2026" — always UTC: epochs are UTC calendar days.
function shortLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric" });
}
// "Sep 29" — the phone-width variant; September-class month names are what
// would otherwise wrap the one-stratum nav line at 375px.
function tinyLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}
function longLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
}

function parseDay(raw: string | undefined, todayUTC: string): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== raw) return null;
  if (raw >= todayUTC || raw < EARLIEST_DAY) return null; // today IS the live Ledger
  return raw;
}

/* The first page, read at request time so it ships inside the HTML.

   Without this the rows could not start loading until the document, the JS
   bundle and hydration had all landed, and only then did the browser open the
   feed request: a waterfall where nothing overlapped. Measured on production,
   the feed alone was 84-156ms on a warm edge and 3.8s cold, all of it stacked
   after ~400ms of hydration.

   Bounded, because moving the read here also moves it in front of the HTML.
   A warm read beats the budget easily and the day arrives complete; a cold one
   is abandoned and the page renders exactly as it used to, with the client
   fetching and its own retry loop taking over. So this can make the page
   faster but never slower to first paint, and it is never the reason a day
   looks empty: on timeout or error the seed is simply absent, which the
   Explorer reads as "go and fetch", not as "there is nothing here". */
const SSR_BUDGET_MS = 1200;

async function firstPage(day: string | null): Promise<LedgerFeedBody | null> {
  try {
    const result = await Promise.race([
      ledgerFeed({ day, filesOnly: true }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), SSR_BUDGET_MS)),
    ]);
    return result && result.status === 200 ? result.body : null;
  } catch {
    return null;
  }
}

const linkStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em",
  color: "#0065A4", textDecoration: "none", whiteSpace: "nowrap",
};

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const { day: rawDay } = await searchParams;
  const todayUTC = new Date().toISOString().slice(0, 10);
  const day = parseDay(rawDay, todayUTC);

  const prev = day ? shiftDay(day, -1) : shiftDay(todayUTC, -1);
  const next = day ? shiftDay(day, 1) : null;

  const initial = await firstPage(day);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--c-text)" }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
        /* The nav line is one stratum and must never wrap: on phones the day
           labels shorten ("Sep 29", "Today") so "All days" keeps its words. */
        .bg-day-short { display: none; }
        @media (max-width: 600px) {
          .bg-day-long { display: none; }
          .bg-day-short { display: inline; }
        }
      `}</style>
      <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "40px 0 80px", animation: "fadeIn .3s ease-out" }}>
        <Explorer
          day={day ?? undefined}
          initial={initial}
          // The shelf: the month-grid index of every day's day, sitting with
          // the anchors toggle so both read as properties of the ledger itself.
          // Text only (calendar glyph tried and ditched); the nav line stays
          // one unwrapped stratum because day labels shorten on phones.
          aside={
            <a href="/ledger/archive" className="bg-arrow-link" style={{ fontSize: 12.5, fontWeight: 600, color: "#0065A4", textDecoration: "none", whiteSpace: "nowrap" }}>
              All days <span className="arrow" aria-hidden>&rarr;</span>
            </a>
          }
          title={
            <div>
              {/* .bg-page-title: the one page-title size, site-wide. */}
              <div className="bg-page-title">
                BitGraph Ledger
              </div>
              <div style={{ fontSize: 14, fontWeight: 400, color: "#4b5563", marginTop: 2 }}>
                {day ? `The day for ${longLabel(day)} (UTC).` : "Every recording, newest first."}
              </div>
            </div>
          }
          // The day-flip stepper — back before forward, sitting together on
          // the nav line's left like ‹ › on a pager. Dated labels everywhere
          // ("← July 30", not "yesterday") so live and day pages read alike;
          // "Today" closes the loop from the most recent sealed day.
          subnav={
            day ? (
              <>
                {prev >= EARLIEST_DAY && (
                  <a href={`/ledger?day=${prev}`} style={linkStyle}>
                    <span aria-hidden>&larr;</span>{" "}
                    <span className="bg-day-long">{shortLabel(prev)}</span>
                    <span className="bg-day-short">{tinyLabel(prev)}</span>
                  </a>
                )}
                {next && (next >= todayUTC ? (
                  <a href="/ledger" className="bg-arrow-link" style={linkStyle}>
                    <span className="bg-day-long">Today</span>
                    <span className="bg-day-short">Today</span>
                    {" "}<span className="arrow" aria-hidden>&rarr;</span>
                  </a>
                ) : (
                  <a href={`/ledger?day=${next}`} className="bg-arrow-link" style={linkStyle}>
                    <span className="bg-day-long">{shortLabel(next)}</span>
                    <span className="bg-day-short">{tinyLabel(next)}</span>
                    {" "}<span className="arrow" aria-hidden>&rarr;</span>
                  </a>
                ))}
              </>
            ) : (
              prev >= EARLIEST_DAY && (
                <a href={`/ledger?day=${prev}`} style={linkStyle}>
                  <span aria-hidden>&larr;</span>{" "}
                  <span className="bg-day-long">{shortLabel(prev)}</span>
                  <span className="bg-day-short">{tinyLabel(prev)}</span>
                </a>
              )
            )
          }
        />
      </div>
    </div>
  );
}
