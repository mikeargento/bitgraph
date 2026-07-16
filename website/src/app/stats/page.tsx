"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { timeTz } from "@/lib/format-time";

const mono = "var(--font-mono), 'SF Mono', SFMono-Regular, monospace";
const BLUE = "#0065A4";
const BLUE_DARK = "#004d7d";
const GRAY_BAR = "#6b7280";
const GRAY_BAR_DARK = "#4b5563";

type Timeline = { startTime: string; endTime: string; fileBins: number[]; anchorBins: number[] };

type Stats = {
  epoch: string;
  head: number;
  allTime: { epochs: number; positions: number };
  range: { from: number; to: number; clamped: boolean; empty: boolean; coveredTo: number | null };
  span: { fromTime: string | null; toTime: string | null; durationSec: number | null } | null;
  totals: { entries: number; fileCommits: number; anchors: number; uniqueDigests: number; recurringDigests: number };
  ratePerMin: number | null;
  recurrences: Array<{
    digest: string; count: number; firstCounter: number; lastCounter: number;
    positions: Array<{ counter: number; t: string | null }>;
  }>;
  rhythm: {
    peak: { commits: number; fromCounter: number; toCounter: number; fromTime: string | null; toTime: string | null } | null;
    quiet: { fromCounter: number; toCounter: number; fromTime: string | null; toTime: string | null; durationSec: number | null } | null;
  };
  timeline: Timeline | null;
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
  return `${timeTz(t)} on ${t.toLocaleDateString()}`;
}

const Em = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: BLUE, fontWeight: 600 }}>{children}</span>
);
const Num = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: BLUE, fontWeight: 600, fontFamily: mono }}>{children}</span>
);

function Card({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #d0d5dd", borderRadius: 0, overflow: "hidden" }}>
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.04em", color: BLUE, padding: "18px 24px", background: "rgba(0,101,164,0.04)", borderBottom: "1px solid #e2e5e9" }}>
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

/* ── Histogram — one series binned over the range's time domain. Thin bars
   with rounded tops anchored to a recessive baseline; full-height hover
   targets wider than the marks feed one tooltip slot. Endpoints carry the
   authoritative Ethereum block times; the fill is server write time. ── */
function Histogram({ t, series, color, hoverColor, height, unit, showEdgeLabels }: {
  t: Timeline;
  series: number[];
  color: string;
  hoverColor: string;
  height: number;
  unit: string;
  showEdgeLabels: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 800;
  const LABEL_H = showEdgeLabels ? 20 : 0;
  const TOP = 16;
  const BASE = height - LABEL_H;
  const bins = series;
  const max = Math.max(1, ...bins);
  const bw = W / bins.length;
  const start = new Date(t.startTime).getTime();
  const end = new Date(t.endTime).getTime();
  const binMs = (end - start) / bins.length;
  const multiDay = new Date(start).toDateString() !== new Date(end).toDateString();

  const barPath = (i: number) => {
    const count = bins[i];
    if (count === 0) return null;
    const h = Math.max(2, (count / max) * (BASE - TOP));
    const x = i * bw + 1, w = Math.max(1, bw - 2), y = BASE - h;
    const r = Math.min(2, w / 2, h / 2);
    return `M ${x} ${BASE} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${BASE} Z`;
  };

  const shortTime = (d: Date, tz: boolean) =>
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", ...(tz ? { timeZoneName: "short" as const } : {}) });

  const binLabel = (i: number) => {
    const a = new Date(start + i * binMs);
    const b = new Date(start + (i + 1) * binMs);
    const span = multiDay
      ? `${a.toLocaleDateString()} ${shortTime(a, false)} – ${b.toLocaleDateString()} ${shortTime(b, true)}`
      : `${shortTime(a, false)} – ${shortTime(b, true)}`;
    return `${fmt(bins[i])} ${unit}${bins[i] === 1 ? "" : "s"} · ${span}`;
  };

  const edgeLabel = (iso: string) => {
    const d = new Date(iso);
    return multiDay ? `${d.toLocaleDateString()} ${shortTime(d, true)}` : shortTime(d, true);
  };

  return (
    <div style={{ position: "relative" }}>
      {hover != null && bins[hover] > 0 && (
        <div style={{
          // Anchored to the container's near half, never the cursor, so the
          // box can never escape the card (Card has overflow:hidden) — and it
          // may wrap on narrow viewports rather than clip.
          position: "absolute", top: -6,
          left: hover < bins.length / 2 ? 0 : undefined,
          right: hover < bins.length / 2 ? undefined : 0,
          maxWidth: "100%",
          background: "#111827", color: "#fff", fontSize: 12, fontWeight: 600,
          lineHeight: 1.4, padding: "4px 9px", pointerEvents: "none", zIndex: 2,
        }}>
          {binLabel(hover)}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${height}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label={`${unit}s per time bin`}>
        <line x1="0" y1={BASE} x2={W} y2={BASE} stroke="#e2e5e9" strokeWidth="1" />
        {bins.map((count, i) => {
          const p = barPath(i);
          return p ? <path key={i} d={p} fill={hover === i ? hoverColor : color} /> : null;
        })}
        {/* Full-height hit targets, wider than the marks. The custom tooltip
            is the single hover layer — no native <title>, which would show a
            second, duplicate browser tooltip after the hover delay. */}
        {bins.map((_, i) => (
          <rect
            key={`h${i}`}
            x={i * bw} y={0} width={bw} height={BASE}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        {showEdgeLabels && (
          <>
            <text x="0" y={height - 5} fontSize="11" fill="#9ca3af">{edgeLabel(t.startTime)}</text>
            <text x={W} y={height - 5} fontSize="11" fill="#9ca3af" textAnchor="end">{edgeLabel(t.endTime)}</text>
          </>
        )}
      </svg>
    </div>
  );
}

/* ── Series header inside a chart block: a small color chip + name + peak
   value, in text ink (identity rides the chip, not the text color). ── */
function SeriesLabel({ color, name, detail }: { color: string; name: string; detail: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#6b7280", marginBottom: 4 }}>
      <span aria-hidden style={{ width: 10, height: 10, background: color, flexShrink: 0 }} />
      <span style={{ fontWeight: 700, color: "#374151" }}>{name}</span>
      <span>{detail}</span>
    </div>
  );
}

/* ── Recurrence track — the same bytes at several causal positions, as dots
   on a hairline across the viewed range. Positioned by time when the write
   time is known, by counter fraction otherwise. ── */
function RecurrenceTrack({ positions, range, timeline }: {
  positions: Array<{ counter: number; t: string | null }>;
  range: { from: number; to: number };
  timeline: Timeline | null;
}) {
  const start = timeline ? new Date(timeline.startTime).getTime() : null;
  const end = timeline ? new Date(timeline.endTime).getTime() : null;
  const frac = (p: { counter: number; t: string | null }) => {
    if (start != null && end != null && end > start && p.t) {
      return Math.min(1, Math.max(0, (new Date(p.t).getTime() - start) / (end - start)));
    }
    const span = Math.max(1, range.to - range.from);
    return Math.min(1, Math.max(0, (p.counter - range.from) / span));
  };
  return (
    <div style={{ position: "relative", height: 16, margin: "10px 0 2px" }} aria-hidden>
      <div style={{ position: "absolute", left: 0, right: 0, top: 7, height: 1, background: "#e2e5e9" }} />
      {positions.map((p) => (
        <span
          key={p.counter}
          title={`#${fmt(p.counter)}`}
          style={{
            position: "absolute", top: 4, width: 8, height: 8, borderRadius: 999,
            background: BLUE, border: "2px solid #fff", boxSizing: "content-box",
            left: `calc(${frac(p) * 100}% - 6px)`,
          }}
        />
      ))}
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

  // Requests are sequenced: each load bumps the generation and aborts the
  // previous fetch, and a settling request only touches state if it is still
  // the newest — a slow past-epoch response must never overwrite a newer view.
  const genRef = useRef(0);
  const ctrlRef = useRef<AbortController | null>(null);
  const load = useCallback(async (qs: string, label: string) => {
    const gen = ++genRef.current;
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setLoading(true);
    setError(false);
    setActive(label);
    try {
      const t = setTimeout(() => ctrl.abort(), 25000);
      const r = await fetch(`/api/stats${qs}`, { signal: ctrl.signal });
      clearTimeout(t);
      if (gen !== genRef.current) return;
      if (!r.ok) throw new Error();
      const body = await r.json();
      if (gen !== genRef.current) return;
      setStats(body);
    } catch {
      if (gen !== genRef.current) return;
      setError(true);
    }
    if (gen === genRef.current) setLoading(false);
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
  const filesMax = s?.timeline ? Math.max(0, ...s.timeline.fileBins) : 0;
  const anchorsMax = s?.timeline ? Math.max(0, ...s.timeline.anchorBins) : 0;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--c-text)" }}>
      <style>{`
        .stats-fields > div:last-child { border-bottom: none !important; }
        .stats-chip { height: 40px; padding: 0 16px; font-size: 13.5px; font-weight: 600; border-radius: 0; cursor: pointer; border: 1px solid ${BLUE}; background: #fff; color: ${BLUE}; }
        .stats-chip[data-on="true"] { background: ${BLUE}; color: #fff; }
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
                {s.range.empty ? (
                  <span style={{ color: "#6b7280" }}>no anchors in this window</span>
                ) : (
                  <>
                    <Num>#{fmt(s.range.from)}</Num> to <Num>#{fmt(s.range.to)}</Num>
                    {s.range.clamped ? <span style={{ color: "#6b7280" }}> (starts before this epoch)</span> : null}
                    {s.range.coveredTo != null ? <span style={{ color: "#6b7280" }}> (large range; counts cover #{fmt(s.range.from)} to #{fmt(s.range.coveredTo)})</span> : null}
                  </>
                )}
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
                {s.digestsCapped ? <span style={{ color: "#6b7280" }}> (unique counts sampled from the first 500)</span> : null}
              </Row>
              <Row label="Ethereum anchors"><Num>{fmt(s.totals.anchors)}</Num></Row>
              {s.ratePerMin != null && s.totals.fileCommits > 0 && (
                <Row label="Recording rate"><Num>{s.ratePerMin}</Num> files per minute</Row>
              )}
              <Row label="All time">
                <Num>{fmt(s.allTime.epochs)}</Num> epoch{s.allTime.epochs === 1 ? "" : "s"} · <Num>{fmt(s.allTime.positions)}</Num> causal positions
              </Row>
            </Card>

            {(s.timeline || s.rhythm.peak || s.rhythm.quiet) && (
              <Card title="File Rhythm">
                {s.timeline && (
                  <div style={{ padding: "18px 24px 8px", borderBottom: "1px solid #e2e5e9" }}>
                    <SeriesLabel
                      color={BLUE}
                      name="Files"
                      detail={filesMax > 0 ? `peak ${fmt(filesMax)} per bin` : "none in this range"}
                    />
                    <Histogram t={s.timeline} series={s.timeline.fileBins} color={BLUE} hoverColor={BLUE_DARK} height={120} unit="file" showEdgeLabels={false} />
                    <div style={{ height: 14 }} />
                    <SeriesLabel
                      color={GRAY_BAR}
                      name="Ethereum anchors"
                      detail={anchorsMax > 0 ? `peak ${fmt(anchorsMax)} per bin — the TEE's pulse` : "none in this range"}
                    />
                    <Histogram t={s.timeline} series={s.timeline.anchorBins} color={GRAY_BAR} hoverColor={GRAY_BAR_DARK} height={78} unit="anchor" showEdgeLabels />
                  </div>
                )}
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

            {s.totals.recurringDigests > 0 && (
              <Card title="Recurrences">
                <div style={{ padding: "14px 24px", borderBottom: "1px solid #e2e5e9", fontSize: 13, color: "#374151", lineHeight: 1.5 }}>
                  The same bytes recorded at more than one causal position in this range.
                </div>
                {s.recurrences.map((r) => (
                  <div key={r.digest} style={{ padding: "14px 24px", borderBottom: "1px solid #e2e5e9" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <a href={`/proof/${encodeURIComponent(r.digest)}`} target="_blank" rel="noopener" style={{ flex: 1, minWidth: 0, fontFamily: mono, fontSize: 12.5, color: "var(--c-accent)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.digest}
                      </a>
                      <span style={{ flexShrink: 0, fontSize: 13, color: "#1f2937" }}>
                        <Num>{r.count}</Num> positions, <Num>#{fmt(r.firstCounter)}</Num> to <Num>#{fmt(r.lastCounter)}</Num>
                      </span>
                    </div>
                    <RecurrenceTrack positions={r.positions} range={s.range} timeline={s.timeline} />
                  </div>
                ))}
                {s.totals.recurringDigests > s.recurrences.length && (
                  <Row label="More">{fmt(s.totals.recurringDigests - s.recurrences.length)} additional recurring digests in this range</Row>
                )}
              </Card>
            )}

          </>
        )}
      </div>
    </div>
  );
}
