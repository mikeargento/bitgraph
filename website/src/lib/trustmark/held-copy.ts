// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

import type { Original } from "./check.ts";

/**
 * A copy of a photo (its BitGraphed file, a screenshot, a feed's copy) whose hidden pointer led to the photo's page,
 * handed to that page so it can show the copy in its file pane, labelled for what it is. Held in a module slot, which
 * survives the client-side navigation (as lib/fresh-proof does); read once.
 */

/** tag: the pointer's tag the copy carries, which opens the original's published thumbnail and credentials on its page.
 *  found: the original a copy was matched to by its looks (check.ts), which opens the same; others: the other bound
 *  originals it matched as well, for the page to list. */
export type HeldCopy = { name: string; data: ArrayBuffer; kind: "bitgraphed" | "copy"; score: number; tag?: number; found?: Original; others?: Original[] };

let slot: { digest: string; copy: HeldCopy } | null = null;

/** Handed to the page through the module slot, and remembered in the browser (the files store, under `${digest}:copy`,
 *  a key no digest can collide with) so a reload or a return to the page still shows the copy and its reference. */
export function setHeldCopy(digestUrlSafe: string, copy: HeldCopy) {
  slot = { digest: digestUrlSafe, copy };
  void rememberHeldCopy(digestUrlSafe, copy).catch(() => {});
}

export function takeHeldCopy(digestUrlSafe: string): HeldCopy | null {
  if (slot && slot.digest === digestUrlSafe) { const c = slot.copy; slot = null; return c; }
  return null;
}

const copyKey = (digestUrlSafe: string) => `${digestUrlSafe}:copy`;
function openFilesDB(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("bitgraph-files", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function rememberHeldCopy(digestUrlSafe: string, copy: HeldCopy): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openFilesDB();
  try {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put(copy, copyKey(digestUrlSafe));
    await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = j; });
  } finally { db.close(); }
}
/** The copy this browser last brought to this page, if any (a reload, a return). */
export async function recallHeldCopy(digestUrlSafe: string): Promise<HeldCopy | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openFilesDB();
    try {
      const tx = db.transaction("files", "readonly");
      const c = await new Promise<HeldCopy | undefined>((resolve) => { const req = tx.objectStore("files").get(copyKey(digestUrlSafe)); req.onsuccess = () => resolve(req.result); req.onerror = () => resolve(undefined); });
      return c && c.data instanceof ArrayBuffer ? c : null;
    } finally { db.close(); }
  } catch { return null; }
}
/** Once the original itself is in hand, the copy is no longer what the page shows. */
export async function forgetHeldCopy(digestUrlSafe: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openFilesDB();
    try {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").delete(copyKey(digestUrlSafe));
      await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = j; });
    } finally { db.close(); }
  } catch { /* nothing to forget */ }
}

const CARRIER_MAGIC = [0x42, 0x47, 0x50, 0x52, 0x4f, 0x4f, 0x46, 0x01];
/** Whether a file is a BitGraphed file: a file with its proof block at the end (lib/carrier). */
export async function isBitGraphedFile(f: Blob): Promise<boolean> {
  if (f.size < 32) return false;
  const tail = new Uint8Array(await f.slice(f.size - 8).arrayBuffer());
  return CARRIER_MAGIC.every((b, i) => tail[i] === b);
}
