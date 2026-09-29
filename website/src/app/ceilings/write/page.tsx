import { notFound } from "next/navigation";
import { BASESCAN, CEILING_WRITER, safeB64, writesForDay } from "@/lib/ceilings";
import { StatusChip } from "@/components/ceiling-status";

/* ── One Base ceiling write: the transaction, its block, and every record
   under its root, each linking to its own proof page. ── */

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
  const writes = await writesForDay(day).catch(() => []);
  const w = writes.find((x) => x.txHash.toLowerCase() === tx.toLowerCase());
  if (!w) notFound();
  const mono = { fontFamily: "var(--mono, ui-monospace, monospace)", fontSize: 13 };
  const time = new Date(w.blockTimestamp * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";

  return (
    <div className="frame" style={{ padding: "56px 0 96px" }}>
      <a href={`/ceilings?day=${day}`} className="bg-action-link" style={{ margin: "0 0 20px" }}>
        <span className="arrow" aria-hidden>&larr;</span> Ceilings
      </a>
      <h1 className="bg-page-title" style={{ margin: 0 }}>Base block {fmt(w.blockNumber)}</h1>
      <p className="lede" style={{ margin: "10px 0 0" }}>
        {w.records === 1 ? "This record" : `These ${fmt(w.records)} records`} existed by {time}, the time of the Base block that includes this transaction.
      </p>
      <div style={{ marginTop: 28, background: "var(--paper)", borderRadius: 16, boxShadow: "var(--shadow-card)", overflow: "hidden" }}>
        <Row label="Status"><StatusChip status={w.status} /></Row>
        <Row label="Block time">{time}</Row>
        <Row label="Block"><a href={`${BASESCAN}/block/${w.blockNumber}`} target="_blank" rel="noopener">{fmt(w.blockNumber)} &#8599;</a></Row>
        <Row label="Transaction"><a href={`${BASESCAN}/tx/${w.txHash}`} target="_blank" rel="noopener" style={mono}>{w.txHash}</a></Row>
        <Row label="Writer"><a href={`${BASESCAN}/address/${CEILING_WRITER}`} target="_blank" rel="noopener" style={mono}>{CEILING_WRITER}</a></Row>
        <Row label="Positions">{w.firstPos === w.lastPos ? `#${fmt(w.firstPos)}` : `#${fmt(w.firstPos)} to #${fmt(w.lastPos)}`}</Row>
        <Row label="Fee">{eth(w.fees.totalWei)} ETH</Row>
      </div>
      <h2 style={{ margin: "40px 0 12px", fontSize: 20 }}>Records</h2>
      <div className="cl-rows" style={{ display: "flex", flexDirection: "column" }}>
        {w.items.map((i) => {
          const href = i.digestB64 ? `/proof/${safeB64(i.digestB64)}?counter=${encodeURIComponent(i.position)}&epoch=${encodeURIComponent(w.epochId)}` : null;
          const inner = (
            <>
              <span style={{ flexShrink: 0, minWidth: 88, fontWeight: 700, color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>#{fmt(i.position)}</span>
              <span style={{ flex: 1, minWidth: 0, ...mono, color: "var(--dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title="proofHash">{i.proofHash}</span>
            </>
          );
          return href
            ? <a key={i.proofHash} href={href} className="xp-row" style={{ display: "flex", gap: 12, alignItems: "center" }}>{inner}</a>
            : <div key={i.proofHash} className="xp-row" style={{ display: "flex", gap: 12, alignItems: "center" }}>{inner}</div>;
        })}
      </div>
    </div>
  );
}
