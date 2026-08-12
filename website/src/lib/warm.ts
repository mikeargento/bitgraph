// A tiny client-side "warm cache". Start fetching a page's data BEFORE the user
// navigates — on idle for a fixed, known target (the example proof), or on
// hover / focus / touch intent for a nav link (the Roll feed) — and stash the
// parsed JSON in a module slot. The destination page seeds its first paint from
// the slot (takeWarm) and then runs its normal fetch as a background reconcile,
// so nothing is ever frozen: the warm copy is just a REAL response fetched a few
// seconds early, and any dynamic field (a new Recording, fresh Roll rows) is
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

// The curated example proof linked from the home hero ("See an example"). Fixed
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

/** The Roll feed's initial (files-only, no-cursor) URL. This MUST stay byte-
 *  identical to Explorer's `feedUrl()` with its default state, because warm
 *  slots are keyed by URL string: the Roll went files-default without this
 *  constant following, so the nav warmed "/api/explorer?" while the page
 *  fetched "/api/explorer?files=1" and every hover prefetched a response
 *  nobody read. If the anchors toggle ever changes its default, change this
 *  too. */
export const ROLL_FEED_KEY = "/api/explorer?files=1";
