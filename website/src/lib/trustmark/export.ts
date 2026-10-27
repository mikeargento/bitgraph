// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The BitGraphed file of a photo, with a hidden pointer: one file that is exact evidence while it is intact (the proof
 * inside it binds its bytes) and still points to the original's proof once a feed, a screenshot or a recompression has
 * stripped that block away (the pointer in its pixels).
 *
 *   1. The photo's fingerprint record is computed again from the photo in hand and found in the original's own tree.
 *      A photo whose BitGraph does not bind one cannot carry a pointer: a pointer to it could be passed off on
 *      another picture.
 *   2. The pointer (the original's position and a tag from its nonce and bound pHash) is written into the pixels, in
 *      this browser, with Pixel Seal (marks.ts), and saved as JPEG. Nothing is recorded unless the mark reads back from that
 *      very JPEG.
 *   3. The marked copy is recorded as its own BitGraph, after the original, the way every drop is (a tree whose first
 *      leaf is the latest Base block), and its members are indexed; a copy already on record keeps its BitGraph.
 *   4. The fingerprint record is published, so a copy can be checked by anyone (app/api/trustmark/records).
 *   5. The marked copy's BitGraphed file (carrier/5) is assembled, with its Base ceiling once it has landed.
 */

import { buildBitGraphedFileV5 } from "@mikeargento/bitgraph-verify";
import { baseBlockFileText, checkMember, memberBlocks, memberOf, withMember } from "@/lib/tree-member";
import { bindOne, digestOf, hashLeaves, latestBaseBlock, postTreeMembers, treeFromLeaves, type Proof } from "@/lib/plugins";
import { publishRecord, recordProofIn } from "./ledger.ts";
import { carriesPointer } from "./check.ts";
import { recordedMsOf } from "@/lib/recorded-time";
import { readDetachedC2PA } from "@/lib/c2pa-reader";
import { manifestStoreOf } from "./c2pa-leaf.ts";
import { markPhoto, readings } from "./marks.ts";
import { epochRef, MAX_COUNTER, pack, tag } from "./payload.ts";
import { decodePhoto, isPhotographic, parseRecord, recordBytes } from "./record.ts";
import { aspectOk } from "./tm.ts";

const CEILING_WAIT_MS = 15_000;
const toUrlSafe = (s: string) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Why a photo cannot carry a pointer; the caller makes the plain BitGraphed file instead. */
export class NoTrustmark extends Error {}

export type TrustmarkedFile = { bytes: Uint8Array; fileName: string; copyProof: Proof; ceiling: boolean; published: boolean };

async function jpeg(rgba: Uint8ClampedArray, w: number, h: number): Promise<Uint8Array> {
  const c = new OffscreenCanvas(w, h), g = c.getContext("2d");
  if (!g) throw new Error("this browser cannot draw the marked photo");
  g.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  return new Uint8Array(await (await c.convertToBlob({ type: "image/jpeg", quality: 0.95 })).arrayBuffer());
}

async function ceilingOf(proof: Proof): Promise<Record<string, unknown> | null> {
  const ph = toUrlSafe(String(proof.proofHash ?? ""));
  const until = Date.now() + CEILING_WAIT_MS;
  for (;;) {
    const res = await fetch(`/api/ceilings/${ph}`, { cache: "no-store" }).catch(() => null);
    if (res?.ok) return (await res.json()) as Record<string, unknown>;
    if (Date.now() > until) return null;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** Of this photo's BitGraphs on the ledger (and the one in hand), the earliest that binds this fingerprint record, by the
 *  enclave's signed clock, then position. */
async function earliestBinding(photoDigestB64: string, inHand: Proof, rec: Uint8Array): Promise<Proof | null> {
  const res = await fetch(`/api/proofs/${toUrlSafe(photoDigestB64)}`).catch(() => null);
  const body = res?.ok ? ((await res.json().catch(() => null)) as { proofs?: Array<{ proof: Proof; kind?: string }> } | null) : null;
  const all = [inHand, ...(body?.proofs ?? []).filter((x) => x.kind === "recorded" && memberOf(x.proof) && checkMember(x.proof, photoDigestB64)).map((x) => x.proof)];
  const when = (p: Proof) => recordedMsOf(p) ?? Number.POSITIVE_INFINITY;
  all.sort((a, b) => when(a) - when(b) || Number(a.commit?.counter ?? 0) - Number(b.commit?.counter ?? 0));
  for (const p of all) if (await recordProofIn(p, rec)) return p;
  return null;
}

/** The marked copy's BitGraph when these exact bytes are already on record as a file of a tree, as the ledger serves it. */
async function recordedCopy(bytes: Uint8Array): Promise<Proof | null> {
  const d = await digestOf(bytes);
  const res = await fetch(`/api/proofs/${toUrlSafe(d)}`).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as { proofs?: Array<{ proof: Proof; kind?: string }> } | null;
  return body?.proofs?.find((x) => x.kind === "recorded" && memberOf(x.proof) && checkMember(x.proof, d))?.proof ?? null;
}

/** Record the marked copy the way every drop is recorded (a tree whose first leaf is the latest Base block), index its
 *  members, and return its member proof. */
async function recordCopy(copy: File): Promise<Proof> {
  const floorFile = baseBlockFileText(await latestBaseBlock());
  const [floorLeaf] = await hashLeaves([new File([floorFile], "base-block.json", { type: "application/json" })]);
  const [copyLeaf] = await hashLeaves([copy]);
  const t = await treeFromLeaves([floorLeaf!, copyLeaf!]);
  const rootDigest = await digestOf(new TextEncoder().encode(t.rootText));
  const b = await bindOne(rootDigest, { ceiling: true, floorLeaf: true });
  const blocks = memberBlocks(t.tree, t.rootText, floorFile);
  await postTreeMembers({ rootDigestB64: rootDigest, epochId: String(b.commit!.epochId), counter: String(b.commit!.counter), rootText: t.rootText, ...(blocks[0]?.floor ? { floor: blocks[0].floor } : {}) },
    t.tree.leaves.map((l, i) => ({ digestB64: l[2], index: i, path: blocks[i]!.path }))).catch(() => 0);
  return withMember(b as Record<string, unknown>, blocks[1]!) as Proof;
}

/**
 * Make the BitGraphed file, with its pointer, of `photo`, whose BitGraph is `photoProof` (the photo's own member proof).
 * Throws NoTrustmark when the photo cannot carry one (no bound fingerprint, not decodable here, too wide, a position
 * past the pointer's range); any other error means something failed on the way.
 */
export async function trustmarkedFile(photo: File, photoDigestB64: string, photoProof: Proof, onStep?: (s: string) => void, { copyChecked = false } = {}): Promise<TrustmarkedFile> {
  // Each step's time, logged as one table when the file is done (or as far as it got), to show where the wait goes.
  const times: Record<string, number> = {};
  let mark = performance.now();
  const step = (name: string) => { const now = performance.now(); times[name] = Math.round(now - mark); mark = now; };
  const report = () => { times.total = Object.values(times).reduce((a, b) => a + b, 0); console.info(`[bitgraph] BitGraphed file of ${photo.name}, ms per step:`); console.table(times); };
  try { return await assemble(); } finally { report(); }
  async function assemble(): Promise<TrustmarkedFile> {
  const img = await decodePhoto(photo);
  step("decode photo");
  if (!img) throw new NoTrustmark("this browser cannot open the photo to mark it");
  if (!aspectOk(img.w, img.h)) throw new NoTrustmark("photos wider or taller than 2:1 cannot carry the pointer");
  if (!isPhotographic(img)) throw new NoTrustmark("this looks like a graphic, not a photograph, and the pointer would show on it");
  onStep?.("Assembling the BitGraphed file…");
  // A copy keeps the pointer it carries, to the earliest known recording: it is never given a new one (and two marks
  // would make both unreadable). Found anywhere in the picture, and counted only when it checks out on the ledger.
  // (copyChecked: Make has just read this photo for a pointer, before making its BitGraph.)
  if (!copyChecked && (await carriesPointer(img))) throw new NoTrustmark("this photo is a copy and already points to the earliest known recording");
  if (!copyChecked) step("read for an earlier pointer");
  const rec = recordBytes(photoDigestB64, img);
  // The pointer leads to the earliest BitGraph of this photo that binds its fingerprint, whichever of its BitGraphs
  // the page shows.
  photoProof = await earliestBinding(photoDigestB64, photoProof, rec) ?? photoProof;
  if (!(await recordProofIn(photoProof, rec))) throw new NoTrustmark("this photo's BitGraph does not bind its fingerprint (it was made before pointers, or in another browser)");
  const parsed = parseRecord(rec)!;
  const epochId = String(photoProof.commit?.epochId ?? ""), counter = Number(photoProof.commit?.counter);
  if (!epochId || !Number.isSafeInteger(counter) || counter > MAX_COUNTER) throw new NoTrustmark("this BitGraph's position does not fit the pointer");
  const nonce = String((photoProof.commit as { nonceB64?: string } | undefined)?.nonceB64 ?? "");
  const eref = await epochRef(epochId);
  const payload = pack(eref, counter, await tag(nonce, parsed.phash, eref, counter));
  step("fingerprint and earliest BitGraph");

  onStep?.("Adding the hidden pointer, in this browser…");
  const marked = await markPhoto(img.rgba, img.w, img.h, payload);
  step("write the pointer (models included)");
  const bytes = await jpeg(marked, img.w, img.h);
  step("encode JPEG");
  const back = await decodePhoto(new Blob([bytes as BlobPart], { type: "image/jpeg" }));
  let readsBack = false;
  if (back) for await (const r of readings(back.rgba, back.w, back.h, { legacy: false })) if (r.payload === payload) { readsBack = true; break; }
  step("read the pointer back");
  if (!readsBack) throw new Error("the pointer did not read back from the marked photo; nothing was recorded");

  onStep?.("Recording the file…");
  const dot = photo.name.lastIndexOf(".");
  // the marked copy is a JPEG named for the photo, and its BitGraphed file is <photo>.bitgraph.jpg, as always
  const stem = dot > 0 ? photo.name.slice(0, dot) : photo.name, copyName = `${stem}.jpg`;
  // The same photo, marked again in this browser, is the same file: a copy already recorded is never recorded twice.
  const copyProof = (await recordedCopy(bytes)) ?? (await recordCopy(new File([bytes as BlobPart], copyName, { type: "image/jpeg" })));
  step("record the file");

  onStep?.("Waiting for its Base ceiling…");
  // The photo's Content Credentials go with it when its BitGraph binds them and they record no location.
  const store = manifestStoreOf(new Uint8Array(await photo.arrayBuffer()));
  const manifest = store && (await recordProofIn(photoProof, store)) && !(await readDetachedC2PA(store))?.hasLocation ? store : null;
  const [published, sidecar] = await Promise.all([publishRecord(rec, manifest), ceilingOf(copyProof)]);
  step("Base ceiling and pointer registration");
  const file = buildBitGraphedFileV5(bytes, copyProof as unknown as Record<string, unknown>, sidecar);
  step("build the file");
  return { bytes: file, fileName: `${stem}.bitgraph.jpg`, copyProof, ceiling: !!sidecar, published };
  }
}
