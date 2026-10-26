// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The BitGraphed file of a photo, with a TrustMark: one file that is exact evidence while it is intact (the proof
 * inside it binds its bytes) and still points to the original's proof once a feed, a screenshot or a recompression has
 * stripped that block away (the TrustMark in its pixels).
 *
 *   1. The photo's fingerprint record is computed again from the photo in hand and found in the original's own tree.
 *      A photo whose BitGraph does not bind one cannot carry a TrustMark: a pointer to it could be passed off on
 *      another picture.
 *   2. The pointer (the original's position and a tag from its nonce and bound pHash) is written into the pixels, in
 *      this browser, nested (marks.ts), and saved as JPEG. Nothing is recorded unless the mark reads back from that
 *      very JPEG.
 *   3. The marked copy is recorded as its own BitGraph, after the original, the way every drop is (a tree whose first
 *      leaf is the latest Base block), and its members are indexed.
 *   4. The fingerprint record is published, so a copy can be checked by anyone (app/api/trustmark/records).
 *   5. The marked copy's BitGraphed file (carrier/5) is assembled, with its Base ceiling once it has landed.
 */

import { buildBitGraphedFileV5 } from "@mikeargento/bitgraph-verify";
import { baseBlockFileText, memberBlocks, withMember } from "@/lib/tree-member";
import { bindOne, digestOf, hashLeaves, latestBaseBlock, postTreeMembers, treeFromLeaves, type Proof } from "@/lib/plugins";
import { publishRecord, recordProofIn } from "./ledger.ts";
import { markNested, readings } from "./marks.ts";
import { epochRef, MAX_COUNTER, pack, tag } from "./payload.ts";
import { decodePhoto, isPhotographic, parseRecord, recordBytes } from "./record.ts";
import { markRuntime, readRuntime } from "./runtime.ts";
import { aspectOk } from "./tm.ts";

const CEILING_WAIT_MS = 15_000;
const toUrlSafe = (s: string) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Why a photo cannot carry a TrustMark; the caller makes the plain BitGraphed file instead. */
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

/**
 * Make the TrustMarked BitGraphed file of `photo`, whose BitGraph is `photoProof` (the photo's own member proof).
 * Throws NoTrustmark when the photo cannot carry one (no bound fingerprint, not decodable here, too wide, a position
 * past the pointer's range); any other error means something failed on the way.
 */
export async function trustmarkedFile(photo: File, photoDigestB64: string, photoProof: Proof, onStep?: (s: string) => void): Promise<TrustmarkedFile> {
  const img = await decodePhoto(photo);
  if (!img) throw new NoTrustmark("this browser cannot open the photo to mark it");
  if (!aspectOk(img.w, img.h)) throw new NoTrustmark("photos wider or taller than 2:1 cannot carry a TrustMark");
  if (!isPhotographic(img)) throw new NoTrustmark("this looks like a graphic, not a photograph, and a TrustMark would show on it");
  // a photo that already carries a mark is never marked again: two marks would make both unreadable
  for await (const _ of readings(img.rgba, img.w, img.h, await readRuntime(), { zooms: false })) { void _; throw new NoTrustmark("this photo already carries a TrustMark"); }
  const rec = recordBytes(photoDigestB64, img);
  onStep?.("Finding the photo's fingerprint in its BitGraph…");
  if (!(await recordProofIn(photoProof, rec))) throw new NoTrustmark("this photo's BitGraph does not bind its fingerprint (it was made before TrustMarks, or in another browser)");
  const parsed = parseRecord(rec)!;
  const epochId = String(photoProof.commit?.epochId ?? ""), counter = Number(photoProof.commit?.counter);
  if (!epochId || !Number.isSafeInteger(counter) || counter > MAX_COUNTER) throw new NoTrustmark("this BitGraph's position does not fit a TrustMark's pointer");
  const nonce = String((photoProof.commit as { nonceB64?: string } | undefined)?.nonceB64 ?? "");
  const eref = await epochRef(epochId);
  const payload = pack(eref, counter, await tag(nonce, parsed.phash, eref, counter));

  onStep?.("Adding the TrustMark here, in this browser…");
  const marked = await markNested(img.rgba, img.w, img.h, payload, await markRuntime());
  const bytes = await jpeg(marked, img.w, img.h);
  const back = await decodePhoto(new Blob([bytes as BlobPart], { type: "image/jpeg" }));
  let readsBack = false;
  if (back) for await (const r of readings(back.rgba, back.w, back.h, await readRuntime())) if (r.payload === payload) { readsBack = true; break; }
  if (!readsBack) throw new Error("the TrustMark did not read back from the marked photo; nothing was recorded");

  onStep?.("Recording the TrustMarked copy…");
  const dot = photo.name.lastIndexOf(".");
  const copyName = `${dot > 0 ? photo.name.slice(0, dot) : photo.name}.trustmark.jpg`;
  const copy = new File([bytes as BlobPart], copyName, { type: "image/jpeg" });
  const floorFile = baseBlockFileText(await latestBaseBlock());
  const [floorLeaf] = await hashLeaves([new File([floorFile], "base-block.json", { type: "application/json" })]);
  const [copyLeaf] = await hashLeaves([copy]);
  const t = await treeFromLeaves([floorLeaf!, copyLeaf!]);
  const rootDigest = await digestOf(new TextEncoder().encode(t.rootText));
  const b = await bindOne(rootDigest, { ceiling: true, floorLeaf: true });
  const blocks = memberBlocks(t.tree, t.rootText, floorFile);
  await postTreeMembers({ rootDigestB64: rootDigest, epochId: String(b.commit!.epochId), counter: String(b.commit!.counter), rootText: t.rootText, ...(blocks[0]?.floor ? { floor: blocks[0].floor } : {}) },
    t.tree.leaves.map((l, i) => ({ digestB64: l[2], index: i, path: blocks[i]!.path }))).catch(() => 0);
  const copyProof = withMember(b as Record<string, unknown>, blocks[1]!) as Proof;

  onStep?.("Publishing the fingerprint and assembling the file…");
  const [published, sidecar] = await Promise.all([publishRecord(rec), ceilingOf(b)]);
  const file = buildBitGraphedFileV5(bytes, copyProof as unknown as Record<string, unknown>, sidecar);
  return { bytes: file, fileName: `${dot > 0 ? photo.name.slice(0, dot) : photo.name}.trustmark.bitgraph.jpg`, copyProof, ceiling: !!sidecar, published };
}
