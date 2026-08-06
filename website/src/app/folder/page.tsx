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
  type WalkedFile, type ExportCheckResult, type DirHandle, type VerdictMemo,
} from "@/lib/folder-check";
import {
  readCachedRows, writeCachedRows, writeCachedThumb, clearCachedRows,
  saveDirHandle, readDirHandle,
  type CachedRow,
} from "@/lib/folder-cache";
import { cacheArtifactToIDB } from "@/lib/file-cache";

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
        // The matched file's fingerprint, which is what lets the NEXT sync
        // skip re-hashing this recording (see VerdictMemo). Only a matched
        // file's identity is worth remembering.
        size: r.matchedFile?.size ?? null,
        mtime: r.matchedFile?.lastModified ?? null,
      }
    : null;

/** The remembered verdicts a sync may honor: ok rows with a full fingerprint. */
const memoFromCache = (cached: CachedRow[]): Map<string, VerdictMemo> => {
  const memo = new Map<string, VerdictMemo>();
  for (const c of cached) {
    if (c.ok === true && c.fileName && typeof c.size === "number" && typeof c.mtime === "number") {
      memo.set(c.digest, { name: c.fileName, size: c.size, mtime: c.mtime, writeTime: c.writeTime });
    }
  }
  return memo;
};

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
  const pendingThumbs = useRef<Map<string, { thumb: Blob; preview?: Blob }>>(new Map());
  const rowsPersisted = useRef(false);
  // The remembered verdicts a sync may honor (ok rows whose file fingerprint
  // is known), and the digests whose pictures are already stored in full.
  // Together they are why re-syncing a settled folder is seconds, not
  // minutes: unchanged files are neither re-hashed nor re-decoded.
  const memoRef = useRef<Map<string, VerdictMemo>>(new Map());
  const cachedCompleteRef = useRef<Set<string>>(new Set());

  useEffect(() => () => { for (const u of thumbUrls.current) URL.revokeObjectURL(u); }, []);

  // What the page opens with when the folder has been handed over before.
  useEffect(() => {
    let dead = false;
    void (async () => {
      const cached = await readCachedRows();
      if (dead) return;
      memoRef.current = memoFromCache(cached);
      cachedCompleteRef.current = new Set(cached.filter((c) => c.thumb && c.preview).map((c) => c.digest));
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
          for (const [d, b] of pendingThumbs.current) void writeCachedThumb(d, b.thumb, b.preview);
          pendingThumbs.current.clear();
        });
        // The verdicts that just landed are next sync's memo.
        memoRef.current = memoFromCache(r.map(cacheFromRow).filter((x): x is CachedRow => !!x));
      },
    }, "", memoRef.current);
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
    // When the MATCHED bytes are in hand (a sync this visit), hand them to
    // the proof page the same way the home drop does, so it opens WITH the
    // picture. Only the matched file: caching a non-matching candidate under
    // the digest would just make the proof page hash it and throw it out.
    // Fire-and-forget: navigation does not wait, the page polls briefly.
    const digestB64 = r.proof?.artifact.digestB64;
    if (r.matchedFile && digestB64) {
      void cacheArtifactToIDB(r.matchedFile, digestB64).catch(() => { /* preview covers it */ });
    }
    const q = r.counter
      ? `?counter=${encodeURIComponent(r.counter)}${r.epochUrlSafe ? `&epoch=${encodeURIComponent(r.epochUrlSafe)}` : ""}`
      : "";
    router.push(`/proof/${r.digestUrlSafe}${q}`);
  }, [router]);

  const linkStyle: React.CSSProperties = {
    background: "none", border: "none", padding: 0, cursor: "pointer",
    color: "#0065A4", fontWeight: 500, fontFamily: "inherit", fontSize: 13,
    textDecoration: "none",
  };

  // The cache answers in milliseconds; a blank beat is invisible, either
  // wrong state for that beat is not.
  if (rows === undefined) return null;

  /* ── ONE layout, synced or not (Mike: "this page should always look like
     this, not the homepage"). The same column as /roll, to the pixel: 90% up
     to 800, 40px under the nav. Before a sync the drop box simply sits first,
     where the roll will be — no hero, no tagline, nothing to graduate from.
     The hero-mirror empty state was tried and retired the same week. ── */
  return (
    <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "40px 0 80px", animation: "fadeIn .3s ease-out" }}>
      {/* fadeIn's keyframes live per-page (the roll defines its own); this
          page needs its own copy or the animation is silently nothing. */}
      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }`}</style>
      <h1 style={{ fontSize: "clamp(26px, 6vw, 32px)", fontWeight: 600, letterSpacing: "-0.03em", color: "#111827", margin: "0 0 4px" }}>
        Your BitGraph Folder
      </h1>
      {rows === null ? (
        <>
          {/* File-neutral on purpose: the folder holds photos, PDFs, video,
              text — a recording is a recording. */}
          <p style={{ fontSize: 14, color: "#4b5563", margin: "0 0 18px", lineHeight: 1.6 }}>
            Every recording in your folder, checked against the ledger.
          </p>
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
          <p style={{ fontSize: 13, margin: "18px 0 0", lineHeight: 1.6 }}>
            <a href={DOWNLOAD} style={linkStyle}>
              Download BitGraph Folder for macOS <span aria-hidden>&rarr;</span>
            </a>
          </p>
          <p style={{ fontSize: 13, margin: "6px 0 0", lineHeight: 1.6 }}>
            <Link href="/docs/folder" style={linkStyle}>
              How the Folder works <span aria-hidden>&rarr;</span>
            </Link>
          </p>
        </>
      ) : (
        <>
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
            cachedComplete={cachedCompleteRef.current}
            onThumb={(digest, blob, preview) => {
              if (rowsPersisted.current) void writeCachedThumb(digest, blob, preview);
              else pendingThumbs.current.set(digest, { thumb: blob, preview });
            }}
          />
        </>
      )}
    </div>
  );
}
