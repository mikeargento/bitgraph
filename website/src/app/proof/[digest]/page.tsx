"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
// Nav is in root layout
import { hashFile, hashBytes, proofHashB64, commitDigest, type BitGraphProof } from "@/lib/bitgraph";
import { zipSync, strToU8 } from "fflate";
import { verifyNitroAttestation, type NitroVerifyResult } from "@/lib/nitro-verify";
import { timeTz, stampTz, timeNoTz, stampNoTz } from "@/lib/format-time";
import type { C2PAReadResult } from "@/lib/c2pa-reader";
import { takeWarm, proofFeedKey } from "@/lib/warm";
import { takeFreshProof } from "@/lib/fresh-proof";
import { Shell, ProofSkeleton } from "./proof-skeleton";
// QR code removed — replaced with Ethereum Seal card

const mono = "var(--font-mono), 'SF Mono', SFMono-Regular, monospace";

// Standard base64 -> url-safe, for comparing epoch ids against URL params.
const toSafeB64 = (s: string) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// The two-sided ETH anchor window as a compact phrase, matching the lead
// "Recorded" card: "between X and Y on DATE" when both bounds share a day, a
// full range across days, or a one-sided "after/before X" when only one anchor
// is known yet (a very recent recording whose next anchor is unmined).
function formatWindow(lower: string | null, upper: string | null): string | null {
  if (lower && upper) {
    const t1 = new Date(lower), t2 = new Date(upper);
    return t1.toDateString() === t2.toDateString()
      ? `between ${timeTz(t1)} and ${timeTz(t2)} on ${t2.toLocaleDateString()}`
      : `between ${stampTz(t1)} and ${stampTz(t2)}`;
  }
  if (lower) { const t = new Date(lower); return `after ${timeTz(t)} on ${t.toLocaleDateString()}`; }
  if (upper) { const t = new Date(upper); return `before ${timeTz(t)} on ${t.toLocaleDateString()}`; }
  return null;
}

// "sha256" -> "SHA-256", "sha-512" -> "SHA-512". Hyphenates the SHA family to
// the conventional spelling; anything else is just upper-cased.
function formatHashAlg(alg: string): string {
  const up = alg.toUpperCase();
  const m = up.match(/^SHA-?(\d+)$/);
  return m ? `SHA-${m[1]}` : up;
}

// Leading icon for the page's action buttons, so they read as controls rather
// than as bordered panels. Stroke style matches the title check mark.
function BtnIcon({ name, color = "#0065A4", size = 18 }: { name: "code" | "certificate" | "link" | "download" | "plus"; color?: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, style: { flexShrink: 0 } };
  if (name === "code") return <svg {...common}><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>;
  // Attestation = a signed credential: a document with a ribboned seal (the
  // Tabler "certificate" glyph).
  if (name === "certificate") return <svg {...common}><path d="M15 15m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" /><path d="M13 17.5v4.5l2 -1.5l2 1.5v-4.5" /><path d="M10 19h-5a2 2 0 0 1 -2 -2v-10c0 -1.1 .9 -2 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -1 1.73" /><path d="M6 9l12 0" /><path d="M6 12l3 0" /><path d="M6 15l2 0" /></svg>;
  if (name === "link") return <svg {...common}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>;
  if (name === "plus") return <svg {...common}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
  return <svg {...common}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>;
}

export default function ProofPage() {
  const params = useParams();
  const digestParam = params.digest as string;

  // Whether this load is a just-recorded BitGraph (?fresh=1). Captured at render,
  // before the flash effect strips the flag from the URL, so the load effect and
  // the loading state can both tell "you just recorded this" from "you opened a
  // link" — the former seeds instantly and waits with "Recording…", not the
  // lookup skeleton.
  const freshRef = useRef<boolean | null>(null);
  if (freshRef.current === null) {
    freshRef.current = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("fresh") === "1";
  }

  const [proof, setProof] = useState<BitGraphProof | null>(null);
  const [causalWindow, setCausalWindow] = useState<{
    anchorBefore: { counter: string; attrName: string; blockNumber: number | null; blockHash: string | null; etherscanUrl: string | null; blockTime?: string | null; digestB64?: string | null } | null;
    anchorAfter: { counter: string; attrName: string; blockNumber: number | null; blockHash: string | null; etherscanUrl: string | null; blockTime?: string | null; digestB64?: string | null } | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cachedFile, setCachedFile] = useState<{ name: string; data: ArrayBuffer; c2pa?: C2PAReadResult | null; c2paChecked?: boolean } | null>(null);

  // The anchor's OWN Ethereum block (number + timestamp), for the "Recorded"
  // line on Ethereum-anchor pages. Null for user proofs.
  const [anchorBlock, setAnchorBlock] = useState<{ blockNumber: number | null; blockTime: string | null; etherscanUrl: string | null } | null>(null);
  // Every causal position recorded for these bytes (the same bits can be
  // BitGraphed more than once), earliest first. ?counter=&epoch= in the URL
  // picks which one this page describes. lowerTime/upperTime are the ETH anchor
  // window bounds (block times) that bracket each recording.
  const [positions, setPositions] = useState<Array<{ counter: string | null; epoch: string | null; lowerTime: string | null; upperTime: string | null }>>([]);

  // A capture "flash" plays once when you land here straight off a fresh
  // recording (the drop flow / BitGraph Again append ?fresh=1). On mount the
  // flag is read and stripped from the URL immediately (so a reload or shared
  // link never replays it: the flash means "you just took this", not "this
  // exists"), but the animation is armed to fire when the proof CONTENT
  // reveals, not on mount, so a slow load can't swallow it.
  const [flashArmed, setFlashArmed] = useState(false);
  const [justCreated, setJustCreated] = useState(false);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("fresh") === "1") {
      setFlashArmed(true);
      sp.delete("fresh");
      const qs = sp.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  }, []);
  useEffect(() => {
    if (flashArmed && !loading && proof) {
      setFlashArmed(false);
      setJustCreated(true);
      const t = setTimeout(() => setJustCreated(false), 1600);
      return () => clearTimeout(t);
    }
  }, [flashArmed, loading, proof]);

  // A fresh recording arrives with only its lower bound: the sealing anchor
  // hasn't been mined yet. Instead of a static "after X" line, poll the same
  // endpoint until the upper anchor lands, then fill the window in place, no
  // refresh. We show a quiet pulsing "waiting on Ethereum…" rather than a
  // seconds countdown: the client has no ETA for the next anchor (the cadence
  // is ~12s only when the TEE is live, up to an hour when idle), so any number
  // would be counting toward nothing real. The poll gives up after 5 minutes
  // and the line falls back to the honest static "after X on DATE".
  const [ethWait, setEthWait] = useState(false);
  useEffect(() => {
    const attrName = (proof?.attribution as { name?: string } | undefined)?.name || "";
    const needUpper = !!proof && !attrName.startsWith("Ethereum") && attrName !== "Interval" &&
      !!causalWindow?.anchorBefore?.blockTime && !causalWindow?.anchorAfter?.blockTime;
    if (!needUpper) { setEthWait(false); return; }
    let cancelled = false;
    setEthWait(true);
    const poll = setInterval(async () => {
      try {
        const qs = new URLSearchParams(window.location.search);
        const sel = new URLSearchParams();
        if (qs.get("counter")) sel.set("counter", qs.get("counter")!);
        if (qs.get("epoch")) sel.set("epoch", qs.get("epoch")!);
        const selStr = sel.toString();
        const r = await fetch(`/api/proofs/digest/${digestParam}${selStr ? `?${selStr}` : ""}`);
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled && data.causalWindow?.anchorAfter?.blockTime) {
          setCausalWindow(data.causalWindow);
          if (Array.isArray(data.positions)) setPositions(data.positions);
        }
      } catch { /* transient; next poll retries */ }
    }, 4000);
    const stop = setTimeout(() => { clearInterval(poll); if (!cancelled) setEthWait(false); }, 5 * 60_000);
    return () => { cancelled = true; clearInterval(poll); clearTimeout(stop); };
  }, [proof, causalWindow?.anchorBefore?.blockTime, causalWindow?.anchorAfter?.blockTime, digestParam]);

  // Nav visible on proof pages

  useEffect(() => {
    let cancelled = false;
    let imagePollStarted = false;

    // The IndexedDB image poll. The home page writes the artifact bytes under
    // this digest in the background after BitGraphing — bytes first, then a C2PA
    // upgrade once the ~6 MB toolkit has parsed — and that write can land AFTER
    // this page mounts. So poll briefly instead of reading once: pick up the
    // bytes as soon as they appear (image preview), then keep polling until C2PA
    // has been checked (card), bounded to a few seconds. Independent of the proof
    // payload, so it starts as soon as we have a proof — seeded or freshly
    // fetched. Guarded so a warm seed + a reconcile don't start it twice.
    const startImagePoll = () => {
      if (imagePollStarted) return;
      imagePollStarted = true;
      let digestB64 = decodeURIComponent(digestParam).replace(/-/g, "+").replace(/_/g, "/");
      while (digestB64.length % 4 !== 0) digestB64 += "=";
      const readCached = async () => {
        try {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open("bitgraph-files", 1);
            req.onupgradeneeded = () => req.result.createObjectStore("files");
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          const tx = db.transaction("files", "readonly");
          const file = await new Promise<{ name: string; data: ArrayBuffer; c2pa?: C2PAReadResult | null; c2paChecked?: boolean } | undefined>((resolve) => {
            const req = tx.objectStore("files").get(digestB64);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(undefined);
          });
          db.close();
          return file;
        } catch { return undefined; }
      };
      // Self-heal: drop a cached record whose bytes don't match this proof.
      // Older home-page builds cached the dropped proof.json itself under the
      // digest key; those bytes aren't the artifact and would otherwise hide
      // both the image and the bring-your-file box.
      const dropCached = async () => {
        try {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open("bitgraph-files", 1);
            req.onupgradeneeded = () => req.result.createObjectStore("files");
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          const tx = db.transaction("files", "readwrite");
          tx.objectStore("files").delete(digestB64);
          await new Promise((r) => { tx.oncomplete = r; tx.onerror = r; });
          db.close();
        } catch { /* best effort */ }
      };
      // Non-blocking poll so it never delays first paint.
      void (async () => {
        let validated = false;
        for (let attempt = 0; attempt < 20 && !cancelled; attempt++) {
          const file = await readCached();
          if (file && !cancelled) {
            // Trust a cached file only if its bytes actually hash to this
            // proof's digest. A non-matching record (e.g. a stale cached
            // proof.json) is dropped so the bring-your-file box can show.
            if (!validated) {
              let matches = false;
              try { matches = (await hashBytes(new Uint8Array(file.data))) === digestB64; } catch { matches = false; }
              if (!matches) { void dropCached(); break; }
              validated = true;
            }
            setCachedFile(file);
            if (file.c2paChecked) break; // bytes + C2PA both settled
          }
          await new Promise((r) => setTimeout(r, 350));
        }
      })();
    };

    // Apply a proof API response to state (and kick the image poll). Returns
    // false for a response with no proof, so callers can fall back to an error.
    const applyData = (data: { proofs?: Array<{ proof?: BitGraphProof }>; causalWindow?: typeof causalWindow; anchorBlock?: typeof anchorBlock; positions?: typeof positions } | null): boolean => {
      if (cancelled || !data?.proofs?.[0]?.proof) return false;
      setProof(data.proofs[0].proof);
      if (data.causalWindow) setCausalWindow(data.causalWindow);
      if (data.anchorBlock) setAnchorBlock(data.anchorBlock);
      if (Array.isArray(data.positions)) setPositions(data.positions);
      startImagePoll();
      return true;
    };

    // Pass ?counter=&epoch= through so a specific causal position can be
    // selected when the same bytes were BitGraphed more than once. window.location
    // is read directly (not useSearchParams) so the page needs no Suspense
    // boundary; links between positions do full loads. proofFeedKey builds the
    // exact URL the warmer used, so a warm copy keys straight to this fetch.
    const qs = new URLSearchParams(window.location.search);
    const key = proofFeedKey(digestParam, qs.get("counter"), qs.get("epoch"));

    // Instant first paint. A just-recorded BitGraph seeds from the committed
    // proof the drop flow handed over (no skeleton on create); otherwise a warmed
    // example/lookup seeds from the prefetch. Either way the fetch below reconciles.
    const freshHit = freshRef.current ? takeFreshProof<Parameters<typeof applyData>[0]>(digestParam) : null;
    const warmHit = freshHit ? null : takeWarm<Parameters<typeof applyData>[0]>(key);
    const seedData = freshHit ?? (warmHit && "data" in warmHit ? warmHit.data : null);
    const seeded = !!(seedData && applyData(seedData));
    if (seeded) setLoading(false);

    // Live fetch — the source of truth, and the background reconcile when we
    // seeded. A reconcile failure never clobbers a good seeded render.
    (async () => {
      // If a warm fetch is still in flight (warmed on hover/idle, then a quick
      // click before it resolved), await THAT request instead of firing a
      // duplicate — the page paints the moment it lands, and its data is current
      // enough that no separate reconcile is needed.
      if (!seeded && warmHit && "promise" in warmHit) {
        try {
          const data = await warmHit.promise;
          if (cancelled) return;
          if (applyData(data)) { setLoading(false); return; }
        } catch { /* fall through to a fresh fetch */ }
      }
      try {
        // 15s timeout guards against a stuck API route (e.g. a slow Ethereum
        // RPC inside the causal-window lookup). Without this the page can hang
        // indefinitely on the skeleton if anything downstream stalls.
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        let resp: Response;
        try {
          resp = await fetch(key, { signal: controller.signal });
        } finally {
          clearTimeout(timeoutId);
        }
        if (!resp.ok) { if (!seeded && !cancelled) setError("BitGraph not found"); return; }
        const data = await resp.json();
        // Guard on !cancelled: applyData returns false for a cancelled (unmounted
        // or strict-mode double-invoked) effect, and without this a cancelled run
        // would clobber a good render with a spurious "not found".
        if (!cancelled && !applyData(data) && !seeded) setError("BitGraph not found");
      } catch { if (!seeded && !cancelled) setError("Failed to load BitGraph"); }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [digestParam]);

  // While the proof loads from S3, show the page's real shape: a stack of
  // collapsed card headers rendered as shimmering placeholders. It lands the
  // cards where they'll actually be (no jump when data arrives) and reads as
  // alive, unlike a static "Loading…" line.
  // A just-recorded BitGraph normally seeds instantly (no wait at all). If its
  // data isn't in hand yet, the create moment gets a "Recording…" wait, not the
  // lookup skeleton — the skeleton reads as "a page is loading", wrong for the
  // moment you just hit record.
  if (loading) return freshRef.current ? <FreshRecordingWait /> : <ProofSkeleton />;
  if (error || !proof) return (
    <Shell>
      <div style={{ padding: "80px 20px", textAlign: "center" }}>
        <div style={{ fontSize: 16, color: "#f87171", marginBottom: 12 }}>{error || "BitGraph not found"}</div>
        <a href="/" style={{ fontSize: 14, color: "var(--c-accent)" }}>BitGraph</a>
      </div>
    </Shell>
  );

  const commit = proof.commit;
  const attr = proof.attribution as { name?: string; title?: string; message?: string } | undefined;
  const slot = (proof as unknown as Record<string, unknown>).slotAllocation as Record<string, unknown> | undefined;
  const isEth = attr?.name?.startsWith("Ethereum");
  // Interval checkpoint: a system re-recording of an Ethereum block hash, not a
  // user submission. It gets its own card (not "Submitter's Note") and, like an
  // anchor, carries no user file.
  const isInterval = attr?.name === "Interval";
  const isTee = proof.environment?.enforcement === "measured-tee";
  const ts = (proof.timestamps as Record<string, Record<string, unknown>> | undefined)?.artifact;

  // Ethereum block number this anchor commits (parsed from the etherscan link),
  // used in the "Recorded" line and the Ethereum Block card.
  const ethBlockNum = isEth ? (attr?.title?.match(/\/block\/(\d+)/)?.[1] ?? null) : null;

  // "Recorded" summary, shown the same way on both page types. User BitGraph:
  // the two-sided ETH time window (committed after the earlier anchor, before
  // the later one). Ethereum anchor: its own block and that block's timestamp.
  // anchorBefore is the earlier block (lower bound), anchorAfter the later
  // (upper bound) — see the naming note on the BitGraphed After/Before cards.
  const lowerTime = causalWindow?.anchorBefore?.blockTime;
  const upperTime = causalWindow?.anchorAfter?.blockTime;
  let recordedLine: string | null = null;
  // Optional pre-formatted node so the Ethereum-anchor line breaks cleanly
  // between the block and its time (one line on desktop, time drops to line 2
  // on mobile) instead of wrapping mid-time/mid-date via wordBreak.
  let recordedNode: React.ReactNode = null;
  // Lead-card variants: the date moves up into the card TITLE ("BitGraph
  // Recorded on 7/17/2026") so the line below is pure wall-clock time.
  // recordedLine/recordedNode keep the date for other consumers (the interval
  // "Window ended" field must stand alone). Cross-day windows keep full
  // stamps and an undated title.
  // The date now lives on its own line inside the lead card (not the title,
  // which wrapped on mobile), written long ("October 24, 2025") so there is no
  // M/D vs D/M ambiguity across locales.
  let recordedDate: string | null = null;
  const longDate = (d: Date) => d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  let leadNode: React.ReactNode = null;
  // The actual time/date values are emphasized in brand blue (the connector
  // words stay default gray), so the receipt's key temporal fact reads as the
  // focal point, consistent with how counters/block numbers are highlighted.
  const emStyle: React.CSSProperties = { color: "#111827", fontWeight: 600 };
  const Em = ({ children }: { children: React.ReactNode }) => <span style={emStyle}>{children}</span>;
  if (isEth && ethBlockNum) {
    // An anchor is just a BitGraph (of an Ethereum block hash), so it reads
    // like the others: "BitGraph Recorded on {date}" with the block + time on
    // the line below. The date lives in the title.
    const bt = anchorBlock?.blockTime;
    const blockPart = `Ethereum Block #${Number(ethBlockNum).toLocaleString()}`;
    if (bt) {
      const d = new Date(bt);
      const timeStr = timeTz(d);
      const dateStr = d.toLocaleDateString();
      recordedLine = `${blockPart} at ${timeStr} on ${dateStr}`;
      recordedNode = (
        <>
          <span style={{ whiteSpace: "nowrap" }}>{blockPart}</span>{" "}
          <span style={{ whiteSpace: "nowrap" }}>at <Em>{timeStr}</Em> on <Em>{dateStr}</Em></span>
        </>
      );
      recordedDate = longDate(d);
      leadNode = (
        <>
          <span style={{ whiteSpace: "nowrap" }}>{blockPart}</span>{" "}
          <span style={{ whiteSpace: "nowrap" }}>at <Em>{timeStr}</Em></span>
        </>
      );
    } else {
      recordedLine = blockPart;
      leadNode = <span style={{ whiteSpace: "nowrap" }}>{blockPart}</span>;
    }
  } else if (!isEth && lowerTime && upperTime) {
    const t1 = new Date(lowerTime), t2 = new Date(upperTime);
    if (t1.toDateString() === t2.toDateString()) {
      // Each time-with-zone is an unbreakable unit, so on narrow screens the
      // phrase wraps at the connector words instead of splitting "PM" from
      // "EDT" mid-time.
      recordedLine = `between ${timeTz(t1)} and ${timeTz(t2)} on ${t2.toLocaleDateString()}`;
      recordedNode = <>between <Em><span style={{ whiteSpace: "nowrap" }}>{timeTz(t1)}</span></Em> and <Em><span style={{ whiteSpace: "nowrap" }}>{timeTz(t2)}</span></Em> on <Em><span style={{ whiteSpace: "nowrap" }}>{t2.toLocaleDateString()}</span></Em></>;
      recordedDate = longDate(t2);
      leadNode = <>between <Em><span style={{ whiteSpace: "nowrap" }}>{timeTz(t1)}</span></Em> and <Em><span style={{ whiteSpace: "nowrap" }}>{timeTz(t2)}</span></Em></>;
    } else {
      recordedLine = `between ${stampTz(t1)} and ${stampTz(t2)}`;
      recordedNode = <>between <Em><span style={{ whiteSpace: "nowrap" }}>{stampTz(t1)}</span></Em> and <Em><span style={{ whiteSpace: "nowrap" }}>{stampTz(t2)}</span></Em></>;
    }
  } else if (!isEth && lowerTime) {
    const t1 = new Date(lowerTime);
    recordedLine = `after ${timeTz(t1)} on ${t1.toLocaleDateString()}`;
    recordedDate = longDate(t1);
    if (ethWait) {
      // The window is still open: show it as "between X and <waiting>". When the
      // sealing anchor lands, the poll above swaps in the real end time without a
      // refresh. No seconds count: the next anchor has no client-known ETA.
      recordedNode = (
        <>
          between <Em><span style={{ whiteSpace: "nowrap" }}>{timeTz(t1)}</span></Em> and{" "}
          <span style={{ color: "#6b7280", whiteSpace: "nowrap", animation: "ethWaitPulse 1.6s ease-in-out infinite" }}>
            waiting for the next block…
          </span>
        </>
      );
      leadNode = recordedNode;
    } else {
      recordedNode = <>after <Em><span style={{ whiteSpace: "nowrap" }}>{timeTz(t1)}</span></Em> on <Em><span style={{ whiteSpace: "nowrap" }}>{t1.toLocaleDateString()}</span></Em></>;
      leadNode = <>after <Em><span style={{ whiteSpace: "nowrap" }}>{timeTz(t1)}</span></Em></>;
    }
  }

  // The recording window renders as ONE horizontal line ("between VALUE and
  // VALUE"), sized with a clamp so it stays a single line at every width and the
  // card stays short. Connectors are gray labels; the values are the brand font
  // in black, kept as unbreakable units. A cross-midnight window carries full
  // date stamps, long enough to wrap at its connectors — fine for that rare case.
  let leadStack: React.ReactNode = null;
  const conn = (label: string) => <span style={{ color: "#6b7280", fontWeight: 400 }}>{label}</span>;
  const val = (t: string) => <span style={{ color: "#111827", fontWeight: 400, whiteSpace: "nowrap" }}>{t}</span>;
  const winLine = (children: React.ReactNode) => (
    <div style={{ fontFamily: mono, fontSize: 12, lineHeight: 1.6, color: "#6b7280" }}>{children}</div>
  );
  if (isEth && ethBlockNum && anchorBlock?.blockTime) {
    // The block number lives in the "BitGraphed Ethereum Block" card below, so
    // the receipt carries only the block's date (left, via recordedDate) and its
    // single timestamp (right) — the same shape as a file-proof receipt.
    const d = new Date(anchorBlock.blockTime);
    leadStack = winLine(val(timeTz(d)));
  } else if (!isEth && lowerTime) {
    if (upperTime) {
      const s1 = new Date(lowerTime), s2 = new Date(upperTime);
      const sameDay = s1.toDateString() === s2.toDateString();
      // "between X and Y" bounds the window ("between 12:00:59 AM and 12:01:11 AM
      // EDT"). One shared zone per phrase, so the opening time drops the zone and
      // the closing time carries it.
      const fmtOpen = sameDay ? timeNoTz : stampNoTz;
      const fmtClose = sameDay ? timeTz : stampTz;
      leadStack = winLine(<>{conn("between ")}{val(fmtOpen(s1))}{conn(" and ")}{val(fmtClose(s2))}</>);
    } else if (ethWait) {
      const s1 = new Date(lowerTime);
      // Not sealed yet: the close time is unknown. Show the open time and a
      // pulsing ellipsis for the pending close ("between 11:04:35 PM and …")
      // rather than a full-width timestamp placeholder — short enough that date
      // + time stay on one line while waiting (no wrap). When the anchor lands
      // the close fills in; on mobile it then drops to its own line at seal.
      leadStack = winLine(
        <>
          {conn("between ")}{val(timeTz(s1))}{conn(" and ")}
          <span style={{ color: "#9ca3af", fontWeight: 400, whiteSpace: "nowrap", animation: "ethWaitPulse 1.6s ease-in-out infinite" }}>
            …
          </span>
        </>
      );
    } else {
      leadStack = winLine(<>{conn("after ")}{val(timeTz(new Date(lowerTime)))}</>);
    }
  }

  // The recording's "when": date (bold, left) + time window (right). Shown
  // inside the content card (above the image / hash) on file proofs, and as its
  // own small card on anchor/interval proofs (which have no file card). On a
  // phone the window wraps to its own right-aligned line.
  const whenNode = leadStack ?? (recordedDate ? leadNode : (recordedNode ?? recordedLine));
  const whenRow = (recordedDate || whenNode) ? (
    /* Written like a card field: the date is the heading, the time window the
       value beneath it in the monospace/data font, matching the hashes and
       counters elsewhere on the page. */
    <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "14px 16px" }}>
      {recordedDate && (
        <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", letterSpacing: "-0.01em" }}>
          {recordedDate}
        </div>
      )}
      {whenNode}
    </div>
  ) : null;

  // Interval window, derived from the causal positions the page already loads
  // (metadata.interval does not survive the TEE, so nothing here relies on it):
  // the earliest recording is the original anchor = when the window BEGAN, and
  // this proof's own ETH bounds (recordedLine) are when it ENDED. The counter
  // gap between them is the causal activity across the window.
  const intervalBlockNum = isInterval ? (attr?.title?.match(/\/block\/(\d+)/)?.[1] ?? null) : null;
  const originalPos = isInterval && positions.length > 0 && positions[0]?.counter !== commit?.counter ? positions[0] : null;
  const intervalBegan = originalPos ? formatWindow(originalPos.lowerTime, originalPos.upperTime) : null;
  // Highlighted node form so "Window began" reads like "Window ended".
  let intervalBeganNode: React.ReactNode = intervalBegan;
  if (originalPos?.lowerTime && originalPos?.upperTime) {
    const b1 = new Date(originalPos.lowerTime), b2 = new Date(originalPos.upperTime);
    intervalBeganNode = b1.toDateString() === b2.toDateString()
      ? <>between <Em>{timeTz(b1)}</Em> and <Em>{timeTz(b2)}</Em> on <Em>{b2.toLocaleDateString()}</Em></>
      : <>between <Em>{stampTz(b1)}</Em> and <Em>{stampTz(b2)}</Em></>;
  }

  async function exportZip() {
    try {
    const files: Record<string, Uint8Array> = {
      "proof.json": strToU8(JSON.stringify(proof, null, 2)),
    };
    // Include the original file if cached
    if (cachedFile) {
      files[cachedFile.name] = new Uint8Array(cachedFile.data);
    }
    // Fetch BOTH bounding ETH anchors. The proof was witnessed after the
    // "before" anchor and before the "after" anchor, which brackets it to one
    // anchor interval (~12s) of public Ethereum time. Both are required to read
    // the window: the after-anchor alone gives only an upper bound, the same
    // one-sided "existed by now" a plain blockchain timestamp gives.
    try {
      const counter = commit.counter;
      const enc = encodeURIComponent(commit.epochId || "");
      const [afterResp, beforeResp] = await Promise.all([
        fetch(`/api/proofs/anchors?counter=${counter}&epoch=${enc}&limit=1`),
        fetch(`/api/proofs/anchors?counter=${counter}&epoch=${enc}&before=1`),
      ]);
      // For an anchor, also add its block-header witness so the anchor's
      // Ethereum time claim verifies fully offline. The server re-encodes and
      // self-checks the header (returns it only when keccak256 == the signed
      // block hash), so a failure just omits the witness; the bundle stays valid.
      const addWitness = async (name: string, anchor: Record<string, unknown>) => {
        try {
          const eth = anchor.ethereum as { blockNumber?: number; blockHash?: string } | undefined;
          const attr = anchor.attribution as { title?: string; message?: string } | undefined;
          const m = attr?.title?.match(/\/block\/(\d+)/);
          const blockNumber = eth?.blockNumber ?? (m ? parseInt(m[1], 10) : undefined);
          const blockHash = eth?.blockHash ?? attr?.message;
          if (blockNumber === undefined || !blockHash) return;
          const wResp = await fetch(`/api/proofs/witness?block=${blockNumber}&hash=${encodeURIComponent(blockHash)}`);
          if (wResp.ok) files[name] = strToU8(JSON.stringify(await wResp.json(), null, 2));
        } catch (_) { /* the bundle is valid without the witness */ }
      };
      // The four ETH anchor files (before/after anchor + their block-header
      // witnesses) go in an ethereum-anchors/ subfolder so they don't clutter
      // the bundle root. Audit discovery is by schema shape, not path, so the
      // nesting is transparent to the verifier.
      if (afterResp.ok) {
        const data = await afterResp.json();
        if (Array.isArray(data.anchors) && data.anchors.length > 0) {
          files["ethereum-anchors/anchor-after.json"] = strToU8(JSON.stringify(data.anchors[0], null, 2));
          await addWitness("ethereum-anchors/anchor-after-witness.json", data.anchors[0]);
        }
      }
      if (beforeResp.ok) {
        const data = await beforeResp.json();
        if (Array.isArray(data.anchors) && data.anchors.length > 0) {
          files["ethereum-anchors/anchor-before.json"] = strToU8(JSON.stringify(data.anchors[0], null, 2));
          await addWitness("ethereum-anchors/anchor-before-witness.json", data.anchors[0]);
        }
      }
    } catch (_) { /* ignore */ }
    const zipped = zipSync(files, { level: 0 });
    const blob = new Blob([zipped as unknown as BlobPart], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `bitgraph-proof-${commit.counter}.zip`; a.click();
    URL.revokeObjectURL(url);
    } catch (e) { console.error("[bitgraph] export error:", e); alert("Export failed: " + e); }
  }

  return (
    <Shell>
      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:translateY(0) } }
        @keyframes ethWaitPulse { 0%,100%{opacity:1} 50%{opacity:.45} }
        /* Collapsible card header — the disclosure affordance is a single blue
           chevron that rotates down when open; the row tints on hover. */
        .bg-collapse-head { transition: background .12s; }
        .bg-collapse-chev { color:#0065A4; transition: color .15s; }
        @media (hover:hover) {
          .bg-collapse-head:hover { background:#f3f5f7 !important; }
          .bg-collapse-head:hover .bg-collapse-chev { color:#004b7a; }
        }
        /* Face-ID-style success: a brand-blue ring sweeps closed, then the checkmark
           draws itself, the whole badge springs in and fades away. Plays once
           on a freshly-recorded BitGraph. */
        @keyframes fidScrim { 0%{opacity:0} 15%{opacity:1} 78%{opacity:1} 100%{opacity:0} }
        @keyframes fidPop { 0%{transform:translate(-50%,-50%) scale(.6);opacity:0} 45%{opacity:1} 62%{transform:translate(-50%,-50%) scale(1.07)} 100%{transform:translate(-50%,-50%) scale(1);opacity:1} }
        @keyframes fidFade { to { opacity:0 } }
        @keyframes fidDraw { to { stroke-dashoffset:0 } }
        .fid-scrim { position:fixed; inset:0; z-index:9998; pointer-events:none; background:rgba(245,245,245,.72); animation:fidScrim 1.5s ease-out forwards; }
        .fid-badge { position:fixed; top:44%; left:50%; z-index:9999; pointer-events:none; width:104px; height:104px; animation:fidPop .5s cubic-bezier(.2,.8,.3,1) forwards, fidFade .35s ease-out 1.15s forwards; }
        .fid-ring { fill:none; stroke:#0065A4; stroke-width:6; stroke-linecap:round; stroke-dasharray:295; stroke-dashoffset:295; animation:fidDraw .5s ease-out .05s forwards; }
        .fid-check { fill:none; stroke:#0065A4; stroke-width:7; stroke-linecap:round; stroke-linejoin:round; stroke-dasharray:60; stroke-dashoffset:60; animation:fidDraw .3s ease-out .46s forwards; }
        @media (prefers-reduced-motion: reduce) { .fid-badge, .fid-scrim, .fid-ring, .fid-check { animation-duration:.01ms !important; animation-delay:0s !important; } }
        .proof-fields > div:last-child { border-bottom: none !important; }
        /* Causal Positions rows: a stacked entry that reads the same at every
           width. Line 1 is the counter (left) and the View/Viewing action
           (right); below it the role reads as a bold heading, then the ETH
           anchor window as secondary detail. Stacking avoids the ragged inline
           wrap the single-line layout produced on narrow screens. */
        .causal-row { padding: 14px 16px; }
        .causal-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .causal-label { font-size: 14px; font-weight: 700; white-space: nowrap; }
        .causal-action { font-size: 12.5px; font-weight: 600; white-space: nowrap; }
        .causal-role { font-size: 13px; font-weight: 700; color: #111827; margin-top: 6px; }
        .causal-window { font-size: 13px; color: #6b7280; line-height: 1.5; margin-top: 2px; }
        @media print {
        }
      `}</style>

      {justCreated && (
        <>
          <div className="fid-scrim" aria-hidden />
          <svg className="fid-badge" viewBox="0 0 104 104" aria-hidden role="img">
            <circle className="fid-ring" cx="52" cy="52" r="47" />
            <path className="fid-check" d="M32 54 L46 68 L73 39" />
          </svg>
        </>
      )}

      <div style={{ width: "90%", maxWidth: 800, margin: "0 auto", padding: "40px 0 80px", animation: "fadeIn .3s ease-out" }}>

        <div className="proof-grid" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>

          {/* The content itself sits first: the page
              certifies the photograph, so you see the subject before its
              paperwork. The match banner rides with it after an active check. */}
          {/* The receipt: a plain (non-collapsible) card, always open, that
              answers "what is this page" in one line — date on the left, the
              precise wall-clock window on the right. "BitGraphed" is dropped as a
              label (you are already looking at the proof); the window carries
              whether the sealing Ethereum anchor has landed yet ("waiting for
              the next block…"). Each value is an unbreakable unit, so on narrow phones
              the window wraps at its connector (never mid-value) and the whole
              right column can drop below the date. Gated on the recording info it
              shows, not on proofHash (which is absent from exported/older
              proofs). */}
          {/* Interval proofs have no content card, so the "when" is its own
              small card here. File proofs show it inside the BitGraphed File
              card, and Ethereum anchors inside the BitGraphed Ethereum Block
              card (both below), above the content — so the time always leads the
              first card rather than floating in a card of its own. The only
              anchor that still needs a standalone when-card is the rare Ethereum
              anchor with no etherscan title (no block card to hold it). */}
          {(isInterval || (isEth && !attr?.title)) && whenRow && (
            <div style={{ background: "#fff", border: "1px solid #d0d5dd", borderRadius: 0 }}>
              {whenRow}
            </div>
          )}

          {/* The content slot: the "BitGraph Recorded" card. Unlike the technical
              cards below it, this one is plain (no toggle) and always open — it
              holds the file, its "when", and its hash, and its header asserts the
              recording happened (the confirmation the removed receipt used to
              carry). The "when" leads the body, then the image when the bytes are
              in hand (or the bring-your-file dropzone), then the file hash. */}
          {!isEth && !isInterval && (
            <CollapsibleCard title="BitGraph Recorded" plain>
              {whenRow && <div style={{ borderBottom: "1px solid #e2e5e9" }}>{whenRow}</div>}
              {isDisplayableImage(cachedFile, cachedFile?.c2pa) ? (
                <PhotoCard cachedFile={cachedFile} c2pa={cachedFile?.c2pa ?? null} bare />
              ) : cachedFile ? (
                <FileCard cachedFile={cachedFile} />
              ) : (
                <div style={{ padding: 16 }}>
                  <BringYourFile proof={proof} onMatch={(rec) => setCachedFile(rec)} />
                </div>
              )}
              {/* The fingerprint lives with the file: this SHA-256 IS the file's
                  pre-existing identity. In the no-file state it is also the
                  value a dropped file is checked against. */}
              <Field label="File Hash" value={proof.artifact.digestB64} mono topBorder />
              {/* Below the hash, when the artifact is in hand: record these
                  same bytes again (secondary), then Export as the closing
                  action. Export lives here with the file it saves rather than at
                  the page bottom, so it is reachable without scrolling past the
                  technical cards. When the file is NOT in hand, Export sits at
                  the bottom instead (see below). */}
              {cachedFile && (
                <div style={{ padding: "12px 16px 16px", borderTop: "1px solid #e2e5e9", display: "flex", flexDirection: "column", gap: 10 }}>
                  <BitGraphAgainButton proof={proof} digestParam={digestParam} />
                  <button
                    onClick={exportZip}
                    className="bg-btn-fill"
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                      height: 76, fontSize: 16, fontWeight: 600,
                      color: "#ffffff", background: "#0065A4",
                      border: "none", borderRadius: 0, cursor: "pointer", letterSpacing: "-0.01em",
                    }}
                  >
                    <BtnIcon name="download" color="#ffffff" />
                    <span>Export BitGraph + File</span>
                  </button>
                </div>
              )}
            </CollapsibleCard>
          )}

          {/* An anchor's artifact IS the Ethereum block hash, so its block card
              sits in the same content slot the BitGraphed File uses on file
              proofs, titled to match. */}
          {isEth && attr?.title && (
            <CollapsibleCard title="BitGraphed Ethereum Block" plain>
              {whenRow && <div style={{ borderBottom: "1px solid #e2e5e9" }}>{whenRow}</div>}
              <Field label="Block" value={ethBlockNum ? `#${Number(ethBlockNum).toLocaleString()}` : "#?"} highlight />
              <Field label="Etherscan" value={attr.title} link />
            </CollapsibleCard>
          )}

          {/* Recordings — shown only when these exact bytes were BitGraphed more
              than once. File-level context (every position the same bytes
              occupy), so it sits right under the file, ahead of the single-proof
              construction cards. Each row: BitGraph #, the date it was recorded
              in the role line, and its time window in the mono/data font (same
              treatment as the BitGraphed File card), plus a link to that position. */}
          {positions.length > 1 && (
            <CollapsibleCard title={`Recordings (${positions.length})`}>
              <div style={{ padding: "14px 16px", borderBottom: "1px solid #e2e5e9", fontSize: 13, color: "#374151", lineHeight: 1.5 }}>
                These exact bits were BitGraphed {positions.length} times. Each recording sits at its own position, with its own verifiable time window.
              </div>
              {[...positions].reverse().map((pos) => {
                const isEarliest = pos === positions[0];
                const isCurrent =
                  String(pos.counter) === String(commit.counter) &&
                  (!pos.epoch || !commit.epochId || pos.epoch === toSafeB64(String(commit.epochId)));
                const num = pos.counter != null ? Number(pos.counter).toLocaleString() : "?";
                const t1 = pos.lowerTime ? new Date(pos.lowerTime) : null;
                const t2 = pos.upperTime ? new Date(pos.upperTime) : null;
                const sameDay = !!(t1 && t2 && t1.toDateString() === t2.toDateString());
                let rowDate: string | null = null;
                if (t1 && t2) { if (sameDay) rowDate = longDate(t2); }
                else if (t2) rowDate = longDate(t2);
                else if (t1) rowDate = longDate(t1);
                const roleText = isEarliest ? "Earliest recorded position" : "Recorded again";
                const roleLine = rowDate ? `${roleText} on ${rowDate}` : roleText;
                const timesNode = t1 && t2
                  ? (sameDay
                      ? <>{conn("between ")}{val(timeNoTz(t1))}{conn(" and ")}{val(timeTz(t2))}</>
                      : <>{conn("between ")}{val(stampTz(t1))}{conn(" and ")}{val(stampTz(t2))}</>)
                  : (t1 ? <>{conn("after ")}{val(timeTz(t1))}</> : null);
                return (
                  <div key={`${pos.epoch}-${pos.counter}`} className="causal-row" style={{ borderBottom: "1px solid #e2e5e9" }}>
                    <div className="causal-top">
                      <span className="causal-label" style={{ color: "var(--c-accent)" }}>BitGraph <span style={{ fontFamily: mono }}>#{num}</span></span>
                      {isCurrent ? (
                        <span className="causal-action" style={{ color: "#374151" }}>Viewing</span>
                      ) : (
                        <a
                          className="causal-action"
                          href={`/proof/${encodeURIComponent(digestParam)}?counter=${encodeURIComponent(pos.counter ?? "")}${pos.epoch ? `&epoch=${encodeURIComponent(pos.epoch)}` : ""}`}
                          style={{ color: "var(--c-accent)", textDecoration: "none" }}
                        >
                          View &rarr;
                        </a>
                      )}
                    </div>
                    <div className="causal-role">{roleLine}</div>
                    {timesNode && <div className="causal-window" style={{ fontFamily: mono }}>{timesNode}</div>}
                  </div>
                );
              })}
            </CollapsibleCard>
          )}

          {/* 1. Slot — reserved first, before anything else */}
          {slot && (
            <CollapsibleCard title="Reserved Slot">
              <Field label="Slot Counter" value={`#${slot.counter}`} highlight />
              {slot.nonceB64 ? <Field label="Nonce" value={String(slot.nonceB64)} mono /> : null}
              {slot.signatureB64 ? <Field label="Slot Signature" value={String(slot.signatureB64)} mono /> : null}
              {slot.epochId ? <Field label="Epoch ID" value={String(slot.epochId)} mono /> : null}
            </CollapsibleCard>
          )}

          {/* 2. Artifact hash — only for Ethereum anchors and interval proofs,
              whose artifact IS a block hash rather than a file. User-file proofs
              carry their File Hash inside the BitGraphed File card above, with
              the file it identifies, so there is no separate box here. */}
          {(isEth || isInterval) && (
            <CollapsibleCard title="Artifact Hash">
              {isEth && attr?.message && <Field label="Ethereum Block Hash" value={attr.message} mono />}
              <Field
                label={isEth && attr?.message
                  ? `${formatHashAlg(proof.artifact.hashAlg)} of Block Hash`
                  : `${formatHashAlg(proof.artifact.hashAlg)} Digest`}
                value={proof.artifact.digestB64}
                mono
              />
            </CollapsibleCard>
          )}

          {/* 3. Commit — the artifact digest bound to its own position, one past
              the reserved slot. commit.counter is a DISTINCT position from the
              slot's (slot reserved at N, the artifact commits at N+1), so it is
              labeled "Artifact Counter" to set it apart from the slot's counter.
              When the Causal Slot card above is present it already shows the
              Epoch ID, Nonce, and slot counter (commit.slotCounter is the same
              value), so those are not echoed here; the Slot Hash remains as the
              cryptographic link binding this commit to that slot. With no slot
              card, they surface here so nothing is hidden. */}
          <CollapsibleCard title="Artifact Commit">
            <Field label="Artifact Counter" value={`#${commit.counter}`} highlight />
            {!slot && commit.epochId && <Field label="Epoch ID" value={String(commit.epochId)} mono />}
            {commit.prevB64 && <Field label="Previous Hash" value={commit.prevB64} mono />}
            {!slot && commit.nonceB64 && <Field label="Nonce" value={commit.nonceB64} mono />}
            {!slot && commit.slotCounter != null && <Field label="Slot Counter" value={`#${commit.slotCounter}`} />}
            {commit.slotHashB64 && <Field label="Slot Hash" value={commit.slotHashB64} mono />}
          </CollapsibleCard>

          {/* 4. Signer — the proof's own fingerprint (the proofHash) first, then
              the enclave's Ed25519 signature over it. The proofHash is computed
              last, from the fully assembled signed body, and is the value the
              attestation in the Environment card below binds to
              (user_data == proofHash), so it belongs here at the signing step,
              not up in the receipt. */}
          <CollapsibleCard title="Signature">
            {(proof as BitGraphProof & { proofHash?: string }).proofHash && (
              <Field label="This BitGraph's Hash" value={(proof as BitGraphProof & { proofHash?: string }).proofHash!} mono />
            )}
            <Field label="Signature" value={proof.signer.signatureB64} mono />
            <Field label="Public Key" value={proof.signer.publicKeyB64} mono />
          </CollapsibleCard>

          {/* 5. Environment — where it was signed */}
          {/* The title states the signing environment outright (the old vague
              "Environment" + Enforcement field pair), and the evidence — PCR0,
              attestation format, the verify action — is optional depth. */}
          <CollapsibleCard title={isTee ? "Hardware Enclave" : "Software"}>
            {proof.environment?.measurement && <Field label="PCR0 Measurement" value={proof.environment.measurement} mono />}
            {proof.environment?.attestation?.format && <Field label="Attestation Format" value={proof.environment.attestation.format} />}
            {proof.environment?.attestation?.reportB64 && proof.environment?.measurement && (
              <div style={{ padding: "14px 16px", borderBottom: "1px solid #e2e5e9" }}>
                <AttestationButton reportB64={proof.environment.attestation.reportB64} measurement={proof.environment.measurement} proof={proof} />
              </div>
            )}
          </CollapsibleCard>

          {/* Ethereum Seal */}
          {/* Ethereum info — single card for both anchor proofs and user proofs */}

          {/* "Recorded after this block" — the previous same-epoch anchor (lower
              time bound). Renders anchorBefore, the earlier block: the BitGraph
              was recorded AFTER this block. Shown above "Recorded before this
              block" so the pair reads as a bracket: after this block, before
              that one. */}
          {!isEth && causalWindow?.anchorBefore && (
            <CollapsibleCard title="Recorded after this block">
              {causalWindow.anchorBefore.blockNumber !== null && (
                <Field label="Block" value={`#${causalWindow.anchorBefore.blockNumber.toLocaleString()}`} highlight />
              )}
              {causalWindow.anchorBefore.blockTime && (
                <Field label="Block Time" value={stampTz(new Date(causalWindow.anchorBefore.blockTime))} />
              )}
              {causalWindow.anchorBefore.etherscanUrl && (
                <Field label="Etherscan" value={causalWindow.anchorBefore.etherscanUrl} link />
              )}
              {causalWindow.anchorBefore.digestB64 && (
                <div style={{ padding: "14px 16px", borderBottom: "1px solid #e2e5e9" }}>
                  <a
                    href={`/proof/${encodeURIComponent((causalWindow.anchorBefore.digestB64 || "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""))}`}
                    className="bg-btn-outline"
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
                      width: "100%", height: 76, fontSize: 16, fontWeight: 500,
                      color: "#0065A4", background: "#f4f6f9",
                      border: "1px solid #0065A4", borderRadius: 0,
                      textDecoration: "none", cursor: "pointer",
                    }}
                  >
                    <BtnIcon name="link" />
                    <span>View Anchor BitGraph #{causalWindow.anchorBefore.counter} &rarr;</span>
                  </a>
                </div>
              )}
            </CollapsibleCard>
          )}

          {/* The anchor's own block card moved to the content slot above; here
              only the file proof's sealing "Before" anchor renders — an anchor
              is the bracket, so it has no before/after window of its own. */}
          {!isEth && causalWindow?.anchorAfter ? (
            <CollapsibleCard title="Recorded before this block">
              {causalWindow.anchorAfter.blockNumber !== null && (
                <Field label="Block" value={`#${causalWindow.anchorAfter.blockNumber.toLocaleString()}`} highlight />
              )}
              {causalWindow.anchorAfter.blockTime && (
                <Field label="Block Time" value={stampTz(new Date(causalWindow.anchorAfter.blockTime))} />
              )}
              {causalWindow.anchorAfter.etherscanUrl && (
                <Field label="Etherscan" value={causalWindow.anchorAfter.etherscanUrl} link />
              )}
              {causalWindow.anchorAfter.digestB64 && (
                <div style={{ padding: "14px 16px", borderBottom: "1px solid #e2e5e9" }}>
                  <a
                    href={`/proof/${encodeURIComponent((causalWindow.anchorAfter.digestB64 || "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""))}`}
                    className="bg-btn-outline"
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
                      width: "100%", height: 76, fontSize: 16, fontWeight: 500,
                      color: "#0065A4", background: "#f4f6f9",
                      border: "1px solid #0065A4", borderRadius: 0,
                      textDecoration: "none", cursor: "pointer",
                    }}
                  >
                    <BtnIcon name="link" />
                    <span>View Anchor BitGraph #{causalWindow.anchorAfter.counter} &rarr;</span>
                  </a>
                </div>
              )}
            </CollapsibleCard>
          ) : !isEth && !isInterval ? (
            <CollapsibleCard title="Recorded before the next block">
              <div style={{ padding: "14px 16px", fontSize: 14, color: "#6b7280" }}>
                Waiting for the next Ethereum block…
              </div>
            </CollapsibleCard>
          ) : null}

          {/* Submitter's Note — self-supplied, only for non-ETH proofs that carry
              it. These values are typed in by whoever made the proof and are NOT
              verified by BitGraph, so the card says so and never labels the name
              as "Creator". */}
          {isInterval && (
            <CollapsibleCard title="Interval BitGraph">
              {intervalBlockNum && <Field label="Ethereum Block" value={`https://etherscan.io/block/${intervalBlockNum}`} link />}
              {attr?.message && <Field label="Block Hash" value={attr.message} mono />}
              {intervalBegan && <Field label="Window Began" value={intervalBegan} valueNode={intervalBeganNode} />}
              {recordedLine && <Field label="Window Ended" value={recordedLine} valueNode={recordedNode} />}
            </CollapsibleCard>
          )}

          {/* Advisory timestamp — the Ethereum window above is the authoritative
              time mechanism. A TSA time, if present, is advisory only, so it is
              labeled as such and sits last. */}
          {ts && (
            <CollapsibleCard title="Advisory Timestamp">
              {ts.authority ? <Field label="Authority" value={String(ts.authority)} /> : null}
              {ts.time ? <Field label="TSA Time" value={String(ts.time)} /> : null}
              {ts.digestAlg ? <Field label="Digest Algorithm" value={String(ts.digestAlg)} /> : null}
            </CollapsibleCard>
          )}

          {/* Content Credentials (C2PA) — the manifest embedded in the bytes. */}
          {!isEth && cachedFile?.c2pa?.present && <C2PACard c2pa={cachedFile.c2pa} />}

          {/* Submitter's Note — LAST card, like an appendix: it was appended to
              the recording by whoever made it. The title slot is a link ONLY
              when it actually holds a URL; agents routinely put prose there,
              which used to render as a link to nowhere. */}
          {attr && !isEth && !isInterval && (
            <CollapsibleCard title="Submitter's Note">
              {attr.name && <Field label="Submitted by" value={attr.name} />}
              {attr.message && <Field label="Note" value={attr.message} mono />}
              {attr.title && (/^https?:\/\//i.test(attr.title.trim())
                ? <Field label="Link" value={attr.title} link />
                : <Field label="Title" value={attr.title} />)}
            </CollapsibleCard>
          )}

          {/* Raw JSON — a collapsible card like the others (was a button that
              opened a modal), so the whole proof reads as one stack of cards. */}
          <JsonSection proof={proof} />
        </div>

        {/* Export — for proofs where the file is NOT in hand (a cold or shared
            link, Ethereum/interval anchors). When the artifact IS in hand,
            Export lives inside the BitGraph Recorded card, below "Again," so
            this bottom button is suppressed. */}
        {!cachedFile && (
        <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            onClick={exportZip}
            className="bg-btn-fill"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              height: 76, fontSize: 16, fontWeight: 600,
              color: "#ffffff", background: "#0065A4",
              border: "none", borderRadius: 0,
              cursor: "pointer", letterSpacing: "-0.01em",
            }}
          >
            <BtnIcon name="download" color="#ffffff" />
            <span>{!isEth && cachedFile ? "Export BitGraph + File" : "Export BitGraph"}</span>
          </button>
          {/* The original file only ever lives on the device that holds it
              (never the server). When it is present the "+ File" label says
              enough; when it is not, this note explains the proof-only export. */}
          {!isEth && !isInterval && !cachedFile && (
            <div style={{ fontSize: 12.5, color: "#6b7280", textAlign: "center" }}>
              BitGraph only: the original file is not on this device
            </div>
          )}
        </div>
        )}

      </div>
    </Shell>
  );
}

/* ── Shell — uses same theme as maker page ── */

/* ── Create wait — shown only on a just-recorded BitGraph (?fresh=1) whose data
   isn't seeded yet. Says "BitGraphing…", the SAME label as the drop flow's commit
   spinner, so the two waits in a create read as one continuous moment (not a
   lookup skeleton). Fades in over ~0.45s so the common case — an instant seed
   that replaces it within a frame — never shows a harsh flash, while a real wait
   reads as BitGraphing in progress. ── */
function FreshRecordingWait() {
  return (
    <Shell>
      <style>{`@keyframes fpSpin { to { transform: rotate(360deg) } } @keyframes fpIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
      {/* Pinned to the same fixed viewport point (44% down, centered) that every
          other wait state and the success checkmark use, so the spinner never
          jumps between the drop flow's "BitGraphing…" and this. */}
      <div style={{ position: "fixed", top: "44%", left: "50%", transform: "translate(-50%, -50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 16, width: "max-content", maxWidth: "92vw", animation: "fpIn 0.45s ease-out" }}>
        <div role="status" aria-label="BitGraphing" style={{ width: 32, height: 32, border: "3px solid #e2e5e9", borderTopColor: "#0065A4", borderRadius: "50%", animation: "fpSpin 0.8s linear infinite" }} />
        <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", letterSpacing: "-0.01em" }}>BitGraphing&hellip;</div>
      </div>
    </Shell>
  );
}

/* ── Card ── */


/* ── Collapsible card — same face as Card, but the header is a disclosure
   toggle. Used for the two ETH anchor sections: their titles already state
   the essential fact (after/before block #N), so the details are optional. ── */

function CollapsibleCard({ title, children, defaultOpen, plain }: { title: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; plain?: boolean }) {
  // A plain card has no toggle and is always open — used for the primary
  // "BitGraph Recorded" card, whose contents are the point of the page.
  const [open, setOpen] = useState(!!defaultOpen || !!plain);
  const headerStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, width: "100%",
    fontSize: 14, fontWeight: 700, letterSpacing: "0.04em", color: "#0065A4",
    padding: "14px 16px", background: open ? "rgba(0,101,164,0.04)" : "#fff",
    border: "none", borderBottom: open ? "1px solid #e2e5e9" : "none",
    textAlign: "left", fontFamily: "inherit",
  };
  return (
    <div style={{ background: "#fff", border: "1px solid #d0d5dd", borderRadius: 0, overflow: "hidden" }}>
      {plain ? (
        // Static header: a heading, not a control — no hover affordance, no toggle.
        <div style={{ ...headerStyle, cursor: "default" }}>
          <span>{title}</span>
        </div>
      ) : (
        /* The header is a full-row toggle with the same hover + outlined-button
           affordance as the explorer rows: the row tints on hover and the
           chevron button inverts to solid blue, so a collapsed card reads as
           clearly clickable. */
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="bg-collapse-head"
          style={{ ...headerStyle, cursor: "pointer" }}
        >
          <span>{title}</span>
          <span className="bg-collapse-chev" aria-hidden style={{ display: "inline-flex", flexShrink: 0, transform: open ? "rotate(90deg)" : "none", transition: "transform .18s" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="square" strokeLinejoin="miter"><path d="M9 6 L15 12 L9 18" /></svg>
          </span>
        </button>
      )}
      {open && <div className="proof-fields" style={{ padding: "4px 0", animation: "fadeIn .2s ease-out" }}>{children}</div>}
    </div>
  );
}

/* ── Field with copy ── */

function Field({ label, value, valueNode, mono: isMono, highlight, link, center, topBorder }: { label: string; value: string; valueNode?: React.ReactNode; mono?: boolean; highlight?: boolean; link?: boolean; center?: boolean; topBorder?: boolean }) {
  const [copied, setCopied] = useState(false);

  return (
    <div
      onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      style={{
        display: "flex", flexDirection: "column", gap: 5,
        padding: "14px 16px", borderBottom: "1px solid #e2e5e9", cursor: "pointer",
        textAlign: center ? "center" : undefined,
        // Divider above the row, for when it follows non-field content (e.g. the
        // File Hash under the file image/dropzone, which has no bottom border).
        ...(topBorder ? { borderTop: "1px solid #e2e5e9" } : {}),
      }}
    >
      <span style={{ fontSize: 14, color: "#374151", fontWeight: 700 }}>{label}</span>
      {link ? (
        <a href={value} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} style={{
          fontSize: 13, color: "var(--c-accent)", textDecoration: "none", wordBreak: "break-all",
        }}>{value}</a>
      ) : (
        <span style={{
          fontSize: isMono ? 12 : 14,
          fontFamily: isMono ? mono : "inherit",
          color: copied ? "#0065A4" : highlight ? "var(--c-accent)" : "#1f2937",
          fontWeight: highlight ? 700 : 400,
          transition: "color .2s", lineHeight: 1.6,
          // Mono values (hashes, keys, nonces) are long fixed-length strings:
          // keep them on one line and let the row scroll horizontally on narrow
          // screens instead of shredding them across ragged wrapped lines.
          // Still tap-to-copy, so nobody needs to scroll to grab the value.
          ...(isMono
            ? { whiteSpace: "nowrap", overflowX: "auto", WebkitOverflowScrolling: "touch" }
            : { wordBreak: valueNode ? "normal" : "break-all" }),
        }}>
          {copied ? "Copied!" : (valueNode ?? value)}
        </span>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "8px 16px", fontSize: 13, fontWeight: 600, color: "#ffffff",
  background: "#0065A4", border: "1px solid #0065A4", borderRadius: 0, cursor: "pointer",
};

/* ── BitGraph again — commit the same digest into a fresh slot, then reload
   onto the new position's URL so the page shows the recording that was just
   made (with the Causal Positions card now listing every position). ── */

function BitGraphAgainButton({ proof, digestParam }: { proof: BitGraphProof; digestParam: string }) {
  const [state, setState] = useState<"idle" | "working" | "error">("idle");

  async function run() {
    if (state === "working") return;
    setState("working");
    try {
      const p = await commitDigest(proof.artifact.digestB64);
      const counter = p.commit?.counter;
      const epoch = p.commit?.epochId ? toSafeB64(String(p.commit.epochId)) : "";
      // &fresh=1 → capture flash on the new position (a just-made recording).
      window.location.href = `/proof/${encodeURIComponent(digestParam)}?counter=${encodeURIComponent(counter ?? "")}${epoch ? `&epoch=${encodeURIComponent(epoch)}` : ""}&fresh=1`;
    } catch (e) {
      console.error("[bitgraph] BitGraph again failed:", e);
      setState("error");
    }
  }

  return (
    <>
      <button
        onClick={run}
        disabled={state === "working"}
        className="bg-btn-outline"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
          width: "100%", height: 76, fontSize: 16, fontWeight: 500,
          color: state === "working" ? "#9ca3af" : "#0065A4",
          background: "#f4f6f9",
          border: `1px solid ${state === "working" ? "#d0d5dd" : "#0065A4"}`,
          borderRadius: 0, cursor: state === "working" ? "default" : "pointer",
        }}
      >
        <BtnIcon name="plus" color={state === "working" ? "#9ca3af" : "#0065A4"} />
        <span>{state === "working" ? "BitGraphing…" : "BitGraph this file Again"}</span>
      </button>
      {state === "error" && (
        <div style={{ fontSize: 12.5, color: "#dc2626", textAlign: "center" }}>
          Could not record a new position. Try again in a moment.
        </div>
      )}
    </>
  );
}

function JsonSection({ proof }: { proof: BitGraphProof }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(proof, null, 2);
  return (
    <CollapsibleCard title="Raw JSON">
      {/* No copy button: click anywhere on the JSON to copy it, the same
          tap-to-copy affordance every Field uses. A brief "Copied!" chip
          confirms it without hiding the content. */}
      <div style={{ padding: "14px 16px", position: "relative" }}>
        {copied && (
          <span style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 50,
            padding: "10px 22px", fontSize: 14, fontWeight: 700, color: "#fff",
            background: "#0065A4", borderRadius: 0, pointerEvents: "none",
            boxShadow: "0 4px 20px rgba(0,0,0,0.22)",
          }}>
            Copied!
          </span>
        )}
        <pre
          onClick={() => { navigator.clipboard.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          style={{
            fontSize: 12,
            lineHeight: 1.6,
            color: "#374151",
            padding: 14,
            margin: 0,
            background: "#f9fafb",
            border: "1px solid #e5e7eb",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            fontFamily: mono,
            cursor: "pointer",
          }}
        >
          {json}
        </pre>
      </div>
    </CollapsibleCard>
  );
}

/* ── Bring-your-file checker — when no artifact is cached on this device, let
   the visitor supply the file. It is hashed in the browser and matched against
   the proof's digest; on a match the page fills in (image + C2PA), on a
   mismatch it says so. Nothing is uploaded. ── */

function BringYourFile({
  proof,
  onMatch,
}: {
  proof: BitGraphProof;
  onMatch: (rec: { name: string; data: ArrayBuffer; c2pa: C2PAReadResult | null; c2paChecked: boolean }) => void;
}) {
  const [state, setState] = useState<"idle" | "checking" | "mismatch">("idle");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function check(file: File | undefined | null) {
    if (!file) return;
    setState("checking");
    try {
      const digest = await hashFile(file);
      if (digest !== proof.artifact.digestB64) { setState("mismatch"); return; }
      const data = await file.arrayBuffer();
      let c2pa: C2PAReadResult | null = null;
      try {
        const { readC2PA } = await import("@/lib/c2pa-reader");
        c2pa = await readC2PA(file);
      } catch (e) { console.warn("[bitgraph] c2pa read failed:", e); }
      // Persist to the same IndexedDB store the page reads, so it survives reloads.
      try {
        const db = await new Promise<IDBDatabase>((res, rej) => {
          const req = indexedDB.open("bitgraph-files", 1);
          req.onupgradeneeded = () => req.result.createObjectStore("files");
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
        const tx = db.transaction("files", "readwrite");
        tx.objectStore("files").put({ name: file.name, data, c2pa, c2paChecked: true }, proof.artifact.digestB64);
        await new Promise((r, j) => { tx.oncomplete = () => r(null); tx.onerror = () => j(tx.error); });
        db.close();
      } catch (e) { console.warn("[bitgraph] cache write failed:", e); }
      onMatch({ name: file.name, data, c2pa, c2paChecked: true });
    } catch {
      setState("mismatch");
    }
  }

  const mismatch = state === "mismatch";
  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); check(e.dataTransfer.files?.[0]); }}
      style={{
        background: "#fff",
        border: `2px dashed ${mismatch ? "#dc2626" : dragOver ? "#0065A4" : "#c4c9d0"}`,
        padding: "34px 24px",
        textAlign: "center",
        cursor: "pointer",
        transition: "border-color .15s",
      }}
    >
      <input ref={inputRef} type="file" style={{ display: "none" }} onClick={(e) => e.stopPropagation()} onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; check(f); }} />
      {state === "checking" ? (
        <div style={{ fontSize: 15, fontWeight: 600, color: "#6b7280" }}>Checking…</div>
      ) : mismatch ? (
        <>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#dc2626" }}>These bytes don&rsquo;t match this BitGraph</div>
          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 6 }}>A single changed bit produces a completely different hash. Drop the exact original to check again.</div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>Have the file? Check it against this BitGraph.</div>
          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 6 }}>Drop it here or click to choose. Hashed in your browser, nothing is uploaded.</div>
        </>
      )}
    </div>
  );
}

/* ── Photo preview card — shows the artifact image when one is available ── */

function PhotoCard({
  cachedFile,
  c2pa,
  bare,
}: {
  cachedFile: { name: string; data: ArrayBuffer } | null;
  c2pa?: C2PAReadResult | null;
  /** Skip the card chrome (used inside the BitGraphed File collapsible). */
  bare?: boolean;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  // Build an object URL for image preview if the cached file is an image.
  //
  //   1. Browser-native formats (JPEG, PNG, GIF, WebP, AVIF, BMP, TIFF) → blob URL
  //   2. HEIC/HEIF → convert to JPEG via heic2any (lazy-loaded ~500 KB).
  //      iPhones shoot HEIC by default.
  //   3. RAW camera formats (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2, PEF,
  //      SRW, X3F) → extract the embedded JPEG preview from the raw bytes.
  //
  // The <img> onError handler clears previewUrl so an unsupported format
  // never renders as a broken image — it falls back to the C2PA thumbnail
  // or to nothing.
  useEffect(() => {
    if (!cachedFile) { setPreviewUrl(null); setPreviewFailed(false); return; }
    const name = cachedFile.name.toLowerCase();

    const isHeic = /\.(heic|heif)$/i.test(name);
    const isRaw = /\.(cr2|cr3|nef|arw|dng|raf|orf|rw2|pef|srw|raw|x3f)$/i.test(name);
    // Prefer the extension, but fall back to sniffing magic bytes so a
    // browser-renderable image still previews when the filename has no or an
    // odd extension (some AI exports / ChatGPT downloads arrive that way).
    const isNative =
      /\.(jpe?g|png|gif|webp|avif|bmp|tiff?)$/i.test(name) ||
      (!isHeic && !isRaw && sniffNativeImage(cachedFile.data));

    if (!isNative && !isHeic && !isRaw) {
      setPreviewUrl(null);
      return;
    }

    if (isRaw) {
      const rawData = new Uint8Array(cachedFile.data);
      const jpegBlob = extractJpegFromRaw(rawData);
      if (jpegBlob) {
        const url = URL.createObjectURL(jpegBlob);
        setPreviewUrl(url);
        return () => URL.revokeObjectURL(url);
      }
      setPreviewUrl(null);
      return;
    }

    let revoke: (() => void) | null = null;

    if (isHeic) {
      (async () => {
        try {
          const heic2any = (await import("heic2any")).default;
          const blob = new Blob([new Uint8Array(cachedFile.data)]);
          const result = await heic2any({ blob, toType: "image/jpeg", quality: 0.85 });
          const jpegBlob = Array.isArray(result) ? result[0] : result;
          const url = URL.createObjectURL(jpegBlob);
          setPreviewUrl(url);
          revoke = () => URL.revokeObjectURL(url);
        } catch (e) {
          console.warn("[bitgraph] heic2any conversion failed:", e);
          setPreviewUrl(null);
        }
      })();
    } else {
      const blob = new Blob([new Uint8Array(cachedFile.data)]);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      revoke = () => URL.revokeObjectURL(url);
    }

    setPreviewFailed(false);
    return () => { revoke?.(); };
  }, [cachedFile]);

  // Image source fallback chain:
  //   1. Local preview URL (converted if HEIC, blob if native)
  //   2. C2PA embedded thumbnail (covers RAW + shared links with no cached file)
  //   3. Nothing — the card is not rendered
  const imageSrc = (!previewFailed && previewUrl) || c2pa?.thumbnailDataUrl || "";
  if (!imageSrc) return null;

  const alt = cachedFile?.name || c2pa?.title || "Proof artifact";

  // One frame rule for every orientation: uniform padding, and the photo
  // fills the padded area up to its caps — a landscape runs to the side
  // padding, a portrait to the height cap, a square to whichever comes
  // first. Long and short edges get the same breathing room either way.
  return (
    <div
      style={{
        background: "#ffffff",
        border: bare ? "none" : "1px solid #d0d5dd",
        borderRadius: 0,
        padding: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageSrc}
        alt={alt}
        onError={() => { if (previewUrl) setPreviewFailed(true); }}
        style={{
          display: "block",
          maxWidth: "100%",
          maxHeight: "min(70vh, 640px)",
          width: "auto",
          height: "auto",
          objectFit: "contain",
          borderRadius: 0,
        }}
      />
    </div>
  );
}

/* ── Non-image file display — the file is in hand but is not a picture, so
   show it the way the browser natively can: text gets an inline excerpt,
   PDFs an embedded view, audio/video their native players, and anything
   else its identity. Every kind closes with the same name · size row; the
   kinds a browser can render in a full tab (text, PDF) add an Open link
   there. Bytes never leave the device — everything runs on object URLs. */

const TEXT_EXT = /\.(txt|md|markdown|json|csv|tsv|log|xml|ya?ml|toml|ini|html?|css|mjs|cjs|jsx?|tsx?|py|rb|go|rs|java|c|h|cpp|hpp|swift|kt|sh|zsh|bash|sql|env|cfg|conf|srt|vtt|tex)$/i;
const VIDEO_EXT = /\.(mp4|m4v|webm|mov|ogv)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|oga|ogg|opus)$/i;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// A cheap "is this text?" sniff for files whose extension says nothing: no
// NUL bytes and almost everything printable in the first 2 KB.
function looksLikeText(buffer: ArrayBuffer): boolean {
  const b = new Uint8Array(buffer, 0, Math.min(2048, buffer.byteLength));
  if (!b.length) return false;
  let ok = 0;
  for (const c of b) {
    if (c === 0) return false;
    if (c === 9 || c === 10 || c === 13 || c >= 32) ok++;
  }
  return ok / b.length > 0.97;
}

function fileKind(name: string, data: ArrayBuffer): { kind: "pdf" | "video" | "audio" | "text" | "other"; mime: string } {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return { kind: "pdf", mime: "application/pdf" };
  if (VIDEO_EXT.test(n)) {
    const mime = n.endsWith(".webm") ? "video/webm" : n.endsWith(".mov") ? "video/quicktime" : n.endsWith(".ogv") ? "video/ogg" : "video/mp4";
    return { kind: "video", mime };
  }
  if (AUDIO_EXT.test(n)) {
    const mime = n.endsWith(".mp3") ? "audio/mpeg" : n.endsWith(".wav") ? "audio/wav" : n.endsWith(".m4a") || n.endsWith(".aac") ? "audio/mp4" : n.endsWith(".flac") ? "audio/flac" : "audio/ogg";
    return { kind: "audio", mime };
  }
  if (TEXT_EXT.test(n) || looksLikeText(data)) return { kind: "text", mime: "text/plain" };
  return { kind: "other", mime: "application/octet-stream" };
}

function FileCard({ cachedFile }: { cachedFile: { name: string; data: ArrayBuffer } }) {
  const { kind, mime } = fileKind(cachedFile.name, cachedFile.data);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (kind === "other") { setUrl(null); return; }
    const u = URL.createObjectURL(new Blob([new Uint8Array(cachedFile.data)], { type: mime }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [cachedFile, kind, mime]);

  // Text excerpt: enough lines to see what the document is, never the whole
  // thing — Open shows the full file in its own tab.
  let excerpt: { text: string; truncated: boolean } | null = null;
  if (kind === "text") {
    try {
      const raw = new TextDecoder("utf-8", { fatal: false }).decode(cachedFile.data.slice(0, 6000));
      const lines = raw.split("\n");
      const text = lines.slice(0, 24).join("\n").slice(0, 3000);
      excerpt = { text, truncated: lines.length > 24 || raw.length > text.length || cachedFile.data.byteLength > 6000 };
    } catch { excerpt = null; }
  }

  // PDF gets no inline embed: an iframe can render blank or dark on some
  // browsers / for odd bytes, and a broken-looking preview is the wrong thing
  // on a proof page. It gets the identity row + Open →, which hands the file to
  // the browser's own full PDF viewer in a new tab.
  const openable = kind === "text" || kind === "pdf";
  const hasPreviewAbove = kind === "text" || kind === "video" || kind === "audio";
  return (
    <div style={{ background: "#ffffff" }}>
      {kind === "text" && excerpt && (
        <pre style={{ margin: 0, padding: 16, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5, lineHeight: 1.6, color: "#374151", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 320, overflow: "hidden" }}>
          {excerpt.text}{excerpt.truncated ? "\n…" : ""}
        </pre>
      )}
      {kind === "video" && url && (
        <div style={{ padding: 20, display: "flex", justifyContent: "center" }}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={url} controls style={{ display: "block", maxWidth: "100%", maxHeight: "min(70vh, 640px)", borderRadius: 0 }} />
        </div>
      )}
      {kind === "audio" && url && (
        <div style={{ padding: "20px 16px" }}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio src={url} controls style={{ display: "block", width: "100%" }} />
        </div>
      )}
      {/* The identity row every kind closes with. For formats with no inline
          rendering it is the whole display: the file's name and size, held by
          the receipt — the hash below is the part that matters. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderTop: hasPreviewAbove ? "1px solid #eef0f1" : "none" }}>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, color: "#6b7280" }}>
          <span style={{ fontWeight: 600, color: "#111827" }}>{cachedFile.name}</span>
          {" · "}{fmtBytes(cachedFile.data.byteLength)}
        </span>
        {openable && url && (
          <a href={url} target="_blank" rel="noopener" style={{ flexShrink: 0, fontSize: 14, fontWeight: 600, color: "#0065A4", textDecoration: "none", whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>
            Open <span aria-hidden>&rarr;</span>
          </a>
        )}
      </div>
    </div>
  );
}

/* ── Content Credentials (C2PA) card — the file's self-declared provenance ──
   Pass-through of the manifest embedded in the artifact bytes. BitGraph does
   not vouch for these claims; it pins the exact bytes that carry them. Only
   recognized IPTC source types get a friendly label, so an unknown code falls
   back to the generator line rather than guessing. */

const SOURCE_TYPE_LABELS: Record<string, string> = {
  trainedAlgorithmicMedia: "Generated by AI",
  compositeWithTrainedAlgorithmicMedia: "Contains AI-generated elements",
  digitalCapture: "Camera capture",
};

// Turn a raw C2PA generator into a human label, e.g.
// "lightroom_classic/15.3.1" -> "Lightroom Classic 15.3.1". Prefers the
// structured claimGeneratorInfo (clean name + version), falling back to the
// User-Agent-style claim_generator string. Only word-initial letters are
// cased, so acronyms like "ChatGPT" / "OpenAI" survive untouched.
function formatGenerator(c2pa: C2PAReadResult): string | undefined {
  const prettify = (s: string) =>
    s.replace(/[_-]+/g, " ").trim().replace(/\b\w/g, (ch) => ch.toUpperCase());
  const info = c2pa.claimGeneratorInfo?.find((g) => g.name);
  if (info?.name) return info.version ? `${prettify(info.name)} ${info.version}` : prettify(info.name);
  const raw = c2pa.claimGenerator;
  if (!raw) return undefined;
  const [namePart, version] = raw.split(/\s+/)[0].split("/");
  return version ? `${prettify(namePart)} ${version}` : prettify(namePart);
}

function C2PACard({ c2pa }: { c2pa: C2PAReadResult }) {
  const sourceText = c2pa.digitalSourceType ? SOURCE_TYPE_LABELS[c2pa.digitalSourceType] : undefined;
  const generator = formatGenerator(c2pa);
  // OpenAI-origin credentials get a link to OpenAI's own verifier
  // (upload-only; it has no URL parameters, and BitGraph never holds the
  // bytes). The visitor uploads the same file there themselves, which is
  // exactly what makes the check independent of this site.
  const isOpenAI = /openai|chatgpt|gpt-image|dall.?e/i.test(
    [c2pa.claimGenerator, ...(c2pa.claimGeneratorInfo?.map((g) => g.name) || []), c2pa.signatureIssuer]
      .filter(Boolean).join(" "),
  );

  return (
    /* Collapsible like the other optional cards, plain title, no badge: the
       fields inside (Signed by, Source, Made with) say what the manifest
       claims; a header glyph must never imply validation. It never asserts
       the file is authentic. */
    <CollapsibleCard title="Content Credentials (C2PA)">
      {sourceText && <Field label="Source" value={sourceText} highlight />}
      {generator && <Field label="Made with" value={generator} />}
      {c2pa.creator && <Field label="Creator" value={c2pa.creator} />}
      {c2pa.signatureIssuer && <Field label="Signed by" value={c2pa.signatureIssuer} />}
      {isOpenAI && (
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #e2e5e9" }}>
          <a
            href="https://openai.com/research/verify/"
            target="_blank" rel="noopener"
            className="bg-btn-outline"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
              width: "100%", height: 76, fontSize: 16, fontWeight: 500,
              color: "#0065A4", background: "#f4f6f9",
              border: "1px solid #0065A4", borderRadius: 0,
              textDecoration: "none", cursor: "pointer",
            }}
          >
            <BtnIcon name="certificate" />
            <span>Verify with OpenAI</span>
          </a>
        </div>
      )}
    </CollapsibleCard>
  );
}

/* ── Sniff browser-renderable image types from magic bytes ──
   Lets the preview work when the filename has no usable extension (some AI
   exports / ChatGPT downloads arrive that way). Covers only the formats an
   <img> renders directly; HEIC and RAW are handled separately since they
   need conversion. */
/* Whether a cached file can actually be shown as an image. When it can't (e.g.
   a cached .txt arriving via the home "Open" link, or any non-image artifact),
   PhotoCard would render nothing, so the proof page should fall through to the
   bring-your-file checker instead of showing an empty slot. */
function isDisplayableImage(
  f: { name: string; data: ArrayBuffer } | null | undefined,
  c2pa?: C2PAReadResult | null,
): boolean {
  if (c2pa?.thumbnailDataUrl) return true;
  if (!f) return false;
  if (/\.(jpe?g|png|gif|webp|avif|bmp|tiff?|heic|heif|cr2|cr3|nef|arw|dng|raf|orf|rw2|pef|srw|raw|x3f)$/i.test(f.name)) return true;
  return sniffNativeImage(f.data);
}

function sniffNativeImage(buffer: ArrayBuffer): boolean {
  const b = new Uint8Array(buffer, 0, Math.min(16, buffer.byteLength));
  if (b.length < 4) return false;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true; // PNG
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;                  // JPEG
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return true;                  // GIF
  if (b[0] === 0x42 && b[1] === 0x4d) return true;                                   // BMP
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) ||
      (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a)) return true; // TIFF
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true;  // RIFF/WEBP
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 &&
      b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69 && b[11] === 0x66) return true;  // ftyp 'avif'
  return false;
}

/* ── Extract embedded JPEG preview from RAW camera files ── */

/**
 * RAW camera files (CR2, NEF, ARW, DNG, RAF, etc.) embed one or more
 * JPEG previews for the camera's LCD screen. This function scans the
 * raw bytes for JPEG start (0xFF 0xD8) and end (0xFF 0xD9) markers and
 * returns the largest *browser-renderable* JPEG block.
 *
 * The renderable check matters for DNG: DNGs store the raw sensor data
 * as a lossless JPEG (Start-Of-Frame marker 0xC3) that is far larger
 * than the baseline preview but cannot be decoded by an <img>. Grabbing
 * the largest block blindly picks that lossless stream and shows no
 * preview, so we accept only baseline / extended / progressive frames
 * (0xC0 / 0xC1 / 0xC2) and take the largest of those.
 *
 * No external dependency. Works for every major DSLR RAW format.
 */
function extractJpegFromRaw(data: Uint8Array): Blob | null {
  // Collect every JPEG SOI (Start Of Image) offset.
  const starts: number[] = [];
  for (let i = 0; i < data.length - 1; i++) {
    if (data[i] === 0xFF && data[i + 1] === 0xD8) starts.push(i);
  }
  if (starts.length === 0) return null;

  // Walk a JPEG's marker segments to read its Start-Of-Frame type.
  // Browsers decode only baseline (C0), extended-sequential (C1), and
  // progressive (C2); lossless (C3) and arithmetic (C9–CB) fail.
  const frameType = (start: number, end: number): number | null => {
    let i = start + 2;
    while (i < end - 1) {
      if (data[i] !== 0xFF) { i++; continue; }
      let marker = data[i + 1];
      while (marker === 0xFF && i + 2 < end) { i++; marker = data[i + 1]; } // skip fill bytes
      // Standalone markers (SOI, TEM, RSTn, EOI) carry no length payload.
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD9)) { i += 2; continue; }
      // Start-Of-Frame markers are 0xC0–0xCF except DHT(C4), JPG(C8), DAC(CC).
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        return marker;
      }
      if (i + 3 >= end) break;
      const len = (data[i + 2] << 8) | data[i + 3];
      if (len < 2) break;
      i += 2 + len;
    }
    return null;
  };

  let bestStart = -1, bestEnd = -1, bestSize = 0;   // largest renderable JPEG
  let fbStart = -1, fbEnd = -1, fbSize = 0;          // fallback: largest of any type

  for (let s = 0; s < starts.length; s++) {
    const start = starts[s];
    // Search boundary: next JPEG SOI or end of file.
    const boundary = s + 1 < starts.length ? starts[s + 1] : data.length;

    // Last JPEG EOI (End Of Image) before the boundary.
    let end = -1;
    for (let j = boundary - 2; j >= start + 2; j--) {
      if (data[j] === 0xFF && data[j + 1] === 0xD9) { end = j + 2; break; }
    }

    if (end < 0) continue;
    const size = end - start;
    if (size <= 10000) continue; // skip tiny thumbnails — we want the full-res preview

    if (size > fbSize) { fbStart = start; fbEnd = end; fbSize = size; }

    const sof = frameType(start, end);
    const renderable = sof === 0xC0 || sof === 0xC1 || sof === 0xC2;
    if (renderable && size > bestSize) { bestStart = start; bestEnd = end; bestSize = size; }
  }

  // Prefer the largest renderable JPEG; if none was confirmed (odd container),
  // fall back to the largest block found — still better than no preview.
  const outStart = bestStart >= 0 ? bestStart : fbStart;
  const outEnd = bestStart >= 0 ? bestEnd : fbEnd;
  if (outStart < 0) return null;
  return new Blob([data.slice(outStart, outEnd)], { type: "image/jpeg" });
}

/* ── Attestation Verifier (modal) ── */

function AttestationButton({ reportB64, measurement, proof }: { reportB64: string; measurement: string; proof: BitGraphProof }) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<NitroVerifyResult | null>(null);
  const [copiedReport, setCopiedReport] = useState(false);

  async function runVerify() {
    setRunning(true);
    setResult(null);
    // Yield to allow UI repaint
    await new Promise((r) => setTimeout(r, 50));
    try {
      // Recompute this proof's hash and require the attestation's user_data to
      // match it, so a genuine attestation can't be lifted onto a forged proof.
      const expectedUserData = await proofHashB64(proof);
      const r = await verifyNitroAttestation(reportB64, measurement, expectedUserData);
      setResult(r);
    } catch (e) {
      setResult({
        valid: false,
        checks: [{ name: "Verification Error", pass: false, detail: e instanceof Error ? e.message : String(e) }],
        pcrs: {},
      });
    }
    setRunning(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); runVerify(); }}
        className="bg-btn-outline"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
          width: "100%", height: 76, fontSize: 16, fontWeight: 500,
          color: "#0065A4", background: "#f4f6f9",
          border: "1px solid #0065A4", borderRadius: 0,
          cursor: "pointer",
        }}
      >
        <BtnIcon name="certificate" />
        <span>Verify Attestation</span>
      </button>
    );
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={() => setOpen(false)}
    >
      <div
        style={{ width: "100%", maxWidth: 720, maxHeight: "85vh", display: "flex", flexDirection: "column", background: "#fff", borderRadius: 0, border: "1px solid #d0d5dd", overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #e5e7eb" }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--c-accent)" }}>AWS Nitro Attestation Verification</span>
          <button onClick={() => setOpen(false)} style={{ padding: "5px 12px", fontSize: 12, fontWeight: 600, color: "#fff", background: "var(--c-accent)", border: "none", borderRadius: 0, cursor: "pointer" }}>Close</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "auto", padding: "18px 20px" }}>
          {running && (
            <div style={{ padding: "40px 20px", textAlign: "center", color: "#6b7280", fontSize: 14 }}>
              Verifying signature, certificate chain, and PCR0…
            </div>
          )}

          {result && (
            <>
              {/* Overall status */}
              <div style={{
                padding: "14px 18px", marginBottom: 16, borderRadius: 0,
                background: result.valid ? "#f0f6ff" : "#fef2f2",
                border: `1px solid ${result.valid ? "#bfdbfe" : "#fecaca"}`,
              }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: result.valid ? "#0065A4" : "#dc2626" }}>
                  {result.valid ? "Attestation Verified" : "Verification Failed"}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                  {result.valid
                    ? "All checks passed. This BitGraph was signed inside an AWS Nitro Enclave with the displayed PCR0."
                    : "One or more verification steps failed. See details below."}
                </div>
              </div>

              {/* Checks */}
              <div style={{ marginBottom: 18 }}>
                {result.checks.map((c, i) => (
                  <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: i < result.checks.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                    <span style={{ fontSize: 16, color: c.pass ? "#0065A4" : "#dc2626", flexShrink: 0 }}>{c.pass ? "✓" : "✗"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2, wordBreak: "break-all" }}>{c.detail}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Decoded fields */}
              {(result.moduleId || result.timestamp || result.certChainLength) && (
                <div style={{ marginBottom: 18, padding: "14px 18px", background: "#f9fafb", borderRadius: 0, border: "1px solid #e5e7eb" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Decoded from Attestation Document</div>
                  {result.moduleId && (
                    <div style={{ fontSize: 12, color: "#374151", marginBottom: 4, wordBreak: "break-all" }}>
                      <span style={{ color: "#6b7280" }}>Module ID: </span>{result.moduleId}
                    </div>
                  )}
                  {result.timestamp && (
                    <div style={{ fontSize: 12, color: "#374151", marginBottom: 4 }}>
                      <span style={{ color: "#6b7280" }}>Timestamp: </span>{stampTz(new Date(result.timestamp))}
                    </div>
                  )}
                  {result.certChainLength && (
                    <div style={{ fontSize: 12, color: "#374151" }}>
                      <span style={{ color: "#6b7280" }}>Certificate Chain: </span>{result.certChainLength} certificates
                    </div>
                  )}
                </div>
              )}

              {/* Other PCRs */}
              {Object.keys(result.pcrs).length > 1 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Other Active PCRs</div>
                  {Object.entries(result.pcrs)
                    .filter(([idx]) => idx !== "0")
                    .map(([idx, hex]) => (
                      <div key={idx} style={{ fontSize: 11, fontFamily: mono, color: "#6b7280", marginBottom: 4, wordBreak: "break-all" }}>
                        <span style={{ color: "#6b7280" }}>PCR{idx}: </span>{hex}
                      </div>
                    ))}
                </div>
              )}

              {/* Reproducible build */}
              <div style={{ padding: "14px 18px", background: "rgba(0,101,164,0.04)", border: "1px solid rgba(0,101,164,0.15)", borderRadius: 0, marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--c-accent)", marginBottom: 6 }}>What PCR0 proves</div>
                <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.5, marginBottom: 8 }}>
                  PCR0 is the SHA-384 hash of the exact enclave image that signed this BitGraph, shown above. The enclave source is open and the build is bit-for-bit reproducible: you can rebuild it on any linux/amd64 host and re-derive this exact PCR0 yourself, trusting no one. You do not have to take BitGraph at its word for what runs inside the boundary.
                </div>
                <a href="/docs/self-host-tee" target="_blank" rel="noopener" style={{ fontSize: 12, fontWeight: 600, color: "var(--c-accent)", textDecoration: "none" }}>
                  Rebuild and verify this PCR0 &rarr;
                </a>
              </div>

              {/* Raw report */}
              <div style={{ padding: "12px 16px", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em" }}>Raw Attestation Report</div>
                  <button
                    onClick={() => { navigator.clipboard.writeText(reportB64); setCopiedReport(true); setTimeout(() => setCopiedReport(false), 1500); }}
                    style={{ fontSize: 11, fontWeight: 600, color: "var(--c-accent)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    {copiedReport ? "Copied!" : "Copy"}
                  </button>
                </div>
                <div style={{ fontSize: 10, fontFamily: mono, color: "#6b7280", wordBreak: "break-all", maxHeight: 60, overflow: "hidden" }}>
                  {reportB64.slice(0, 200)}...
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
