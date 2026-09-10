// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * The update channel: the app is TOLD, it does not install.
 *
 * ⚠️ THE RECORDER EXECUTES NOTHING IT DOWNLOADS (README, "What this is not"),
 * and a self-replacing updater is exactly a thing that downloads and runs. So
 * this reads one small JSON feed on the same host it already speaks to, says
 * whether a newer version exists, and hands over the URL of the notarized DMG.
 * Opening that URL is the person's act, and Gatekeeper checks the download the
 * way it checks any other. The feed is written by mac/release.sh from the
 * release it just checked, so version, URL and checksum come from one place.
 */

export const DEFAULT_UPDATE_FEED = "https://bitgraph.ing/recorder/latest.json";

/** What the feed says. Every field is checked before it is believed. */
export interface UpdateFeed {
  version: string;
  url: string;
  notes?: string;
  sha256?: string;
  minimumSystemVersion?: string;
  publishedAt?: string;
}

export interface UpdateCheck {
  current: string;
  latest: string;
  available: boolean;
  url: string;
  notes: string;
  sha256: string;
  checkedAt: string;
}

const SEMVER = /^\d+\.\d+\.\d+$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** -1, 0 or 1 for a < b, a == b, a > b. Plain three-part versions only. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** The feed, or a reason it cannot be believed. */
export function parseFeed(raw: unknown): UpdateFeed {
  if (typeof raw !== "object" || raw === null) throw new Error("the update feed is not an object.");
  const f = raw as Record<string, unknown>;
  if (typeof f.version !== "string" || !SEMVER.test(f.version)) throw new Error("the update feed names no version.");
  if (typeof f.url !== "string" || !f.url.startsWith("https://")) throw new Error("the update feed's download is not an https URL.");
  const out: UpdateFeed = { version: f.version, url: f.url };
  if (typeof f.notes === "string" && f.notes.startsWith("https://")) out.notes = f.notes;
  if (typeof f.sha256 === "string" && HEX64.test(f.sha256)) out.sha256 = f.sha256;
  if (typeof f.minimumSystemVersion === "string") out.minimumSystemVersion = f.minimumSystemVersion;
  if (typeof f.publishedAt === "string") out.publishedAt = f.publishedAt;
  return out;
}

/**
 * Ask the feed whether something newer than `current` exists. Never throws
 * on a version the feed cannot parse of its own: a bad feed is an error the
 * caller reports as a gap, not a verdict that the app is current.
 */
export async function checkForUpdate(opts: { current: string; feedUrl?: string; fetch?: typeof fetch }): Promise<UpdateCheck> {
  if (!SEMVER.test(opts.current)) throw new Error(`the app's own version is not a version: ${opts.current}`);
  const doFetch = opts.fetch ?? fetch;
  const res = await doFetch(opts.feedUrl ?? DEFAULT_UPDATE_FEED, { headers: { accept: "application/json", "cache-control": "no-cache" } });
  if (!res.ok) throw new Error(`the update feed answered ${res.status}.`);
  const feed = parseFeed(await res.json());
  return {
    current: opts.current,
    latest: feed.version,
    available: compareVersions(feed.version, opts.current) > 0,
    url: feed.url,
    notes: feed.notes ?? "",
    sha256: feed.sha256 ?? "",
    checkedAt: new Date().toISOString(),
  };
}
