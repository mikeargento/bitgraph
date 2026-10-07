import { DocsPageNav } from "@/components/docs-page-nav";
import { BASESCAN, CEILING_WRITER, floorBlockUrl, floorChainWord, floorFor, writesForDay, type CeilingFloor, type CeilingWrite } from "@/lib/ceilings";
import { runPool } from "@/lib/s3";
import { StatusChip } from "@/components/ceiling-status";

/* ── Base: one row per Base transaction the ceiling writer sent, its floor
   beside its ceiling. Each is a Merkle root over the records made since the
   one before, so the block's time is a moment every record under it already
   existed by. Floors moved to Base with enclave v10, so "Floors" (Ethereum
   anchors, /ledger) and "Ceilings" became one page titled "Base" (Mike,
   2026-10-06); the route stays /ceilings.

   The row's floor is the floor of its first position, read from that record's
   sidecar (one read per row). A position's floor is fixed when it opens and
   positions open in order, so the first position's floor is the earliest, and
   every record under the row was made after it. Records before v10 name an
   Ethereum block; the row says which chain in a word.

   Day pages like the anchors: today live, earlier days by ?day=, named by
   UTC date. Times are the Base block's own timestamp, in UTC, so each one
   matches its Basescan link exactly (the anchors page's standing rule). ── */

export const dynamic = "force-dynamic";
export const metadata = { title: "Base" };

// The writer's first day. No day exists before it.
const EARLIEST_DAY = "2026-09-29";

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}
function shortLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric" });
}
function longLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
}
function parseDay(raw: string | undefined, todayUTC: string): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  if (raw >= todayUTC || raw < EARLIEST_DAY) return null;
  return raw;
}
function when(unix: number): string {
  const d = new Date(unix * 1000);
  const md = d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  const t = d.toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit", second: "2-digit" });
  return `${md}, ${t} UTC`;
}
function clock(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit", second: "2-digit" });
}
const fmt = (n: number | string) => Number(n).toLocaleString("en-US");

export default async function CeilingsPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const { day: rawDay } = await searchParams;
  const todayUTC = new Date().toISOString().slice(0, 10);
  const day = parseDay(rawDay, todayUTC);
  const shown = day ?? todayUTC;
  const prev = shiftDay(shown, -1);
  const next = day ? shiftDay(day, 1) : null;
  let writes: CeilingWrite[] = [];
  let failed = false;
  try { writes = await writesForDay(shown); } catch { failed = true; }
  // The first position's floor per row; a row whose sidecar cannot be read shows no floor.
  const floors = new Map<string, CeilingFloor>();
  await runPool(writes, 16, async (w) => {
    const first = w.items.find((i) => i.position === w.firstPos) ?? w.items[0];
    const f = first ? await floorFor(first.proofHash) : null;
    if (f) floors.set(w.txHash, f);
  });

  return (
    <div className="frame" style={{ padding: "56px 0 96px", maxWidth: "var(--measure)" }}>{/* the 1040px column every record page reads at (Mike, 10-06: "floors and ceilings are the only contents that load wide now") */}
      <style>{`
        .cl-rows { display: flex; flex-direction: column; }
        .cl-row { display: flex; align-items: center; gap: 12px; }
        .cl-records { flex-shrink: 0; min-width: 104px; font-size: 15px; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
        .cl-pos { flex: 1; min-width: 0; font-size: 12.5px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
        .cl-when { flex-shrink: 0; font-size: 12.5px; color: var(--dim); white-space: nowrap; font-variant-numeric: tabular-nums; }
        .cl-status { flex-shrink: 0; font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: 999px; white-space: nowrap; }
        .cl-settling { background: #fef7e0; color: #b06000; }
        .cl-settled { background: #e6f4ea; color: #137333; }
        .cl-dropped { background: #fce8e6; color: #c5221f; text-decoration: line-through; }
        .cl-blocks { flex-shrink: 0; display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--dim); white-space: nowrap; font-variant-numeric: tabular-nums; }
        .cl-blocks a { font-weight: 600; white-space: nowrap; }
        .cl-blocks .cl-by { margin-left: 6px; }
        .cl-eth { flex-shrink: 0; font-size: 12.5px; color: var(--dim); white-space: nowrap; font-variant-numeric: tabular-nums; text-decoration: none; }
        .cl-writer { font-family: var(--mono, ui-monospace, monospace); font-size: 13px; }
        .cl-when-short { display: none; }
        /* The position range is the first thing to go: it truncates to "#14,2…"
           long before the row runs out of room, and the detail page has it whole. */
        @media (max-width: 900px) { .cl-pos { visibility: hidden; } }
        @media (max-width: 640px) {
          .cl-records { min-width: 0; }
          .cl-pos, .cl-row .cl-status, .cl-row .cl-eth, .cl-when-long { display: none; }
          .cl-when-short { display: inline; }
          .cl-when { margin-left: auto; }
          .cl-row { flex-wrap: wrap; row-gap: 8px; }
          .cl-blocks { order: 1; flex-basis: 100%; }
        }
      `}</style>
      <div className="xp-head">
        <div className="xp-head-text">
          <h1 className="bg-page-title" style={{ margin: 0 }}>Base</h1>
          {day && <p style={{ fontSize: 14, color: "var(--dim)", margin: "2px 0 0" }}>{`${longLabel(day)} (UTC)`}</p>}
          <p className="lede" style={{ margin: "10px 0 0" }}>
            Each row is one Base transaction carrying a Merkle root over the records made since the last one. Every record under it was made after the row&rsquo;s floor block and existed by the time of the transaction&rsquo;s block, read from the block itself, in UTC. Floors before enclave v10 are Ethereum blocks.
          </p>
          <p style={{ margin: "12px 0 0", fontSize: 14, color: "var(--dim)" }}>
            Sent from BitGraph&rsquo;s ceiling address:{" "}
            <a className="cl-writer" href={`${BASESCAN}/address/${CEILING_WRITER}`} target="_blank" rel="noopener">{CEILING_WRITER}</a>
          </p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, margin: "28px 0 20px" }}>
        {prev >= EARLIEST_DAY && (
          <a href={`/ceilings?day=${prev}`} className="bg-action-link" style={{ margin: 0 }}>
            <span className="arrow" aria-hidden>&larr;</span> {shortLabel(prev)}
          </a>
        )}
        {next && (
          <a href={next >= todayUTC ? "/ceilings" : `/ceilings?day=${next}`} className="bg-action-link" style={{ margin: 0 }}>
            {next >= todayUTC ? "Today" : shortLabel(next)} <span className="arrow" aria-hidden>&rarr;</span>
          </a>
        )}
      </div>

      {failed ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--faint)", fontSize: 14 }}>The ledger could not be read. Try again in a moment.</div>
      ) : writes.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--faint)", fontSize: 14 }}>No Base blocks on this day.</div>
      ) : (
        <div className="cl-rows">
          {writes.map((w) => {
            const d = new Date(w.blockTimestamp * 1000).toISOString().slice(0, 10);
            const detail = `/ceilings/write?day=${d}&block=${w.blockNumber}&tx=${w.txHash}`;
            const floor = floors.get(w.txHash);
            return (
              <div key={w.txHash} className="xp-row xp-row-base cl-row">
                <a href={detail} className="cl-records" style={{ textDecoration: "none" }}>
                  {w.records === 1 ? "1 record" : `${fmt(w.records)} records`}
                </a>
                <span className="cl-blocks">
                  {floor && (
                    <>
                      after{" "}
                      <a href={floorBlockUrl(floor)} target="_blank" rel="noopener" title="Floor">
                        {floorChainWord(floor)} #{fmt(floor.blockNumber)}
                      </a>
                    </>
                  )}
                  <span className={floor ? "cl-by" : undefined}>by</span>{" "}
                  <a href={`${BASESCAN}/tx/${w.txHash}`} target="_blank" rel="noopener" title="Ceiling">
                    Base block #{fmt(w.blockNumber)}
                  </a>
                </span>
                <a href={detail} className="cl-pos" style={{ textDecoration: "none" }}>
                  {w.firstPos === w.lastPos ? `#${fmt(w.firstPos)}` : `#${fmt(w.firstPos)} to #${fmt(w.lastPos)}`}
                </a>
                <StatusChip status={w.status} />
                {w.settlement && (
                  <a href={`https://etherscan.io/block/${w.settlement.l1BlockNumber}`} target="_blank" rel="noopener" className="cl-eth" title="The Ethereum block carrying the batch data that holds this Base block">
                    Ethereum {fmt(w.settlement.l1BlockNumber)}
                  </a>
                )}
                <a href={detail} className="cl-when" style={{ textDecoration: "none" }}>
                  <span className="cl-when-long">{when(w.blockTimestamp)}</span>
                  <span className="cl-when-short">{clock(w.blockTimestamp)}</span>
                </a>
              </div>
            );
          })}
        </div>
      )}
      <DocsPageNav current="/ceilings" />
    </div>
  );
}
