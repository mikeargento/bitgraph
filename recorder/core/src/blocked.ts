// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * macOS blocking the app, said in words.
 *
 * ⚠️ EPERM ON A FILE THE APP ITSELF WROTE IS NOT A PERMISSIONS BUG. It is
 * macOS's privacy layer (TCC) refusing this app the folder: Desktop, Documents,
 * Downloads, a removable or network volume. Mike, 2026-09-09: the app was
 * renamed, the new bundle id had no Desktop grant, and the window said
 * "EPERM: operation not permitted, open '…/Recordings/.index.jsonl'" over a
 * calendar reading "Nothing recorded yet" with six recordings on disk. The
 * raw code reached him and the empty count lied.
 *
 * The person can fix it in one place, so the sentence names the place. The
 * grant is keyed by bundle id: renaming the bundle id loses it again.
 */

export const BLOCKED_PREFIX = "macOS is blocking BitGraph Recorder from ";

export const BLOCKED_HOW =
  "Allow it under System Settings › Privacy & Security › Files and Folders (or Full Disk Access), then try again.";

/** True for the error macOS raises when the privacy layer refuses a path. */
export function isBlocked(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "EPERM" || code === "EACCES";
}

/** The path an fs error names, if it names one. */
export function blockedPath(err: unknown): string {
  const p = (err as { path?: unknown } | null)?.path;
  return typeof p === "string" ? p : "";
}

/** The sentence the person sees. */
export function blockedMessage(path: string): string {
  return `${BLOCKED_PREFIX}${path === "" ? "a folder it needs" : path}. ${BLOCKED_HOW}`;
}

/**
 * The error, explained. Anything that is not a block passes through
 * untouched; a block becomes a plain sentence that also carries the flag and
 * the path for the surface to act on.
 */
export function explain(err: unknown): { message: string; blocked: boolean; path: string } {
  if (isBlocked(err)) {
    const path = blockedPath(err);
    return { message: blockedMessage(path), blocked: true, path };
  }
  return { message: err instanceof Error ? err.message : String(err), blocked: false, path: "" };
}
