// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * @mikeargento/bitgraph-mcp: BitGraphed files (bitgraph-carrier/1).
 *
 * A BitGraphed file is committed bytes followed by one structural block that
 * carries the proof and the anchor evidence. The block is found from the END
 * of the file, by structure, never by scanning. Everything here is local:
 * an 8-byte tail read decides whether a file is a carrier at all, and the
 * full judgment runs offline through @mikeargento/bitgraph-verify.
 *
 * The one rule that cannot bend: the envelope is never the recorded thing,
 * the bytes inside it are. So the tools look up the INNER digest, and
 * bitgraph_record never mints carrier bytes, the same structural guarantee
 * the site's drop box gives.
 */

import { open } from "node:fs/promises";
import {
  CARRIER_MAGIC, CARRIER_OVERHEAD, parseCarrier, verifyCarrier,
  type CarrierVerifyResult,
} from "@mikeargento/bitgraph-verify";

/** ISO string for a witness timestamp (seconds), or null when the header was unreadable. */
const iso = (ts: number | null): string | null => (ts === null ? null : new Date(ts * 1000).toISOString());

/** The window as the tools state it. not_after null = NOT FETCHED, in those words. */
export interface CarrierWindowView {
  verdict: "TRUE" | "FALSE" | "UNDETERMINED";
  not_before: { block: number; hash: string; time: string | null } | null;
  /** null when the ceiling has not been fetched into the file yet. */
  not_after: { block: number; hash: string; time: string | null } | null;
  ceiling: "present" | "unfetched" | null;
  reasons: string[];
}

export function carrierWindowView(r: CarrierVerifyResult): CarrierWindowView {
  return {
    verdict: r.verdict,
    not_before: r.bounds ? { block: r.bounds.notBefore.blockNumber, hash: r.bounds.notBefore.blockHash, time: iso(r.bounds.notBefore.timestamp) } : null,
    not_after: r.bounds?.notAfter ? { block: r.bounds.notAfter.blockNumber, hash: r.bounds.notAfter.blockHash, time: iso(r.bounds.notAfter.timestamp) } : null,
    ceiling: r.ceiling,
    reasons: r.reasons,
  };
}

/**
 * One line for a markdown row: the verdict and the window, in the stated
 * words. The floor is temporal (after the block's own time, cryptographically);
 * the ceiling is POSITIONAL: committed before the ANCHORING of the later
 * block, never before that block's mine time, because an anchor is built
 * after the block it carries. Canon §3.5/§3.6: floor in time, ceiling in
 * position; converting the positional ceiling into a clock reading is the
 * one error.
 */
export function carrierLine(view: CarrierWindowView): string {
  const parts: string[] = [`carried proof ${view.verdict}`];
  if (view.not_before) parts.push(`after block ${view.not_before.block}${view.not_before.time ? ` (mined ${view.not_before.time})` : ""}`);
  parts.push(
    view.not_after
      ? `before the anchoring of block ${view.not_after.block}${view.not_after.time ? ` (block mined ${view.not_after.time})` : ""}`
      : "closing anchor NOT FETCHED (drop the file on bitgraph.ing to complete it)"
  );
  return parts.join(" · ");
}

/**
 * True when the file's last 8 bytes are the carrier magic. One positioned
 * read; no file that is not a carrier pays more than that.
 */
export async function sniffCarrierTail(path: string, size: number): Promise<boolean> {
  if (size < CARRIER_OVERHEAD) return false;
  const fd = await open(path, "r");
  try {
    const tail = Buffer.alloc(CARRIER_MAGIC.length);
    await fd.read(tail, 0, tail.length, size - tail.length);
    return tail.equals(Buffer.from(CARRIER_MAGIC));
  } finally {
    await fd.close();
  }
}

export interface CarrierFileResult {
  /** "ok": readable block, judged. "corrupt": block found but unreadable. */
  status: "ok" | "corrupt";
  /** Standard base64 SHA-256 of the COMMITTED bytes inside; the digest every lookup uses. */
  innerDigestB64: string | null;
  /** The committed bytes, for callers that go on to sniff or serve them. */
  inner: Uint8Array | null;
  result: CarrierVerifyResult | null;
  view: CarrierWindowView | null;
  corruptReason: string | null;
}

/**
 * Read a tail-confirmed carrier whole and judge it offline: the carried
 * proof, the floor by identity, the witnesses, the ceiling when present.
 * Proof-level judgment (attestation depth stays the audit CLI's job).
 */
export async function readCarrierFile(path: string): Promise<CarrierFileResult> {
  const fd = await open(path, "r");
  let bytes: Uint8Array;
  try {
    const info = await fd.stat();
    const buf = Buffer.alloc(info.size);
    await fd.read(buf, 0, info.size, 0);
    bytes = new Uint8Array(buf);
  } finally {
    await fd.close();
  }
  const parsed = parseCarrier(bytes);
  if (parsed.kind !== "carrier") {
    const reason = parsed.kind === "corrupt" ? parsed.reason : "the tail magic matched but no block parsed";
    return { status: "corrupt", innerDigestB64: null, inner: null, result: null, view: null, corruptReason: reason };
  }
  const result = await verifyCarrier(bytes);
  const { createHash } = await import("node:crypto");
  const innerDigestB64 = createHash("sha256").update(parsed.inner).digest("base64");
  return { status: "ok", innerDigestB64, inner: parsed.inner, result, view: carrierWindowView(result), corruptReason: null };
}
