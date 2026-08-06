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
  discoverDrop, startFolderCheck,
  type WalkedFile, type ExportCheckResult,
} from "@/lib/folder-check";
import {
  readCachedRows, writeCachedRows, writeCachedThumb, clearCachedRows,
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
  const [rows, setRows] = useState<ExportCheckResult[] | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [checking, setChecking] = useState(false);
  const [walkCount, setWalkCount] = useState<number | null>(null);
  const [thumbs, setThumbs] = useState<Map<string, string>>(() => new Map());
  const thumbUrls = useRef<string[]>([]);

  useEffect(() => () => { for (const u of thumbUrls.current) URL.revokeObjectURL(u); }, []);

  // What the page opens with when the folder has been handed over before.
  useEffect(() => {
    let dead = false;
    void (async () => {
      const cached = await readCachedRows();
      if (dead || !cached.length) return;
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

  const handleFolder = useCallback((walked: WalkedFile[]) => {
    const scan = discoverDrop(walked);
    setWalkCount(null);
    if (!scan.exports.length) { setChecking(false); return; }
    setFromCache(false);
    setChecking(true);
    const { done } = startFolderCheck(scan.exports, {
      onRows: (r) => setRows(r),
      onUpdate: (i, row) => setRows((prev) => (prev ? prev.map((x, n) => (n === i ? row : x)) : prev)),
      onDone: (r) => {
        setRows(r);
        setChecking(false);
        // Remembered only once every verdict is in, so a half-checked pass
        // cannot be what the page opens with next time.
        void writeCachedRows(r.map(cacheFromRow).filter((x): x is CachedRow => !!x));
      },
    });
    void done.catch(() => setChecking(false));
  }, []);

  const forget = useCallback(async () => {
    await clearCachedRows();
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
                onFolderScan={(files, done) => setWalkCount(done ? null : files)}
                onFiles={() => { /* a loose file is not a folder; the home page takes those */ }}
                headline="Open your folder"
                hint={walkCount !== null
                  ? `Reading… ${walkCount.toLocaleString()} file${walkCount === 1 ? "" : "s"}`
                  : "Drag it in."}
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
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "0 20px 80px" }}>
      <h1 style={{ fontSize: "clamp(26px, 6vw, 32px)", fontWeight: 600, letterSpacing: "-0.03em", color: "#111827", margin: "8px 0 6px" }}>
        Your BitGraph Folder
      </h1>
      <p style={{ fontSize: 13, color: "#4b5563", margin: "0 0 14px", lineHeight: 1.6 }}>
        {fromCache
          ? "Remembered from the last time you opened your folder. Open it again to check these against the ledger and pick up anything new."
          : checking
          ? "Checking each recording against the ledger."
          : "Checked against the ledger."}
        {" "}
        <button type="button" style={linkStyle} onClick={() => { setRows(null); setFromCache(false); }}>
          Open your folder
        </button>
        {" · "}
        <button type="button" style={linkStyle} onClick={() => void forget()}>
          Forget it
        </button>
      </p>
      <CheckedRoll
        checked={rows}
        onOpen={openRow}
        heading={null}
        cachedThumbs={thumbs}
        onThumb={(digest, blob) => void writeCachedThumb(digest, blob)}
      />
    </div>
  );
}
