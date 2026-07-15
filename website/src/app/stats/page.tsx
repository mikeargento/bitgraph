"use client";

import { useCallback, useEffect, useState } from "react";

const mono = "var(--font-mono), 'SF Mono', SFMono-Regular, monospace";

type Stats = {
  epoch: string;
  head: number;
  range: { from: number; to: number; clamped: boolean };
  span: { fromTime: string | null; toTime: string | null; durationSec: number | null } | null;
  totals: { entries: number; fileCommits: number; anchors: number; uniqueDigests: number; recurringDigests: number };
  ratePerMin: number | null;
  recurrences: Array<{ digest: string; count: number; firstCounter: number; lastCounter: number }>;
  rhythm: {
    peak: { commits: number; fromCounter: number; toCounter: number; fromTime: string | null; toTime: string | null } | null;
    quiet: { fromCounter: number; toCounter: number; fromTime: string | null; toTime: string | null; durationSec: number | null } | null;
  };
  truncated: boolean;
  digestsCapped: boolean;
};

// "24s", "1m 24s", "2h 5m", "4d 7h" — units roll over as soon as reached.
function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

const fmt = (n: number) => n.toLocaleString();

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso);
  return `${t.toLocaleTimeString()} on ${t.toLocaleDateString()}`;
}

const Em = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: "#0065A4", fontWeight: 600 }}>{children}</span>
);
const Num = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: "#0065A4", fontWeight: 600, fontFamily: mono }}>{children}</span>
);

function Card({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #d0d5dd", borderRadius: 0, overflow: "hidden" }}>
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.04em", color: "#0065A4", padding: "18px 24px", background: "rgba(0,101,164,0.04)", borderBottom: "1px solid #e2e5e9" }}>
        {title}
      </div>
      <div className="stats-fields" style={{ padding: "4px 0" }}>{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "14px 24px", borderBottom: "1px solid #e2e5e9" }}>
      <span style={{ fontSize: 14, color: "#374151", fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: 14, color: "#1f2937", lineHeight: 1.5, wordBreak: "break-word" }}>{children}</span>
    </div>
  );
}

type Preset = { label: string; hours?: number };
const PRESETS: Preset[] = [
  { label: "Last hour", hours: 1 },
  { label: "Last 24 hours", hours: 24 },
  { label: "Last 7 days", hours: 168 },
  { label: "Entire epoch" },
];

export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [active, setActive] = useState<string>("Last 24 hours");
  const [fromIn, setFromIn] = useState("");
  const [toIn, setToIn] = useState("");
  const [fromT, setFromT] = useState("");
  const [toT, setToT] = useState("");

  const load = useCallback(async (qs: string, label: string) => {
    setLoading(true);
    setError(false);
    setActive(label);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const r = await fetch(`/api/stats${qs}`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error();
      setStats(await r.json());
    } catch {
      setError(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load("?hours=24", "Last 24 hours"); }, [load]);

  const applyCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const f = parseInt(fromIn, 10);
    const t = parseInt(toIn, 10);
    if (isNaN(f) || isNaN(t) || f < 1 || t < f) return;
    load(`?from=${f}&to=${t}`, "custom");
  };

  // datetime-local values are local wall-clock; the API takes ISO instants.
  const applyTimes = (e: React.FormEvent) => {
    e.preventDefault();
    const f = fromT ? new Date(fromT) : null;
    const t = toT ? new Date(toT) : null;
    if (!f && !t) return;
    if (f && isNaN(f.getTime())) return;
    if (t && isNaN(t.getTime())) return;
    if (f && t && t < f) return;
    const qs = new URLSearchParams();
    if (f) qs.set("fromTime", f.toISOString());
    if (t) qs.set("toTime", t.toISOString());
    load(`?${qs.toString()}`, "custom-time");
  };

  const s = stats;
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--c-text)" }}>
      <style>{`
        .stats-fields > div:last-child { border-bottom: none !important; }
        .stats-chip { height: 40px; padding: 0 16px; font-size: 13.5px; font-weight: 600; border-radius: 0; cursor: pointer; border: 1px solid #0065A4; background: #fff; color: #0065A4; }
        .stats-chip[data-on="true"] { background: #0065A4; color: #fff; }
        .stats-input { height: 40px; width: 110px; padding: 0 10px; border: 1px solid #d0d5dd; border-radius: 0; font-size: 14px; background: #fff; color: #111827; outline: none; font-family: ${mono}; }
        .stats-dt { width: 205px; font-family: inherit; }
        .stats-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
      `}</style>
      <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "40px 0 80px", display: "flex", flexDirection: "column", gap: 24, animation: "fadeIn .3s ease-out" }}>

        <div className="stats-controls">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              className="stats-chip"
              data-on={active === p.label}
              onClick={() => load(p.hours ? `?hours=${p.hours}` : "?from=1", p.label)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <form onSubmit={applyTimes} className="stats-controls">
          <input className="stats-input stats-dt" type="datetime-local" value={fromT} onChange={(e) => setFromT(e.target.value)} aria-label="Range start date and time" />
          <span style={{ fontSize: 13, color: "#6b7280" }}>to</span>
          <input className="stats-input stats-dt" type="datetime-local" value={toT} onChange={(e) => setToT(e.target.value)} aria-label="Range end date and time" />
          <button type="submit" className="stats-chip" data-on={active === "custom-time"}>Apply</button>
        </form>
        <form onSubmit={applyCustom} className="stats-controls">
          <input className="stats-input" inputMode="numeric" placeholder="from #" value={fromIn} onChange={(e) => setFromIn(e.target.value)} aria-label="Range start counter" />
          <span style={{ fontSize: 13, color: "#6b7280" }}>to</span>
          <input className="stats-input" inputMode="numeric" placeholder="to #" value={toIn} onChange={(e) => setToIn(e.target.value)} aria-label="Range end counter" />
          <button type="submit" className="stats-chip" data-on={active === "custom"}>Apply</button>
        </form>

        {loading && <div style={{ padding: 60, textAlign: "center", color: "#9ca3af", fontSize: 14 }}>Reading the ledger…</div>}
        {error && !loading && <div style={{ padding: 60, textAlign: "center", color: "#9ca3af", fontSize: 14 }}>Stats unavailable right now.</div>}

        {s && !loading && !error && (
          <>
            <Card title="Range">
              <Row label="Counters">
                <Num>#{fmt(s.range.from)}</Num> to <Num>#{fmt(s.range.to)}</Num>
                {s.range.clamped ? <span style={{ color: "#6b7280" }}> (window predates this epoch; showing the entire epoch)</span> : null}
              </Row>
              {s.span?.fromTime && <Row label="First anchor"><Em>{fmtTime(s.span.fromTime)}</Em></Row>}
              {s.span?.toTime && <Row label="Last anchor"><Em>{fmtTime(s.span.toTime)}</Em></Row>}
              {s.span?.durationSec != null && s.span.durationSec > 0 && <Row label="Duration"><Em>{formatDuration(s.span.durationSec)}</Em></Row>}
              <Row label="Epoch"><span style={{ fontFamily: mono, fontSize: 12.5 }}>{s.epoch}</span></Row>
            </Card>

            <Card title="Activity">
              <Row label="Files recorded">
                <Num>{fmt(s.totals.fileCommits)}</Num>{" "}
                {s.totals.uniqueDigests !== s.totals.fileCommits ? <>(<Num>{fmt(s.totals.uniqueDigests)}</Num> unique)</> : null}
                {s.truncated ? <span style={{ color: "#6b7280" }}> (large range, counts capped)</span> : s.digestsCapped ? <span style={{ color: "#6b7280" }}> (unique counts sampled from the first 500)</span> : null}
              </Row>
              <Row label="Ethereum anchors"><Num>{fmt(s.totals.anchors)}</Num></Row>
              {s.ratePerMin != null && s.totals.fileCommits > 0 && (
                <Row label="Recording rate"><Num>{s.ratePerMin}</Num> files per minute</Row>
              )}
            </Card>

            {s.totals.recurringDigests > 0 && (
              <Card title="Recurrences">
                {s.recurrences.map((r) => (
                  <div key={r.digest} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 24px", borderBottom: "1px solid #e2e5e9" }}>
                    <a href={`/proof/${encodeURIComponent(r.digest)}`} target="_blank" rel="noopener" style={{ flex: 1, minWidth: 0, fontFamily: mono, fontSize: 12.5, color: "var(--c-accent)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.digest}
                    </a>
                    <span style={{ flexShrink: 0, fontSize: 13, color: "#1f2937" }}>
                      <Num>{r.count}</Num> positions, <Num>#{fmt(r.firstCounter)}</Num> to <Num>#{fmt(r.lastCounter)}</Num>
                    </span>
                  </div>
                ))}
                {s.totals.recurringDigests > s.recurrences.length && (
                  <Row label="More">{fmt(s.totals.recurringDigests - s.recurrences.length)} additional recurring digests in this range</Row>
                )}
              </Card>
            )}

            {(s.rhythm.peak || s.rhythm.quiet) && (
              <Card title="Rhythm">
                {s.rhythm.peak && (
                  <Row label="Busiest anchor window">
                    <Num>{fmt(s.rhythm.peak.commits)}</Num> file{s.rhythm.peak.commits === 1 ? "" : "s"} between <Em>{fmtTime(s.rhythm.peak.fromTime)}</Em> and <Em>{fmtTime(s.rhythm.peak.toTime)}</Em>
                  </Row>
                )}
                {s.rhythm.quiet && s.rhythm.quiet.durationSec != null && s.rhythm.quiet.durationSec > 0 && (
                  <Row label="Longest quiet stretch">
                    <Em>{formatDuration(s.rhythm.quiet.durationSec)}</Em>, from <Em>{fmtTime(s.rhythm.quiet.fromTime)}</Em> to <Em>{fmtTime(s.rhythm.quiet.toTime)}</Em>
                  </Row>
                )}
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
