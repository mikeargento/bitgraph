// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The ledger, as TrustMark uses it from the browser: a fingerprint record's place in its BitGraph, publishing a record
 * when its photo is exported with a TrustMark, and the records a pointer could mean.
 */

import { verifyAttested, createVerificationContext } from "@mikeargento/bitgraph-verify";
import { checkMember, memberOf, rootTextBytes } from "@/lib/tree-member";
import type { Proof } from "@/lib/plugins";

const toUrlSafe = (s: string) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]!); return btoa(s); };
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const digestB64 = async (u: Uint8Array) => b64(new Uint8Array(await crypto.subtle.digest("SHA-256", u as BufferSource)));

/**
 * The full check of a file that is a member of a tree, as the drop box makes it: its hash must walk up to the root the
 * proof binds, and the proof (signature, counts, and the AWS Nitro attestation pinned to BitGraph's published images)
 * is then checked against the root's text, the bytes it signs.
 */
export async function verifyMember(proof: Proof, bytes: Uint8Array): Promise<boolean> {
  const member = memberOf(proof);
  if (!member || !checkMember(proof, await digestB64(bytes), member)) return false;
  const { proofHash: _h, ...p } = proof as Proof & { proofHash?: unknown };
  void _h;
  const plain = { ...p, metadata: Object.fromEntries(Object.entries((p as { metadata?: Record<string, unknown> }).metadata ?? {}).filter(([k]) => k !== "bitgraph-tree-member/1")) };
  try {
    const r = await verifyAttested({ proof: plain as never, bytes: rootTextBytes(member), context: createVerificationContext() });
    return r.valid === true;
  } catch { return false; }
}

/** The proof that places this record in the same BitGraph as `photoProof`, when there is one. */
export async function recordProofIn(photoProof: Proof, recordBytes: Uint8Array): Promise<Proof | null> {
  const d = await digestB64(recordBytes);
  const res = await fetch(`/api/proofs/${toUrlSafe(d)}`).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as { proofs?: Array<{ proof: Proof; kind?: string }> } | null;
  const want = photoProof.artifact?.digestB64, at = photoProof.commit;
  return body?.proofs?.find((x) => x.kind === "recorded" && x.proof.artifact?.digestB64 === want
    && String(x.proof.commit?.epochId) === String(at?.epochId) && String(x.proof.commit?.counter) === String(at?.counter)
    && checkMember(x.proof, d))?.proof ?? null;
}

/** Publish a record, with the photo's Content Credentials and the BitGraphed file's thumbnail when they go too; its tree's index can lag the bind by a
 *  moment, so a not-found is waited out a few times. */
export async function publishRecord(recordBytes: Uint8Array, manifest?: Uint8Array | null, thumb?: Uint8Array | null): Promise<boolean> {
  const body = JSON.stringify({ recordB64: b64(recordBytes), ...(manifest ? { c2paB64: b64(manifest) } : {}), ...(thumb ? { thumbB64: b64(thumb) } : {}) });
  for (let attempt = 0; attempt < 12; attempt++) {
    const res = await fetch("/api/trustmark/records", { method: "POST", headers: { "content-type": "application/json" }, body }).catch(() => null);
    if (res?.ok) return true;
    if (res && res.status !== 404 && res.status !== 429 && res.status < 500) return false;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

/** thumbB64 and thumbProof: the BitGraphed file's thumbnail and the proof that binds it in that file's own BitGraph. */
export type Published = { recordB64: string; proof: Proof; c2paB64?: string; c2paProof?: Proof; thumbB64?: string; thumbProof?: Proof };

/** Every published record the pointer (eref, counter, tag) could mean. The tag is required: a record, with its thumbnail
 *  and credentials, opens only to someone holding the picture (its pointer, or the original's fingerprint), never to a
 *  position read off the ledger. Unchecked: the caller verifies each. */
export async function candidates(eref: number, counter: number, tag: number, one?: { epochId: string; recordDigestB64: string }): Promise<Published[]> {
  const safe = (b: string) => b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const at = one ? `&epoch=${safe(one.epochId)}&record=${safe(one.recordDigestB64)}` : "";
  const res = await fetch(`/api/trustmark/records?eref=${eref}&counter=${counter}&tag=${tag}${at}`);
  if (!res.ok) throw new Error(`records ${res.status}`);
  const body = (await res.json().catch(() => null)) as { entries?: Published[] } | null;
  return (body?.entries ?? []).filter((e) => typeof e?.recordB64 === "string" && e.proof && typeof e.proof === "object");
}

/** Found photos' fingerprint records, published when their trees bind them: photos bound before Make published records
 *  (2026-10-29) become findable by their looks the first time their originals are checked, on Check or on a proof page.
 *  Each record is computed from the file in hand, looked up by its own hash, and the server checks it against the tree
 *  before keeping it; a record already kept still gets its place in the find index. A photo whose record was published
 *  without a reference thumbnail (thumb.ts) gets one now: the thumbnails of a whole drop are bound as one BitGraph, since
 *  only a bound thumbnail can be checked, then published with their records. */
export async function publishFoundRecords(items: Array<{ f: Blob; photoDigestB64: string; name?: string }>): Promise<void> {
  if (items.length === 0) return;
  const { decodeForRecord, fingerprintOf, recordBytesOf } = await import("./record");
  const { epochRef, tag } = await import("./payload");
  const { makeThumb, THUMB_SUFFIX } = await import("./thumb");
  type Prepared = { bytes: Uint8Array; thumb: Uint8Array | null };
  const prepared: Array<Prepared | null> = new Array(items.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < items.length) {
      const i = next++, it = items[i]!;
      try {
        const img = await decodeForRecord(it.f);
        if (!img) continue;
        const fp = fingerprintOf(img), bytes = recordBytesOf(it.photoDigestB64, fp);
        const recordDigest = await digestB64(bytes);
        const d = recordDigest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        const res = await fetch(`/api/proofs/${d}`).catch(() => null);
        const body = res?.ok ? ((await res.json().catch(() => null)) as { proofs?: Array<{ kind?: string; proof: Proof }> } | null) : null;
        const mine = body?.proofs?.find((p) => p.kind === "recorded")?.proof;
        if (!mine) continue;
        const epochId = String(mine.commit?.epochId ?? ""), counter = Number(mine.commit?.counter), nonce = String((mine.commit as { nonceB64?: unknown } | undefined)?.nonceB64 ?? "");
        let thumb: Uint8Array | null = null;
        if (epochId && Number.isSafeInteger(counter) && nonce) {
          const eref = await epochRef(epochId);
          // unknown whether one is published (the read failed): no thumbnail is bound on a guess; the record still goes
          let had: Published[] | null = null;
          try { had = await candidates(eref, counter, await tag(nonce, fp.phash, eref, counter), { epochId, recordDigestB64: recordDigest }); } catch { had = null; }
          if (had && !had.some((c) => typeof c.thumbB64 === "string")) thumb = await makeThumb(it.f).catch(() => null);
        }
        prepared[i] = { bytes, thumb };
      } catch { /* this one is skipped; the rest go on */ }
    }
  }));
  const ready = prepared.filter((p): p is Prepared => p !== null);
  const withThumb = ready.filter((p) => p.thumb);
  if (withThumb.length) {
    const { bindFiles } = await import("@/lib/bind-file");
    try {
      await bindFiles(withThumb.map((p, k) => ({ name: `${items[prepared.indexOf(p)]?.name ?? `photo-${k + 1}`}${THUMB_SUFFIX}`, bytes: p.thumb!, type: "image/jpeg" })));
    } catch { for (const p of withThumb) p.thumb = null; }
  }
  let n = 0;
  await Promise.all(Array.from({ length: 3 }, async () => { while (n < ready.length) { const p = ready[n++]!; await publishRecord(p.bytes, null, p.thumb).catch(() => false); } }));
}

/** One found photo (see publishFoundRecords). */
export const publishFoundRecord = (f: Blob, photoDigestB64: string, name = "photo") => publishFoundRecords([{ f, photoDigestB64, name }]);
