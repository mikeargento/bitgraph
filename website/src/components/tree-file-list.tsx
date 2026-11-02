"use client";
// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * A tree's files on its root's proof page (2026-11-02): each file's own proof, in tree order, a batch of 2,000 at a
 * time from the list the drop kept under the root's position (api/tree-members?list=1). Names show only on the device
 * that made the drop (lib/file-cache.ts); anywhere else a file is shown by its hash. Renders nothing for a BitGraph
 * that is not a tree, or a tree made before the lists were kept.
 */

import { useEffect, useState } from "react";
import { getTreeNamesFromIDB } from "@/lib/file-cache";

const safe = (b64: string) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const toHex = (b64: string) => Array.from(atob(b64), (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");

export function TreeFileList({ digestB64, epochId, counter }: { digestB64: string; epochId: string; counter: string }) {
  const [chunks, setChunks] = useState<number[] | null>(null);
  const [rows, setRows] = useState<Array<{ index: number; digestB64: string }>>([]);
  const [names, setNames] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const q = `digest=${safe(digestB64)}&epoch=${safe(epochId)}&counter=${encodeURIComponent(counter)}&list=1`;

  const load = async (first: number) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/tree-members?${q}&first=${first}`);
      const j = r.ok ? ((await r.json()) as { first: number; digests: string[] }) : null;
      if (j) setRows((prev) => [...prev, ...j.digests.flatMap((d, i) => (d ? [{ index: j.first + i, digestB64: d }] : []))]);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    let cancelled = false;
    setChunks(null); setRows([]);
    void (async () => {
      const r = await fetch(`/api/tree-members?${q}`).catch(() => null);
      const j = r?.ok ? ((await r.json()) as { chunks?: number[] }) : null;
      if (cancelled || !j?.chunks?.length) return;
      setChunks(j.chunks);
      void getTreeNamesFromIDB(digestB64, counter).then((n) => { if (!cancelled) setNames(n); });
      await load(j.chunks[0]!);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  if (!chunks || rows.length === 0) return null;
  const next = chunks.find((c) => !rows.some((r) => r.index === c));
  const href = (d: string) => `/proof/${safe(d)}?counter=${encodeURIComponent(counter)}&epoch=${safe(epochId)}`;
  return (
    <div className="pv-row pv-tree-files">
      <div className="pv-row-label">Files in this tree</div>
      <ul className="plug-members">
        {rows.map((r) => (
          <li key={r.index} className="plug-member">
            <span className="plug-member-name">{names?.[r.index] ?? `${(r.index + 1).toLocaleString("en-US")}. ${toHex(r.digestB64).slice(0, 16)}…`}</span>
            <a href={href(r.digestB64)}>View proof</a>
          </li>
        ))}
      </ul>
      {next !== undefined && (
        <button type="button" className="pv-link-btn" disabled={loading} onClick={() => void load(next)}>
          {loading ? "Loading…" : `Show the next ${(2000).toLocaleString("en-US")}`}
        </button>
      )}
    </div>
  );
}
