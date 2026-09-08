"use client";

/* Fetching a drop's missing anchors, and packing them into one file.
 *
 * The pure half — which positions are short which side, and where their files
 * belong — is anchor-export.ts and is tested there. This half is the network
 * and the zip.
 *
 * ⚠️ ONE FILE OUT, NEVER N. Chromium prompts "wants to download multiple
 * files" on the SECOND download a page starts, so a folder of three sets
 * cannot be three downloads. It is one zip whose top level is named after the
 * dropped folder, holding only the files that folder does not have, at the
 * paths it already uses. Dragging it back offers Finder's Merge, and because
 * the zip holds ONLY what is absent there is nothing for Merge to overwrite:
 * "only what is missing" is what makes the merge safe as well as fast.
 */

import { Zip, ZipPassThrough } from "fflate";
import { blockTimeFromHeader } from "@/lib/export-pages";
import {
  anchorDirFor, anchorStatusDoc, isSettled, ANCHOR_STATUS_FILE,
  type PositionNeed, type BoundReport, type BoundState,
} from "@/lib/anchor-export";

/** The route's `bound` field. Absent from an older deployment's answer, which
 *  is itself a state we must not read as a verdict. */
interface BoundAnswer { state?: string; note?: string }

const KNOWN: BoundState[] = ["anchored", "pending", "closed", "none", "unknown-epoch", "undetermined", "unavailable"];

const UNAVAILABLE = (why: string): BoundReport => ({
  state: "unavailable",
  note: `This side was not fetched: ${why}. That is a gap in what we asked, not a fact about the ledger — the anchor may well exist. Ask again.`,
});

/**
 * One side of one position, asked once.
 *
 * ⚠️ EVERY FAILURE PATH HERE RETURNS `unavailable`, NEVER AN ABSENCE. A
 * request that throws, a 503, a 500, an answer that will not parse and an
 * answer from a deployment too old to carry `bound` are all "we did not find
 * out", and shipping any of them as a missing file would put this straight
 * back into the bug the phase exists to fix. Only a 200 carrying a `bound`
 * state we recognise is allowed to speak for the ledger.
 */
async function askSide(
  epochId: string, counter: string, side: "upper" | "lower", apiBase: string,
): Promise<{ report: BoundReport; anchor: Record<string, unknown> | null }> {
  const q = `counter=${encodeURIComponent(counter)}&epoch=${encodeURIComponent(epochId)}${side === "lower" ? "&before=1" : ""}`;
  let resp: Response;
  try {
    resp = await fetch(`${apiBase}/api/proofs/anchors?${q}`);
  } catch (e) {
    return { report: UNAVAILABLE(`the request did not complete (${(e as Error).message})`), anchor: null };
  }
  if (!resp.ok) {
    return { report: UNAVAILABLE(resp.status === 503 ? "the ledger could not be read" : `the ledger answered ${resp.status}`), anchor: null };
  }
  let data: { anchors?: Array<Record<string, unknown>>; bound?: BoundAnswer };
  try {
    data = await resp.json();
  } catch {
    return { report: UNAVAILABLE("the answer could not be read"), anchor: null };
  }
  const anchor = data.anchors?.[0] ?? null;
  if (anchor) return { report: { state: "anchored", note: data.bound?.note ?? "An Ethereum anchor bounds this position on this side." }, anchor };

  const state = data.bound?.state;
  if (!state || !KNOWN.includes(state as BoundState)) {
    // An empty list with no `bound` is exactly the four-meanings-at-once
    // answer this endpoint used to give. Refuse to interpret it.
    return { report: UNAVAILABLE("the ledger gave no reason for the absence"), anchor: null };
  }
  return {
    report: { state: state as BoundState, note: data.bound?.note ?? "" },
    anchor: null,
  };
}

/** The block-header witness for an anchor, so its Ethereum time claim can be
 *  recomputed offline. Its absence is recorded on the side's report rather
 *  than passed over: an anchor without one still bounds the position, but it
 *  cannot be read without trusting us about the block's time. */
async function witnessFor(anchor: Record<string, unknown>, apiBase: string): Promise<{ json: string; block: number; ts: number | null } | null> {
  try {
    const eth = anchor.ethereum as { blockNumber?: number; blockHash?: string } | undefined;
    const attr = anchor.attribution as { title?: string; message?: string } | undefined;
    const fromTitle = attr?.title?.match(/\/block\/(\d+)/)?.[1];
    const blockNumber = eth?.blockNumber ?? (fromTitle ? parseInt(fromTitle, 10) : undefined);
    const blockHash = eth?.blockHash ?? attr?.message;
    if (blockNumber === undefined || !blockHash) return null;
    const r = await fetch(`${apiBase}/api/proofs/witness?block=${blockNumber}&hash=${encodeURIComponent(blockHash)}`);
    if (!r.ok) return null;
    const w = await r.json();
    return { json: JSON.stringify(w, null, 2), block: blockNumber, ts: w?.headerRlpHex ? blockTimeFromHeader(w.headerRlpHex) || null : null };
  } catch {
    return null;
  }
}

export interface FetchedPosition {
  need: PositionNeed;
  files: Array<{ name: string; text: string }>;
  upper: BoundReport;
  lower: BoundReport;
}

export interface AnchorFetchSummary {
  positions: FetchedPosition[];
  /** Positions whose upper bound is still open — "not yet", not "none". */
  pending: number;
  /** Positions where we could not find out. Our gap, never the folder's. */
  unavailable: number;
  /** Positions with an upper bound that will never exist. */
  closed: number;
  /** Files the zip will carry. */
  fileCount: number;
}

/**
 * Fetch what the drop is missing. ONE pair of requests per POSITION — a set of
 * 48,000 files is three requests, not 96,000.
 *
 * Four at a time: this is a handful of small reads for a folder of any size
 * (the 48k folder is three positions), so there is nothing here to pool
 * harder. If a drop ever holds thousands of distinct positions this is the
 * knob, and it should be sized by what the slowest CONCURRENT request costs.
 */
export async function fetchAnchorsFor(
  needs: PositionNeed[],
  onProgress?: (done: number, total: number) => void,
  apiBase = "",
): Promise<AnchorFetchSummary> {
  const positions: FetchedPosition[] = new Array(needs.length);
  let done = 0;
  let next = 0;
  const WIDTH = 4;

  await Promise.all(Array.from({ length: Math.min(WIDTH, needs.length) }, async () => {
    while (next < needs.length) {
      const i = next++;
      const need = needs[i];
      const files: Array<{ name: string; text: string }> = [];

      const [up, low] = await Promise.all([
        need.needUpper ? askSide(need.epochId, need.counter, "upper", apiBase)
          : Promise.resolve({ report: { state: "anchored", note: "Already in the folder." } as BoundReport, anchor: null }),
        need.needLower ? askSide(need.epochId, need.counter, "lower", apiBase)
          : Promise.resolve({ report: { state: "anchored", note: "Already in the folder." } as BoundReport, anchor: null }),
      ]);

      for (const [side, got] of [["after", up], ["before", low]] as const) {
        if (!got.anchor) continue;
        files.push({ name: `anchor-${side}.json`, text: JSON.stringify(got.anchor, null, 2) });
        const w = await witnessFor(got.anchor, apiBase);
        got.report.witness = !!w;
        if (w) {
          files.push({ name: `anchor-${side}-witness.json`, text: w.json });
          got.report.block = w.block;
        }
      }

      // ⚠️ The status file is written whenever the position is NOT settled —
      // including when a side we did fetch came back permanently absent. It is
      // the difference between a folder that is missing an anchor and a folder
      // whose anchor does not exist, and it is the entire reason for the phase.
      if (!isSettled(up.report.state, low.report.state)) {
        files.push({
          name: ANCHOR_STATUS_FILE,
          text: JSON.stringify(
            anchorStatusDoc({ epochId: need.epochId, counter: need.counter }, up.report, low.report),
            null, 2),
        });
      }

      positions[i] = { need, files, upper: up.report, lower: low.report };
      onProgress?.(++done, needs.length);
    }
  }));

  const has = (p: FetchedPosition, s: BoundState) => p.upper.state === s || p.lower.state === s;
  return {
    positions,
    pending: positions.filter((p) => p.upper.state === "pending").length,
    unavailable: positions.filter((p) => has(p, "unavailable") || has(p, "undetermined")).length,
    closed: positions.filter((p) => p.upper.state === "closed").length,
    fileCount: positions.reduce((n, p) => n + p.files.length, 0),
  };
}

/** Zip-entry names are always "/"-joined, whatever the host filesystem uses. */
const zipPath = (segs: string[]) => segs.join("/");

/**
 * One zip, whose top level is the dropped folder's own name so that dragging
 * it back lands the files where they belong.
 *
 * The paths inside mirror the drop exactly (anchorDirFor decides where each
 * position's files go), which is what lets this merge with no instructions.
 */
export function packAnchorZip(summary: AnchorFetchSummary): Blob {
  const chunks: Uint8Array[] = [];
  let error: Error | null = null;
  let finished = false;
  const z = new Zip((err, chunk, final) => {
    if (err) { error = err; return; }
    if (chunk) chunks.push(chunk);
    if (final) finished = true;
  });
  for (const p of summary.positions) {
    if (!p.files.length) continue;
    const dir = anchorDirFor(p.need);
    for (const f of p.files) {
      const entry = new ZipPassThrough(zipPath([...dir, f.name]));
      z.add(entry);
      entry.push(new TextEncoder().encode(f.text), true);
    }
  }
  z.end();
  // fflate's Zip is synchronous for pushed-whole entries; every callback has
  // already run by the time end() returns for content this small.
  if (error) throw error;
  if (!finished) throw new Error("the anchors package did not finish");
  const size = chunks.reduce((s, c) => s + c.length, 0);
  const merged = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { merged.set(c, at); at += c.length; }
  return new Blob([merged.buffer as ArrayBuffer], { type: "application/zip" });
}

/** What the download is called. The dropped folder's name, so the file says
 *  which folder it belongs to while it sits alone in Downloads for weeks —
 *  the same reason FOLDERNAME-bitgraphs.json carries its name.
 *  ⚠️ A drop of loose files has no folder name to borrow; see the caller. */
export function anchorZipName(dropName: string | null): string {
  const safe = (dropName ?? "").replace(/[\x00-\x1f\x7f/]/g, " ").trim();
  return safe ? `${safe} anchors.zip` : "BitGraph anchors.zip";
}
