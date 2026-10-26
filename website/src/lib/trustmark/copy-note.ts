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
/** A search found this BitGraph's Content Credentials for the copy in hand: how closely the copy matched their
 *  signed thumbnail. Shown on the proof page the result opens. */
const matchKey = (digestUrlSafe: string) => `bitgraph-credentials-match:${digestUrlSafe}`;
export function noteCredentialsMatch(digestUrlSafe: string, score: number): void {
  try { sessionStorage.setItem(matchKey(digestUrlSafe), String(score)); } catch { /* the note is a courtesy */ }
}
export function credentialsMatchNote(digestUrlSafe: string): number | null {
  try { const v = Number(sessionStorage.getItem(matchKey(digestUrlSafe))); return v > 0 && v <= 1 ? v : null; } catch { return null; }
}

export function copyOfNote(digestUrlSafe: string): CopyOf | null {
  try {
    const c = JSON.parse(sessionStorage.getItem(key(digestUrlSafe)) ?? "null") as Partial<CopyOf> | null;
    return c && Number.isSafeInteger(c.counter) && typeof c.href === "string" && c.href.startsWith("/proof/") ? (c as CopyOf) : null;
  } catch { return null; }
}
