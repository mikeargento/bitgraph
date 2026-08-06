"use client";

/* ── /folder — your BitGraph folder, viewed.
 *
 * The Folder stopped generating browsing pages in 1.9.0 on the bargain that
 * the site would be the browsing layer, and it has been: drop the folder on
 * the home page and you get the roll. What it never had was an ADDRESS. This
 * is it, and it is the one surface in the product that is about YOUR
 * recordings rather than the ledger's.
 *
 * ⚠️ Deliberately NOT part of /roll. That page is the ledger stream, every
 * recording anyone has made, and mixing one person's thumbnails into it
 * would put pictures on a thin scattering of rows and leave the rest blank.
 * The Roll is the ledger; this is your folder. Two different things that had
 * been sharing a name.
 *
 * Nothing is uploaded here, exactly as everywhere else: the folder is read
 * in the browser, digests are looked up, and the bytes never move. ── */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FileDrop } from "@/components/file-drop";
import { CheckedRoll } from "@/components/folder-roll";
import {
  discoverDrop, startFolderCheck, walkDirectoryHandle,
  type WalkedFile, type ExportCheckResult, type DirHandle,
} from "@/lib/folder-check";
import {
  readCachedRows, writeCachedRows, writeCachedThumb, clearCachedRows,
  saveDirHandle, readDirHandle,
  type CachedRow,
} from "@/lib/folder-cache";

const DOWNLOAD = "https://github.com/mikeargento/bitgraph/releases/latest/download/BitGraphFolder.pkg";

/** A remembered row, shaped like a checked one so the roll renders it
 *  unchanged. The Files are absent by definition: this row exists precisely
 *  because the bytes are not in hand. */
function rowFromCache(c: CachedRow): ExportCheckResult {
  return {
    dirName: c.dirName,
    fileName: c.fileName,
    matchedFile: null,
    artifactFile: null,
    block: c.block,
    ts: c.ts,
    proof: null,
    counter: c.counter,
    epochUrlSafe: c.epochUrlSafe,
    digestUrlSafe: c.digest,
    writeTime: c.writeTime,
    onLedger: c.ok === true,
    ok: c.ok,
    failure: c.failure,
  };
}

const cacheFromRow = (r: ExportCheckResult): CachedRow | null =>
  r.digestUrlSafe
    ? {
        digest: r.digestUrlSafe,
        dirName: r.dirName,
        fileName: r.fileName,
        counter: r.counter,
        epochUrlSafe: r.epochUrlSafe,
        block: r.block,
        ts: r.ts,
        writeTime: r.writeTime,
        ok: r.ok,
        failure: r.failure,
      }
    : null;

export default function FolderPage() {
  const router = useRouter();
  // undefined = the cache has not answered yet. Rendering the empty state
  // during that gap flashed the drop box at everyone whose folder was
  // remembered, which reads as the page forgetting and then remembering.
  const [rows, setRows] = useState<ExportCheckResult[] | null | undefined>(undefined);
  const [fromCache, setFromCache] = useState(false);
  const [checking, setChecking] = useState(false);
  const [walkCount, setWalkCount] = useState<number | null>(null);
  const [thumbs, setThumbs] = useState<Map<string, string>>(() => new Map());
  const thumbUrls = useRef<string[]>([]);
  // The stored permission slip: a Chromium directory handle from an earlier
  // drag or pick. Held in state so "Sync again" can use it; null everywhere
  // the browser cannot produce one, and syncing there stays a drag.
  const dirHandleRef = useRef<DirHandle | null>(null);
  // ⚠️ Thumbnails outrun the rows. A thumb generated mid-sync went straight
  // to writeCachedThumb, which attaches to a STORED row — and rows are only
  // stored once the last verdict lands, minutes later on a big folder. So
  // most thumbs made during a sync were silently dropped, and every later
  // visit showed the same gaps ("the thumb issue persists"). They wait here
  // until the rows are down, then flush.
  const pendingThumbs = useRef<Map<string, Blob>>(new Map());
  const rowsPersisted = useRef(false);

  useEffect(() => () => { for (const u of thumbUrls.current) URL.revokeObjectURL(u); }, []);

  // What the page opens with when the folder has been handed over before.
  useEffect(() => {
    let dead = false;
    void (async () => {
      const cached = await readCachedRows();
      if (dead) return;
      if (!cached.length) { setRows(null); return; } // answered: nothing remembered
      const urls = new Map<string, string>();
      for (const c of cached) {
        if (!c.thumb) continue;
        const u = URL.createObjectURL(c.thumb);
        thumbUrls.current.push(u);
        urls.set(c.digest, u);
      }
      setThumbs(urls);
      setRows(cached.map(rowFromCache));
      setFromCache(true);
    })();
    return () => { dead = true; };
  }, []);

  // The stored handle, and the quiet resync it allows. queryPermission
  // answering "granted" with no prompt means the person told Chrome to allow
  // this site's reads on every visit, so the page can do exactly what it has
  // permission to do: read the folder again and bring the roll up to date,
  // remembered rows standing until fresh ones replace them. Anything short
  // of "granted" waits for the Sync again CLICK, because requestPermission
  // must ride a user gesture.
  useEffect(() => {
    let dead = false;
    void (async () => {
      const h = (await readDirHandle()) as DirHandle | null;
      if (dead || !h) return;
      dirHandleRef.current = h;
      try {
        const q = await h.queryPermission?.({ mode: "read" });
        if (q !== "granted" || dead) return;
        const walked = await walkDirectoryHandle(h, (n) => { if (!dead) setWalkCount(n); });
        if (dead) return;
        setWalkCount(null);
        handleFolderRef.current?.(walked);
      } catch { /* the remembered rows stand */ }
    })();
    return () => { dead = true; };
  }, []);

  const handleFolderRef = useRef<((walked: WalkedFile[]) => void) | null>(null);
  const handleFolder = useCallback((walked: WalkedFile[]) => {
    const scan = discoverDrop(walked);
    setWalkCount(null);
    if (!scan.exports.length) { setChecking(false); return; }
    rowsPersisted.current = false;
    pendingThumbs.current.clear();
    setFromCache(false);
    setChecking(true);
    const { done } = startFolderCheck(scan.exports, {
      onRows: (r) => setRows(r),
      onUpdate: (i, row) => setRows((prev) => (prev ? prev.map((x, n) => (n === i ? row : x)) : prev)),
      onDone: (r) => {
        setRows(r);
        setChecking(false);
        // Remembered only once every verdict is in, so a half-checked pass
        // cannot be what the page opens with next time. The thumbs that were
        // generated while the verdicts streamed flush right behind the rows
        // they belong to.
        void writeCachedRows(r.map(cacheFromRow).filter((x): x is CachedRow => !!x)).then(() => {
          rowsPersisted.current = true;
          for (const [d, b] of pendingThumbs.current) void writeCachedThumb(d, b);
          pendingThumbs.current.clear();
        });
      },
    });
    void done.catch(() => setChecking(false));
  }, []);
  handleFolderRef.current = handleFolder;

  /** Sync without a drag when the stored handle allows it; otherwise back to
   *  the drop box. The click IS the user gesture requestPermission needs. */
  const syncAgain = useCallback(async () => {
    const h = dirHandleRef.current;
    if (h) {
      try {
        let perm = (await h.queryPermission?.({ mode: "read" })) ?? "prompt";
        if (perm !== "granted") perm = (await h.requestPermission?.({ mode: "read" })) ?? "denied";
        if (perm === "granted") {
          const walked = await walkDirectoryHandle(h, (n) => setWalkCount(n));
          setWalkCount(null);
          handleFolder(walked);
          return;
        }
      } catch { /* the drag still works */ }
    }
    setRows(null);
    setFromCache(false);
  }, [handleFolder]);

  const forget = useCallback(async () => {
    await clearCachedRows();
    dirHandleRef.current = null;
    for (const u of thumbUrls.current) URL.revokeObjectURL(u);
    thumbUrls.current = [];
    setThumbs(new Map());
    setRows(null);
    setFromCache(false);
  }, []);

  const openRow = useCallback((r: ExportCheckResult) => {
    if (!r.digestUrlSafe) return;
    const q = r.counter
      ? `?counter=${encodeURIComponent(r.counter)}${r.epochUrlSafe ? `&epoch=${encodeURIComponent(r.epochUrlSafe)}` : ""}`
      : "";
    router.push(`/proof/${r.digestUrlSafe}${q}`);
  }, [router]);

  const linkStyle: React.CSSProperties = {
    background: "none", border: "none", padding: 0, cursor: "pointer",
    color: "#0065A4", fontWeight: 500, fontFamily: "inherit", fontSize: 13,
  };

  // The cache answers in milliseconds; a blank beat is invisible, either
  // wrong state for that beat is not.
  if (rows === undefined) return null;

  return rows === null ? (
    /* ── First arrival: the home page's hero, pointed at the folder.
       Mike: "before you have synced, it should mirror the homepage style."
       Same tagline scale, same centered stack, same camera box, same
       stacked arrow links. The style rules are copied from page.tsx's hero
       block (they are page-mounted <style> tags there, so there is nothing
       shared to import); if the home hero's numbers change, change these. ── */
    <>
      <style>{`
        @keyframes slideIn { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
        .bgf-wrap { width: 90%; max-width: 800px; margin: 0 auto; padding: max(52px, calc(50dvh - 318px)) 0 32px; display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 24px; min-height: calc(100dvh - 72px); }
        @media (min-width: 769px) { .bgf-wrap { padding-top: max(52px, calc(50dvh - 386px)); } }
        .bgf-hero { display: flex; flex-direction: column; align-items: stretch; gap: clamp(26px, 4.5vw, 40px); }
        .bgf-head { display: flex; flex-direction: column; align-items: stretch; gap: clamp(12px, 2.5vw, 16px); }
        .bgf-tagline { text-align: center; font-size: clamp(24px, 9.3vw, 54px); font-weight: 800; letter-spacing: -0.035em; line-height: 1.02; color: #111827; margin: 0; }
        .bgf-why { max-width: 600px; margin: 0 auto; text-align: center; font-size: clamp(15px, 3.6vw, 18px); line-height: 1.4; color: #1f2937; font-weight: 500; letter-spacing: -0.012em; text-wrap: balance; }
        .bgf-why p { margin: 0; }
        .bgf-links { text-align: center; }
        .bgf-links .second { margin-top: 10px; }
        .bgf-link { appearance: none; border: none; background: none; cursor: pointer; font-family: inherit; font-size: 14.5px; font-weight: 600; letter-spacing: -0.01em; color: #0065A4; display: inline-flex; align-items: center; gap: 7px; padding: 4px 6px; text-decoration: none; }
        .bgf-link .arrow { transition: transform .18s ease; }
        @media (hover: hover) { .bgf-link:hover .arrow { transform: translateX(3px); } }
        .bgf-link:focus-visible { outline: 2px solid #0065A4; outline-offset: 3px; }
      `}</style>
      <div className="bgf-wrap">
        <div className="bgf-hero" style={{ animation: "slideIn 0.3s ease-out" }}>
          <div className="bgf-head">
            <h1 className="bgf-tagline">Your BitGraph Folder.</h1>
            {/* File-neutral on purpose: the folder holds photos, PDFs, video,
                text — a recording is a recording. */}
            <div className="bgf-why">
              <p>Every recording in your folder, checked against the ledger.</p>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "clamp(26px, 4.5vw, 40px)" }}>
            <div className="bitgraph-camera">
              <FileDrop
                multiple
                onFolder={handleFolder}
                onFolderHandle={(h) => { dirHandleRef.current = h; void saveDirHandle(h); }}
                onFolderScan={(files, done) => setWalkCount(done ? null : files)}
                onFiles={() => { /* a loose file is not a folder; the home page takes those */ }}
                headline="Sync your folder"
                hint={walkCount !== null
                  ? `Reading… ${walkCount.toLocaleString()} file${walkCount === 1 ? "" : "s"}`
                  : "Open the BitGraph folder on your Desktop and drag Recordings here."}
                subhint="Read on your device. Nothing is uploaded."
              />
            </div>
            <div className="bgf-links">
              <a href={DOWNLOAD} className="bgf-link">
                Download BitGraph Folder for macOS <span className="arrow" aria-hidden>&rarr;</span>
              </a>
              <div className="second">
                <Link href="/docs/folder" className="bgf-link">
                  How the Folder works <span className="arrow" aria-hidden>&rarr;</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  ) : (
    /* The same column as /roll, to the pixel: 90% up to 800, 40px under the
       nav. The first cut used max-width alone with inner padding, which made
       this the one page whose text column was 760px with its own gutters. */
    <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "40px 0 80px", animation: "fadeIn .3s ease-out" }}>
      {/* fadeIn's keyframes live per-page (the roll defines its own); this
          branch needs its own copy or the animation is silently nothing. */}
      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }`}</style>
      <h1 style={{ fontSize: "clamp(26px, 6vw, 32px)", fontWeight: 600, letterSpacing: "-0.03em", color: "#111827", margin: "0 0 4px" }}>
        Your BitGraph Folder
      </h1>
      {/* One subtitle, carrying the count AND the state; the roll's own
          header is off (heading={null}) so nothing repeats it below. */}
      <p style={{ fontSize: 14, color: "#4b5563", margin: "0 0 4px", lineHeight: 1.6 }}>
        {walkCount !== null
          ? `Reading your folder… ${walkCount.toLocaleString()} file${walkCount === 1 ? "" : "s"}`
          : <>{rows.length.toLocaleString()} recording{rows.length === 1 ? "" : "s"}, newest first
        {fromCache
          ? ", remembered from last time."
          : checking
          ? ". Checking each against the ledger…"
          : ", checked against the ledger."}</>}
      </p>
      <p style={{ fontSize: 13, margin: "0 0 18px", lineHeight: 1.6 }}>
        <button type="button" style={linkStyle} onClick={() => void syncAgain()}>
          Sync again
        </button>
        {" · "}
        {/* Clears what this page remembers (rows + thumbnails, the local
            IndexedDB picture) and nothing else: the folder on disk and the
            ledger are untouched. "Forget it" made people ask what "it" was. */}
        <button type="button" style={linkStyle} onClick={() => void forget()}
          title="Clears what this page remembers. Your folder and the ledger are untouched.">
          Forget this folder
        </button>
      </p>
      <CheckedRoll
        checked={rows}
        onOpen={openRow}
        heading={null}
        cachedThumbs={thumbs}
        onThumb={(digest, blob) => {
          if (rowsPersisted.current) void writeCachedThumb(digest, blob);
          else pendingThumbs.current.set(digest, blob);
        }}
      />
    </div>
  );
}
