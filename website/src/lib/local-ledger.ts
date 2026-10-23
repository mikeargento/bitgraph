"use client";

/* What you hold — the ledger that replaces the hosted one.
 *
 * The hosted ledger answered one question: "do these bytes already have a
 * proof?" It answered it for everyone, about everything, which is why it cost
 * what it cost. This answers the same question about YOUR files, from the
 * BitGraphs files you have on your own disk, and it costs nothing.
 *
 * ⚠️ THE GATE IS ON MINTING, NOT ON DRAGGING. Mike's July ruling — a lone new
 * file auto-records, the drop is the shutter — depended on the ledger being
 * able to say the file was NEW. Without one, "new" is unknowable, and
 * auto-record silently becomes "record something that may already be
 * recorded", permanently. The rule did not change; its precondition
 * disappeared. So dragging is always safe and never mints, and it is minting
 * that has to know what it is doing.
 *
 * The honest line, which mattered four separate times on 2026-09-07:
 * "I have no record of this" is not "there is no record of this."
 *
 * ⚠️ NO PICKER, NO CONNECT BUTTON, NO GATE IN FRONT OF THE DROP. A picker
 * means showDirectoryPicker's "Let this site view files?", rejected
 * 2026-08-07 and absent in Brave, Safari and iOS. Connecting IS dragging the
 * folder in.
 */

import { readBitGraphsFile } from "./bitgraphs-file.ts";
import type { BitGraphProof } from "./bitgraph";

/* How to read a fused proof's ORIGIN digest, supplied by the caller rather
 * than imported. Reaching into the fuse pipeline from here would make this
 * module depend on the whole placement stack to answer a question about a
 * Map — and would put the pipeline in front of every test of it. The camera
 * passes fusedMarkerOf; anything that only holds plain proofs passes nothing. */
export type OriginReader = (p: BitGraphProof) => string | null;

/** A dropped file that is a BitGraphs file rather than something to record.
 *  Recognised by NAME here only as a first filter; the content decides. */
export const isBitGraphsFileName = (name: string) =>
  name === "bitgraphs.json" || name.endsWith("-bitgraphs.json");

export interface LocalLedger {
  /** Every distinct position held, newest first is not meaningful here —
   *  insertion order is fine, since nothing renders this list. */
  proofs: BitGraphProof[];
  /** Digest (standard base64) -> the positions those bytes hold. Carries BOTH
   *  the origin digest and the committed one, so a file matches whether the
   *  holder kept the original or the fused bytes. */
  byDigest: Map<string, BitGraphProof[]>;
  /** Where these came from, for the state line. */
  sources: string[];
}

export const emptyLedger = (): LocalLedger => ({ proofs: [], byDigest: new Map(), sources: [] });

const positionOf = (p: BitGraphProof) =>
  `${p.commit?.epochId ?? ""} ${p.commit?.counter ?? ""}`;

/**
 * Every digest by which a proof can be recognised.
 *
 * A plain recorded proof commits the bytes themselves. A FUSED proof commits
 * the new file, which the holder usually does not keep — the original is what
 * is on their disk — so the origin digest from the signed attribution is the
 * one that matters, and both are indexed.
 *
 * ⚠️ A SET'S MEMBERS ARE NOT INDEXED, AND CANNOT BE. A set proof commits the
 * manifest, and the manifest is deliberately NOT stored (42 MB of Merkle paths
 * for 48,000 files against 23 KB without it — it is rebuilt by hashing the
 * folder, since the order is canonical). So a lone member of a set dropped by
 * itself will read as unmatched. That is a known cost of the size decision,
 * not an oversight, and it is safe in the direction that matters: it can miss
 * a match, never invent one.
 */
function digestsFor(p: BitGraphProof, originOf?: OriginReader): string[] {
  const out: string[] = [];
  const committed = p.artifact?.digestB64;
  if (committed) out.push(committed);
  try {
    const origin = originOf?.(p);
    if (origin && origin !== committed) out.push(origin);
  } catch { /* an unreadable marker just means one fewer way in */ }
  return out;
}

/** Fold proofs into a ledger, deduped by position. */
export function addProofs(
  ledger: LocalLedger,
  proofs: BitGraphProof[],
  source?: string | null,
  originOf?: OriginReader,
): LocalLedger {
  const held = new Set(ledger.proofs.map(positionOf));
  const next: LocalLedger = {
    proofs: [...ledger.proofs],
    byDigest: new Map(ledger.byDigest),
    sources: [...ledger.sources],
  };
  for (const p of proofs) {
    const key = positionOf(p);
    if (held.has(key)) continue;
    held.add(key);
    next.proofs.push(p);
    for (const d of digestsFor(p, originOf)) {
      const at = next.byDigest.get(d);
      if (at) at.push(p); else next.byDigest.set(d, [p]);
    }
  }
  if (source && !next.sources.includes(source)) next.sources.push(source);
  return next;
}

/** Read every BitGraphs file out of a set of dropped files. Files that are not
 *  BitGraphs files are returned untouched, because a drop can hold both. */
export async function readBitGraphsFiles(files: File[]): Promise<{
  proofs: BitGraphProof[];
  sources: string[];
  rest: File[];
}> {
  const proofs: BitGraphProof[] = [];
  const sources: string[] = [];
  const rest: File[] = [];
  for (const f of files) {
    // Name first (cheap), content second (decisive): a file called
    // notes-bitgraphs.json that is not one falls through to `rest` and is
    // treated as an ordinary file, which is the safe direction.
    if (!isBitGraphsFileName(f.name)) { rest.push(f); continue; }
    const doc = readBitGraphsFile(await f.text());
    if (!doc) { rest.push(f); continue; }
    proofs.push(...doc.proofs);
    sources.push(doc.source ?? f.name);
  }
  return { proofs, sources, rest };
}

/** The positions these bytes already hold, or an empty array. */
export const heldFor = (ledger: LocalLedger, digestB64: string): BitGraphProof[] =>
  ledger.byDigest.get(digestB64) ?? [];

/* ── Persistence ──
 *
 * Connecting is dragging, so it can be forgotten. On Chromium a drag also
 * yields a storable directory handle ("sync again without a drag"), but that
 * is absent in Brave, Safari and Firefox — so on those the ledger is dragged
 * in again each session unless it is remembered here. This is the same net
 * that holds the packages: it makes the common case not require a drag,
 * without ever requiring a permission prompt.
 *
 * ⚠️ It is a CACHE OF WHAT YOU SHOWED US, never the authority. The folder on
 * disk is the authority. Anything here can be evicted by the browser at any
 * time, which is exactly why the "nothing loaded" state has to be a normal,
 * non-alarming state rather than an error.
 */

const DB = "bitgraph-files";
const STORE = "files";
const KEY = "local-ledger/1";

async function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function saveLedger(ledger: LocalLedger): Promise<void> {
  try {
    const db = await open();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ proofs: ledger.proofs, sources: ledger.sources, at: Date.now() }, KEY);
    await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = j; });
    db.close();
  } catch (e) {
    console.warn("[bitgraph] could not remember the connected ledger:", e);
  }
}

export async function loadLedger(originOf?: OriginReader): Promise<LocalLedger> {
  try {
    const db = await open();
    const tx = db.transaction(STORE, "readonly");
    const got = await new Promise<{ proofs?: BitGraphProof[]; sources?: string[] } | undefined>((res, rej) => {
      const r = tx.objectStore(STORE).get(KEY);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    db.close();
    if (!got?.proofs?.length) return emptyLedger();
    const l = addProofs(emptyLedger(), got.proofs, null, originOf);
    l.sources.push(...(got.sources ?? []));
    return l;
  } catch (e) {
    console.warn("[bitgraph] could not read the remembered ledger:", e);
    return emptyLedger();
  }
}
