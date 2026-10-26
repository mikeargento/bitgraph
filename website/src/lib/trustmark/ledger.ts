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

/** Publish a record; its tree's index can lag the bind by a moment, so a not-found is waited out a few times. */
export async function publishRecord(recordBytes: Uint8Array): Promise<boolean> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const res = await fetch("/api/trustmark/records", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recordB64: b64(recordBytes) }) }).catch(() => null);
    if (res?.ok) return true;
    if (res && res.status !== 404 && res.status !== 429 && res.status < 500) return false;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

export type Published = { recordB64: string; proof: Proof };

/** Every published record the pointer (eref, counter) could mean. Unchecked: the caller verifies each. */
export async function candidates(eref: number, counter: number): Promise<Published[]> {
  const res = await fetch(`/api/trustmark/records?eref=${eref}&counter=${counter}`).catch(() => null);
  if (!res?.ok) return [];
  const body = (await res.json().catch(() => null)) as { entries?: Published[] } | null;
  return (body?.entries ?? []).filter((e) => typeof e?.recordB64 === "string" && e.proof && typeof e.proof === "object");
}
