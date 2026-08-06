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

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "0 20px 80px" }}>
      <h1 style={{ fontSize: "clamp(26px, 6vw, 32px)", fontWeight: 600, letterSpacing: "-0.03em", color: "#111827", margin: "8px 0 6px" }}>
        Your BitGraph Folder
      </h1>

      {rows === null ? (
        <>
          <p style={{ fontSize: "clamp(15px, 3.6vw, 17px)", color: "#374151", lineHeight: 1.5, margin: "0 0 28px", textWrap: "balance" }}>
            Every recording in your folder, with its picture, checked against the ledger. Nothing is uploaded: the folder is read here on your device.
          </p>
          <div style={{ height: "clamp(254px, 42vw, 340px)" }}>
            <FileDrop
              multiple
              onFolder={handleFolder}
              onFolderScan={(files, done) => setWalkCount(done ? null : files)}
              onFiles={() => { /* a loose file is not a folder; the home page takes those */ }}
              headline="Open your BitGraph folder"
              hint={walkCount !== null
                ? `Reading… ${walkCount.toLocaleString()} file${walkCount === 1 ? "" : "s"}`
                : "Drag a folder."}
              subhint="It is read here. Nothing is uploaded."
            />
          </div>
          {/* The page is otherwise blank for anyone who has not installed the
              Folder yet, and blank pages do not explain themselves. */}
          <p style={{ marginTop: 26, fontSize: 14, color: "#4b5563", lineHeight: 1.6 }}>
            Do not have the folder yet?{" "}
            <a href={DOWNLOAD} className="bg-arrow-link" style={{ color: "#0065A4", fontWeight: 600, textDecoration: "none" }}>
              Download BitGraph Folder for macOS <span className="arrow" aria-hidden>&rarr;</span>
            </a>
          </p>
        </>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
