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

/** Tiny thumbs from in-hand bytes, for any list of dropped files: decode
 *  once, draw at 96px (2x the 48px cell), keep only the few-KB blob's object
 *  URL. Keyed by the FILE (stable across re-renders); URLs revoked on
 *  unmount. Four decodes in flight, in the caller's given order — pass files
 *  in render order so pictures fill from the top of what is on screen. */
export function useFileThumbs(files: Array<File | null | undefined>): Map<File, string> {
  const [thumbs, setThumbs] = useState<Map<File, string>>(() => new Map());
  const mapRef = useRef<Map<File, string>>(new Map());
  useEffect(() => () => { for (const u of mapRef.current.values()) URL.revokeObjectURL(u); }, []);
  // Re-run when the SET of files changes, not the array identity: result
  // arrays are rebuilt per verdict and restarting the loop each time is the
  // old 24-restarts bug.
  const key = files.filter(Boolean).length;
  useEffect(() => {
    let dead = false;
    const list = files.filter((f): f is File => !!f);
    let next = 0;
    const worker = async () => {
      while (!dead) {
        const i = next++;
        if (i >= list.length) return;
        const f = list[i];
        if (mapRef.current.has(f)) continue;
        const ext = f.name.slice(f.name.lastIndexOf(".") + 1).toLowerCase();
        if (!IMAGE_THUMB_EXT.includes(ext)) continue;
        try {
          const bmp = await createImageBitmap(f);
          const w = Math.min(96, bmp.width);
          const h = Math.max(1, Math.round((bmp.height / bmp.width) * w));
          const c = document.createElement("canvas");
          c.width = w; c.height = h;
          c.getContext("2d")?.drawImage(bmp, 0, 0, w, h);
          bmp.close();
          const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.75));
          if (!blob || dead || mapRef.current.has(f)) continue;
          mapRef.current.set(f, URL.createObjectURL(blob));
          setThumbs(new Map(mapRef.current));
        } catch { /* a row without a thumb shows its type label */ }
      }
    };
    void Promise.all(Array.from({ length: 4 }, worker));
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return thumbs;
}

/* The cachedThumbs / onThumb / cachedComplete plumbing that fed the /folder
   browser's IndexedDB memory was removed with that page (2026-08-07). This
   list renders drops whose bytes are in hand; thumbs are generated from
   those bytes and live for the visit. */
export function CheckedRoll({ checked, onOpen, heading = "BitGraph Roll" }: {
  checked: ExportCheckResult[];
  onOpen: (r: ExportCheckResult) => void;
  /** The list's own title. null lets a caller's page header own the top. */
  heading?: string | null;
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

  // Thumbs from the dropped bytes, in the roll's render order so pictures
  // fill from the top of what is on screen (see useFileThumbs).
  const thumbs = useFileThumbs(ordered.map((r) => r.artifactFile));

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
        /* The Roll's own title, at the one size every page title on the site
           uses (docs h1, /roll, /folder). */
        <div style={{ fontSize: "clamp(26px, 6vw, 32px)", fontWeight: 600, letterSpacing: "-0.03em", color: "#111827" }}>
          {heading}
        </div>
      )}
      {(heading || view) && (
        <div style={{ fontSize: 14, color: "#4b5563", marginTop: 2, marginBottom: 10 }}>
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
              const thumb = r.artifactFile ? thumbs.get(r.artifactFile) : undefined;
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
