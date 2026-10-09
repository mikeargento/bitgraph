import { notFound } from "next/navigation";
import { BASESCAN, CEILING_WRITER, floorChainWord, floorFor, writesForDay, type CeilingFloor } from "@/lib/ceilings";
import { runPool } from "@/lib/s3";
import { StatusChip } from "@/components/ceiling-status";

/* ── One Base ceiling write: the transaction, its block, and every record
   under its root by position and proof hash, with its floor (the block it was
   made after: Base from enclave v10, Ethereum before), read from its sidecar.

   The rows linked to each record's proof page until 2026-10-09, which made this
   page and the Base list above it a way to open everyone's records, paintings
   included (Mike: "We don't want that ledger."). A record is found by whoever
   holds its file, its digest or a link its maker shared; here it is a position
   and a proof hash, which open nothing. ── */

export const dynamic = "force-dynamic";
export const metadata = { title: "Ceiling write" };

const fmt = (n: number | string) => Number(n).toLocaleString("en-US");
const eth = (wei: string) => (Number(BigInt(wei)) / 1e18).toFixed(9).replace(/0+$/, "").replace(/\.$/, "");

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 16, padding: "12px 20px", borderBottom: "1px solid var(--line-2)", fontSize: 14, alignItems: "baseline" }}>
      <div style={{ width: 150, flexShrink: 0, color: "var(--dim)" }}>{label}</div>
      <div style={{ minWidth: 0, overflowWrap: "anywhere", fontVariantNumeric: "tabular-nums" }}>{children}</div>
    </div>
  );
}

export default async function CeilingWritePage({ searchParams }: { searchParams: Promise<{ day?: string; block?: string; tx?: string }> }) {
  const { day, tx } = await searchParams;
  if (!day || !tx) notFound();
  const writes = await writesForDay(day, { includeHidden: true }).catch(() => []);
  const w = writes.find((x) => x.txHash.toLowerCase() === tx.toLowerCase());
  if (!w) notFound();
  const floors = new Map<string, CeilingFloor>();
  await runPool(w.items, 16, async (i) => {
    const f = await floorFor(i.proofHash);
    if (f) floors.set(i.proofHash, f);
  });
  const mono = { fontFamily: "var(--mono, ui-monospace, monospace)", fontSize: 13 };
  const time = new Date(w.blockTimestamp * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";

  return (
    <div className="frame" style={{ padding: "96px 0 96px", maxWidth: "var(--measure)" }}>{/* the column, so "All ceilings" sits on its right edge, not the wide frame's */}
      {/* The same corner and size as a proof page's "All floors" (96px top
          margin: 28px, the 44px pill, 24px), so a write reads like a proof. */}
      <div style={{ position: "relative" }}>
        <div style={{ position: "absolute", right: -8, top: -68, display: "flex" }}>
          <a href={`/ceilings?day=${day}`} className="bg-action-link bg-proof-top">All ceilings</a>
        </div>
      </div>
      {/* One column (Mike, 2026-10-04: "thats not aligned right"): the title and "Records" sat in the
          centred reading measure while the cards ran the full frame, so neither edge lined up. */}
      <div style={{ maxWidth: "var(--measure)", margin: "0 auto 0 0" }}>
      <h1 className="bg-page-title" style={{ margin: 0 }}>Base block {fmt(w.blockNumber)}</h1>
      <p className="lede" style={{ margin: "10px 0 0" }}>
        {w.records === 1 ? "This record" : `These ${fmt(w.records)} records`} existed by {time}, the time of the Base block that includes this transaction.
      </p>
      <div style={{ marginTop: 28, background: "var(--paper)", borderRadius: 16, boxShadow: "var(--shadow-card)", overflow: "hidden" }}>
        <Row label="Status"><StatusChip status={w.status} /></Row>
        {w.settlement && (
          <Row label="On Ethereum">
            block <a href={`https://etherscan.io/block/${w.settlement.l1BlockNumber}`} target="_blank" rel="noopener">{fmt(w.settlement.l1BlockNumber)}</a>, {new Date(w.settlement.l1BlockTimestamp * 1000).toISOString().replace("T", " ").slice(0, 19)} UTC: the batch data holding this Base block, in <a href={`https://etherscan.io/tx/${w.settlement.l1TxHash}`} target="_blank" rel="noopener" style={mono}>{w.settlement.l1TxHash.slice(0, 18)}&hellip;</a>
          </Row>
        )}
        <Row label="Block time">{time}</Row>
        <Row label="Block"><a href={`${BASESCAN}/block/${w.blockNumber}`} target="_blank" rel="noopener">{fmt(w.blockNumber)}</a></Row>
        <Row label="Transaction"><a href={`${BASESCAN}/tx/${w.txHash}`} target="_blank" rel="noopener" style={mono}>{w.txHash}</a></Row>
        <Row label="Writer"><a href={`${BASESCAN}/address/${CEILING_WRITER}`} target="_blank" rel="noopener" style={mono}>{CEILING_WRITER}</a></Row>
        <Row label="Positions">{w.firstPos === w.lastPos ? `#${fmt(w.firstPos)}` : `#${fmt(w.firstPos)} to #${fmt(w.lastPos)}`}</Row>
        <Row label="Fee">{eth(w.fees.totalWei)} ETH</Row>
      </div>
      <h2 style={{ margin: "40px 0 12px", fontSize: 20 }}>Records</h2>
      <div className="cl-rows" style={{ display: "flex", flexDirection: "column" }}>
        {w.items.map((i) => {
          const floor = floors.get(i.proofHash);
          return (
            <div key={i.proofHash} className="xp-row" style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ flexShrink: 0, minWidth: 88, fontWeight: 700, color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>#{fmt(i.position)}</span>
              <span style={{ flex: 1, minWidth: 0, ...mono, color: "var(--dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title="proofHash">{i.proofHash}</span>
              {floor && <span style={{ flexShrink: 0, fontSize: 12.5, color: "var(--dim)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>after {floorChainWord(floor)} #{fmt(floor.blockNumber)}</span>}
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}
