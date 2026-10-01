"use client";

import { DropPrompt, Browse } from "@/components/drop-prompt";
import { useState, useEffect, useRef } from "react";
import { blockTimeFromHeader, type AnchorSide } from "@/lib/export-pages";
import { docxText, isDocx } from "@/lib/docx-text";
import { useParams } from "next/navigation";
// Nav is in root layout
import { hashBytes, proofHashB64, type BitGraphProof } from "@/lib/bitgraph";
import { findMatchInDrop, findMatchInFiles, findAnyMatchInDrop, findAnyMatchInFiles, captureDrop, type CapturedDrop } from "@/lib/folder-check";
import { zipSync, strToU8 } from "fflate";
import { anchorStatusDoc, isSettled, ANCHOR_STATUS_FILE, type BoundReport } from "@/lib/anchor-export";
import { verifyNitroAttestation, attestationTimestampMs, type NitroVerifyResult } from "@/lib/nitro-verify";
import { timeTz, stampTz, longDateTz, dateTz, sameDayTz, useTimeZoneMode, TimeChip } from "@/lib/format-time";
import type { C2PAReadResult } from "@/lib/c2pa-reader";
import { takeWarm, proofFeedKey, EXAMPLE_PROOF, PRESTON_PROOF_DIGEST, HOME_EXAMPLE_DIGEST } from "@/lib/warm";
import { useDashedEdges } from "@/lib/use-dashed-edges";
import { takeFreshProof } from "@/lib/fresh-proof";
import { loadLedger, heldFor } from "@/lib/local-ledger";

/* How the remembered ledger learns a fused proof's origin, so a page addressed
   by the original file's digest finds the proof that was built from it. The
   same reader the camera hands loadLedger. */
const originOfProof = (p: Parameters<typeof fusedMarkerOf>[0]) => {
  try { return fusedMarkerOf(p)?.originDigestB64 ?? null; } catch { return null; }
};
import { getPreviewFromIDB, putPreviewToIDB, cacheArtifactToIDB } from "@/lib/file-cache";
import { fusedMarkerOf, rebuildFromOrigin, unpackNewFile, fuseFile, FuseTooLargeError, rebuildSetMember, unpackSetMember, checkInline, isInlineProof } from "@/lib/fuse-client";
import { buildCarrierForProof, deCarrierFiles, fetchAnchorPair, assembleProofEvidence } from "@/lib/carrier-site";
import { verifyCarrierPayload, type CarrierClaim, type CarrierLookups } from "@mikeargento/bitgraph-verify";
import { ProofView, type ProofViewModel, type FieldView, type PositionRowView, type SetRowView, type DownloadView } from "./proof-view";
import { PUBLISHED_PCR0S, PUBLISHED_ENCLAVE_MEASUREMENTS } from "@/lib/enclave-measurements";
import { PKG_COMMITTED_DIR, PKG_ORIGINAL_DIR, PKG_CARRIER_DIR, PKG_README, packageReadme } from "@/lib/package-layout";
import { ENCODING_BASE64URL, bytesToBase64, bytesToHex, computeProofHash } from "@mikeargento/bitgraph-verify";
import { computeCommitmentFor } from "@/lib/fuse-commitment";
import { FUSE2_ATTRIBUTION_NAME, isFuseName } from "@/lib/fuse-core";

/** Carry encodings this page knows; anything else in the title is a placement. */
const ENCODING_IDS: string[] = [ENCODING_BASE64URL];

/** The commitment from a proof’s own slot record, base64url, for the row that lets a reader search the file.
 *  A bitgraph-fuse/2 marker means the commitment also binds the proof's signed floor block. */
function slotCommitmentOf(proof: unknown): string | null {
  const p = proof as { slotAllocation?: unknown; attribution?: { name?: unknown }; commit?: { slotAnchor?: { blockHash?: unknown } } } | null;
  const slot = p?.slotAllocation;
  if (!slot) return null;
  try {
    const floor = p?.attribution?.name === FUSE2_ATTRIBUTION_NAME ? (p?.commit?.slotAnchor?.blockHash as string | undefined) ?? null : null;
    return bytesToBase64(computeCommitmentFor(slot as never, floor)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  } catch { return null; }
}
import { SET_KEY, bindSet, bindSetMember, dropDigestsFor, isSetProof, memberEvidenceOf, memberOf, type BoundSet, type SetMemberRow } from "@/lib/fuse-set";
import { toUrlSafeB64, fromUrlSafeB64, truncateHash } from "@/lib/explorer";
import { Shell, ProofSkeleton } from "./proof-skeleton";
// QR code removed — replaced with Ethereum Seal card

const mono = "var(--font-mono), 'SF Mono', SFMono-Regular, monospace";

// Standard base64 -> url-safe, for comparing epoch ids against URL params.
const toSafeB64 = (s: string) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// A set proof's manifest is read here only once BOUND (bindSet: strict parse,
// hashed to the signed artifact digest and to the slot's commitment).
// Everything on this page that lists members, names a member's hashes or
// searches a drop for a member reads from that, never from the raw metadata,
// which is unsigned. The site's proof type is an interface; the set helpers
// take the plain record.
const asRecord = (p: BitGraphProof) => p as unknown as Record<string, unknown>;

// The window as a phrase, for interval proofs only (a legacy type): the floor
// as a time. The upper bound is omitted on purpose: the next anchor's block
// time is not an upper bound on a position (see the overview, "Where time
// comes from"); the lead card names the following anchor by position.
function formatWindow(lower: string | null, _upper: string | null): string | null {
  if (lower) { const t = new Date(lower); return `after ${stampTz(t)}`; }
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
/* Files the site hosts, so a shared proof link shows the picture instead of an
   empty "bring your file" box. Keyed by digest so an ordinary proof page
   fetches nothing: without the key there is one entry to try, and with it
   exactly one, never a list.

   ⚠️ THE HASH GUARD BELOW IS WHAT MAKES THIS SAFE, not this table. Whatever is
   fetched is displayed only if its bytes hash to the digest in the URL, so a
   wrong path or a re-encoded file shows nothing rather than the wrong picture.
   Do not remove that check on the grounds that the mapping is already correct.

   ❄️ The four two-images files (grok, chatgpt, gemini, mikeargento) were hosted
   here for the /docs/three-images demo. The page was removed 2026-08-10 and the
   images were deleted from public/ so they could no longer be opened in a
   browser, so their rows came out with them. Those five proof pages now show
   the bring-your-file box, which is the same thing every other user's proof
   page shows: a deliberate trade, not a regression. Do not re-add a row without
   putting the file back in the same commit, or the page fetches a 404 on every
   load. */
const EXAMPLE_FILES: Record<string, { path: string; name: string; mime: string }> = {
  [EXAMPLE_PROOF.digest]: { path: "/example/chatgpt.png", name: "chatgpt.png", mime: "image/png" },
  // The previous front-door example; kept so old links still show the photo.
  [PRESTON_PROOF_DIGEST]: { path: "/example/preston.jpg", name: "preston.jpg", mime: "image/jpeg" },
  // The home page's "See a real BitGraph": a text file that explains itself for a reader
  // who knows nothing about BitGraph, in the TRACE doc's words: it carries its position
  // commitment and the link to the anchor BitGraph recorded right after its position
  // opened, so it names both of the things it came after, and since 2026-09-30 the Base
  // block that came after it (BitGraph #4,546). Served so the preview shows without the
  // reader having to find the file.
  [HOME_EXAMPLE_DIGEST]:
    { path: "/example/bitgraph-demonstration-4.txt", name: "bitgraph-demonstration.txt", mime: "text/plain" },
  // The home example of 2026-09-27 (#3,178, before Base ceilings); kept so old links still show it.
  "pCAk_zQCEgu7EU4ErgfST3lmM7JwUojNCUBb8PH51nc":
    { path: "/example/bitgraph-demonstration-3.txt", name: "bitgraph-demonstration.txt", mime: "text/plain" },
  // The home example of 2026-09-22 (the commitment on line 4, the almanac line); kept so
  // old links still show it.
  "YYJh9nWOYBQUNvVmzy0kXvYTrAqLgmL9veqLHP7x-WU":
    { path: "/example/bitgraph-demonstration-2.txt", name: "bitgraph-demonstration.txt", mime: "text/plain" },
  // The previous home example (2026-09-20), without the almanac line; kept so old links still show it.
  "YVf5bpwcpBg4SsTh6XXBqBoYpYS68s1Tjog1u_cvRQ4":
    { path: "/example/bitgraph-demonstration.txt", name: "bitgraph-demonstration.txt", mime: "text/plain" },
};

/* Records a BitGraph demonstration site hosts by digest. Fetched only when a link
   asks with ?original=<key>, so an ordinary proof page still fetches nothing, and
   shown only through the same hash guard as EXAMPLE_FILES: the host is trusted for
   nothing. */
const ORIGINAL_HOSTS: Record<string, string> = {
  // BitGraph Postseason (2026-09-28): every call Jev made and its outcome, as sealed.
  postseason: "https://live.bitgraph.ing/by-digest/",
};

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
  // Base ceiling (bitgraph-ceiling/1): the record's ceiling in TIME, written
  // by the ceiling writer beside the proof, never inside it. A 404 means none
  // was written (every record before 2026-09-29, or one still queued), and
  // then the card is simply absent: nothing here implies a ceiling exists.
  const [baseCeiling, setBaseCeiling] = useState<{
    status: "pending" | "included" | "safe" | "finalized";
    anchor: { txHash: string; blockNumber: number; blockTimestamp: number } | null;
    floor?: { blockNumber: number; blockTimestamp: number } | null;
  } | null>(null);
  // Auto-check (Mike, 2026-09-30): the Base write lands seconds after the
  // commit, so a fresh proof keeps asking until its card appears (every 4 s,
  // up to 3 minutes), and an included one keeps asking until Base settles it
  // on Ethereum (every 15 s, up to 10 minutes). An old proof asks once.
  useEffect(() => {
    const ph = (proof as (BitGraphProof & { proofHash?: string }) | null)?.proofHash;
    if (!ph) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const safe = ph.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const rep = proof?.environment?.attestation?.reportB64;
    const madeMs = typeof rep === "string" && rep.length > 0 ? attestationTimestampMs(rep) : null;
    const fresh = freshRef.current === true || (madeMs !== null && Date.now() - madeMs < 10 * 60_000);
    const started = Date.now();
    const ask = async () => {
      let j: { version?: string; status?: string } | null = null;
      try {
        const r = await fetch(`/api/ceilings/${safe}`, { cache: "no-store" });
        j = r.ok ? await r.json() : null;
      } catch { j = null; }
      if (cancelled) return;
      if (j?.version === "bitgraph-ceiling/1") setBaseCeiling(j as never);
      const elapsed = Date.now() - started;
      const settled = j?.status === "safe" || j?.status === "finalized";
      // Nothing yet, or queued ("pending") and not yet in a block: ask again soon.
      if ((!j || j.status === "pending") && fresh && elapsed < 3 * 60_000) timer = setTimeout(ask, 4_000);
      else if (j && !settled && elapsed < 10 * 60_000) timer = setTimeout(ask, 15_000);
    };
    void ask();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [proof]);
  const [causalWindow, setCausalWindow] = useState<{
    anchorBefore: { counter: string; attrName: string; blockNumber: number | null; blockHash: string | null; etherscanUrl: string | null; blockTime?: string | null; digestB64?: string | null; recordedMs?: number | null } | null;
    anchorAfter: { counter: string; attrName: string; blockNumber: number | null; blockHash: string | null; etherscanUrl: string | null; blockTime?: string | null; digestB64?: string | null; recordedMs?: number | null } | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  /* The lookup came back empty AND said why: discovery is retired, so the
     emptiness is not a claim about these bytes. */
  const [retired, setRetired] = useState(false);
  const [cachedFile, setCachedFile] = useState<{ name: string; data: ArrayBuffer; c2pa?: C2PAReadResult | null; c2paChecked?: boolean } | null>(null);
  // Re-render every printed time when the viewer flips the zone toggle.
  useTimeZoneMode();
  // Which file the page holds for a fused proof: the original (accepted by
  // reconstruction) or the new file itself. Names the export action; an
  // ordinary recording has one file and needs no role.
  const [cachedRole, setCachedRole] = useState<"original" | "new" | null>(null);
  // The file cachedRole was worked out for. Until it is the file in hand the
  // role is still being told, and the last file's role must not show for it.
  const [roleOf, setRoleOf] = useState<object | null>(null);
  // A set proof (placement set/1) commits a manifest of N members under one
  // slot. Bound once the proof is in hand; null for everything else, and for
  // a set whose manifest is missing or does not hash to the signed digest.
  const [setBound, setSetBound] = useState<BoundSet | null>(null);
  useEffect(() => {
    if (!proof || !isSetProof(proof)) { setSetBound(null); return; }
    let cancelled = false;
    void bindSet(asRecord(proof)).then((b) => { if (!cancelled) setSetBound(b); }).catch(() => { if (!cancelled) setSetBound(null); });
    return () => { cancelled = true; };
  }, [proof]);
  // The checks (2026-09-30): the same claims the CLI answers, computed here from
  // the same evidence a download carries (assembleProofEvidence: the floor anchor
  // and its header, the closing anchor, the Base sidecar, each vetted), with the
  // file's bytes when they are in hand and are the committed bytes. Re-run when
  // a ceiling lands or a file arrives; confirmed against public nodes on request.
  const [checks, setChecks] = useState<{ state: "idle" | "running" | "done" | "failed"; claims: CarrierClaim[]; reading: string | null; verdict: "TRUE" | "FALSE" | "UNDETERMINED" | null; note: string | null; bytesInHand: boolean; confirming: boolean; confirmed: boolean }>({ state: "idle", claims: [], reading: null, verdict: null, note: null, bytesInHand: false, confirming: false, confirmed: false });
  // The floor and the closing anchor as the vetted evidence names them: the floor is the
  // proof's SIGNED commit.slotAnchor (the anchor fixed at allocation), which is what the
  // checks, the BitGraphed file and the docs mean by the floor; the window route's
  // "anchor before" is the anchor before the COMMIT, a tighter bound on the commit by
  // hash order, shown as a note.
  const [evidenceSides, setEvidenceSides] = useState<{
    floor: { counter: string; blockNumber: number; blockHash: string; timestamp: number | null; digestB64: string | null; recordedMs: number | null } | null;
    ceiling: { counter: string; blockNumber: number; blockHash: string; timestamp: number | null; digestB64: string | null; recordedMs: number | null } | null;
  }>({ floor: null, ceiling: null });
  const evidenceRef = useRef<{ payload: Parameters<typeof verifyCarrierPayload>[0]; forCounter: string | null; ceilings: string } | null>(null);
  const checksBytesRef = useRef<Uint8Array | null>(null);
  const runChecks = async (lookups?: CarrierLookups) => {
    if (!proof || !proof.commit?.slotAnchor) { setChecks((c) => ({ ...c, state: "failed", note: proof && !proof.commit?.slotAnchor ? "This proof was recorded before enclave v7 and carries no signed floor, so its window cannot be checked here; the signature and attestation can be checked from the package." : null })); return; }
    setChecks((c) => ({ ...c, state: c.state === "done" ? "done" : "running", confirming: lookups !== undefined }));
    try {
      const key = `${baseCeiling?.anchor?.txHash ?? "-"}|${causalWindow?.anchorAfter?.counter ?? "-"}`;
      let ev = evidenceRef.current;
      if (!ev || ev.forCounter !== (proof.commit.counter ?? null) || ev.ceilings !== key) {
        const assembled = await assembleProofEvidence(proof as never);
        ev = { payload: assembled.payload as never, forCounter: proof.commit.counter ?? null, ceilings: key };
        evidenceRef.current = ev;
      }
      const r = await verifyCarrierPayload(ev.payload, checksBytesRef.current, { pins: { pcr0: [...PUBLISHED_PCR0S] }, ...(lookups ? { lookups } : {}) });
      setChecks({ state: "done", claims: r.claims, reading: r.reading, verdict: r.verdict, note: null, bytesInHand: checksBytesRef.current !== null, confirming: false, confirmed: lookups !== undefined });
      const sideOf = (anchor: Record<string, unknown> | undefined, witness: { blockNumber: number; blockHash: string } | undefined, ts: number | null) => {
        const ac = (anchor as { commit?: { counter?: string } } | undefined)?.commit;
        const digest = (anchor as { artifact?: { digestB64?: string } } | undefined)?.artifact?.digestB64 ?? null;
        const rep = (anchor as { environment?: { attestation?: { reportB64?: string } } } | undefined)?.environment?.attestation?.reportB64;
        if (!ac || typeof ac.counter !== "string" || !witness) return null;
        return { counter: ac.counter, blockNumber: witness.blockNumber, blockHash: witness.blockHash, timestamp: ts, digestB64: digest, recordedMs: typeof rep === "string" ? attestationTimestampMs(rep) : null };
      };
      const p = ev.payload as { floor: { anchor: Record<string, unknown>; witness: { blockNumber: number; blockHash: string } }; ceiling: { status: string; anchor?: Record<string, unknown>; witness?: { blockNumber: number; blockHash: string } } };
      setEvidenceSides({
        floor: sideOf(p.floor.anchor, p.floor.witness, r.bounds?.notBefore.timestamp ?? null),
        ceiling: p.ceiling.status === "present" ? sideOf(p.ceiling.anchor, p.ceiling.witness, r.bounds?.notAfter?.timestamp ?? null) : null,
      });
    } catch (e) {
      setChecks((c) => ({ ...c, state: "failed", note: e instanceof Error ? e.message : String(e), confirming: false }));
    }
  };
  useEffect(() => {
    if (!proof) return;
    let cancelled = false;
    // The committed bytes, when they are in hand: a plain recording's file, or a fused
    // new file. An original in hand is not the artifact (it rebuilds into it), and a set's
    // artifact is its root document, so neither is offered as the bytes.
    // An anchor's bytes are the block hash it records, as text: they are in the proof itself.
    const attrib = proof.attribution as { name?: string; message?: string } | undefined;
    const anchorText = attrib?.name?.startsWith("Ethereum") ? attrib.message : undefined;
    const bytes = cachedFile && cachedRole !== "original" && !isSetProof(proof)
      ? new Uint8Array(cachedFile.data)
      : typeof anchorText === "string" && anchorText.length > 0 ? new TextEncoder().encode(anchorText) : null;
    (async () => {
      if (bytes) {
        const h = await hashBytes(bytes);
        if (cancelled) return;
        checksBytesRef.current = h === proof.artifact.digestB64 ? bytes : null;
      } else checksBytesRef.current = null;
      if (!cancelled) void runChecks();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proof, cachedFile, cachedRole, baseCeiling?.anchor?.txHash, causalWindow?.anchorAfter?.counter]);
  const confirmAgainstNodes = () => {
    const rpc = (url: string) => async (n: number): Promise<string | null> => {
      try {
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["0x" + n.toString(16), false] }), signal: AbortSignal.timeout(15_000) });
        const j = (await res.json()) as { result?: { hash?: string } | null };
        return j.result?.hash ?? null;
      } catch { return null; }
    };
    void runChecks({ ethereumBlockHash: rpc("https://ethereum-rpc.publicnode.com"), baseBlockHash: rpc("https://mainnet.base.org") });
  };
  // The manifest row the file in hand belongs to, when this is a set proof:
  // named by the verifier, which is also what decides the role below.
  const [heldMember, setHeldMember] = useState<SetMemberRow | null>(null);
  // A set/2 page reached by the SET's own digest has no member list and no
  // evidence, so a dropped member cannot be recognised locally: there is
  // nothing to compare it against. The drop asks the ledger instead, and what
  // comes back is kept here (Mike, 2026-09-07: "it works on home drop but not
  // proof card drop").
  const [resolvedMember, setResolvedMember] = useState<SetMemberRow | null>(null);
  useEffect(() => {
    const marker = (proof?.attribution as { name?: string; message?: string } | undefined);
    const settle = (role: "original" | "new" | null) => { setCachedRole(role); setRoleOf(cachedFile); };
    if (!cachedFile || !proof || !marker || !isFuseName(marker.name)) { settle(null); setHeldMember(null); return; }
    let cancelled = false;
    if (isSetProof(proof)) {
      // A member's original is accepted by reconstruction, its new file
      // directly; one verifier pass tells them apart and names the row.
      void unpackSetMember(proof, new Uint8Array(cachedFile.data), cachedFile.name).then((u) => {
        if (cancelled) return;
        const c = u.verification.category;
        settle(c === "SET_MEMBER_FROM_ORIGIN" ? "original" : c === "SET_MEMBER_DIRECT" ? "new" : null);
        setHeldMember(u.member);
      }).catch(() => { if (!cancelled) { settle(null); setHeldMember(null); } });
      return () => { cancelled = true; };
    }
    void hashBytes(new Uint8Array(cachedFile.data)).then((h) => {
      if (cancelled) return;
      settle(h === marker.message ? "original" : h === proof.artifact.digestB64 ? "new" : null);
    }).catch(() => { if (!cancelled) settle(null); });
    return () => { cancelled = true; };
  }, [cachedFile, proof]);
  // The new file's readable content. A wrapper placement (container/2, every text
  // file) puts the original inside a small tar, so previewing the new file's own
  // bytes showed the wrapper's header, "bitgraph-fuse/original" and zero padding,
  // instead of the text (Mike, 2026-09-28: "our sample proof shows more lines of
  // text than when i load this one"). The original comes back out the way the
  // "Original file" download takes it, and is previewed in the new file's place.
  // Kept with the file it came from, so a stale result never shows for another,
  // and kept when nothing came out (original: null), so the preview stops waiting.
  const [heldOriginal, setHeldOriginal] = useState<{ of: object; original: { name: string; data: ArrayBuffer } | null } | null>(null);
  useEffect(() => {
    if (!cachedFile || !proof || cachedRole !== "new" || isInlineProof(proof)) return;
    let live = true;
    const bytes = new Uint8Array(cachedFile.data);
    const unpacked = isSetProof(proof)
      ? unpackSetMember(proof, bytes, cachedFile.name, setBound?.bytes ?? null)
      : unpackNewFile(proof, bytes, cachedFile.name);
    void unpacked.then((u) => {
      if (!live) return;
      setHeldOriginal({
        of: cachedFile,
        original: u.originalBytes ? { name: u.originalName ?? cachedFile.name, data: u.originalBytes.slice().buffer as ArrayBuffer } : null,
      });
    }).catch(() => {
      // The preview falls back to the new file's own bytes.
      if (live) setHeldOriginal({ of: cachedFile, original: null });
    });
    return () => { live = false; };
  }, [cachedFile, proof, cachedRole, setBound]);
  // An inline marker declares that the commitment sits in the artifact's own
  // bytes. When the bytes are on this device the page checks that rather than
  // repeating it: category, the offset where it actually is, and the
  // commitment recomputed from the proof's own slot record. Null until the
  // check runs, so the row can say which of the two it is showing.
  const [inlineFound, setInlineFound] = useState<{ category: string; offset: number | null; commitmentB64: string | null } | null>(null);
  useEffect(() => {
    if (!cachedFile || !proof || !isInlineProof(proof)) { setInlineFound(null); return; }
    let cancelled = false;
    void checkInline(proof, new Uint8Array(cachedFile.data))
      .then((r) => { if (!cancelled) setInlineFound(r); })
      .catch(() => { if (!cancelled) setInlineFound(null); });
    return () => { cancelled = true; };
  }, [cachedFile, proof]);

  // Export fetches the two ETH anchors and their block-header witnesses before
  // zipping, so it is a real wait, not an instant download. The link reports it.
  const [exporting, setExporting] = useState(false);
  // The carrier download: the file with its proof inside (lib/carrier-site).
  const [carrierBusy, setCarrierBusy] = useState(false);
  const [carrierMsg, setCarrierMsg] = useState<string | null>(null);
  // The two piece-downloads beside the package: the anchor pair, and the original.
  const [anchorsBusy, setAnchorsBusy] = useState(false);
  const [anchorsMsg, setAnchorsMsg] = useState<string | null>(null);
  const [originBusy, setOriginBusy] = useState(false);
  const [originMsg, setOriginMsg] = useState<string | null>(null);

  /* The /folder browser's preview fallback lived here 2026-08-06 to
     2026-08-07 (a cached ~512px stand-in for remembered recordings) and was
     removed with the browser itself. The bytes handoff through
     bitgraph-files still populates the picture for any row clicked while
     the bytes are in hand. */

  // The hosted examples are the only artifacts BitGraph serves publicly, so
  // their proof pages can show the picture to anyone — a shared link or a cold
  // device, with nothing in IndexedDB. Every other proof stays device-only by
  // design: user files are never uploaded, so a stranger sees the
  // bring-your-file box.
  //
  // This was gated on the single curated digest and had to learn a set when the
  // /subjects C2PA demo added three more. Gating on a constant rather than on
  // the table is why hosting those files did nothing at first: the table was
  // never consulted.
  const examplePulled = useRef(false);
  useEffect(() => {
    /* Guard with a ref, not on cachedFile: depending on it would tear this
       effect down the moment we set the bytes, cancelling the C2PA parse that
       follows and leaving a shared link with a photo but no credentials card.
   
       ⚠️ A CANCELLED RUN MUST RELEASE THE CLAIM. React invokes effects twice in
       development, and the ref made that non-idempotent: the first run took the
       ref and started fetching, its cleanup cancelled it, and the second run saw
       the ref already taken and did nothing at all. The picture never appeared,
       but only when arriving by client-side navigation, which is exactly how a
       reader arrives from the /subjects demo. A hard load ran once and worked,
       so it looked fine everywhere it was tested. */
    const d = decodeURIComponent(digestParam);
    const hostKey = new URLSearchParams(window.location.search).get("original");
    const host = hostKey && Object.hasOwn(ORIGINAL_HOSTS, hostKey) ? ORIGINAL_HOSTS[hostKey] : null;
    const example: { path: string; name: string; mime: string } | null = EXAMPLE_FILES[d]
      ?? (host ? { path: host + d.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), name: "record.json", mime: "application/json" } : null);
    if (!example || examplePulled.current) return;
    examplePulled.current = true;
    let cancelled = false;
    let settled = false;
    void (async () => {
      try {
        const r = await fetch(example.path);
        if (!r.ok || cancelled) return;
        const name = r.headers.get("X-Record-Name") ?? example.name;
        const data = await (await r.blob()).arrayBuffer();
        // Same guard the IDB path uses: only show bytes that hash to this proof.
        let digestB64 = decodeURIComponent(digestParam).replace(/-/g, "+").replace(/_/g, "/");
        while (digestB64.length % 4 !== 0) digestB64 += "=";
        if ((await hashBytes(new Uint8Array(data))) !== digestB64) return;
        if (cancelled) return;
        settled = true;
        setCachedFile({ name, data });
        // Parse the embedded credentials too, or a shared link would show the
        // photo but not the Content Credentials card that is half its point.
        try {
          const { readC2PA } = await import("@/lib/c2pa-reader");
          const c2pa = await readC2PA(new Blob([new Uint8Array(data)], { type: example.mime }));
          if (!cancelled) setCachedFile({ name, data, c2pa, c2paChecked: true });
        } catch { /* the photo still shows without the card */ }
      } catch { /* falls back to the bring-your-file box */ }
    })();
    return () => {
      cancelled = true;
      // Hand the claim back if this run never delivered, so the next one can.
      if (!settled) examplePulled.current = false;
    };
  }, [digestParam]);

  // The anchor's OWN Ethereum block (number + timestamp), for the "Recorded"
  // line on Ethereum-anchor pages. Null for user proofs.
  const [anchorBlock, setAnchorBlock] = useState<{ blockNumber: number | null; blockTime: string | null; etherscanUrl: string | null } | null>(null);
  // When each bracketing anchor was itself RECORDED, per the enclave platform's
  // signed clock (Mike, 2026-09-27: "the anchors should bracket it. but as you
  // can see this is after its bracket?"). The ceiling card used to show only the
  // ceiling block's MINE time under "Before anchor #K", which reads as a clock
  // ceiling and is not one: an anchor is recorded after the block it carries.
  // On #1,012 the block was mined 9:44:59 PM, the file recorded 9:45:01, and
  // the anchor recorded 9:45:06, so the file looked out of its bracket while
  // sitting exactly inside it. Canon 3.6's "one error", on a card. Reading the
  // anchor's own attested instant lets the ceiling card show the real bound.
  // Cached digest-API reads, after first paint; a failed read just leaves the
  // field off, since the positional title is already true without it.
  const [anchorRecordedMs, setAnchorRecordedMs] = useState<{ before: number | null; after: number | null }>({ before: null, after: null });
  useEffect(() => {
    const w = causalWindow;
    if (!w) return;
    let cancelled = false;
    const urlsafe = (b: string) => b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const readOne = async (a: { counter: string; digestB64?: string | null; recordedMs?: number | null } | null): Promise<number | null> => {
      // The window now carries each anchor's recorded time, read on the server
      // from the anchor's own attestation. The fetch below is for a response
      // cached before that field existed.
      if (typeof a?.recordedMs === "number") return a.recordedMs;
      if (!a?.digestB64) return null;
      try {
        const r = await fetch(`/api/proofs/digest/${urlsafe(a.digestB64)}`);
        if (!r.ok) return null;
        const d = await r.json();
        const list: Array<{ proof?: BitGraphProof }> = Array.isArray(d?.proofs) ? d.proofs : [];
        const hit = list.find((x) => String(x.proof?.commit?.counter) === String(a.counter))?.proof ?? list[0]?.proof;
        const rep = hit?.environment?.attestation?.reportB64;
        return typeof rep === "string" && rep.length > 0 ? attestationTimestampMs(rep) : null;
      } catch { return null; }
    };
    void Promise.all([readOne(w.anchorBefore), readOne(w.anchorAfter)]).then(([before, after]) => {
      if (!cancelled) setAnchorRecordedMs({ before, after });
    });
    return () => { cancelled = true; };
  }, [causalWindow?.anchorBefore?.digestB64, causalWindow?.anchorBefore?.counter, causalWindow?.anchorBefore?.recordedMs, causalWindow?.anchorAfter?.digestB64, causalWindow?.anchorAfter?.counter, causalWindow?.anchorAfter?.recordedMs]); // eslint-disable-line react-hooks/exhaustive-deps
  // Every causal position recorded for these bytes (the same bits can be
  // BitGraphed more than once), earliest first. ?counter=&epoch= in the URL
  // picks which one this page describes. lowerTime/upperTime are the ETH anchor
  // window bounds (block times) that bracket each recording.
  const [positions, setPositions] = useState<Array<{ counter: string | null; epoch: string | null; lowerTime: string | null; upperTime: string | null; recordedMs?: number | null; kind?: "recorded" | "fused"; artifactDigest?: string | null; placement?: string | null }>>([]);

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

  /* ⚠️ THE WINDOW NO LONGER ARRIVES WITH THE PROOF, so ask for it.
   *
   * It used to come from /api/proofs/digest/{digest}, which finds nothing for
   * a proof made after 2026-09-08 — the ledger keeps only anchors. A BitGraph
   * opened from its own holder's folder therefore showed no time at all, and
   * the anchor card sat on "Waiting for the next Ethereum block…" forever,
   * which was false: the anchors had landed and nobody was asking (Mike: "eth
   * anchors dont load into proofs but they should. they are accessible from
   * the s3").
   *
   * The proof carries its own counter and epoch in its SIGNED body, and
   * anchors are indexed by counter — that is why that index survived the
   * cutover. So this asks by position, never by digest: nothing about the file
   * is sent, and the privacy the cutover bought is untouched.
   *
   * Only when the window is missing, so a page that already has one from the
   * ledger costs nothing extra. */
  useEffect(() => {
    if (!proof || causalWindow) return;
    const c = proof.commit as { counter?: string; epochId?: string } | undefined;
    if (!c?.counter || !c?.epochId) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/proofs/window?counter=${encodeURIComponent(c.counter!)}&epoch=${encodeURIComponent(toUrlSafeB64(c.epochId!))}`);
        if (!r.ok || cancelled) return;   // 503 is "we could not look", not "none"
        const d = await r.json();
        if (!cancelled && (d?.causalWindow?.anchorBefore || d?.causalWindow?.anchorAfter)) {
          setCausalWindow(d.causalWindow);
        }
      } catch { /* leave it unknown; the card says so rather than guessing */ }
    })();
    return () => { cancelled = true; };
  }, [proof, causalWindow]);

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
    /* ⚠️ THE POLL WAS KNOCKING ON THE DEAD DOOR. It asked
     * /api/proofs/digest/{digest} every four seconds — the lookup that finds
     * nothing for a proof made after the cutover — so for a local-first
     * BitGraph it could never resolve. It ran its full five minutes, gave up,
     * and the page kept its unfinished window with nothing said. Live in
     * principle, never live in fact (Mike: "shouldnt this be a live change").
     *
     * The window endpoint is keyed by COUNTER, which is what survived phase 2,
     * and the proof carries its own counter and epoch in its signed body — so
     * this asks with what it is holding rather than what the URL happens to
     * say. A shared link with no ?counter= polled with no selector at all
     * before, and got the wrong position's window when the bytes held several.
     */
    const c = proof?.commit as { counter?: string; epochId?: string } | undefined;
    const poll = setInterval(async () => {
      if (!c?.counter || !c?.epochId) return;
      try {
        const r = await fetch(`/api/proofs/window?counter=${encodeURIComponent(c.counter)}&epoch=${encodeURIComponent(toUrlSafeB64(c.epochId))}`);
        if (!r.ok) return;   // 503 is "could not look", not "not yet"
        const data = await r.json();
        if (!cancelled && data.causalWindow?.anchorAfter?.blockTime) {
          setCausalWindow(data.causalWindow);
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
    const startImagePoll = (p: BitGraphProof | null) => {
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
              // The committed file itself is also good: a fused proof's page is
              // addressed by the origin, so a new file dropped here hashes to the
              // artifact digest, not the URL's, and was dropped on every reload.
              try {
                const h = await hashBytes(new Uint8Array(file.data));
                matches = h === digestB64 || h === p?.artifact?.digestB64;
              } catch { matches = false; }
              // A fused proof (profile bitgraph-fuse/1) is usually remembered
              // with the ORIGINAL, which never hashes to the artifact digest:
              // accept it when it rebuilds the committed fused bytes. A set
              // proof is remembered under a MEMBER's digest: accept its
              // original by reconstruction or its new file directly.
              if (!matches && p && fusedMarkerOf(p) !== null) {
                if (isSetProof(p)) {
                  try {
                    const c = (await unpackSetMember(p, new Uint8Array(file.data), file.name)).verification.category;
                    matches = c === "SET_MEMBER_FROM_ORIGIN" || c === "SET_MEMBER_DIRECT";
                  } catch { matches = false; }
                } else {
                  try { matches = (await rebuildFromOrigin(p, new Uint8Array(file.data), file.name)).verification.category === "FUSED_FROM_ORIGIN"; } catch { matches = false; }
                }
              }
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
      startImagePoll(data.proofs[0].proof);
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
    // The proof a row handed over (fresh-proof.ts) is taken whenever it is
    // there, not only behind ?fresh=1: a results row navigates without the
    // flag, so the hand-off was never read and the page fell through to a
    // retired lookup and "not found" (Mike, 2026-09-16: "you click one after
    // its made and it doesnt work"). The flag now only means "play the flash".
    const freshHit = takeFreshProof<Parameters<typeof applyData>[0]>(digestParam);
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
        if (!resp.ok) {
          // A failed READ is not a verdict about the bytes. 5xx means the
          // ledger could not be consulted; only a clean 404 means the index
          // holds nothing. Either way the wait ends here rather than leaving
          // the skeleton up forever.
          if (!seeded && !cancelled) {
            setError(resp.status >= 500
              ? "The lookup failed just now. That is not a finding about this BitGraph. Try again in a moment, or check the proof offline."
              : "BitGraph not found");
            setLoading(false);
          }
          return;
        }
        const data = await resp.json();
        // Guard on !cancelled: applyData returns false for a cancelled (unmounted
        // or strict-mode double-invoked) effect, and without this a cancelled run
        // would clobber a good render with a spurious "not found".
        if (!cancelled && data?.discovery === "retired") setRetired(true);
        /* ⚠️ ASK THIS BROWSER BEFORE SAYING THERE IS NOTHING.
         *
         * The hosted lookup can no longer find a proof made after 2026-09-08 —
         * that is the point — so this page went straight to "Nothing here to
         * look up" for a BitGraph its own owner had made seconds earlier, and
         * would do it again on every reload and every browser-back. The
         * connected BitGraphs folder IS the ledger now, and it is right here.
         * Only ever ADDS a record; a browser holding nothing falls through to
         * the honest empty state.
         *
         * ⚠️ INSERTED INTO THE ORIGINAL LINE, NOT WRAPPED AROUND IT. My first
         * version returned early on success — which skipped everything after,
         * including the `setLoading(false)` that lives past the try, so a
         * perfectly good proof sat on "Loading BitGraph…" forever. The shape
         * of this line is load-bearing: it must fall through. */
        if (!cancelled && !applyData(data) && !seeded) {
          // The remembered ledger, indexed by origin as well as by the committed
          // digest: a fused proof's page is addressed by the ORIGIN's digest.
          const mine = heldFor(await loadLedger(originOfProof), fromUrlSafeB64(digestParam));
          if (!cancelled && !(mine.length && applyData({ proofs: mine.map((pr) => ({ proof: pr })) }))) {
            setError("BitGraph not found");
          }
        }
        // Staleness guard. The CDN serves settled responses stale-while-
        // revalidate, so right after the same bytes are BitGraphed again a
        // cached copy can predate the very position this page is displaying —
        // provably stale, because ?counter= is missing from its own Recordings
        // list. Refetch once on a distinct cache key (the CDN ignores client
        // no-cache headers, so a different URL is the only reliable bypass).
        // Deterministic single retry: the origin's list always contains any
        // position that exists, so the fresh copy passes this check.
        // Two provably-stale signals: the position this page displays is absent
        // from the list, or the referring page told us (?n=) it knew MORE
        // recordings than the cached response contains — the record-again →
        // view-older-position flow, where the sibling URL's cached copy
        // predates the newest recording yet still contains the viewed counter.
        const viewedCounter = qs.get("counter");
        const minCount = parseInt(qs.get("n") ?? "0", 10) || 0;
        const staleList = !cancelled && Array.isArray(data?.positions) && (
          (viewedCounter &&
            !data.positions.some((p: { counter?: string | null }) =>
              String(p?.counter) === String(parseInt(viewedCounter, 10)))) ||
          data.positions.length < minCount
        );
        if (staleList) {
          try {
            const freshResp = await fetch(`${key}${key.includes("?") ? "&" : "?"}fresh=1`);
            if (freshResp.ok && !cancelled) applyData(await freshResp.json());
          } catch { /* keep the stale render; SWR heals it on the next visit */ }
        }
      } catch { if (!seeded && !cancelled) setError("The BitGraph could not be loaded: the request failed. That is not a finding about the bytes; try again."); }
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
  /* ⚠️ "NOT FOUND" IS A VERDICT THIS PAGE CAN NO LONGER SUPPORT.
   *
   * While every proof was written to the bucket, an empty lookup meant these
   * bytes were never recorded. Now it means EITHER that, or that they were
   * recorded and the proof is in the holder's own BitGraphs folder, where it
   * belongs. The page cannot tell, so it must not imply — same family as
   * reporting a failed read as an absence.
   *
   * And this settles what /proof/{digest} is FOR, which was open: it becomes a
   * VIEWER for a proof you supply. A proof verifies with no ledger at all
   * (signature, attestation to the AWS root, slot binding, floor), so the page
   * has everything it needs the moment you hand it one — which is exactly what
   * the drop below already does. */
  /* ⚠️ NOTHING TO LOOK UP IS NOT NOTHING TO SAY, but it is very little.
   *
   * This screen briefly carried the whole viewer: a paragraph plus a drop zone
   * that took a package or a proof.json and rendered it. Mike: "site doesnt
   * need this does it?" — it does not. /verify IS that, properly: the offline
   * verifier, one file, no network, the thing you send someone. A second
   * weaker copy of it living inside an error state is exactly the drift that
   * killed the old page generator.
   *
   * So the page says the one true thing and points at the tool. The sentence
   * still matters: an empty lookup is NOT a finding about those bytes, and
   * saying "not found" here would accuse a file whose proof is sitting in
   * somebody's folder working perfectly.
   */
  if (error || !proof) return (
    <Shell>
      <div style={{ padding: "80px 20px", textAlign: "center", maxWidth: 520, margin: "0 auto" }}>
        {retired ? (
          <>
            <div style={{ fontSize: 16, color: "var(--ink)", marginBottom: 12, fontWeight: 700 }}>
              Nothing here to look up
            </div>
            <div style={{ fontSize: 14, color: "var(--dim)", lineHeight: 1.6, marginBottom: 20 }}>
              BitGraph keeps no index of proofs by digest, so this is not a finding
              about those bytes. If you have the BitGraph itself, check it offline.
            </div>
            {/* ⚠️ WAS /verify, WHICH NO LONGER EXISTS (Mike, 2026-09-08). The
                offline check is a command, not a page you load from us: a page
                served from bitgraph.ing is trusted exactly as much as we are,
                which is the thing being checked. /docs/verification names the
                command. */}
            <a href="/docs/verification" className="bg-action-link" style={{ fontSize: 14 }}>
              <span>How to check it offline</span>
              <span className="arrow" aria-hidden>&rarr;</span>
            </a>
          </>
        ) : (
          <>
            <div style={{ fontSize: 16, color: "var(--err)", marginBottom: 12 }}>{error || <>The lookup failed</>}</div>
            <a href="/" style={{ fontSize: 14, color: "var(--c-accent)" }}>BitGraph</a>
          </>
        )}
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
  // A set proof: N files under one slot, the manifest of their digests the
  // committed artifact. The page is reached by the manifest digest, a member's
  // original digest or a member's new-file digest; the row it describes is the
  // file in hand when there is one, else the row the URL digest names.
  const isSet = isSetProof(proof);
  // Every BitGraph answers the same question, so the page asks it the same way
  // and only the answer changes: how does this artifact carry the commitment
  // to the slot it consumed? A fused file carries it in its own bytes, a set
  // member in each member's bytes, and a digest-only recording (the
  // compatibility path) does not say. That is a field, not a different page
  // (Mike, 2026-09-07: "all bitgraphs should render the same way"). The
  // placement id stays out of it, as it has since 2026-09-03: a verifier
  // detail, in the attribution and the Raw JSON.
  // One marker, and its title answers "how is the commitment carried" in either
  // of two vocabularies: a placement id (a recipe exists, so the artifact
  // rebuilds from an original) or an encoding id (there is no original; the
  // artifact was MADE with the commitment inside it, so it is looked for).
  const carryId = attr && isFuseName(attr.name) ? attr.title ?? null : null;
  const isInline = carryId !== null && ENCODING_IDS.includes(carryId);
  const placementId = isInline ? null : carryId;
  // Which of a BitGraph's two files is in hand, said on the file's own line
  // (2026-09-28): "original" or "new file". Only where there are two: a record
  // with the commitment written inside it (the home demonstration) is one file.
  const roleKnown = cachedFile !== null && roleOf === cachedFile;
  const heldLabel = roleKnown && placementId !== null
    ? (cachedRole === "original" ? "original" : cachedRole === "new" ? "new file" : null)
    : null;
  const unpackedHeld = heldOriginal !== null && heldOriginal.of === cachedFile ? heldOriginal : null;
  const originalInHand = roleKnown && cachedRole === "new" ? unpackedHeld?.original ?? null : null;
  // The preview waits while the page tells which file is in hand and, for a new
  // file, takes the original out. Shown straight away, the new file's own bytes
  // put the wrapper's header on screen for about 100 ms before the text replaced
  // it (measured 2026-09-28), and again on every reload of the page.
  const previewPending = cachedFile !== null && placementId !== null && (!roleKnown || (cachedRole === "new" && unpackedHeld === null));
  // The value to look for. From the check when the file is here; otherwise from
  // the proof's own slot record, which is where the check gets it too.
  const inlineCommitment = isInline ? inlineFound?.commitmentB64 ?? slotCommitmentOf(proof) : null;
  const carriedBy =
    isInline
      ? inlineFound === null
        ? "In the artifact's own bytes"
        : inlineFound.category === "CARRIED_INLINE"
          ? `In the artifact's own bytes, found at byte ${inlineFound.offset}`
          : inlineFound.category === "COMMITMENT_ABSENT"
            ? "Declared, but not present in the file on this device"
            : "Declared, but the file on this device does not verify against this proof"
    : placementId === null ? "Not declared"
    : placementId.startsWith("set/") ? "In each member's bytes"
    : placementId.startsWith("container/") ? "In the file's bytes, in a wrapper"
    : placementId === "trailer/1" ? "In the file's bytes, appended"
    : "In the file's bytes";
  // set/1 lists every row; set/2 knows one member, the one whose evidence
  // rode along with this copy of the proof (the lookup that served it).
  const evidenceRow: SetMemberRow | null = setBound?.kind === "set/2" ? bindSetMember(setBound, memberEvidenceOf(asRecord(proof))) : null;
  const viewingRow: SetMemberRow | null = heldMember ?? resolvedMember ?? (setBound ? (setBound.kind === "set/2" ? evidenceRow : memberOf(setBound, stdDigest(digestParam))) : null);
  const setRows: SetMemberRow[] = setBound ? (setBound.kind === "set/2" ? (viewingRow ? [viewingRow] : []) : setBound.members) : [];
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
  const upperCounter = causalWindow?.anchorAfter?.counter ?? null;
  // The committed instant per the enclave platform's signed clock: the Nitro
  // attestation document's own timestamp, decoded here for display and fully
  // verified on demand in the Hardware Enclave card. RE-RULING 2026-09-25:
  // the attested instant LEADS the receipt, the Ethereum bracket beneath
  // confirms it, and the number always wears its root. The bracket's ceiling
  // stays positional (before the anchor), never a block's mine time.
  // Computed plainly (no hook): this section sits below the page's early
  // returns, and the decode is a few kilobytes of CBOR.
  const attestedRep = proof?.environment?.attestation?.reportB64;
  const attestedMs = typeof attestedRep === "string" && attestedRep.length > 0 ? attestationTimestampMs(attestedRep) : null;
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
  // The heading names the day IN THE DISPLAYED ZONE, so the times beneath it
  // drop their date when they fall on that day (Mike, 2026-09-17), and a
  // toggle to local can never print "3:05 AM EDT" under a UTC date. UTC stays
  // the default (Mike, 2026-09-19: "it should be UTC throughout").
  const longDate = (d: Date) => longDateTz(d);
  const sameUtcDay = (a: Date, b: Date) => sameDayTz(a, b);
  const utcDate = (d: Date) => dateTz(d);
  let leadNode: React.ReactNode = null;
  // The actual time/date values are emphasized in brand blue (the connector
  // words stay default gray), so the receipt's key temporal fact reads as the
  // focal point, consistent with how counters/block numbers are highlighted.
  const emStyle: React.CSSProperties = { color: "var(--ink)", fontWeight: 600 };
  const Em = ({ children }: { children: React.ReactNode }) => <span style={emStyle}>{children}</span>;
  if (isEth && ethBlockNum) {
    // An anchor is just a BitGraph (of an Ethereum block hash), so it reads
    // like the others: "BitGraph Record on {date}" with the block + time on
    // the line below. The date lives in the title.
    const bt = anchorBlock?.blockTime;
    const blockPart = `Ethereum Block #${Number(ethBlockNum).toLocaleString()}`;
    if (bt) {
      const d = new Date(bt);
      const timeStr = timeTz(d);
      const dateStr = utcDate(d);
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
    // Mike's ruling (2026-09-16, restated 2026-09-17): the verdict reads
    // "after <time>, before <time>", each time a block's own mint time, so it
    // matches the Etherscan page its row links to. The 09-16 redesign printed
    // the ceiling as an anchor position instead; he reversed that. The anchor's
    // position still has its own card below.
    const t1 = new Date(lowerTime);
    const t2 = new Date(upperTime);
    const upper = sameUtcDay(t1, t2) ? timeTz(t2) : stampTz(t2);
    recordedLine = `after ${stampTz(t1)}, before ${stampTz(t2)}`;
    recordedNode = <>after <Em><span style={{ whiteSpace: "nowrap" }}>{timeTz(t1)}</span></Em>, before <Em><span style={{ whiteSpace: "nowrap" }}>{upper}</span></Em></>;
    recordedDate = longDate(t1);
    leadNode = <>after <Em><span style={{ whiteSpace: "nowrap" }}>{timeTz(t1)}</span></Em></>;
  } else if (!isEth && lowerTime) {
    const t1 = new Date(lowerTime);
    recordedLine = `after ${timeTz(t1)} on ${utcDate(t1)}`;
    recordedDate = longDate(t1);
    if (ethWait) {
      // The window is still open: show it as "between X and <waiting>". When the
      // sealing anchor lands, the poll above swaps in the real end time without a
      // refresh. No seconds count: the next anchor has no client-known ETA.
      recordedNode = (
        <>
          after <Em><span style={{ whiteSpace: "nowrap" }}>{timeTz(t1)}</span></Em>
        </>
      );
      leadNode = recordedNode;
    } else {
      recordedNode = <>after <Em><span style={{ whiteSpace: "nowrap" }}>{timeTz(t1)}</span></Em> on <Em><span style={{ whiteSpace: "nowrap" }}>{utcDate(t1)}</span></Em></>;
      leadNode = <>after <Em><span style={{ whiteSpace: "nowrap" }}>{timeTz(t1)}</span></Em></>;
    }
  }

  // The recording window renders as ONE horizontal line ("between VALUE and
  // VALUE"), sized with a clamp so it stays a single line at every width and the
  // card stays short. Connectors are gray labels; the values are the brand font
  // in black, kept as unbreakable units. A cross-midnight window carries full
  // date stamps, long enough to wrap at its connectors — fine for that rare case.
  let leadStack: React.ReactNode = null;
  const conn = (label: string) => <span style={{ color: "var(--dim)", fontWeight: 400 }}>{label}</span>;
  const val = (t: string) => <span style={{ color: "var(--ink)", fontWeight: 400, whiteSpace: "nowrap" }}>{t}</span>;
  const winLine = (children: React.ReactNode) => (
    <div style={{ fontFamily: mono, fontSize: 12, lineHeight: 1.6, color: "var(--dim)" }}>{children}</div>
  );
  // RE-RULING 2026-09-25 (Mike: "just say what time it commits according to
  // the TEE... the eth proofs confirm the time", then "Recorded ... we dont
  // need eth info there"): the lead is the recorded instant alone, bare by
  // the ruled lead exception, because the card stack directly beneath it
  // supplies the root and both bounds (Hardware Enclave, floor, ceiling).
  // The card's heading names the position (Mike, 2026-09-26: "show WHAT bitgraph"): the
  // commit counter, the BitGraph's own number, not the slot just before it. The epoch ID
  // stays in the Positions card: an epoch is one UTC day, which the date line already gives.
  const commitCounter = typeof commit?.counter === "string" && /^\d+$/.test(commit.counter) ? Number(commit.counter) : null;
  // The position's other coordinate, one line down (Mike, 2026-09-26: "the other coordinate is
  // epoch id ... next line down, its like a teacher too"): a counter means nothing without its
  // epoch, so the head shows both. The full ID where it fits, cut with an ellipsis by the
  // column's width where it does not (a phone); the tooltip always holds all of it.
  const epochFull = typeof commit?.epochId === "string" ? commit.epochId.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : null;
  // The date and the time share one line under "BitGraphed" (Mike, 2026-09-26: "let date
  // and time share second line", "remove recorded"): the heading carries the verb.
  const committedLine = attestedMs !== null
    ? (
      // Normal text, not mono (Mike, 2026-09-26): a date written in words is read, not
      // compared character by character; the epoch ID beneath stays mono.
      <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--ink)" }}>
        <TimeChip date={new Date(attestedMs)} withDate />
      </div>
    )
    : null;
  if (isEth && ethBlockNum && anchorBlock?.blockTime) {
    // An anchor leads like every other proof (Mike, 2026-09-27: "match the new
    // proof page format"): the attested instant, when the enclave recorded the
    // block, per the 09-25 re-ruling. It used to lead with the block's own mine
    // time, which is a different and earlier moment (an anchor is built after
    // the block it carries: 2s after it on the anchor this was checked against,
    // though canon 3.6 measured about 12s on 09-15); that time now sits in the
    // identity row beside the block it belongs to. The block time stands in only when the
    // attestation cannot be read.
    const d = new Date(anchorBlock.blockTime);
    leadStack = committedLine ?? winLine(val(timeTz(d)));
  } else if (!isEth && lowerTime) {
    if (upperTime) {
      // RE-RULED 2026-09-25 (supersedes the 09-16/17 "after <time>, before
      // <time>" verdict): the committed instant leads on its own line, the
      // floor stays a block's mint time, and the ceiling is stated in
      // POSITION ("before anchor #K"), never as the later block's mint time,
      // because an anchor is built after the block it carries. The ceiling
      // block's own time still shows on its card below, beside its link.
      const s1 = new Date(lowerTime);
      const s2 = new Date(upperTime);
      // The lead is the recorded instant alone (Mike, 09-25: "we dont need
      // eth info there"); the floor and ceiling keep their own cards below.
      // When the attestation is unreadable, the bracket line stands in, with
      // the ceiling stated in position.
      leadStack = committedLine ?? winLine(
        <>
          <span style={{ whiteSpace: "nowrap" }}>{conn("after ")}{val(timeTz(s1))}{conn(",")}</span>{" "}
          {upperCounter !== null
            ? <span style={{ whiteSpace: "nowrap" }}>{conn("before ")}{val(`anchor #${Number(upperCounter).toLocaleString("en-US")}`)}</span>
            : <span style={{ whiteSpace: "nowrap" }}>{conn("before ")}{val(sameUtcDay(s1, s2) ? timeTz(s2) : stampTz(s2))}</span>}
        </>
      );
    } else if (ethWait) {
      const s1 = new Date(lowerTime);
      // Not sealed yet: the close time is unknown. Show the open time and a
      // pulsing ellipsis for the pending close ("between 11:04:35 PM and …")
      // rather than a full-width timestamp placeholder — short enough that date
      // + time stay on one line while waiting (no wrap). When the anchor lands
      // the close fills in; on mobile it then drops to its own line at seal.
      leadStack = committedLine ?? winLine(
        <>
          {conn("after ")}{val(timeTz(s1))}
        </>
      );
    } else {
      leadStack = committedLine ?? winLine(<>{conn("after ")}{val(timeTz(new Date(lowerTime)))}</>);
    }
  }

  // The recording's "when": date (bold, left) + time window (right). Shown
  // inside the content card (above the image / hash) on file proofs, and as its
  // own small card on anchor/interval proofs (which have no file card). On a
  // phone the window wraps to its own right-aligned line.
  const whenNode = leadStack ?? (recordedDate ? leadNode : (recordedNode ?? recordedLine));
  // Where an anchor's "All Ethereum anchors" goes: a past UTC day to that day's ledger
  // page, where this anchor's row is; today to the live list.
  const anchorsBackHref = isEth && attr?.title ? (() => {
    const bt = anchorBlock?.blockTime;
    const day = bt ? new Date(bt).toISOString().slice(0, 10) : null;
    const today = new Date().toISOString().slice(0, 10);
    return day && day < today ? `/ledger?day=${day}` : "/ledger";
  })() : null;
  // The record's name. It was the first line of the card head; since the card
  // folds (Mike, 2026-09-28: "BitGraph #1,012 would be label and it is closed
  // by default"), it is the card's label, and each page shows its own number.
  const recordName = `BitGraph${commitCounter !== null ? ` #${commitCounter.toLocaleString("en-US")}` : ""}`;

  // Interval window, derived from the causal positions the page already loads
  // (metadata.interval does not survive the TEE, so nothing here relies on it):
  // the earliest recording is the original anchor = when the window BEGAN, and
  // this proof's own ETH bounds (recordedLine) are when it ENDED. The counter
  // gap between them is the causal activity across the window.
  const intervalBlockNum = isInterval ? (attr?.title?.match(/\/block\/(\d+)/)?.[1] ?? null) : null;
  const originalPos = isInterval && positions.length > 0 && positions[0]?.counter !== commit?.counter ? positions[0] : null;
  const intervalBegan = originalPos ? formatWindow(originalPos.lowerTime, originalPos.upperTime) : null;

  // The fused copy is stored nowhere: it is rebuilt here from the original in
  // hand and the proof, and offered only on this explicit click. A visitor who
  // dropped the fused file itself simply gets those bytes back.

  /** The proof, as the file it already is. See the note at the call site. */
  function downloadProof() {
    if (!proof) return;
    const blockNumber = (proof.metadata as { anchor?: { blockNumber?: number } } | undefined)?.anchor?.blockNumber;
    const name = blockNumber ? `ethereum-anchor-${blockNumber}.json` : "bitgraph-proof.json";
    const url = URL.createObjectURL(new Blob([JSON.stringify(proof, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    /* Freed on the next tick; revoking straight away races the download in
       Safari, which has not read the blob yet when click() returns. */
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportZip() {
    if (exporting) return;
    setExporting(true);
    try {
    // A set proof travels WITH its manifest: proof.json is what a member's
    // export verifies against, and the manifest is what names the member.
    // The route's copy carries it; if it does not, the bound copy is attached.
    const proofOut = proof && isSet && setBound && proof.metadata?.[SET_KEY] === undefined
      ? { ...proof, metadata: { ...(proof.metadata ?? {}), [SET_KEY]: setBound.manifest } }
      : proof;
    const files: Record<string, Uint8Array> = {
      "proof.json": strToU8(JSON.stringify(proofOut, null, 2)),
    };
    // No Frame in the package (Mike, 2026-09-03: "this is the correct proof").
    // A Frame is { type, manifest, proof }, and the proof inside it is byte for
    // byte proof.json, so shipping both put the signed proof in the zip twice.
    // Of the manifest's four fields, three are already in the signed proof (the
    // placement is the attribution title, the origin digest its message, the
    // artifact digest the proof's own) and the fourth is the new file's name,
    // which is moot here because the new file is in new-file/ beside it.
    //
    // The package. A fused BitGraph leaves this page for someone who may have
    // neither the original nor a tool that rebuilds, so the export is the one
    // moment the new file is actually wanted (Mike, 2026-09-03): the original
    // as it always was, and the new file beside it under new-file/.
    // Everywhere else the new file stays virtual. Built here from whichever
    // file is in hand: the original rebuilds it, the new file carries the
    // original inside it. Without a file, the proof travels alone.
    let packLabel = cachedFile?.name ?? null;
    const packProof = proof;
    if (cachedFile && packProof) {
      const bytes = new Uint8Array(cachedFile.data);
      // The new file keeps the original's name and is told apart by the folder
      // it sits in (Mike, 2026-09-03). It is the same picture plus 48 bytes, so
      // a second name would imply a second thing. "fused" is gone from the
      // package too: Fuse is a working name and an export is permanent.
      if (isSet && cachedRole === "new") {
        // A set member's new file: the original back out of it, beside it.
        const u = await unpackSetMember(packProof, bytes, cachedFile.name, setBound?.bytes ?? null);
        const name = u.originalName ?? cachedFile.name;
        files[`${PKG_COMMITTED_DIR}/${name}`] = bytes;
        if (u.originalBytes && u.originalName) {
          files[`${PKG_ORIGINAL_DIR}/${u.originalName}`] = u.originalBytes;
          packLabel = u.originalName;
        }
      } else if (isSet) {
        // A set member's original: its new file rebuilt from the row's
        // placement and the set's slot commitment, only when the rebuild
        // hashes to the row's listed digest. Never a wrong new-file.
        files[`${PKG_ORIGINAL_DIR}/${cachedFile.name}`] = bytes;
        const r = await rebuildSetMember(packProof, bytes, cachedFile.name, setBound?.bytes ?? null);
        if (r.fusedBytes) files[`${PKG_COMMITTED_DIR}/${cachedFile.name}`] = r.fusedBytes;
      } else if (isInlineProof(packProof)) {
        // An inline record carries its commitment in its own bytes: there is no
        // container and no separate original, so the file is both halves at once.
        // It goes at the root, not under new-file/, which would imply an original
        // that never existed and leaves the artifact where bitgraph-audit does not
        // look for it. Verified 2026-09-21: before this branch the export held only
        // new-file/<name> and no original, because unpackNewFile had nothing to
        // unpack. Since 2026-10-01 every package names its folders for what the
        // bytes are: committed/ holds the bytes the proof's digest names, always;
        // original/ exists only when the committed file was made from one.
        files[`${PKG_COMMITTED_DIR}/${cachedFile.name}`] = bytes;
      } else if (isFuseName(attr?.name) && cachedRole === "new") {
        const u = await unpackNewFile(packProof, bytes, cachedFile.name);
        const name = u.originalName ?? cachedFile.name;
        files[`${PKG_COMMITTED_DIR}/${name}`] = bytes;
        if (u.originalBytes && u.originalName) {
          files[`${PKG_ORIGINAL_DIR}/${u.originalName}`] = u.originalBytes;
          packLabel = u.originalName;
        }
      } else if (isFuseName(attr?.name)) {
        files[`${PKG_ORIGINAL_DIR}/${cachedFile.name}`] = bytes;
        const r = await rebuildFromOrigin(packProof, bytes, cachedFile.name);
        if (r.fusedBytes) files[`${PKG_COMMITTED_DIR}/${cachedFile.name}`] = r.fusedBytes;
      } else {
        files[`${PKG_COMMITTED_DIR}/${cachedFile.name}`] = bytes;
      }
    } else if (cachedFile) {
      files[`${PKG_COMMITTED_DIR}/${cachedFile.name}`] = new Uint8Array(cachedFile.data);
    }
    // Captured as the anchors are gathered, so the export's own page can state
    // the causal window without a second round of fetching. Declared out here
    // because the page is written after the fetch block closes.
    const sides: { before: AnchorSide; after: AnchorSide } = { before: {}, after: {} };
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
          if (wResp.ok) {
            const w = await wResp.json();
            files[name] = strToU8(JSON.stringify(w, null, 2));
            // The block time is not a field anywhere; it is inside the header.
            const side = name.includes("before") ? sides.before : sides.after;
            side.block = blockNumber;
            if (w?.headerRlpHex) side.ts = blockTimeFromHeader(w.headerRlpHex) || null;
          }
        } catch (_) { /* the bundle is valid without the witness */ }
      };
      // The four ETH anchor files (before/after anchor + their block-header
      // witnesses) go in an ethereum-anchors/ subfolder so they don't clutter
      // the bundle root. Audit discovery is by schema shape, not path, so the
      // nesting is transparent to the verifier.
      /* ⚠️ AN ABSENT ANCHOR FILE USED TO SAY NOTHING, HERE TOO. This is the
       * second of the two places that build an ethereum-anchors/ folder, and
       * it swallowed the same four different situations into one silence: the
       * ledger saying "not yet", saying "never", being unreadable, and the
       * request throwing. A package could not tell its reader whether no upper
       * bound had been FETCHED or none EXISTED. Fixing only the camera's copy
       * would have left the bug alive on the path a stranger actually uses —
       * a fallback is where a fixed bug survives (2026-09-07). */
      const readSide = async (resp: Response, name: string, witnessName: string): Promise<BoundReport> => {
        if (!resp.ok) {
          return { state: "unavailable", note: resp.status === 503
            ? "BitGraph's copy could not be read when this package was built. That is a gap in what was asked, not a finding about what it holds."
            : `BitGraph answered ${resp.status} when this package was built, so this side was never learned.` };
        }
        const data = await resp.json();
        if (Array.isArray(data.anchors) && data.anchors.length > 0) {
          files[name] = strToU8(JSON.stringify(data.anchors[0], null, 2));
          await addWitness(witnessName, data.anchors[0]);
          // The anchor before is the floor in time; the anchor after is the
          // ceiling in position (CANON §3.6, 2026-09-16).
          return { state: "anchored", note: name.includes("before") ? "An Ethereum anchor is the floor of this position." : "An Ethereum anchor is the ceiling of this position: it sits after it in the order." };
        }
        const b = data.bound as { state?: string; note?: string } | undefined;
        if (!b?.state) {
          return { state: "unavailable", note: "BitGraph returned no anchor and gave no reason, so nothing can be concluded from this absence." };
        }
        return { state: b.state as BoundReport["state"], note: b.note ?? "" };
      };
      const [upperReport, lowerReport] = await Promise.all([
        readSide(afterResp, "ethereum-anchors/anchor-after.json", "ethereum-anchors/anchor-after-witness.json"),
        readSide(beforeResp, "ethereum-anchors/anchor-before.json", "ethereum-anchors/anchor-before-witness.json"),
      ]);
      // Only when something is missing: a complete package is byte-for-byte
      // what it was before this change.
      if (!isSettled(upperReport.state, lowerReport.state)) {
        files[`ethereum-anchors/${ANCHOR_STATUS_FILE}`] = strToU8(JSON.stringify(
          anchorStatusDoc({ epochId: commit.epochId || "", counter: String(counter ?? "") }, upperReport, lowerReport),
          null, 2));
      }
    } catch (e) {
      // Even a throw has to leave a trace: a package that silently lacks its
      // anchors is the exact ambiguity this file exists to remove.
      console.error("[bitgraph] anchors for package:", e);
      files[`ethereum-anchors/${ANCHOR_STATUS_FILE}`] = strToU8(JSON.stringify(anchorStatusDoc(
        { epochId: commit.epochId || "", counter: String(commit.counter ?? "") },
        { state: "unavailable", note: `This side was not fetched: the request did not complete (${(e as Error).message}). Ask again.` },
        { state: "unavailable", note: `This side was not fetched: the request did not complete (${(e as Error).message}). Ask again.` },
      ), null, 2));
    }

    let ceilingDoc: { status?: string; settlement?: { l1?: { blockNumber?: number; blockTimestamp?: number; txHash?: string } } | null; anchor?: { blockNumber?: number; blockTimestamp?: number; txHash?: string } | null } | null = null;
    // The ceiling in time (bitgraph-ceiling/1) travels beside the proof, in its
    // own folder, exactly as the writer published it: the Merkle path, the
    // signed Base transaction, the block header and its inclusion proof, and
    // the floor block's header. With proof.json it verifies offline, with no
    // call to bitgraph.ing (bitgraph-audit, or verifyCeiling). Absent, the
    // package says so in words instead of staying silent (the same rule as
    // the anchor status above): an unfetched ceiling is not a missing one.
    try {
      const ph = (proof as BitGraphProof & { proofHash?: string }).proofHash ?? computeProofHash(proof as never);
      const safe = ph.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const cr = await fetch(`/api/ceilings/${safe}`);
      if (cr.ok) {
        const ceilingBytes = new Uint8Array(await cr.arrayBuffer());
        files["base-ceiling/ceiling.json"] = ceilingBytes;
        try { ceilingDoc = JSON.parse(new TextDecoder().decode(ceilingBytes)); } catch { ceilingDoc = null; }
        // Settlement is attached a few minutes after the Base block. Absent, the package says
        // so in words: the sidecar's "status" is a report, not evidence (outside review, 2026-09-30).
        if (ceilingDoc && !ceilingDoc.settlement) {
          files["base-ceiling/settlement-status.json"] = strToU8(JSON.stringify({
            version: "bitgraph-settlement-status/1",
            proofHash: ph,
            status: "not-attached",
            reportedBaseStatus: ceilingDoc.status ?? null,
            note: "No settlement pointer was attached to this ceiling when the package was built. The ceiling's status field is what BitGraph's Base node reported, which this package cannot prove. The pointer (the Ethereum block that carries the batch data holding this Base block) is attached a few minutes after the Base block: build the package again later to get it.",
          }, null, 2));
        }
      } else {
        files["base-ceiling/ceiling-status.json"] = strToU8(JSON.stringify({
          version: "bitgraph-ceiling-status/1",
          proofHash: ph,
          status: cr.status === 404 ? "none-found" : "unavailable",
          note: cr.status === 404
            ? "No ceiling in time was found for this record when this package was built. Records made before 2026-09-29 22:43 UTC have none; a newer record may still be queued for its Base write, so build the package again."
            : `BitGraph answered ${cr.status} when this package was built, so the ceiling was never learned. Build the package again.`,
        }, null, 2));
      }
    } catch (e) {
      files["base-ceiling/ceiling-status.json"] = strToU8(JSON.stringify({
        version: "bitgraph-ceiling-status/1",
        status: "unavailable",
        note: `The ceiling was not fetched: the request did not complete (${(e as Error).message}). Build the package again.`,
      }, null, 2));
    }

    // ❄️ NO index.html. An export carries evidence, not a rendering of it.
    //
    // This zip used to open as a page rather than as a pile of JSON, and the
    // Folder wrote the same page beside every recording. Both are gone
    // (Folder 1.12.0): it was a second implementation of this very proof page
    // and it drifted from it, and what it displayed was not a check anyone
    // could rely on — the match verdict was computed by whoever built the
    // export, so a recipient opening it was reading the sender's assertion.
    // The check that means something is dropping the folder on bitgraph.ing,
    // which re-hashes in the reader's own browser against the ledger.
    //
    // The two must not diverge: a zip from here and a folder from the Folder
    // are meant to be the same object, and they now are.

    // The BitGraphed file rides along when it can be built: one file with the whole proof inside,
    // for whoever receives only a file. A set member waits (as on the page); a failure leaves it out.
    const committedPath = Object.keys(files).find((k) => k.startsWith(`${PKG_COMMITTED_DIR}/`)) ?? null;
    const originalPath = Object.keys(files).find((k) => k.startsWith(`${PKG_ORIGINAL_DIR}/`)) ?? null;
    let carrierPath: string | null = null;
    if (committedPath && proof && !isSet && (commit as { slotAnchor?: unknown }).slotAnchor) {
      try {
        const built = await buildCarrierForProof(files[committedPath]!, proof, committedPath.slice(PKG_COMMITTED_DIR.length + 1), { waitForCeilingMs: 0 });
        carrierPath = `${PKG_CARRIER_DIR}/${built.fileName}`;
        files[carrierPath] = built.bytes;
      } catch (e) { console.warn("[bitgraph] the BitGraphed file was left out of the package:", e); }
    }
    // README.md: the claim, which file is which, how to check, and what each result rests on.
    try {
      const hex = async (b: Uint8Array | undefined) => b ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b as unknown as BufferSource))).map((x) => x.toString(16).padStart(2, "0")).join("") : null;
      const iso = (sec: number | null | undefined) => (typeof sec === "number" && sec > 0 ? new Date(sec * 1000).toISOString() : null);
      const sa = (commit as { slotAnchor?: { blockNumber?: number; blockHash?: string } }).slotAnchor;
      let floorIso: string | null = sa?.blockNumber !== undefined && sides.before.block === sa.blockNumber ? iso(sides.before.ts ?? null) : null;
      if (sa?.blockNumber !== undefined && sa.blockHash && floorIso === null) {
        try {
          const w = await fetch(`/api/proofs/witness?block=${sa.blockNumber}&hash=${encodeURIComponent(sa.blockHash)}`).then((r) => (r.ok ? r.json() : null));
          if (w?.headerRlpHex) floorIso = iso(blockTimeFromHeader(w.headerRlpHex));
        } catch { /* the README says the time is not in the package */ }
      }
      let afterCounter: string | null = null;
      try { afterCounter = files["ethereum-anchors/anchor-after.json"] ? String(JSON.parse(new TextDecoder().decode(files["ethereum-anchors/anchor-after.json"])).commit?.counter ?? "") || null : null; } catch { afterCounter = null; }
      const pcr0 = proof?.environment?.measurement ?? null;
      const tagNote = PUBLISHED_ENCLAVE_MEASUREMENTS.find((m) => m.pcr0 === pcr0)?.note.match(/^v(\d+)/);
      const ca = ceilingDoc?.anchor, st = ceilingDoc?.settlement?.l1;
      files[PKG_README] = strToU8(packageReadme({
        recordName,
        epochId: String(commit.epochId ?? ""),
        proofUrl: `${window.location.origin}/proof/${digestParam}`,
        committedPath, originalPath, carrierPath,
        committedSha256Hex: committedPath ? await hex(files[committedPath]) : null,
        originalSha256Hex: originalPath ? await hex(files[originalPath]) : null,
        recordedIso: attestedMs !== null ? new Date(attestedMs).toISOString() : null,
        floor: sa?.blockNumber !== undefined ? { block: sa.blockNumber, iso: floorIso } : null,
        ceilingInTime: ca && typeof ca.blockNumber === "number" && typeof ca.blockTimestamp === "number" && ca.txHash
          ? { block: ca.blockNumber, iso: new Date(ca.blockTimestamp * 1000).toISOString(), txHash: ca.txHash, reportedStatus: String(ceilingDoc?.status ?? "included") } : null,
        settlement: st && typeof st.blockNumber === "number" && typeof st.blockTimestamp === "number" && st.txHash
          ? { block: st.blockNumber, iso: new Date(st.blockTimestamp * 1000).toISOString(), txHash: st.txHash } : null,
        ceilingInPosition: afterCounter ? { anchorCounter: afterCounter, block: sides.after.block ?? null, iso: iso(sides.after.ts ?? null) } : null,
        pcr0, enclaveTag: tagNote ? `enclave-v${tagNote[1]}` : null,
        writer: "0xf3972408D853c975F86351C311f4310220bbF2a3",
        hasAnchorsBefore: !!files["ethereum-anchors/anchor-before.json"], hasAnchorsAfter: !!files["ethereum-anchors/anchor-after.json"],
        versions: { verify: "1.15.1", audit: "0.8.0", sdk: "0.3.0" },
      }));
    } catch (e) { console.warn("[bitgraph] README left out of the package:", e); }

    const zipped = zipSync(files, { level: 0 });
    const blob = new Blob([zipped as unknown as BlobPart], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    // Named the way the Folder names its exports, so the zip expands into an
    // identically named folder and the two stay interchangeable. The counter
    // scheme this replaces was rejected for folder names long ago (a counter
    // is a position within one epoch and identifies nothing across days); the
    // zip had kept it. Without a file in hand there is no label, and a bare
    // "BitGraph.zip" beats advertising a number that means nothing tomorrow.
    const zipLabel = packLabel ? ` (${packLabel.replace(/[\x00-\x1f\x7f/]/g, " ").trim()})` : "";
    const a = document.createElement("a"); a.href = url; a.download = `BitGraph${zipLabel}.zip`; a.click();
    URL.revokeObjectURL(url);
    } catch (e) { console.error("[bitgraph] export error:", e); alert("Export failed: " + e); }
    finally { setExporting(false); }
  }

  /* One file out: the committed bytes with the proof, the floor anchor and its
     block header inside, and the closing anchor too once it exists. The bytes
     handed to the builder are the COMMITTED ones (the new file), rebuilt from
     the original when that is what the page holds; the builder re-hashes them
     against the proof before anything is assembled, and never stamps an
     unverified anchor. Sets wait (offline member verification is thinner). */
  async function downloadCarrier() {
    if (carrierBusy || !proof || !cachedFile) return;
    setCarrierBusy(true);
    setCarrierMsg(null);
    try {
      const bytes = new Uint8Array(cachedFile.data);
      let committed = bytes;
      let label = cachedFile.name;
      if (!isInlineProof(proof) && isFuseName(attr?.name) && cachedRole !== "new") {
        const r = await rebuildFromOrigin(proof, bytes, cachedFile.name);
        if (!r.fusedBytes) throw new Error("the new file could not be rebuilt from this original");
        committed = new Uint8Array(r.fusedBytes);
        label = cachedFile.name;
      }
      // A fresh recording's closing anchor is usually seconds away: wait a
      // short, capped moment for it so the file leaves complete and never
      // needs a second step. Permanent answers and the idle cadence fall
      // through to floor-only immediately or at the cap, stated in the note.
      const built = await buildCarrierForProof(committed, proof, label, { waitForCeilingMs: 15000 });
      const url = URL.createObjectURL(new Blob([built.bytes as unknown as BlobPart], { type: "application/octet-stream" }));
      const el = document.createElement("a"); el.href = url; el.download = built.fileName; el.click();
      URL.revokeObjectURL(url);
      // Success is silent (the download is the feedback); only a missing side speaks.
      setCarrierMsg(built.ceiling === "present"
        ? null
        : `Floor inside; the closing anchor is not, yet: ${built.ceilingNote ?? "none has landed."} Drop the file back here later and it completes.`);
    } catch (e) {
      setCarrierMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setCarrierBusy(false);
    }
  }

  /** One object, one file, no zip. A tick apart so the browser takes both. */
  function saveJson(name: string, obj: unknown) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }));
    const el = document.createElement("a"); el.href = url; el.download = name; el.click();
    URL.revokeObjectURL(url);
  }

  /* The anchor pair, as the ledger serves them: two self-contained proof JSONs
     (each carries its block header in metadata). The floor is the signed
     slotAnchor's anchor when the proof has one; the closing anchor is the
     first after the commit, and its absence is stated, never padded. */
  async function downloadAnchors() {
    if (anchorsBusy || !proof) return;
    setAnchorsBusy(true);
    setAnchorsMsg(null);
    try {
      const pair = await fetchAnchorPair(proof);
      if (!pair.floor && !pair.ceiling) throw new Error("no anchors could be read for this position");
      if (pair.floor) saveJson("anchor-before.json", pair.floor);
      if (pair.ceiling) { await new Promise((r) => setTimeout(r, 300)); saveJson("anchor-after.json", pair.ceiling); }
      setAnchorsMsg(pair.ceiling
        ? null
        : `The floor anchor saved. ${pair.note ?? "No anchor follows this position yet."}`);
    } catch (e) {
      setAnchorsMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setAnchorsBusy(false);
    }
  }

  /* The original back out of the new file, byte-exact, only ever offered when
     the page holds a new file and the recovery hashes to the origin digest
     the proof signs (unpackNewFile refuses otherwise). No zip around it. */
  async function downloadOriginal() {
    if (originBusy || !proof || !cachedFile) return;
    setOriginBusy(true);
    setOriginMsg(null);
    try {
      const u = await unpackNewFile(proof, new Uint8Array(cachedFile.data), cachedFile.name);
      if (!u.originalBytes || !u.originalName) throw new Error("the original could not be recovered from this file");
      const url = URL.createObjectURL(new Blob([u.originalBytes as unknown as BlobPart]));
      const el = document.createElement("a"); el.href = url; el.download = u.originalName; el.click();
      URL.revokeObjectURL(url);
      setOriginMsg(null);
    } catch (e) {
      setOriginMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setOriginBusy(false);
    }
  }

  return (
    <Shell>
      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:translateY(0) } }
        @keyframes spin { to { transform: rotate(360deg) } }
        /* Face-ID-style success: a brand-blue ring sweeps closed, then the checkmark
           draws itself, the whole badge springs in and fades away. Plays once
           on a freshly-recorded BitGraph. */
        @keyframes fidScrim { 0%{opacity:0} 15%{opacity:1} 78%{opacity:1} 100%{opacity:0} }
        @keyframes fidPop { 0%{transform:translate(-50%,-50%) scale(.6);opacity:0} 45%{opacity:1} 62%{transform:translate(-50%,-50%) scale(1.07)} 100%{transform:translate(-50%,-50%) scale(1);opacity:1} }
        @keyframes fidFade { to { opacity:0 } }
        @keyframes fidDraw { to { stroke-dashoffset:0 } }
        .fid-scrim { position:fixed; inset:0; z-index:9998; pointer-events:none; background:rgba(20,20,19,.55); animation:fidScrim 1.5s ease-out forwards; }
        .fid-badge { position:fixed; top:44%; left:50%; z-index:9999; pointer-events:none; width:104px; height:104px; animation:fidPop .5s cubic-bezier(.2,.8,.3,1) forwards, fidFade .35s ease-out 1.15s forwards; }
        .fid-ring { fill:none; stroke:var(--accent); stroke-width:6; stroke-linecap:round; stroke-dasharray:295; stroke-dashoffset:295; animation:fidDraw .5s ease-out .05s forwards; }
        .fid-check { fill:none; stroke:var(--accent); stroke-width:7; stroke-linecap:round; stroke-linejoin:round; stroke-dasharray:60; stroke-dashoffset:60; animation:fidDraw .3s ease-out .46s forwards; }
        @media (prefers-reduced-motion: reduce) { .fid-badge, .fid-scrim, .fid-ring, .fid-check { animation-duration:.01ms !important; animation-delay:0s !important; } }
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

      <div style={{ width: "90%", maxWidth: "var(--frame)", margin: "0 auto", padding: "56px 0 96px", animation: "fadeIn .3s ease-out" }}>
        <ProofView m={(() => {
          const kind: ProofViewModel["kind"] = isEth ? "anchor" : isInterval ? "interval" : "file";
          const stdB64 = (x: string | null | undefined) => (typeof x === "string" ? x : "");
          // Anchor views for the window, with each anchor's own recorded instant beside it.
          const side = (a: typeof causalWindow extends null ? never : NonNullable<typeof causalWindow>["anchorBefore"], recordedMs: number | null) =>
            a ? { counter: a.counter, blockNumber: a.blockNumber, blockHash: a.blockHash, etherscanUrl: a.etherscanUrl, blockTime: a.blockTime ?? null, digestB64: a.digestB64 ?? null, recordedMs } : null;
          const fromEvidence = (e: typeof evidenceSides.floor) => e ? {
            counter: e.counter, blockNumber: e.blockNumber, blockHash: e.blockHash, etherscanUrl: `https://etherscan.io/block/${e.blockNumber}`,
            blockTime: e.timestamp !== null ? new Date(e.timestamp * 1000).toISOString() : null, digestB64: e.digestB64, recordedMs: e.recordedMs,
          } : null;
          const floorView = fromEvidence(evidenceSides.floor) ?? side(causalWindow?.anchorBefore ?? null, anchorRecordedMs.before);
          const ceilView = fromEvidence(evidenceSides.ceiling) ?? side(causalWindow?.anchorAfter ?? null, anchorRecordedMs.after);
          // The anchor before the commit, when it is a later anchor than the signed floor: a
          // tighter bound on the commit itself, by hash order, said as a note.
          const commitAfter = causalWindow?.anchorBefore && floorView && causalWindow.anchorBefore.counter !== floorView.counter && causalWindow.anchorBefore.blockNumber !== null
            ? { counter: causalWindow.anchorBefore.counter, blockNumber: causalWindow.anchorBefore.blockNumber, blockTime: causalWindow.anchorBefore.blockTime ?? null, digestB64: causalWindow.anchorBefore.digestB64 ?? null }
            : null;
          // The file pane: the preview, the drop box, or the anchor's block row.
          const filePane: React.ReactNode = isEth ? (
            <div className="pv-file-row">
              <span className="pv-file-name">
                <strong>Ethereum block {ethBlockNum ? `#${Number(ethBlockNum).toLocaleString("en-US")}` : "#?"}</strong>
                {anchorBlock?.blockTime ? <span className="pv-file-meta"> · mined {attestedMs !== null && sameDayTz(new Date(anchorBlock.blockTime), new Date(attestedMs)) ? timeTz(new Date(anchorBlock.blockTime)) : stampTz(new Date(anchorBlock.blockTime))}</span> : null}
              </span>
              {attr?.title && <a href={attr.title} target="_blank" rel="noopener" className="pv-list-link">Open <span aria-hidden>&#8599;</span></a>}
            </div>
          ) : isInterval ? null : isDisplayableImage(cachedFile, cachedFile?.c2pa) ? (
            <PhotoCard cachedFile={cachedFile} c2pa={cachedFile?.c2pa ?? null} bare previewKey={stdDigest(digestParam)} label={heldLabel} />
          ) : cachedFile ? (
            <FileCard cachedFile={cachedFile} label={heldLabel} preview={originalInHand} pending={previewPending} />
          ) : (
            <div style={{ padding: 16 }}>
              <BringYourFile proof={proof} setBound={setBound} cacheKey={stdDigest(digestParam)} onMatch={(rec) => setCachedFile(rec)} onResolvedMember={setResolvedMember} />
            </div>
          );
          const hashes: FieldView[] = isEth
            ? [
                ...(attr?.message ? [{ label: "Ethereum block hash", value: attr.message, mono: true }] : []),
                { label: attr?.message ? `${formatHashAlg(proof.artifact.hashAlg)} of the block hash` : `${formatHashAlg(proof.artifact.hashAlg)} digest`, value: proof.artifact.digestB64, mono: true },
              ]
            : [
                { label: "Commitment", value: carriedBy },
                ...(inlineCommitment ? [{ label: "Position commitment", value: inlineCommitment, mono: true }] : []),
                ...(isSet
                  ? [
                      ...(viewingRow ? [{ label: "New file hash", value: viewingRow.fusedDigestB64, mono: true }, { label: "Original file hash", value: viewingRow.originDigestB64, mono: true }] : []),
                      { label: "Set hash", value: proof.artifact.digestB64, mono: true },
                    ]
                  : placementId !== null
                    ? [{ label: "New file hash", value: proof.artifact.digestB64, mono: true }, { label: "Original file hash", value: attr?.message ?? "not declared", mono: true }]
                    : [{ label: "File hash", value: proof.artifact.digestB64, mono: true }]),
              ];
          // Positions: every causal position these bytes occupy, newest first, each with its
          // role and its own recorded instant (the enclave's clock; the floor time stands in).
          const recordedPositions = positions.filter((p) => p.kind !== "fused");
          const fusedPositions = positions.filter((p) => p.kind === "fused");
          const positionRows: PositionRowView[] = [...positions].reverse().map((pos) => {
            const isFusedRow = pos.kind === "fused";
            const isEarliest = pos === recordedPositions[0];
            const isEarliestFused = isFusedRow && fusedPositions.length > 1 && pos === fusedPositions[0];
            const isCurrent = String(pos.counter) === String(commit.counter) && (!pos.epoch || !commit.epochId || pos.epoch === toSafeB64(String(commit.epochId)));
            const t1 = pos.lowerTime ? new Date(pos.lowerTime) : null;
            const t2 = pos.upperTime ? new Date(pos.upperTime) : null;
            const sameDay = !!(t1 && t2 && sameUtcDay(t1, t2));
            const rec = typeof pos.recordedMs === "number" ? new Date(pos.recordedMs) : null;
            let rowDate: string | null = null;
            if (rec) rowDate = longDate(rec);
            else if (t1 && t2) { if (sameDay) rowDate = longDate(t2); }
            else if (t2) rowDate = longDate(t2);
            else if (t1) rowDate = longDate(t1);
            const roleText = isFusedRow
              ? isEarliestFused ? "Earliest new file made from the original" : "New file made from the original"
              : recordedPositions.length === 1 ? "Placed" : isEarliest ? "Earliest placement" : "Placed again";
            const rowDigest = isFusedRow && pos.artifactDigest ? pos.artifactDigest : digestParam;
            return {
              key: `${pos.epoch}-${pos.counter}`,
              num: pos.counter != null ? Number(pos.counter).toLocaleString() : "?",
              viewing: isCurrent,
              href: `/proof/${encodeURIComponent(rowDigest)}?counter=${encodeURIComponent(pos.counter ?? "")}${pos.epoch ? `&epoch=${encodeURIComponent(pos.epoch)}` : ""}&n=${positions.length}`,
              roleLine: rowDate ? `${roleText} on ${rowDate}` : roleText,
              timeNode: rec ? timeTz(rec) : t1 ? `after ${sameDay || !t2 ? timeTz(t1) : stampTz(t1)}` : null,
            };
          });
          const showPositions = (!isEth && !isInterval) ? positions.length >= 1 : positions.length > 1;
          const setRowsView: SetRowView[] = setBound ? setRows.map((mrow, i) => ({
            key: String(mrow.index),
            ordinal: setBound.kind === "set/2" ? mrow.index + 1 : i + 1,
            viewing: viewingRow !== null && viewingRow.index === mrow.index,
            href: `/proof/${encodeURIComponent(toUrlSafeB64(mrow.originDigestB64))}?counter=${encodeURIComponent(commit.counter ?? "")}${commit.epochId ? `&epoch=${encodeURIComponent(toSafeB64(String(commit.epochId)))}` : ""}`,
            placement: mrow.placement,
            originDigestB64: mrow.originDigestB64,
          })) : [];
          const downloads: DownloadView[] = isEth
            ? [{ label: "Proof (.json)", busyLabel: "Proof (.json)", onClick: downloadProof, busy: false }]
            : [
                ...(cachedFile && !isSet && (commit as { slotAnchor?: unknown }).slotAnchor ? [{ label: "BitGraphed file", busyLabel: "Assembling\u2026", onClick: downloadCarrier, busy: carrierBusy, primary: true }] : []),
                { label: "Package (.zip)", busyLabel: "Exporting\u2026", onClick: exportZip, busy: exporting },
                { label: "Proof (.json)", busyLabel: "Proof (.json)", onClick: downloadProof, busy: false },
                ...(cachedFile && !isSet && cachedRole !== "original" && isFuseName(attr?.name) && !isInlineProof(proof) ? [{ label: "Original file", busyLabel: "Recovering\u2026", onClick: downloadOriginal, busy: originBusy }] : []),
                { label: "Ethereum anchors", busyLabel: "Fetching\u2026", onClick: downloadAnchors, busy: anchorsBusy },
              ];
          const downloadNotes = [
            ...(originMsg ? [originMsg] : []),
            ...(carrierMsg ? [carrierMsg] : []),
            ...(anchorsMsg ? [anchorsMsg] : []),
            ...(!cachedFile && !isEth ? ["The file itself is not on this device: the downloads carry the proof and its evidence, and the BitGraphed file needs the file in hand."] : []),
          ];
          const proofHashField = (proof as BitGraphProof & { proofHash?: string }).proofHash;
          const model: ProofViewModel = {
            kind,
            proof,
            recordName,
            epochFull,
            attestedMs,
            leadFallback: whenNode,
            filePane,
            c2pa: !isEth && cachedFile?.c2pa?.present ? cachedFile.c2pa : null,
            set: setBound ? { kind: setBound.kind, count: setBound.count, root: setBound.root ? bytesToHex(setBound.root) : null, rows: setRowsView } : null,
            anchorBlock: isEth ? { number: ethBlockNum, minedMs: anchorBlock?.blockTime ? new Date(anchorBlock.blockTime).getTime() : null, etherscanUrl: attr?.title ?? anchorBlock?.etherscanUrl ?? null } : null,
            anchorsBackHref,
            floor: floorView,
            commitAfter,
            ceilingPos: ceilView,
            ethWait,
            ceilingTime: !isEth ? (baseCeiling as ProofViewModel["ceilingTime"]) : null,
            ceilingFileHref: !isEth && baseCeiling?.anchor && proofHashField ? `/api/ceilings/${stdB64(proofHashField).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}` : null,
            checks,
            onConfirm: confirmAgainstNodes,
            downloads,
            downloadNotes,
            againNode: !isEth && !isInterval && cachedFile ? <BitGraphAgainButton proof={proof} cachedFile={cachedFile} /> : null,
            hashes,
            positions: showPositions ? { intro: positions.length === 1 ? "One position, with its own floor." : `${positions.length} positions. Each sits at its own place in the sequence, with its own floor.`, rows: positionRows } : null,
            positionRecord: slot ? [
              { label: "Position", value: `#${slot.counter}`, highlight: true },
              ...(slot.nonceB64 ? [{ label: "Nonce", value: String(slot.nonceB64), mono: true }] : []),
              ...(slot.signatureB64 ? [{ label: "Signature", value: String(slot.signatureB64), mono: true }] : []),
              ...(slot.epochId ? [{ label: "Epoch", value: String(slot.epochId), mono: true }] : []),
            ] : [],
            commitRows: [
              { label: "Commit position", value: `#${commit.counter}`, highlight: true },
              ...(!slot && commit.epochId ? [{ label: "Epoch", value: String(commit.epochId), mono: true }] : []),
              ...(commit.prevB64 ? [{ label: "Previous proof hash", value: commit.prevB64, mono: true }] : []),
              ...(!slot && commit.nonceB64 ? [{ label: "Nonce", value: commit.nonceB64, mono: true }] : []),
              ...(!slot && commit.slotCounter != null ? [{ label: "Reserved position", value: `#${commit.slotCounter}` }] : []),
              ...(commit.slotHashB64 ? [{ label: "Position record hash", value: commit.slotHashB64, mono: true }] : []),
              ...(commit.slotAnchor ? [{ label: "Floor at allocation", value: `Ethereum block ${commit.slotAnchor.blockNumber} (anchor #${commit.slotAnchor.counter})` }, { label: "Floor block hash", value: commit.slotAnchor.blockHash, mono: true }] : []),
              ...(commit.anchor ? [{ label: "Anchored block", value: `Ethereum block ${commit.anchor.blockNumber}`, highlight: true }, { label: "Anchored block hash", value: commit.anchor.blockHash, mono: true }] : []),
            ],
            signatureRows: [
              ...(proofHashField ? [{ label: "This BitGraph's hash", value: proofHashField, mono: true }] : []),
              { label: "Signature", value: proof.signer.signatureB64, mono: true },
              { label: "Public key", value: proof.signer.publicKeyB64, mono: true },
            ],
            enclaveRows: [
              ...(proof.environment?.measurement ? [{ label: "PCR0 (the enclave image)", value: proof.environment.measurement, mono: true }] : []),
              ...(proof.environment?.attestation?.format ? [{ label: "Attestation", value: proof.environment.attestation.format }] : []),
            ],
            intervalRows: isInterval ? [
              ...(intervalBlockNum ? [{ label: "Ethereum block", value: `https://etherscan.io/block/${intervalBlockNum}`, link: true }] : []),
              ...(attr?.message ? [{ label: "Block hash", value: attr.message, mono: true }] : []),
              ...(intervalBegan ? [{ label: "Window began", value: intervalBegan }] : []),
              ...(recordedLine ? [{ label: "Window ended", value: recordedLine }] : []),
            ] : [],
            advisoryRows: ts ? [
              ...(ts.authority ? [{ label: "Authority", value: String(ts.authority) }] : []),
              ...(ts.time ? [{ label: "TSA time", value: String(ts.time) }] : []),
              ...(ts.digestAlg ? [{ label: "Digest algorithm", value: String(ts.digestAlg) }] : []),
            ] : [],
            noteRows: attr && !isEth && !isInterval && !isFuseName(attr.name) ? [
              ...(attr.name ? [{ label: "Submitted by", value: attr.name }] : []),
              ...(attr.message ? [{ label: "Note", value: attr.message, mono: true }] : []),
              ...(attr.title ? [(/^https?:\/\//i.test(attr.title.trim()) ? { label: "Link", value: attr.title, link: true } : { label: "Title", value: attr.title })] : []),
            ] : [],
          };
          return model;
        })()} />
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
        <div role="status" aria-label="BitGraphing" className="bg-spinner" style={{ width: 32, height: 32, border: "3px solid var(--line)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "fpSpin 0.8s linear infinite" }} />
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", letterSpacing: "-0.01em" }}>BitGraphing&hellip;</div>
      </div>
    </Shell>
  );
}

/* ── Card ── */


/* ── Collapsible card — same face as Card, but the header is a disclosure
   toggle. Used for the two ETH anchor sections: their titles already state
   the essential fact (after/before block #N), so the details are optional. ── */

const btnStyle: React.CSSProperties = {
  padding: "8px 16px", fontSize: 13, fontWeight: 600, color: "var(--panel)",
  background: "var(--accent)", border: "1px solid var(--accent)", borderRadius: "var(--radius-card)", cursor: "pointer",
};

/* ── BitGraph again — fuse the file in hand into a NEW artifact under a fresh
   slot, then open the new proof. The file stays the origin; the page reached
   shows it, accepted by reconstruction, exactly as after a first drop. ── */
function BitGraphAgainButton({ proof, cachedFile }: { proof: BitGraphProof; cachedFile: { name: string; data: ArrayBuffer } | null }) {
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState("");
  if (!cachedFile) return null;
  async function run() {
    if (state === "working" || !cachedFile) return;
    setState("working");
    setMessage("");
    try {
      const file = new File([cachedFile.data], cachedFile.name);
      const out = await fuseFile(file);
      // The proof page shows the visitor's own file: remember the original
      // under the new fused digest, as the drop flow does.
      await cacheArtifactToIDB(file, out.artifactDigestB64).catch((e) => console.error("[bitgraph] cache error:", e));
      const counter = out.proof.commit?.counter;
      const epoch = out.proof.commit?.epochId ? toSafeB64(String(out.proof.commit.epochId)) : "";
      // &fresh=1 → capture flash on the new position (a just-made BitGraph).
      window.location.href = `/proof/${encodeURIComponent(toSafeB64(out.artifactDigestB64))}?counter=${encodeURIComponent(counter ?? "")}${epoch ? `&epoch=${encodeURIComponent(epoch)}` : ""}&fresh=1`;
    } catch (e) {
      console.error("[bitgraph] BitGraph again failed:", e);
      setMessage(e instanceof FuseTooLargeError ? e.message : "Could not make a new BitGraph. Try again in a moment.");
      setState("error");
    }
  }
  void proof;

  return (
    <>
      <button onClick={run} disabled={state === "working"} className="bg-action-link">
        <span>{state === "working" ? "BitGraphing…" : "BitGraph this file again"}</span>
        {state !== "working" && <span className="arrow" aria-hidden>&rarr;</span>}
      </button>
      {state === "error" && (
        <div style={{ fontSize: 12.5, color: "var(--err)", textAlign: "center" }}>{message}</div>
      )}
    </>
  );
}

/* ── Bring-your-file checker — when no artifact is cached on this device, let
   the visitor supply the file. It is hashed in the browser and matched against
   the proof's digest; on a match the page fills in (image + C2PA), on a
   mismatch it says so. Nothing is uploaded. ── */

function BringYourFile({
  proof,
  setBound,
  cacheKey,
  onMatch,
  onResolvedMember,
}: {
  proof: BitGraphProof;
  /** The bound set manifest when this is a set proof: a drop is searched for
   *  every member's original and new-file digest, not only the artifact's. */
  setBound: BoundSet | null;
  /** The page's own digest (standard base64), the IndexedDB key the page
   *  reads a remembered file back from. A set member's page is reached by the
   *  member's digest, which is not the proof's artifact digest. */
  cacheKey: string;
  onMatch: (rec: { name: string; data: ArrayBuffer; c2pa: C2PAReadResult | null; c2paChecked: boolean }) => void;
  /** A set/2 member the ledger recognised: local matching cannot find one, there being no member list. */
  onResolvedMember?: (row: SetMemberRow | null) => void;
}) {
  const [state, setState] = useState<"idle" | "reading" | "checking" | "looking" | "mismatch">("idle");
  const [dragOver, setDragOver] = useState(false);
  const [hover, setHover] = useState(false);
  // How many files the last run hashed (for the mismatch wording) and live
  // progress while a multi-file or folder drop is being searched.
  const [checkedCount, setCheckedCount] = useState(0);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [readCount, setReadCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  /* Dash geometry lives in use-dashed-edges now, shared with FileDrop: the
     doctrine (2026-08-06) is that EVERY drop target wears the dashed edge —
     "this is where you drop files" — so the solved-per-edge drawing has one
     home instead of a copy per box. */
  const edges = useDashedEdges();

  // The drop may be many files, or whole folders, and the matching file is
  // FOUND by hashing rather than the person knowing which it is: drop your
  // Pictures folder and the box answers "this one". A browser cannot search
  // the machine, but it can search whatever it is handed. `source` is the
  // DataTransfer itself (captured synchronously) or a picked file list.
  async function check(source: CapturedDrop | File[]) {
    setState("checking");
    setProgress({ done: 0, total: 0 });
    setReadCount(0);
    try {
      // Every digest the pass computes, kept: the set branch below needs the
      // same ones straight afterwards, and hashing a folder twice was most of
      // what made this look hung.
      const seen = new Map<string, File>();
      /* A dropped carrier is its committed bytes plus the proof block: strip
         first, or the outer hash matches nothing (lib/carrier-site). Folder
         drags walk too many files to pre-read and are left as they are. */
      if (Array.isArray(source)) source = (await deCarrierFiles(source)).files;
      else if (source.entries === null) source = (await deCarrierFiles(source.files)).files;
      const { match, checked } = Array.isArray(source)
        ? await findMatchInFiles(source, proof.artifact.digestB64, (done, total) => setProgress({ done, total }), seen)
        : await findMatchInDrop(
            source,
            proof.artifact.digestB64,
            // The walk fully precedes the hashing, so the first progress
            // report is also the signal that reading is over.
            (done, total) => { setState("checking"); setProgress({ done, total }); },
            // A dropped folder is read before a single hash can be taken.
            (files) => { setReadCount(files); setState("reading"); },
            seen,
          );
      setCheckedCount(checked);
      if (!match) {
        // A set proof's page is reached with ONE member in hand, its original
        // or its new file. One hashing pass over the drop against every
        // member's two digests finds it; the verifier then accepts the
        // original by reconstruction or the new file directly.
        if (setBound) {
          // WHICH member this page is about decides what the drop may accept.
          // A member's page is reached by that member's own digest, so the
          // search is scoped to its two digests. Searching every row instead
          // (473 of them, 946 digests) meant a dropped FOLDER matched whichever
          // member came first in the walk, which was usually the first file the
          // set was made from: the page then switched to it, because the held
          // member outranks the row the URL names. That looked like the page
          // resetting to the first recorded file (Mike, 2026-09-07).
          //
          // The all-rows search survives for the one case that wants it: the
          // page reached by the SET's own digest, where no member is named and
          // any member found in the drop is the right answer.
          // set/1: every listed row. set/2: the one member whose evidence came with this copy of the proof.
          const evidenceRow = setBound.kind === "set/2" ? bindSetMember(setBound, memberEvidenceOf(proof as unknown as Record<string, unknown>)) : null;
          const allRows: SetMemberRow[] = setBound.kind === "set/2" ? (evidenceRow ? [evidenceRow] : []) : setBound.members;
          const digests = dropDigestsFor(allRows, cacheKey);
          const hit = Array.isArray(source)
            ? await findAnyMatchInFiles(source, digests)
            : await findAnyMatchInDrop(source, digests);
          if (hit.match) {
            const u = await unpackSetMember(proof, new Uint8Array(await hit.match.arrayBuffer()), hit.match.name, setBound.bytes);
            const c = u.verification.category;
            if (c === "SET_MEMBER_FROM_ORIGIN" || c === "SET_MEMBER_DIRECT") { await accept(hit.match); return; }
          }
          // Nothing local could match: a set/2 knows its members only by a
          // Merkle root, so on the set's own page there is no list to compare
          // against and every genuine member reported "No match". The ledger
          // does know, from each member's indexed evidence, so ask it: hash
          // what was dropped, and take the file whose entry names THIS set.
          // The evidence that comes back binds against the root before the
          // page shows anything, so the answer is still verified here.
          if (digests.size === 0 && seen.size > 0) {
            // ⚠️ This used to hash the drop a SECOND time, then look at the
            // first 2,000 files and ask about the first 500 digests of those.
            // On a 30,000 file folder that is under two percent of it, so
            // whether your file was found came down to where it fell in the
            // walk, and the counter sat frozen on "30,000 of 30,000" for the
            // whole of it. The digests are already in hand from the pass that
            // just ran, so ask about all of them, and say so while it happens.
            setState("looking");
            const byDigest = new Map<string, File>();
            for (const [d, f] of seen) byDigest.set(toUrlSafeB64(d), f);
            const all = [...byDigest.keys()];
            setProgress({ done: 0, total: all.length });
            const mine = toUrlSafeB64(proof.artifact.digestB64);
            const chunks: string[][] = [];
            for (let i = 0; i < all.length; i += 500) chunks.push(all.slice(i, i + 500));
            let asked = 0;
            let found: { row: SetMemberRow; file: File } | null = null;
            let next = 0;
            try {
              await Promise.all(Array.from({ length: Math.min(4, chunks.length) }, async () => {
                while (!found && next < chunks.length) {
                  const chunk = chunks[next++];
                  const r = await fetch("/api/proofs/batch", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ digests: chunk }),
                  });
                  asked += chunk.length;
                  setProgress({ done: asked, total: all.length });
                  if (!r.ok) continue;
                  const answer = (await r.json()) as { results?: Record<string, { proofs?: Array<{ proof?: unknown; setDigest?: string }> }> };
                  for (const d of chunk) {
                    const entry = answer.results?.[d]?.proofs?.find((p) => p.setDigest === mine || toUrlSafeB64(String((p.proof as { artifact?: { digestB64?: string } })?.artifact?.digestB64 ?? "")) === mine);
                    if (!entry) continue;
                    const row = bindSetMember(setBound, memberEvidenceOf(entry.proof as Record<string, unknown>));
                    const f = byDigest.get(d);
                    // The evidence binds against the root here, before the page
                    // shows anything, so the ledger's answer is still checked.
                    if (row && f) { found = { row, file: f }; return; }
                  }
                }
              }));
            } catch { /* the ledger is not required to answer; fall through to mismatch */ }
            if (found !== null) {
              const hit: { row: SetMemberRow; file: File } = found;
              onResolvedMember?.(hit.row);
              await accept(hit.file);
              return;
            }
          }
        }
        // A fused proof's page is reached with the ORIGINAL in hand. Find the
        // file that hashes to the signed origin digest, rebuild the fused bytes
        // with the registered placement, and accept it only when the
        // reconstruction reproduces the committed digest. The page then shows
        // the visitor's own file, verified by reconstruction.
        const marker = fusedMarkerOf(proof);
        if (marker?.originDigestB64) {
          const origin = Array.isArray(source)
            ? await findMatchInFiles(source, marker.originDigestB64)
            : await findMatchInDrop(source, marker.originDigestB64);
          if (origin.match) {
            const rebuilt = await rebuildFromOrigin(proof, new Uint8Array(await origin.match.arrayBuffer()), origin.match.name);
            if (rebuilt.verification.category === "FUSED_FROM_ORIGIN") { await accept(origin.match); return; }
          }
        }
        setState("mismatch");
        return;
      }
      await accept(match);
    } catch {
      setState("mismatch");
    }
  }

  async function accept(file: File) {
    try {
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
        tx.objectStore("files").put({ name: file.name, data, c2pa, c2paChecked: true }, cacheKey);
        await new Promise((r, j) => { tx.oncomplete = () => r(null); tx.onerror = () => j(tx.error); });
        db.close();
      } catch (e) { console.warn("[bitgraph] cache write failed:", e); }
      onMatch({ name: file.name, data, c2pa, c2paChecked: true });
    } catch {
      setState("mismatch");
    }
  }

  const mismatch = state === "mismatch";
  // The edges are painted, so hover has to be state rather than a style
  // mutation on the node.
  // Rest is a step darker than the card hairlines so the box has presence
  // without spending the hover signal: blue stays the thing that means
  // "interactive", and the fill on top of it means "release here". Starting
  // blue would collapse rest and hover into one rung.
  const edge = mismatch ? "var(--err)" : dragOver || hover ? "var(--accent)" : "var(--faint)";
  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      /* ⚠️ captureDrop runs HERE, synchronously, not inside check(): the item
         list dies when this handler returns, and a capture that happens one
         await later reports "no directories" and quietly searches only the
         loose files. One big mixed dump — files, folders, folders with
         subfolders — is the case this box is for. */
      onDrop={(e) => { e.preventDefault(); setDragOver(false); void check(captureDrop(e.dataTransfer)); }}
      /* The same instrument as the home page's, not a footnote to the proof:
         this box is how a stranger who was handed a file actually uses the
         page. Same mark, same blue on hover and drag. Dashed edges from the
         shared hook, like every drop target. */
      ref={edges.ref}
      /* One drop box site-wide (Mike, 2026-09-17: 16:9, and every box the
         same): the geometry, the centring and the type are the .dropbox
         rules in globals.css; only the state colours are set here. */
      className="dropbox"
      style={{ backgroundColor: dragOver ? "var(--tint)" : "var(--panel)", ...edges.edgeStyle(edge) }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <input ref={inputRef} type="file" multiple style={{ display: "none" }} onClick={(e) => e.stopPropagation()} onChange={(e) => { const fs = Array.from(e.currentTarget.files || []); e.currentTarget.value = ""; if (fs.length) void check(fs); }} />
      {state === "reading" ? (
        <div className="dropbox-title" style={{ color: "var(--dim)" }}>
          {readCount > 0
            /* Not "your folder": a drop may be several folders at once, and
               the walk handles that, so the singular was quietly wrong every
               time someone used the capability. The count says what is
               happening without claiming how many roots it came from. */
            ? `Reading… ${readCount.toLocaleString()} file${readCount === 1 ? "" : "s"}`
            : "Reading…"}
        </div>
      ) : state === "checking" ? (
        <div className="dropbox-title" style={{ color: "var(--dim)" }}>
          {progress.total > 1
            ? `Searching… ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}`
            : "Searching…"}
        </div>
      ) : state === "looking" ? (
        /* A set knows its members by a Merkle root, so nothing on this page
           can be compared against the drop and the ledger has to be asked
           which file belongs here. It is a second phase with its own count,
           and saying nothing during it is what made a finished search look
           like a hung one. */
        <div className="dropbox-title" style={{ color: "var(--dim)" }}>
          {progress.total > 1
            ? <>{`Matching members… ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}`}</>
            : <>Matching members…</>}
        </div>
      ) : mismatch ? (
        <>
          <div className="dropbox-title" style={{ color: "var(--err)" }}>
            {checkedCount > 1
              ? `No match. None of the ${checkedCount.toLocaleString()} files you dropped are this file.`
              : "No match. Those are not the bytes this BitGraph describes."}
          </div>
          <div className="dropbox-line">
            Changing a single bit changes the hash completely, so an edited or re-saved copy will never match. Drop the original to try again.
          </div>
        </>
      ) : (
        <>
          {/* No mark, matching the home drop zone (2026-08-07): the drawn box
              is already the picture of where a file goes, so a document glyph
              inside it said the same thing a second time, quieter. This is
              the same instrument as the home box, pointed at one recording
              instead of the whole ledger, so it wears the same face: blue
              title, one instruction line, one quiet line under it.

              text-wrap: balance on every line, the treatment the hero and the
              camera page use: centered copy with one short trailing line
              reads as a mistake.

              Each line has one job. The title names it and says WHICH file
              ("this file", the one this page is about); the middle line names
              both gestures and the method; the last says where the work
              happens. "your device" is not repeated: the title places the
              file, the last line places the computation. */}
          {/* The whole block is weighed as one thing and centered in the
              frame, exactly as the home box: title plus both lines under it,
              their combined height split evenly above and below. The
              container is already a centered flex column with symmetric
              padding, so plain flow does it; anything that stretches a child
              or pads one side would break it. */}
          {/* Black at rest, brand blue on hover, off the same state the
              dashed edges use, so title and frame light up together. */}
          {/* One drop box site-wide (2026-09-17): the mark, one sentence, one quiet line. */}
          <DropPrompt quiet="BitGraph searches by hash and finds the match for you, even if you do not know which file it is. Nothing is uploaded; the search runs in your browser.">
            Find this file: drag files or a folder here, or <Browse />
          </DropPrompt>
          {/* ⚠️ No "choose a folder" link here either, in any browser: every
              click path to a folder raises a view-files or upload-files
              warning, which is intolerable on a box whose own copy promises
              nothing is uploaded. Folders arrive by dragging. The long note
              in file-drop.tsx has the full reasoning. */}
        </>
      )}
    </div>
  );
}

/* The route's digest is url-safe; the file cache is keyed by the standard
   form. The same conversion the page does inline where it reads the cache. */
function stdDigest(digestParam: string): string {
  let d = decodeURIComponent(digestParam).replace(/-/g, "+").replace(/_/g, "/");
  while (d.length % 4 !== 0) d += "=";
  return d;
}

/* ── Photo preview card — shows the artifact image when one is available ── */

function PhotoCard({
  cachedFile,
  c2pa,
  bare,
  previewKey,
  label,
}: {
  cachedFile: { name: string; data: ArrayBuffer } | null;
  /** "original" or "new file", when the BitGraph has both. */
  label?: string | null;
  c2pa?: C2PAReadResult | null;
  /** Skip the card chrome (used inside the BitGraphed File collapsible). */
  bare?: boolean;
  /** The proof digest (standard base64), the key a converted preview is
   *  remembered under in IndexedDB so a second visit is instant. */
  previewKey?: string;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  // True while a preview is being made from bytes the browser cannot show as
  // they are (a HEIC on anything but Safari: several seconds of WebAssembly
  // for a 24 MP photo). The card shows the wait rather than nothing; nothing
  // read as "HEIC files aren't compatible" (Mike, 2026-08-19).
  const [preparing, setPreparing] = useState(false);

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
    let cancelled = false;

    if (isHeic) {
      setPreparing(true);
      (async () => {
        try {
          // 1. A preview made on an earlier visit, remembered by digest.
          if (previewKey) {
            const remembered = await getPreviewFromIDB(previewKey);
            if (cancelled) return;
            if (remembered) {
              const url = URL.createObjectURL(remembered);
              setPreviewUrl(url);
              revoke = () => URL.revokeObjectURL(url);
              return;
            }
          }
          // 2. The browser's own decoder. Safari and iOS show HEIC natively
          //    and instantly; the probe loads the bytes as an image and either
          //    succeeds (use them as they are) or fails (convert).
          const raw = new Blob([new Uint8Array(cachedFile.data)], { type: "image/heic" });
          const rawUrl = URL.createObjectURL(raw);
          const native = await new Promise<boolean>((resolve) => {
            const probe = new Image();
            probe.onload = () => resolve(probe.naturalWidth > 0);
            probe.onerror = () => resolve(false);
            probe.src = rawUrl;
          });
          if (cancelled) { URL.revokeObjectURL(rawUrl); return; }
          if (native) {
            setPreviewUrl(rawUrl);
            revoke = () => URL.revokeObjectURL(rawUrl);
            return;
          }
          URL.revokeObjectURL(rawUrl);
          // 3. Convert to JPEG in WebAssembly (heic2any, lazy-loaded ~500 KB),
          //    and remember the result so this only ever happens once per
          //    recording in this browser.
          const heic2any = (await import("heic2any")).default;
          const result = await heic2any({ blob: new Blob([new Uint8Array(cachedFile.data)]), toType: "image/jpeg", quality: 0.85 });
          const jpegBlob = Array.isArray(result) ? result[0] : result;
          if (cancelled) return;
          const url = URL.createObjectURL(jpegBlob);
          setPreviewUrl(url);
          revoke = () => URL.revokeObjectURL(url);
          if (previewKey) void putPreviewToIDB(previewKey, jpegBlob);
        } catch (e) {
          console.warn("[bitgraph] HEIC preview failed:", e);
          if (!cancelled) setPreviewUrl(null);
        } finally {
          if (!cancelled) setPreparing(false);
        }
      })();
    } else {
      const blob = new Blob([new Uint8Array(cachedFile.data)], { type: nativeImageMime(cachedFile.name, cachedFile.data) });
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      revoke = () => URL.revokeObjectURL(url);
    }

    setPreviewFailed(false);
    return () => { cancelled = true; revoke?.(); };
  }, [cachedFile, previewKey]);

  // Image source fallback chain:
  //   1. Local preview URL (converted if HEIC, blob if native)
  //   2. C2PA embedded thumbnail (covers RAW + shared links with no cached file)
  //   3. Nothing — the card is not rendered
  const imageSrc = (!previewFailed && previewUrl) || c2pa?.thumbnailDataUrl || "";
  if (!imageSrc && !preparing) return null;

  const alt = cachedFile?.name || c2pa?.title || "Proof artifact";

  // Open target: the displayable image at full resolution. Only the local
  // preview blob qualifies — a C2PA thumbnail is low-res, so no "Open full
  // size" is offered when that is all we have.
  const openUrl = (!previewFailed && previewUrl) || null;

  // One frame rule for every orientation: uniform padding, and the photo
  // fills the padded area up to its caps — a landscape runs to the side
  // padding, a portrait to the height cap, a square to whichever comes
  // first. Long and short edges get the same breathing room either way.
  return (
    <div
      style={{
        background: "var(--panel)",
        border: bare ? "none" : "1px solid var(--line)",
        borderRadius: "var(--radius-card)",
      }}
    >
      {/* Identity row — the same name · size · Open → that FileCard gives every
          other file, and in the same place: ABOVE the preview (Mike, 2026-09-26:
          "id rather all the proofs look the same"). The inline image is capped in
          size, so Open shows it at full resolution in a new tab. Only when the
          artifact bytes are in hand (a C2PA-thumbnail-only preview has no full
          file to name or open). */}
      {cachedFile && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--line-2)" }}>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, color: "var(--dim)" }}>
            <span style={{ fontWeight: 600, color: "var(--ink)" }}>{cachedFile.name}</span>
            {" · "}{fmtBytes(cachedFile.data.byteLength)}
            {label ? <>{" · "}{label}</> : null}
          </span>
          {openUrl && (
            <a href={openUrl} target="_blank" rel="noopener" className="bg-arrow-link" style={{ flexShrink: 0, fontSize: 14, fontWeight: 600, color: "var(--accent)", textDecoration: "none", whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>
              Open
            </a>
          )}
        </div>
      )}
      <div style={{ padding: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {imageSrc ? (
          /* eslint-disable-next-line @next/next/no-img-element */
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
              borderRadius: "var(--radius-card)",
            }}
          />
        ) : (
          /* The wait, in the site's one wait look (the camera's spinner and
             label), so a slow decode is a decode in progress and not a blank
             card. Tall enough to hold the slot's shape while it works. */
          <div role="status" aria-label="Preparing preview" style={{ minHeight: 180, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
            <div className="bg-spinner" style={{ width: 32, height: 32, border: "3px solid var(--line)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", letterSpacing: "-0.01em" }}>Preparing preview…</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Non-image file display — the file is in hand but is not a picture, so
   show it the way the browser natively can: text gets an inline excerpt,
   PDFs an embedded view, audio/video their native players, and anything
   else its identity. Every kind opens with the same name · size row, as the
   image card does; the kinds a browser can render in a full tab (text, PDF)
   add an Open link there. Bytes never leave the device — everything runs on object URLs. */

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

function fileKind(name: string, data: ArrayBuffer): { kind: "pdf" | "video" | "audio" | "text" | "docx" | "other"; mime: string } {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return { kind: "pdf", mime: "application/pdf" };
  // Before the text sniff: a .docx is a zip, so looksLikeText would call it
  // binary and it would fall through to "other" and show nothing.
  if (isDocx(n)) {
    return { kind: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  }
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

function FileCard({ cachedFile, label, preview, pending }: {
  cachedFile: { name: string; data: ArrayBuffer };
  /** "original" or "new file", when the BitGraph has both. */
  label?: string | null;
  /** What to preview and Open instead of the held bytes: the original inside a
   *  new file's wrapper, whose own bytes are the wrapper's header, not text. */
  preview?: { name: string; data: ArrayBuffer } | null;
  /** Not yet known what to preview: show the row, hold the contents and Open. */
  pending?: boolean;
}) {
  // The file row names what is in hand; the preview and Open show what it reads as.
  const shown = preview ?? cachedFile;
  const { kind, mime } = fileKind(shown.name, shown.data);
  const [url, setUrl] = useState<string | null>(null);

  /* The .docx words, pulled out of the zip. In an effect and in state rather
     than computed inline like the text excerpt, because this one inflates a
     file: doing it during render would block the first paint of the whole
     proof page on a document nobody has asked to read yet. null means either
     "not a docx" or "could not read it", and both land on the identity row,
     which is a fine answer. */
  const [docx, setDocx] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    // Everything, including the clear, happens after a yield: the inflate must
    // not block the card's first paint, and setting state synchronously inside
    // an effect cascades a render for no reason. Nothing reads `docx` unless
    // the kind is docx, so clearing a beat late is invisible.
    const t = setTimeout(() => {
      if (!live) return;
      setDocx(kind === "docx" ? docxText(shown.data) : null);
    }, 0);
    return () => { live = false; clearTimeout(t); };
  }, [shown, kind]);

  useEffect(() => {
    if (kind === "other") { setUrl(null); return; }
    const u = URL.createObjectURL(new Blob([new Uint8Array(shown.data)], { type: mime }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [shown, kind, mime]);

  // Text: a plain text file opens all the way (Mike, 2026-09-30: "why dont we
  // just let txt files open all the way up"); only a huge one stops, at 50,000
  // characters, and says Open shows the rest. A formatted JSON record keeps its
  // 60-line excerpt.
  let excerpt: { text: string; truncated: boolean; formatted?: boolean } | null = null;
  // Pending: one blank line keeps the text's place, so nothing below jumps.
  if (kind === "text" && pending) excerpt = { text: "\u00a0", truncated: false };
  else if (kind === "text") {
    try {
      let raw = new TextDecoder("utf-8", { fatal: false }).decode(shown.data.slice(0, 60_000));
      let partial = shown.data.byteLength > 60_000;
      // A small .json file reads indented, since a sealed record is usually
      // one compact line. Display only, and labelled below: the bytes are untouched.
      let formatted = false;
      if (/\.json$/i.test(shown.name) && shown.data.byteLength <= 200_000) {
        try {
          const pretty = JSON.stringify(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(shown.data)), null, 2);
          if (pretty.split("\n").length > raw.split("\n").length) { raw = pretty; partial = false; formatted = true; }
        } catch { /* not JSON after all: shown as it is */ }
      }
      const limit = formatted ? 60 : Infinity;
      const lines = raw.split("\n");
      const text = lines.slice(0, limit).join("\n").slice(0, formatted ? 6000 : 50_000);
      excerpt = { text, truncated: lines.length > limit || raw.length > text.length || partial, formatted };
    } catch { excerpt = null; }
  }

  // PDF gets no inline embed: an iframe can render blank or dark on some
  // browsers / for odd bytes, and a broken-looking preview is the wrong thing
  // on a proof page. It gets the identity row + Open →, which hands the file to
  // the browser's own full PDF viewer in a new tab.
  /* .docx is deliberately NOT openable. A browser cannot render one, so the
     link would say Open and perform a download, and a link that lies about
     what it does is worse than no link. The file is already on this device;
     the reader can open it where it lives. */
  const openable = !pending && (kind === "text" || kind === "pdf");
  const hasPreview = pending ? kind === "text" : kind === "text" || kind === "video" || kind === "audio" || (kind === "docx" && !!docx);
  return (
    <div style={{ background: "var(--panel)" }}>
      {/* The identity row, and it HEADS the file rather than closing it (Mike,
          2026-09-26: people may think the file's contents are part of the proof).
          The proof's own header ends in "epoch <base64>", and a text file that
          opens with a label over a long base64 line, as the home example does,
          reads as one more proof field when nothing marks where the proof stops.
          Naming the file first draws that line before the contents begin, which
          is how GitHub heads a file view. For formats with no inline rendering it
          is still the whole display: the file's name and size, held by the
          receipt. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderBottom: hasPreview ? "1px solid var(--line-2)" : "none" }}>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, color: "var(--dim)" }}>
          <span style={{ fontWeight: 600, color: "var(--ink)" }}>{cachedFile.name}</span>
          {" · "}{fmtBytes(cachedFile.data.byteLength)}
          {label ? <>{" · "}{label}</> : null}
        </span>
        {openable && url && (
          <a href={url} target="_blank" rel="noopener" className="bg-arrow-link" style={{ flexShrink: 0, fontSize: 14, fontWeight: 600, color: "var(--accent)", textDecoration: "none", whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>
            Open
          </a>
        )}
      </div>
      {/* Font scales with the screen so a whole 43-character base64 value holds
          one line on a phone (Mike, 2026-09-26: "the text wraps weird"). At a
          fixed 12.5px a 375px screen fits 40 monospace characters, so a
          position commitment broke at its own hyphen and read as two separate
          values. 11px keeps 44 columns down to a 360px screen; 12.5px returns
          by ~417px. The bytes can't be changed to help: the file has to
          contain the exact value.
          (2026-09-30: text files now open all the way; the history below is
          why the old height cap existed.) Height capped at 1200px, raised from 560 (same day): the home
          demonstration file measured 894 to 961px tall on phones, so 560 cut
          it off mid-way and hid its last lines, the ones saying what a proof
          does NOT show. 1000 fitted, but with 39px spare at 412px (the font
          grows faster than the line widens just below 12.5px), which a larger
          system text size or a fallback font would eat. The 24-line and 3,000-character limits in the excerpt
          above are what stop a huge file taking over the page, and they are
          unchanged; this cap only has to clear a short file whose lines wrap
          on a narrow screen. */}
      {kind === "text" && excerpt && (
        <pre style={{ margin: 0, padding: 16, fontFamily: "var(--font-mono)", fontSize: "clamp(11px, 3vw, 12.5px)", lineHeight: 1.6, color: "var(--text)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {excerpt.text}{excerpt.truncated ? "\n…" : ""}
        </pre>
      )}
      {kind === "text" && excerpt?.truncated && !excerpt.formatted && (
        <div style={{ padding: "0 16px 14px", fontSize: 12.5, color: "var(--dim)" }}>The first 50,000 characters. Open shows the whole file.</div>
      )}
      {kind === "text" && excerpt?.formatted && (
        <div style={{ padding: "0 16px 14px", fontSize: 12.5, color: "var(--dim)" }}>Indented for reading. The file itself is compact JSON, exactly as recorded; Open shows it as it is.</div>
      )}
      {/* ⚠️ The label is not decoration. This is the document's TEXT, not the
          document: no fonts, no layout, no images, headings flattened to plain
          lines. On a page whose claim is "these exact bytes", an unlabelled
          approximation would read as the artifact itself. Saying what it is
          costs one quiet line and makes the preview honest. */}
      {kind === "docx" && docx && !pending && (
        <div style={{ padding: "14px 16px 16px" }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--dim)", marginBottom: 8 }}>
            Text from this document
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--text)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 1200, overflow: "hidden" }}>
            {docx.split("\n").slice(0, 24).join("\n").slice(0, 3000)}
            {docx.length > 3000 || docx.split("\n").length > 24 ? "\n…" : ""}
          </div>
        </div>
      )}
      {kind === "video" && url && !pending && (
        <div style={{ padding: 20, display: "flex", justifyContent: "center" }}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={url} controls style={{ display: "block", maxWidth: "100%", maxHeight: "min(70vh, 640px)", borderRadius: "var(--radius-card)" }} />
        </div>
      )}
      {kind === "audio" && url && !pending && (
        <div style={{ padding: "20px 16px" }}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio src={url} controls style={{ display: "block", width: "100%" }} />
        </div>
      )}
    </div>
  );
}

/* ── Content Credentials (C2PA) card — the file's self-declared provenance ──
   Pass-through of the manifest embedded in the artifact bytes. BitGraph does
   not vouch for these claims; it pins the exact bytes that carry them. Only
   recognized IPTC source types get a friendly label, so an unknown code falls
   back to the generator line rather than guessing. */


// Turn a raw C2PA generator into a human label, e.g.
// "lightroom_classic/15.3.1" -> "Lightroom Classic 15.3.1". Prefers the
// structured claimGeneratorInfo (clean name + version), falling back to the
// User-Agent-style claim_generator string. Only word-initial letters are
// cased, so acronyms like "ChatGPT" / "OpenAI" survive untouched.
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

/* ── MIME type for a browser-native image, so its blob URL carries a real
   Content-Type. Without it an <img> still decodes the blob, but OPENING the
   blob URL in a new tab shows raw bytes as text (the browser has no type to
   render by). Prefer the extension, fall back to magic bytes, default JPEG. */
function nativeImageMime(name: string, data: ArrayBuffer): string {
  const n = name.toLowerCase();
  if (/\.png$/.test(n)) return "image/png";
  if (/\.gif$/.test(n)) return "image/gif";
  if (/\.webp$/.test(n)) return "image/webp";
  if (/\.avif$/.test(n)) return "image/avif";
  if (/\.bmp$/.test(n)) return "image/bmp";
  if (/\.tiff?$/.test(n)) return "image/tiff";
  if (/\.jpe?g$/.test(n)) return "image/jpeg";
  const b = new Uint8Array(data, 0, Math.min(16, data.byteLength));
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 &&
      b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69 && b[11] === 0x66) return "image/avif";
  if (b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";
  if ((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d)) return "image/tiff";
  return "image/jpeg";
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


