"use client";

/* The folder's Roll, extracted so it has more than one address: the home
 * page renders it for a one-off drop, and /folder renders it for the folder
 * you keep. Everything here is a READ of bytes already on the machine.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { isUnchecked, type ExportCheckResult } from "@/lib/folder-check";

// Compact recorded time for a result row, e.g. "Jul 17, 9:22 PM" — the same
// format the Roll's rows use, so the two lists read as one system.
export const fmtRowWhen = (ms?: number | null) =>
  ms ? new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

/* ── The folder's Roll — the viewer a dropped BitGraph folder loads into.
   The Folder generates no browsing pages of its own (1.9.0); this is where a
   folder is browsed AND checked, in one surface the site renders. Day
   grouping and causal order are the sheet's exact keys, computed here from
   the exports' own proof.json and witness files; thumbnails are object URLs
   over the dropped bytes, never uploaded, revoked on unmount. ── */

const IMAGE_THUMB_EXT = ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "svg"];

export function CheckedRoll({ checked, onOpen, cachedThumbs, onThumb, cachedComplete, heading = "BitGraph Roll" }: {
  checked: ExportCheckResult[];
  onOpen: (r: ExportCheckResult) => void;
  /** The list's own title. null on /folder, where the page's h1 already
   *  names it: two headings called "BitGraph Roll" and "Your BitGraph
   *  Folder", stacked, made one thing look like two. */
  heading?: string | null;
  /** digestUrlSafe -> object URL, for rows whose bytes are not in hand
   *  (a remembered folder renders from these until it is re-read). */
  cachedThumbs?: Map<string, string>;
  /** Emitted once per thumbnail generated from real bytes, so a caller can
   *  keep it. `blob` is the few-KB JPEG for the 48px cell; `preview` is the
   *  ~512px JPEG a proof page shows when the bytes are not in hand. Neither
   *  is the original. */
  onThumb?: (digestUrlSafe: string, blob: Blob, preview?: Blob) => void;
  /** Digests whose thumb AND preview are already remembered. Decoding a
   *  2,000-photo folder again to remake pictures we have is most of what
   *  made a re-sync feel endless, so these are skipped entirely. */
  cachedComplete?: Set<string>;
}) {
  // Causal order, newest first: lower-bound block, then counter; unsealed
  // (no block) lead. The same sort every surface in the product uses.
  const ordered = useMemo(() => [...checked].sort((x, y) => {
    const xb = x.block ?? 0, yb = y.block ?? 0;
    if (!xb !== !yb) return xb ? 1 : -1;
    if (xb !== yb) return yb - xb;
    return (parseInt(y.counter || "0", 10) || 0) - (parseInt(x.counter || "0", 10) || 0);
  }), [checked]);

  // Day groups along the causal walk: unsealed under today, ts-less sealed
  // rows inherit the open group. Local days, never UTC epochs.
  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; short: string; rows: ExportCheckResult[] }> = [];
    let openKey: string | null = null;
    for (const r of ordered) {
      const when = !r.block ? new Date() : r.ts ? new Date(r.ts * 1000) : null;
      if (when !== null) {
        const key = `${when.getFullYear()}-${when.getMonth()}-${when.getDate()}`;
        if (key !== openKey) {
          openKey = key;
          out.push({
            key,
            label: when.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }),
            short: when.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
            rows: [],
          });
        }
      }
      if (!out.length) {
        const now = new Date();
        out.push({
          key: `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`,
          label: now.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }),
          short: now.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
          rows: [],
        });
      }
      out[out.length - 1].rows.push(r);
    }
    return out;
  }, [ordered]);

  // The Roll's navigation, exactly (Mike: "i thought maybe you could just
  // use Roll exactly for this"): the default view is every recording newest
  // first, and past days are walked one at a time with dated steppers - not
  // scrolled past under inline headers. `day` is which slice is open; null
  // is the live view. Steppers move between RECORDED days (a folder is
  // sparse where the ledger is continuous - the same knowing deviation the
  // old sheet made).
  const [day, setDay] = useState<string | null>(null);
  // The shelf: the Roll's /rolls month-grid calendar, client-side. Not
  // important at two days, load-bearing at two hundred (Mike's call).
  const [shelf, setShelf] = useState(false);
  const dayIdx = day === null ? -1 : groups.findIndex((g) => g.key === day);
  const view = day === null ? null : groups[dayIdx] ?? null;
  const shownGroups = view ? [view] : groups;
  const older = day === null ? (groups.length > 1 ? groups[1] : null) : groups[dayIdx + 1] ?? null;
  const newer = day === null ? null : dayIdx > 0 ? groups[dayIdx - 1] : null;

  const stepLink: React.CSSProperties = { color: "#0065A4", fontWeight: 600, fontSize: 13.5, textDecoration: "none", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };

  // Real small thumbnails, generated from the dropped bytes: decode once,
  // draw at 96px (2x the 48px box), keep only the few-KB blob. An object URL
  // straight over the original was tried and was wrong twice over — a 26MB
  // photo per 48px cell, and the full-res decode never even started under
  // loading="lazy" here.
  //
  // Keyed by the FILE, not the row: verdicts stream in and replace the row
  // array many times per drop, and a [checked]-owned map restarted the whole
  // generation on every verdict (24 restarts for 24 exports — thumbs never
  // finished until the last one). The File objects are stable across
  // updates, so each thumb is made once, whichever rerun gets to it; URLs
  // are revoked only on unmount.
  const [thumbs, setThumbs] = useState<Map<File, string>>(() => new Map());
  const thumbMapRef = useRef<Map<File, string>>(new Map());
  useEffect(() => () => { for (const u of thumbMapRef.current.values()) URL.revokeObjectURL(u); }, []);
  // The caller's onThumb and cachedComplete in refs, so an inline lambda or a
  // rebuilt Set cannot restart the generation loop every render.
  const onThumbRef = useRef(onThumb);
  onThumbRef.current = onThumb;
  const cachedCompleteRef = useRef(cachedComplete);
  cachedCompleteRef.current = cachedComplete;

  useEffect(() => {
    let dead = false;
    // ⚠️ VISIBLE-FIRST, FOUR AT A TIME. This ran one file at a time in
    // DISCOVERY order, and on a 2,000-photo folder that is minutes of
    // decoding delivered in an order nobody is looking at: thumbs landed
    // scattered down the page while the rows on screen sat as type labels
    // (which read as "unpopulated", and got asked about). The queue is now
    // the exact order the roll renders, so pictures fill from the top of
    // what you see, and a small pool cuts the total wait without pinning
    // the main thread the way unlimited decodes would.
    let next = 0;
    const worker = async () => {
      while (!dead) {
        const i = next++;
        if (i >= ordered.length) return;
        const r = ordered[i];
        const f = r.artifactFile;
        if (!f || thumbMapRef.current.has(f)) continue;
        // Already remembered in full (cell thumb + proof-page preview): the
        // cachedThumbs URL renders the cell, so decoding again buys nothing.
        if (r.digestUrlSafe && cachedCompleteRef.current?.has(r.digestUrlSafe)) continue;
        const ext = f.name.slice(f.name.lastIndexOf(".") + 1).toLowerCase();
        if (!IMAGE_THUMB_EXT.includes(ext)) continue;
        try {
          const bmp = await createImageBitmap(f);
          // One decode, two sizes: the 96px cell thumb (2x the 48px box) and
          // a ~512px preview for the proof page. The bitmap is the expensive
          // part; the second draw is nearly free next to it.
          const drawScaled = async (w: number, q: number): Promise<Blob | null> => {
            const width = Math.min(w, bmp.width);
            const h = Math.max(1, Math.round((bmp.height / bmp.width) * width));
            const c = document.createElement("canvas");
            c.width = width; c.height = h;
            c.getContext("2d")?.drawImage(bmp, 0, 0, width, h);
            return new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", q));
          };
          const blob = await drawScaled(96, 0.75);
          const preview = (await drawScaled(512, 0.72)) ?? undefined;
          bmp.close();
          if (!blob || dead) continue;
          if (thumbMapRef.current.has(f)) continue; // a racing rerun got here first
          thumbMapRef.current.set(f, URL.createObjectURL(blob));
          setThumbs(new Map(thumbMapRef.current));
          if (r.digestUrlSafe) onThumbRef.current?.(r.digestUrlSafe, blob, preview);
        } catch { /* a row without a thumb shows its type label */ }
      }
    };
    void Promise.all(Array.from({ length: 4 }, worker));
    return () => { dead = true; };
  }, [ordered]);

  const okCount = checked.filter((c) => c.ok === true).length;
  const pending = checked.filter((c) => c.ok === null).length;
  // Rows the ledger could not be asked about. Counted apart from the failures
  // on purpose: they are not evidence against the recording, and lumping them
  // in is how a throttled sweep once reported 448 of this folder's recordings
  // as not matching when every one of them was on the ledger.
  const uncheckedCount = checked.filter(isUnchecked).length;
  const failCount = checked.length - okCount - pending - uncheckedCount;

  return (
    <div>
      {/* heading === null hands the WHOLE header to the caller: /folder has
          its own h1 and count line, and stacking a second title and a second
          count under them was three sizes of text saying two things. The
          day-view line survives regardless, because only this component
          knows which day is open. */}
      {heading && (
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", color: "#111827" }}>
          {heading}
        </div>
      )}
      {(heading || view) && (
        <div style={{ fontSize: 13, color: "#4b5563", marginTop: 2, marginBottom: 10 }}>
          {view
            ? `The recordings for ${view.label}.`
            : `${checked.length.toLocaleString()} recording${checked.length === 1 ? "" : "s"} from your folder, newest first.`}
        </div>
      )}
      <div style={{ background: "#fff", border: "1px solid #d0d5dd", padding: "18px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 10 }}>
        {pending > 0 ? (
          <span style={{ fontSize: 15, fontWeight: 700, color: "#111827", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            Checking {checked.length - pending} of {checked.length}&hellip;
          </span>
        ) : (
          <span style={{ fontSize: 15, fontWeight: 700, color: "#111827", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {okCount} of {checked.length} {okCount === 1 ? "matches" : "match"} the ledger
          </span>
        )}
        <span style={{ display: "flex", gap: 14, whiteSpace: "nowrap" }}>
          {failCount > 0 && (
            <span style={{ fontSize: 13, fontWeight: 600, color: "#dc2626" }}>
              {failCount} {failCount === 1 ? "does" : "do"} not
            </span>
          )}
          {uncheckedCount > 0 && (
            <span style={{ fontSize: 13, fontWeight: 600, color: "#6b7280" }}>
              {uncheckedCount} not checked
            </span>
          )}
        </span>
      </div>
      {groups.length > 1 && !shelf && (
        <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, margin: "14px 0 4px" }}>
          <span style={{ display: "flex", gap: 20 }}>
            {older && (
              <button type="button" style={stepLink} onClick={() => setDay(older.key)}>
                <span aria-hidden>&larr;</span> {older.short}
              </button>
            )}
            {newer && (
              <button type="button" style={stepLink} onClick={() => setDay(newer.key)}>
                {newer.short} <span aria-hidden>&rarr;</span>
              </button>
            )}
          </span>
          <span style={{ display: "flex", gap: 20, marginLeft: "auto" }}>
            {view && (
              <button type="button" style={stepLink} onClick={() => setDay(null)}>
                All recordings <span aria-hidden>&rarr;</span>
              </button>
            )}
            <button type="button" style={stepLink} onClick={() => setShelf(true)}>
              All rolls <span aria-hidden>&rarr;</span>
            </button>
          </span>
        </nav>
      )}
      {shelf && (
        <CheckedShelf
          groups={groups}
          onPick={(key) => { setDay(key); setShelf(false); }}
          onLive={() => { setDay(null); setShelf(false); }}
        />
      )}
      {!shelf && shownGroups.map((g) => (
        <div key={g.key} style={{ marginTop: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {g.rows.map((r, i) => {
              const clickable = r.onLedger && !!r.digestUrlSafe;
              const thumb = (r.artifactFile ? thumbs.get(r.artifactFile) : undefined)
                ?? (r.digestUrlSafe ? cachedThumbs?.get(r.digestUrlSafe) : undefined);
              const ext = r.fileName ? r.fileName.slice(r.fileName.lastIndexOf(".") + 1).toUpperCase() : "";
              return (
                <div key={r.dirName + i} className="bitgraph-file-card" data-clickable={clickable} style={{ border: "1px solid #d0d5dd", animation: `slideIn 0.2s ease-out ${Math.min(i, 12) * 0.03}s both` }}>
                  <div
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? () => onOpen(r) : undefined}
                    onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(r); } } : undefined}
                    className={`bitgraph-result-row${clickable ? " bitgraph-file-row" : ""}`}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px 10px 10px", cursor: clickable ? "pointer" : "default" }}
                  >
                    {/* The small thumb, from the dropped bytes themselves. A
                        non-image shows its type the way the sheet's cells
                        did; square corners, the card's own border. */}
                    {thumb ? (
                      <img src={thumb} alt="" style={{ width: 48, height: 48, objectFit: "cover", flexShrink: 0, border: "1px solid #e2e5e9", display: "block" }} />
                    ) : (
                      <span style={{ width: 48, height: 48, flexShrink: 0, border: "1px solid #e2e5e9", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#6b7280", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                        {ext.slice(0, 4)}
                      </span>
                    )}
                    {/* An unchecked row keeps the ordinary blue: nothing is
                        wrong with it, we simply did not get an answer. */}
                    <span style={{ flexShrink: 0, fontSize: 14, fontWeight: 700, color: r.ok === false && !isUnchecked(r) ? "#dc2626" : "#0065A4", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                      {r.counter != null ? `#${Number(r.counter).toLocaleString()}` : "—"}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.fileName ?? r.dirName}
                    </span>
                    <span style={{ flexShrink: 0, fontSize: 12.5, color: "#4b5563", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }} className="bg-roll-when">
                      {fmtRowWhen(r.ts ? r.ts * 1000 : r.writeTime)}
                    </span>
                    <span style={{ flexShrink: 0, maxWidth: "40%", fontSize: 12.5, fontWeight: 600, color: r.ok === true ? "#0065A4" : r.ok === false ? (isUnchecked(r) ? "#6b7280" : "#dc2626") : "#9ca3af", textAlign: "right" }}>
                      {r.ok === true ? "matches the ledger" : r.ok === false ? r.failure : "checking\u2026"}
                    </span>
                    {clickable && (
                      <span aria-label="Open" style={{ display: "inline-flex", flexShrink: 0, color: "#0065A4" }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="square" strokeLinejoin="miter"><path d="M9 6 L15 12 L9 18" /></svg>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function CheckedShelf({ groups, onPick, onLive }: {
  groups: Array<{ key: string; label: string; short: string; rows: ExportCheckResult[] }>;
  onPick: (key: string) => void;
  onLive: () => void;
}) {
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const recorded = new Map(groups.map((g) => [g.key, g]));
  const oldest = groups.length
    ? groups[groups.length - 1].key.split("-").map((x) => parseInt(x, 10))
    : [now.getFullYear(), now.getMonth()];
  const months: Array<{ label: string; y: number; m: number }> = [];
  for (let y = now.getFullYear(), m = now.getMonth();
       y > oldest[0] || (y === oldest[0] && m >= oldest[1]);
       m === 0 ? (y--, m = 11) : m--) {
    months.push({ label: new Date(y, m, 1).toLocaleDateString(undefined, { year: "numeric", month: "long" }), y, m });
  }
  const cell: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", aspectRatio: "1", fontSize: 13 };
  const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";
  return (
    <div>
      {months.map(({ label, y, m }) => {
        const daysIn = new Date(y, m + 1, 0).getDate();
        const lead = new Date(y, m, 1).getDay();
        return (
          <section key={label} style={{ marginTop: 24, maxWidth: 340 }}>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em", color: "#111827", marginBottom: 8 }}>{label}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", fontFamily: mono, fontVariantNumeric: "tabular-nums" }}>
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <div key={`h${i}`} style={{ ...cell, fontSize: 10.5, color: "#9ca3af", aspectRatio: "auto", paddingBottom: 4 }}>{d}</div>
              ))}
              {Array.from({ length: lead }, (_, i) => <div key={`b${i}`} style={cell} />)}
              {Array.from({ length: daysIn }, (_, i) => {
                const d = i + 1;
                const key = `${y}-${m}-${d}`;
                if (key === todayKey) {
                  return (
                    <button key={key} type="button" onClick={onLive} aria-label="Today"
                      style={{ ...cell, color: "#0065A4", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontFamily: mono, boxShadow: "inset 0 0 0 1px #0065A4" }}>
                      {d}
                    </button>
                  );
                }
                if (recorded.has(key)) {
                  return (
                    <button key={key} type="button" onClick={() => onPick(key)}
                      className="bitgraph-shelf-day"
                      style={{ ...cell, color: "#0065A4", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontFamily: mono }}>
                      {d}
                    </button>
                  );
                }
                return <div key={key} style={{ ...cell, color: "#c7ccd1" }}>{d}</div>;
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
