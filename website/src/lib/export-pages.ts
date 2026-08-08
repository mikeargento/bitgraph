// Copyright (c) 2024-2026 Mike Argento. All rights reserved.

/**
 * The shape of an export, and the one piece of evidence that has to be decoded
 * rather than read: the block timestamp inside an anchor's witness header.
 *
 * ❄️ THIS FILE NO LONGER RENDERS HTML, and the name is now a little wide.
 * It used to hold `proofPage` and `indexPage`, which wrote a rendering of the
 * proof page into every export zip, mirroring `writeProofPage` in
 * `packages/folder/src/export.js`. Both are gone (Folder 1.12.0), and about
 * 460 lines went with them.
 *
 * Why, so nobody rebuilds it: it was a SECOND implementation of a page this
 * codebase already has, and a duplicate drifts. Its own comment said the type
 * was lifted from the proof page "so the two read as one design"; the site
 * later moved to one title size everywhere and the copy sat at the old values
 * until the mismatch was spotted by eye. What it bought did not cover that
 * cost: the match verdict it displayed was computed by whoever BUILT the
 * export, so a recipient opening it was reading the sender's assertion rather
 * than performing a check. The check that means something is dropping the
 * folder on bitgraph.ing, which re-hashes in the reader's own browser and
 * goes to the ledger.
 *
 * An export now carries evidence and nothing else: proof.json, the artifact,
 * and ethereum-anchors/. A zip from the site and a folder from the Folder are
 * meant to be the same object, and with no pages in either they finally are.
 *
 * `bitgraph-audit` was never affected: it discovers proofs by schema shape
 * rather than by filename.
 */

export interface ExportProof {
  artifact?: { digestB64?: string };
  commit?: { counter?: string; epochId?: string; prevB64?: string; slotHashB64?: string };
  signer?: { signatureB64?: string; publicKeyB64?: string };
  environment?: { measurement?: string; enforcement?: string; attestation?: { format?: string } };
  slotAllocation?: { counter?: string; nonceB64?: string; signatureB64?: string; epochId?: string };
  attribution?: { name?: string; message?: string };
  proofHash?: string;
}

export interface AnchorSide {
  /** Block number, from the anchor's own `ethereum` block. */
  block?: number | null;
  /** Unix seconds. Decoded from the witness header when one is present. */
  ts?: number | null;
}




/* ── RLP: the block timestamp is field 12 of an Ethereum block header ──
   Block times are not stored as fields anywhere in an export; they live inside
   headerRlpHex in the witness files. Deriving it from the witness rather than
   trusting a number alongside it is also the stronger construction, since the
   witness IS the header the proof's anchor commits to. */

function rlpItemAt(b: Uint8Array, i: number): { start: number; len: number; next: number; list: boolean } | null {
  const p = b[i];
  if (p === undefined) return null;
  if (p < 0x80) return { start: i, len: 1, next: i + 1, list: false };
  if (p <= 0xb7) return { start: i + 1, len: p - 0x80, next: i + 1 + (p - 0x80), list: false };
  if (p <= 0xbf) {
    const k = p - 0xb7;
    let n = 0;
    for (let j = 0; j < k; j++) n = n * 256 + b[i + 1 + j];
    return { start: i + 1 + k, len: n, next: i + 1 + k + n, list: false };
  }
  if (p <= 0xf7) return { start: i + 1, len: p - 0xc0, next: i + 1 + (p - 0xc0), list: true };
  const k = p - 0xf7;
  let n = 0;
  for (let j = 0; j < k; j++) n = n * 256 + b[i + 1 + j];
  return { start: i + 1 + k, len: n, next: i + 1 + k + n, list: true };
}

/** Unix seconds from an RLP block header, or 0. Header field order is fixed
 *  and its first twelve entries have never changed across forks. */
export function blockTimeFromHeader(headerRlpHex: string): number {
  const hex = String(headerRlpHex).replace(/^0x/, "");
  if (hex.length % 2 !== 0) return 0;
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < b.length; i++) {
    const v = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(v)) return 0;
    b[i] = v;
  }
  const outer = rlpItemAt(b, 0);
  if (!outer?.list) return 0;
  let i = outer.start;
  for (let n = 0; n < 11; n++) {
    const it = rlpItemAt(b, i);
    if (!it) return 0;
    i = it.next;
  }
  const ts = rlpItemAt(b, i);
  if (!ts || ts.len > 8) return 0;
  let v = 0;
  for (let q = 0; q < ts.len; q++) v = v * 256 + b[ts.start + q];
  return v;
}
