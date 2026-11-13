import type { Metadata } from "next";
import Link from "next/link";
import { LedgerRows } from "@/components/ledger-rows";
import { LEDGER_FIRST_DAY, ledgerPage, type LedgerPage } from "@/lib/running-ledger";

/**
 * The ledger: every BitGraph, newest first, one UTC day per page, today live. A row shows the BitGraph's number, the
 * start of the SHA-256 it bound and when the enclave signed it, and opens its proof page. The file itself is never
 * here; its fingerprint is, so anyone who holds a copy of a file can see whether it was recorded. Checking a proof does
 * not need this page: it is a view of the order, not a step in checking.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Ledger",
  description: "Every BitGraph, in order, newest first. Open any one for its proof.",
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

export default async function LedgerPageView({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
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
    <div className="rl-days">
      {prev >= LEDGER_FIRST_DAY && <a href={`/ledger?day=${prev}`}>&lsaquo; {shortLabel(prev)}</a>}
      {next && <a href={next >= todayUTC ? "/ledger" : `/ledger?day=${next}`}>{next >= todayUTC ? "Today" : shortLabel(next)} &rsaquo;</a>}
      <Link href="/ledger/calendar">Calendar</Link>
    </div>
  );

  return (
    <div className="frame home home-typing prose home-scroll docs-page tools-page sx-page ledger-page">
      <div className="home-hero"><h1 className="sr-only">Ledger.</h1></div>
      <section className="home-section" aria-labelledby="ledger-h">
        <p className="home-kicker">Ledger</p>
        <h2 id="ledger-h">{day ? longLabel(day) : "Every BitGraph, in order."}</h2>
        <p>Newest first, one UTC day to a page. Each row is one BitGraph: its number, the start of the SHA-256 it bound and when it was made. Open one for its proof.</p>
        {dayLinks}
        {failed || !page ? (
          <p className="rl-empty">The ledger could not be read. Try again in a moment.</p>
        ) : (
          <LedgerRows key={shown} day={shown} live={!day} initial={page.rows} newestKey={page.newestKey} hasOlder={page.hasOlder} />
        )}
        <div className="rl-foot">{dayLinks}</div>
      </section>
    </div>
  );
}
