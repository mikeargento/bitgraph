import type { Metadata } from "next";
import { DropBox } from "@/components/drop-box";
import { LedgerRows } from "@/components/ledger-rows";
import { LEDGER_FIRST_DAY, ledgerPage, type LedgerPage } from "@/lib/running-ledger";

/**
 * The running ledger (Mike, 2026-10-17: "a running ledger like the base one"):
 * every BitGraph, newest first, one UTC day per page, today live. The Base
 * page's own layout and styles.
 *
 * Public (Mike, 2026-10-17: "nobody cares. make it. this is genesis of new BitGraph"): a row shows the
 * BitGraph's number, its two counts, the SHA-256 it bound and the enclave's signed time, and opens its proof
 * page. A hash cannot be turned back into the file; a guessable file can be confirmed by someone hashing their
 * own copy, which Mike accepted. This reverses the 2026-10-09 ruling against a browsable gallery.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Ledger",
  description: "Every BitGraph, as it is made: its number, its two counts and the SHA-256 it bound. Open any one for its proof.",
};

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y!, m! - 1, d! + delta)).toISOString().slice(0, 10);
}
function shortLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric" });
}
function longLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
}
function parseDay(raw: string | undefined, todayUTC: string): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  if (raw >= todayUTC || raw < LEDGER_FIRST_DAY) return null;
  return raw;
}
function when(ms: number): string {
  const d = new Date(ms);
  const md = d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  const t = d.toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit", second: "2-digit" });
  return `${md}, ${t} UTC`;
}
function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit", second: "2-digit" });
}
const fmt = (n: number | string) => Number(n).toLocaleString("en-US");

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const { day: rawDay } = await searchParams;
  const todayUTC = new Date().toISOString().slice(0, 10);
  const day = parseDay(rawDay, todayUTC);
  const shown = day ?? todayUTC;
  const prev = shiftDay(shown, -1);
  const next = day ? shiftDay(day, 1) : null;
  let page: LedgerPage | null = null;
  let failed = false;
  try {
    page = await ledgerPage(shown);
  } catch { failed = true; }

  return (
    <div className="frame" style={{ padding: "56px 0 96px", maxWidth: "var(--measure)" }}>
      <style>{`
        .rl-rows { display: flex; flex-direction: column; }
        .rl-row { display: flex; align-items: center; gap: 14px; }
        .rl-num { flex-shrink: 0; min-width: 92px; font-size: 15px; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
        .rl-counts { flex-shrink: 0; font-size: 12.5px; color: var(--dim); white-space: nowrap; font-variant-numeric: tabular-nums; }
        .rl-hash { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: 12.5px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .rl-when { flex-shrink: 0; font-size: 12.5px; color: var(--dim); white-space: nowrap; font-variant-numeric: tabular-nums; }
        .rl-when-short { display: none; }
        .rl-link { color: inherit; text-decoration: none !important; }
        .rl-link:hover .rl-num { text-decoration: underline; }
        @media (max-width: 640px) {
          .rl-hash, .rl-when-long { display: none; }
          .rl-when-short { display: inline; }
          .rl-when { margin-left: auto; }
          .rl-num { min-width: 0; }
        }
      `}</style>
      {/* No visible h1: it repeated the nav (Mike, 2026-10-17: "drop the h1's theyre basically redundant"). */}
        <h1 className="sr-only">Ledger.</h1>

      {/* Check is the ledger (Mike, 2026-10-17): the drop box here only looks files up and never makes one; the
          one on /make makes (Mike, 2026-10-17: the SHA-256 field went, "dont need this"). */}
      <div>
        <DropBox mode="check" variant="buttons" />
      </div>

      {/* The ledger itself, under the checker: every BitGraph by day. */}
      {/* The same divider as between sections elsewhere: a hairline halfway through the 96px gap. */}
      <div style={{ height: 48, borderBottom: "1px solid var(--line-2)", marginBottom: 48 }} aria-hidden="true" />
      {/* LEDGER on the left, the day links and Calendar on the right; no paragraph (Mike, 2026-10-17). */}
      <div className="ledger-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", margin: "0 0 20px" }}>
        <div>
          <p className="home-kicker" style={{ margin: 0 }}>Ledger</p>
          {day && <p style={{ color: "var(--dim)", margin: "4px 0 0" }}>{`${longLabel(day)} (UTC)`}</p>}
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {prev >= LEDGER_FIRST_DAY && (
            <a href={`/ledger?day=${prev}`} className="bg-action-link" style={{ margin: 0 }}>
              <span className="arrow" aria-hidden>&larr;</span> {shortLabel(prev)}
            </a>
          )}
          {next && (
            <a href={next >= todayUTC ? "/ledger" : `/ledger?day=${next}`} className="bg-action-link" style={{ margin: 0 }}>
              {next >= todayUTC ? "Today" : shortLabel(next)} <span className="arrow" aria-hidden>&rarr;</span>
            </a>
          )}
          {day && next && next < todayUTC && <a href="/ledger" className="bg-action-link" style={{ margin: 0 }}>Today</a>}
          <a href="/ledger/calendar" className="bg-action-link" style={{ margin: 0 }}>Calendar</a>
        </div>
      </div>

      {failed || !page ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>The ledger could not be read. Try again in a moment.</div>
      ) : (
        <LedgerRows key={shown} day={shown} live={!day} initial={page.rows} newestKey={page.newestKey} hasOlder={page.hasOlder} />
      )}
    </div>
  );
}
