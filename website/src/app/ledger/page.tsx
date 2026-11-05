import type { Metadata } from "next";
import Link from "next/link";
import { LedgerRows } from "@/components/ledger-rows";
import { LEDGER_FIRST_DAY, ledgerPage, type LedgerPage } from "@/lib/running-ledger";

/**
 * The running ledger (2026-10-17), modelled on the Base ledger:
 * every BitGraph, newest first, one UTC day per page, today live. The Base
 * page's own layout and styles.
 *
 * Public (2026-10-17; the ledger starts with the new BitGraph): a row shows the
 * BitGraph's number, its two counts, the SHA-256 it bound and the enclave's signed time, and opens its proof
 * page. A hash cannot be turned back into the file; a guessable file can be confirmed by someone hashing their
 * own copy, an accepted trade-off. This reverses the 2026-10-09 decision against a browsable gallery.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "The Ledger",
  description: "Every BitGraph ever made, in order. Open any one for its proof.",
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
  // Development only: a local server cannot read the ledger, so it shows today's live rows to preview the layout.
  if (failed && process.env.NODE_ENV === "development" && !day) {
    try {
      const j = (await (await fetch("https://bitgraph.ing/api/ledger/rows", { cache: "no-store" })).json()) as { rows: LedgerPage["rows"]; newestKey: string | null };
      page = { rows: j.rows, newestKey: j.newestKey, hasOlder: false };
      failed = false;
    } catch { /* stays failed */ }
  }

  const dayLinks = (
    <div className="rl-more">
      {prev >= LEDGER_FIRST_DAY && <a href={`/ledger?day=${prev}`}>&lsaquo; {shortLabel(prev)}</a>}
      {next && <a href={next >= todayUTC ? "/ledger" : `/ledger?day=${next}`}>{next >= todayUTC ? "Today" : shortLabel(next)} &rsaquo;</a>}
      <Link href="/ledger/calendar">Calendar</Link>
    </div>
  );

  return (
    <div className="frame" style={{ padding: "56px 0 96px", maxWidth: "var(--measure)" }}>
      <style>{`
        .rl-rows { display: flex; flex-direction: column; gap: 8px; margin-top: 32px; }
        .rl-row { display: flex; align-items: center; gap: 20px; padding: 20px 24px; background: #1c1c1e; border-radius: 14px; }
        .rl-num { flex-shrink: 0; min-width: 96px; font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: var(--ink); font-variant-numeric: tabular-nums; }
        .rl-what { flex: 1; min-width: 0; font-size: 16px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .rl-when { flex-shrink: 0; font-size: 16px; color: var(--dim); white-space: nowrap; }
        .rl-go { flex-shrink: 0; font-size: 26px; line-height: 1; color: var(--dim); }
        .rl-link { color: inherit; text-decoration: none !important; transition: background-color 0.15s; }
        .rl-link:hover { background: #2a2a2c; }
        .rl-link:hover .rl-go { color: var(--ink); }
        .rl-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px 24px; flex-wrap: wrap; }
        .rl-more { display: flex; gap: 20px; flex-wrap: wrap; font-size: 15px; }
        .rl-foot { margin-top: 28px; }
        .rl-more a { color: var(--dim); }
        @media (max-width: 640px) {
          .rl-row { padding: 16px 18px; gap: 14px; }
          .rl-num { min-width: 0; font-size: 24px; }
          .rl-when { font-size: 15px; }
        }
      `}</style>
      {/* No visible h1: it repeated the nav (2026-10-17). */}
        <h1 className="sr-only">The Ledger.</h1>

      {/* The Ledger is nothing but the BitGraphs, newest first, one card each. Finding or making one is
          the Make box's job (a file already on the ledger opens its frame). */}
      {/* The day links sit beside the title, so moving between days never needs a scroll to the end of a long day; they
          repeat under the list for whoever reaches it. */}
      <div className="rl-head">
        <h2 style={{ margin: 0 }}>{day ? longLabel(day) : "The Ledger"}</h2>
        {dayLinks}
      </div>

      {failed || !page ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--faint)" }}>The Ledger could not be read. Try again in a moment.</div>
      ) : (
        <LedgerRows key={shown} day={shown} live={!day} initial={page.rows} newestKey={page.newestKey} hasOlder={page.hasOlder} />
      )}
      <div className="rl-foot">{dayLinks}</div>
    </div>
  );
}
