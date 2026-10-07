// A tiny client-side "warm cache". Start fetching a page's data BEFORE the user
// navigates — on idle for a fixed, known target (the example proof), or on
// hover / focus / touch intent for a nav link (the ledger feed) — and stash the
// parsed JSON in a module slot. The destination page seeds its first paint from
// the slot (takeWarm) and then runs its normal fetch as a background reconcile,
// so nothing is ever frozen: the warm copy is just a REAL response fetched a few
// seconds early, and any dynamic field (a new Recording, fresh Ledger rows) is
// corrected by the reconcile. Module state survives a client-side router.push,
// so the handoff needs no storage.

type Slot = { at: number; data?: unknown; inflight?: Promise<unknown> };

const slots = new Map<string, Slot>();
// A warm copy older than this is treated as cold: the destination ignores it and
// fetches fresh, so a tab left open for minutes never seeds stale data.
const TTL_MS = 60_000;

function defaultFetcher(key: string): Promise<unknown> {
  return fetch(key).then((r) => {
    if (!r.ok) throw new Error(`warm ${key}: ${r.status}`);
    return r.json();
  });
}

/** Begin (or reuse) a warm fetch for `key`. No-op if one is already in flight or
 *  a fresh result is already cached. `key` doubles as the fetch URL unless a
 *  custom `fetcher` is given. Safe to call repeatedly (e.g. on every hover). */
export function warm(key: string, fetcher?: () => Promise<unknown>): void {
  if (typeof window === "undefined") return;
  const existing = slots.get(key);
  if (existing?.inflight) return;
  if (existing?.data !== undefined && Date.now() - existing.at < TTL_MS) return;
  const run = fetcher ?? (() => defaultFetcher(key));
  const p = run()
    .then((data) => { slots.set(key, { at: Date.now(), data }); return data; })
    .catch((e) => { slots.delete(key); throw e; });
  // Swallow the rejection on the stored promise so a failed warm never surfaces
  // as an unhandled rejection; the destination just falls back to its own fetch.
  p.catch(() => {});
  slots.set(key, { at: Date.now(), inflight: p });
}

/** Read a warm result for `key`: `{ data }` if a fresh one is ready, `{ promise }`
 *  if a warm fetch is still running, or null if neither. Does not clear the slot,
 *  so a later reconcile can still reuse it. */
export function takeWarm<T = unknown>(key: string): { data: T } | { promise: Promise<T> } | null {
  const s = slots.get(key);
  if (!s) return null;
  if (s.data !== undefined && Date.now() - s.at < TTL_MS) return { data: s.data as T };
  if (s.inflight) return { promise: s.inflight as Promise<T> };
  return null;
}

// ── Fixed warm targets ──────────────────────────────────────────────────────

// The curated example proof. It was the home hero's link until 2026-08-18,
// when that became "What is a BitGraph" pointing at /docs/overview; the proof
// page still self-seeds this digest's image, which is why it stays. Fixed
// bytes at a fixed causal position, so it can be warmed on home idle and clicked
// into instantly. The proof itself, its settled causal window, and the image are
// immutable; only its Recordings list can grow, which the reconcile handles.
// #7,910: Preston with Lightroom C2PA intact, first example from the
// enclave-v5 epoch (2026-07-29). Chosen over its predecessor (#178,502, prior
// epoch) because the example's PCR0 must match the measurement published on
// /docs/self-host-tee, and that epoch's measurement is retired. When the
// enclave is next rebuilt, re-record an example under the new measurement and
// update this constant in the same motion as PINS.md and the docs page.
export const EXAMPLE_PROOF = {
  // The ChatGPT original from the three-images research (2026-08-10):
  // OpenAI-signed C2PA with an RFC 3161 token, zero parents, recorded at
  // #8,038. Replaced preston.jpg as the front-door example 2026-08-12
  // (Mike's call); preston stays hosted so existing links keep their photo.
  digest: "ngeTOzgjwu_2x2pQyLG3lbhFPFHLkF8JKdETlZyvcyY",
  counter: "8038",
  epoch: "2bx9IFX9ZOoY5HSwlZstSEGx1PWv8DncGofdK5v93jQ",
};

/** The previous example (a real photograph with C2PA); its proof page keeps
 *  showing the picture for anyone holding the old link. */
export const PRESTON_PROOF_DIGEST = "mYNezUiNnzhS3V0xqDsGUWCg2ZsKshiftAI016JPBUc";

/** The exact `/api/proofs/digest/…` URL the proof page fetches for a given
 *  digest + position. Shared by the warmer and the proof page so the warm key
 *  and the fetch URL can never drift apart. */
export function proofFeedKey(digestParam: string, counter?: string | null, epoch?: string | null): string {
  const sel = new URLSearchParams();
  if (counter) sel.set("counter", counter);
  if (epoch) sel.set("epoch", epoch);
  const s = sel.toString();
  return `/api/proofs/digest/${digestParam}${s ? `?${s}` : ""}`;
}

/** The home page's "See a real BitGraph" target. Its own constant rather than
 *  EXAMPLE_PROOF, which is the ChatGPT image used elsewhere: the home example is
 *  BitGraph #135 (2026-10-07): an image of Mike's line, "BitGraph doesn't stop anyone from
 *  lying between 1955 and 1985. It stops anyone from going back to 1955 with the almanac.", made
 *  INSIDE its BitGraph, in one run (SDK beginTask, then the image drawn with the position
 *  commitment at its foot and in a PNG text chunk, then sealTask; 3 s from open to sealed):
 *  bitgraph-fuse/3, so the commitment binds the Base floor block's hash and the picture could
 *  not have existed before that block or before its BitGraph began. Floor Base block
 *  52,277,792, recorded 3 s later, ceiling 52,277,795. Lines: "BitGraph doesn't stop anyone
 *  from / lying between 1955 and 1985. / It stops anyone from going back / to 1955 with the
 *  almanac." (Mike chose these breaks.) Drafts #127, #129, #131 and #133 were made step by step
 *  through the MCP tools, 16 to 26 s windows ("yuck"), and stay on the chain unused. Hosted at
 *  /example/bitgraph-almanac.png (EXAMPLE_FILES, keyed by this digest).
 *  Before it: BitGraph #14 (an image from /image, 2026-10-07 morning) and the one-line text
 *  file BitGraph #1,281 (2026-10-05, Ethereum floor).
 *
 *  The warm key must be the no-query form, because the home link carries no
 *  ?counter/?epoch, so the proof page computes proofFeedKey(digest, null, null).
 *  Warming any other shape stores a response nobody reads, which is exactly the
 *  failure LEDGER_FEED_KEY below was written to stop happening twice. */
export const HOME_EXAMPLE_DIGEST = "sq_qZ7Tuu4h-Jj-HBlRRVDaPcq5CHaJjuSI7faDsppM";

/** The ledger feed's initial (files-only, no-cursor) URL. This MUST stay byte-
 *  identical to Explorer's `feedUrl()` with its default state, because warm
 *  slots are keyed by URL string: the ledger went files-default without this
 *  constant following, so the nav warmed "/api/explorer?" while the page
 *  fetched "/api/explorer?files=1" and every hover prefetched a response
 *  nobody read. If the anchors toggle ever changes its default, change this
 *  too. */
export const LEDGER_FEED_KEY = "/api/explorer?files=1";
