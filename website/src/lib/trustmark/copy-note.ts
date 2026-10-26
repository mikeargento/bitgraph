// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * A photo recorded on Make whose pixels carry a pointer to an earlier BitGraph is recorded all the same: recording says
 * only that these bytes existed by then. Its proof page then says whose copy it is, the earliest known recording. The
 * drop box hands that over in this tab's session storage, keyed by the photo's digest.
 */

export type CopyOf = { counter: number; href: string };
const key = (digestUrlSafe: string) => `bitgraph-copy-of:${digestUrlSafe}`;

export function noteCopyOf(digestUrlSafe: string, c: CopyOf): void {
  try { sessionStorage.setItem(key(digestUrlSafe), JSON.stringify(c)); } catch { /* the note is a courtesy */ }
}
export function copyOfNote(digestUrlSafe: string): CopyOf | null {
  try {
    const c = JSON.parse(sessionStorage.getItem(key(digestUrlSafe)) ?? "null") as Partial<CopyOf> | null;
    return c && Number.isSafeInteger(c.counter) && typeof c.href === "string" && c.href.startsWith("/proof/") ? (c as CopyOf) : null;
  } catch { return null; }
}
