// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * The upper bound, later.
 *
 * The floor is inside the signed proof at commit time, so a make needs nothing
 * but the two calls. The upper bound is DEFERRED, NEVER LOST: the counter is
 * in the signed body and anchors are permanent, so a proof made today
 * completes in a year, and anyone holding it can complete it. This is that
 * completion, running quietly instead of as a ceremony you have to remember.
 *
 * ⚠️ BOTH ROUTES ARE KEYED BY COUNTER AND BLOCK, NEVER BY DIGEST. That is
 * exactly why they survived the 2026-09-08 cutover when the by-digest index
 * did not. Nothing about your file is sent: an epoch id, a counter, a block
 * number, a block hash.
 *
 * ⚠️ ONE POSITION, NOT ONE FILE. A set of 48,000 photos is ONE position. Its
 * four anchor files are ~18.5 KB; asking per file would be 48,000 identical
 * requests and 887 MB of the same four files on disk.
 *
 * ⚠️ AN ABSENCE MUST SAY WHICH KIND IT IS. "No upper bound was fetched" and
 * "no upper bound exists" are opposite claims, and only one of them is about
 * the holder. This is the single most repeated lesson in this codebase, so the
 * route's `bound` state is written down verbatim beside whatever is missing,
 * with the moment it was asked. A read that failed is `unavailable` and is
 * never allowed to look like `closed`.
 */

import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "./evidence.js";
import { pathsFor } from "./paths.js";
import { ANCHOR_DIR } from "./paths.js";

export const ANCHOR_STATUS_VERSION = "bitgraph-anchor-status/1";

/**
 * What the ledger says about one side of a position.
 *
 * The first six come from the route itself. `unavailable` is ours: the request
 * failed or answered 503, which is a gap on our side and not a fact about the
 * ledger.
 */
export type BoundState = "anchored" | "pending" | "closed" | "none" | "unknown-epoch" | "undetermined" | "unavailable";

/** States that will never change. Asking again is wasted. */
const SETTLED: ReadonlySet<BoundState> = new Set<BoundState>(["anchored", "closed", "none"]);

/**
 * How long to leave a side alone after each kind of answer.
 *
 * ⚠️ WITHOUT THIS THE APP IS A LOAD GENERATOR. A folder that has recorded for
 * a month holds hundreds of positions, and a pass that re-asks every open side
 * every minute is hundreds of requests a minute at one host, forever, from
 * every install. The states differ in how fast they can possibly change:
 *
 *   pending        an anchor is coming. They land every ~12 s while the
 *                  enclave is busy and up to an hour when it is not, so two
 *                  minutes is often enough and is never wasteful.
 *   unavailable    the failure was on OUR side. Retry sooner, but not in a
 *                  loop: a host that is down does not come back faster for
 *                  being asked.
 *   undetermined,  the ledger could not say. Nothing about this resolves
 *   unknown-epoch  quickly, and asking often would be asking a question that
 *                  has no fast answer.
 */
const MIN_INTERVAL_MS: Record<BoundState, number> = {
  anchored: Infinity,
  closed: Infinity,
  none: Infinity,
  pending: 2 * 60_000,
  unavailable: 60_000,
  undetermined: 10 * 60_000,
  "unknown-epoch": 30 * 60_000,
};

/** A side that answered this recently is left alone until its interval passes. */
function tooSoon(prior: SideStatus | undefined, now: number): boolean {
  if (prior === undefined) return false;
  const gap = MIN_INTERVAL_MS[prior.state] ?? 0;
  if (gap === Infinity) return true;
  const asked = Date.parse(prior.askedAt);
  return Number.isFinite(asked) && now - asked < gap;
}

export interface SideStatus {
  state: BoundState;
  note: string;
  /** When this side was last asked about. This machine's clock; a scheduling aid, not evidence. */
  askedAt: string;
}

export interface AnchorStatusFile {
  version: typeof ANCHOR_STATUS_VERSION;
  position: { epochId: string; counter: string };
  before?: SideStatus;
  after?: SideStatus;
}

export interface AnchorTransport {
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface AnchorPass {
  /** Positions looked at. */
  positions: number;
  /** Sides that arrived this pass. */
  landed: number;
  /** Sides still open, by state. */
  open: Record<string, number>;
  /** Sides left alone because they were asked recently enough. */
  waiting: number;
  /** True when the pass stopped early. Nothing claims a count it did not count. */
  partial: boolean;
}

const DEFAULT_BASE = "https://bitgraph.ing";

/**
 * Fetch whatever is missing for one position and write it down.
 *
 * Returns the sides that are still open. A settled side is never asked about
 * again: `anchored`, `closed` and `none` are permanent answers.
 */
export async function completePosition(
  positionDir: string,
  position: { epochId: string; counter: string },
  transport: AnchorTransport = {},
  options: { now?: number; force?: boolean } = {},
): Promise<{ landed: number; open: Record<BoundState, number>; waiting: number; asked: number }> {
  const anchorDir = join(positionDir, ANCHOR_DIR);
  const statusPath = join(positionDir, "anchors-status.json");
  const previous = await readStatus(statusPath);

  const open: Partial<Record<BoundState, number>> = {};
  let landed = 0;
  let waiting = 0;
  let asked = 0;
  const now = options.now ?? Date.now();
  const status: AnchorStatusFile = { version: ANCHOR_STATUS_VERSION, position: { ...position } };

  for (const side of ["before", "after"] as const) {
    const anchorPath = join(anchorDir, `anchor-${side}.json`);
    if (await exists(anchorPath)) continue;

    const prior = previous?.[side];
    if (prior !== undefined && SETTLED.has(prior.state)) {
      /* A permanent answer, already on disk. Carried forward untouched so the
       * file keeps saying why, and not asked again. */
      status[side] = prior;
      open[prior.state] = (open[prior.state] ?? 0) + 1;
      continue;
    }
    if (options.force !== true && tooSoon(prior, now)) {
      /* Asked recently enough. The answer on disk is carried forward exactly
       * as it stands, timestamp included, so nothing pretends to be fresher
       * than it is. */
      status[side] = prior!;
      open[prior!.state] = (open[prior!.state] ?? 0) + 1;
      waiting++;
      continue;
    }

    asked++;
    const answer = await askAnchor(position, side, transport);
    if (answer.anchor !== undefined) {
      await mkdir(anchorDir, { recursive: true });
      await writeJsonAtomic(anchorPath, answer.anchor);
      landed++;
      const witness = await askWitness(answer.anchor, transport);
      /* ⚠️ A missing witness is not a missing anchor. The anchor is the claim;
       * the header is what lets a reader recompute keccak256(header) and read
       * the block time without trusting anyone. Its absence is recorded on the
       * side, and the anchor still stands. */
      if (witness !== null) await writeJsonAtomic(join(anchorDir, `anchor-${side}-witness.json`), witness);
      continue;
    }
    status[side] = { state: answer.state, note: answer.note, askedAt: new Date().toISOString() };
    open[answer.state] = (open[answer.state] ?? 0) + 1;
  }

  /* Written ONLY when a side is missing. A fully anchored position gets no
   * status file at all, so the file's presence is itself the signal that
   * something is unfinished. */
  if (status.before === undefined && status.after === undefined) {
    await rm(statusPath, { force: true });
  } else {
    await writeJsonAtomic(statusPath, status);
  }
  return { landed, open: open as Record<BoundState, number>, waiting, asked };
}

/** One pass over every position a folder holds. */
/**
 * The most requests one pass will make.
 *
 * ⚠️ A BUDGET, NOT A LIMIT ON WHAT GETS ANCHORED. Whatever is not reached this
 * pass is reached on the next one, and an upper bound is deferred, never lost:
 * the counter is in the signed body and anchors are permanent. What this
 * prevents is a folder with a thousand open positions turning one install into
 * a thousand requests a minute at one host. A pass that stops on the budget
 * says `partial` rather than reporting its counts as the folder's.
 */
export const REQUESTS_PER_PASS = 60;

/**
 * Fetch what every recording in the library is missing.
 *
 * ⚠️ THE ANCHORS GO IN THE RECORDING. A recording folder is the whole of a
 * BitGraph, so its Ethereum window belongs inside it: hand somebody the folder
 * and they have the proof, the file, and both bounds, with nothing to look up.
 */
export async function completeLibrary(
  library: string,
  rows: Iterable<{ epochId: string; counter: string; bundle?: string }>,
  transport: AnchorTransport = {},
  signal?: { aborted: boolean },
  budget = REQUESTS_PER_PASS,
): Promise<AnchorPass> {
  const seen = new Map<string, string>();
  for (const r of rows) {
    if (r.bundle === undefined || r.bundle === "") continue;
    seen.set(`${r.epochId} ${r.counter}`, r.bundle);
  }
  const open: Record<string, number> = {};
  let landed = 0;
  let waiting = 0;
  let spent = 0;
  let looked = 0;
  let partial = false;
  for (const [key, bundle] of seen) {
    if (signal?.aborted === true || spent >= budget) {
      partial = true;
      break;
    }
    const at = key.lastIndexOf(" ");
    const position = { epochId: key.slice(0, at), counter: key.slice(at + 1) };
    looked++;
    const r = await completePosition(join(library, ...bundle.split("/")), position, transport);
    landed += r.landed;
    waiting += r.waiting;
    spent += r.asked;
    for (const [state, n] of Object.entries(r.open)) open[state] = (open[state] ?? 0) + n;
  }
  return { positions: looked, landed, open, waiting, partial };
}

export async function completeFolder(
  root: string,
  positions: Iterable<{ epochId: string; counter: string }>,
  transport: AnchorTransport = {},
  signal?: { aborted: boolean },
  budget = REQUESTS_PER_PASS,
): Promise<AnchorPass> {
  const paths = pathsFor(root);
  const open: Record<string, number> = {};
  let landed = 0;
  let seen = 0;
  let waiting = 0;
  let spent = 0;
  let partial = false;
  for (const p of positions) {
    if (signal?.aborted === true || spent >= budget) {
      partial = true;
      break;
    }
    seen++;
    const r = await completePosition(paths.position(p.epochId, p.counter), p, transport);
    landed += r.landed;
    waiting += r.waiting;
    spent += r.asked;
    for (const [state, n] of Object.entries(r.open)) open[state] = (open[state] ?? 0) + n;
  }
  return { positions: seen, landed, open, waiting, partial };
}

// ---------------------------------------------------------------------------

interface AnchorAnswer {
  anchor?: unknown;
  state: BoundState;
  note: string;
}

async function askAnchor(position: { epochId: string; counter: string }, side: "before" | "after", t: AnchorTransport): Promise<AnchorAnswer> {
  const base = t.baseUrl ?? DEFAULT_BASE;
  const url = `${base}/api/proofs/anchors?counter=${encodeURIComponent(position.counter)}&epoch=${encodeURIComponent(position.epochId)}${side === "before" ? "&before=1" : ""}`;
  let res: Response;
  try {
    res = await request(url, t);
  } catch (err) {
    return unavailable(`the ledger could not be reached: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    /* ⚠️ 503 is the route saying "the read failed", which is deliberately NOT
     * an empty list. Anything else non-200 is equally ours, not the ledger's. */
    return unavailable(`the ledger answered ${res.status} when asked for the anchor ${side} this position.`);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return unavailable("the ledger's answer could not be read.");
  }
  const body = json as { anchors?: unknown[]; bound?: { state?: string; note?: string } };
  const first = Array.isArray(body.anchors) ? body.anchors[0] : undefined;
  if (first !== undefined) {
    return { anchor: first, state: "anchored", note: body.bound?.note ?? "An Ethereum anchor bounds this position on this side." };
  }
  const state = normalizeState(body.bound?.state);
  return {
    state,
    /* The route's own words are kept. It is the thing that knows why. */
    note: body.bound?.note ?? "The ledger returned no anchor for this side and gave no reason.",
  };
}

/** The anchor's block header, so a reader can recompute keccak256(header) themselves. */
async function askWitness(anchor: unknown, t: AnchorTransport): Promise<unknown | null> {
  const a = anchor as { attribution?: { message?: unknown; title?: unknown } } | null;
  const hash = typeof a?.attribution?.message === "string" ? a.attribution.message : null;
  const title = typeof a?.attribution?.title === "string" ? a.attribution.title : "";
  const block = /(\d+)\s*$/.exec(title)?.[1] ?? null;
  if (hash === null || block === null) return null;
  const base = t.baseUrl ?? DEFAULT_BASE;
  try {
    const res = await request(`${base}/api/proofs/witness?block=${encodeURIComponent(block)}&hash=${encodeURIComponent(hash)}`, t);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function request(url: string, t: AnchorTransport): Promise<Response> {
  const f = t.fetch ?? fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), t.timeoutMs ?? 30_000);
  try {
    return await f(url, { signal: ac.signal, headers: { Accept: "application/json" } });
  } finally {
    clearTimeout(timer);
  }
}

function unavailable(note: string): AnchorAnswer {
  return { state: "unavailable", note: `${note} This is a gap on this machine's side, not a statement about the ledger: ask again.` };
}

function normalizeState(s: unknown): BoundState {
  switch (s) {
    case "anchored":
    case "pending":
    case "closed":
    case "none":
    case "unknown-epoch":
    case "undetermined":
      return s;
    default:
      return "undetermined";
  }
}

async function readStatus(path: string): Promise<AnchorStatusFile | null> {
  try {
    const v = JSON.parse(await readFile(path, "utf8")) as AnchorStatusFile;
    return v.version === ANCHOR_STATUS_VERSION ? v : null;
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
