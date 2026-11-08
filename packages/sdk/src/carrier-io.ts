// Copyright (c) 2025-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * BitGraphed files: committed bytes followed by one structural block that
 * carries their proof. The block is found from the END of the file, by
 * structure, never by scanning: an 8-byte tail read decides whether a file is
 * one at all, and the judgment runs offline through
 * @mikeargento/bitgraph-verify.
 *
 * The envelope is never the recorded thing, the bytes inside it are. Lookups
 * use the INNER digest, and record never makes a BitGraph of a BitGraphed
 * file.
 */

import { open, stat } from "node:fs/promises";
import {
  CARRIER_MAGIC, CARRIER_OVERHEAD, parseCarrier, verifyCarrier,
  type CarrierVerifyResult,
} from "@mikeargento/bitgraph-verify";
import { scanFile, sniffC2paBytes, type ScannedFile } from "./scan.js";

/** A BitGraphed file's offline judgment, as the tools state it. */
export interface CarrierWindowView {
  verdict: "TRUE" | "FALSE" | "UNDETERMINED";
  /** The carrier format's version. */
  version: number | null;
  /** The tree member the file's bytes are, when its path reached the signed root. */
  member: { index: number; count: number } | null;
  reasons: string[];
}

export function carrierWindowView(r: CarrierVerifyResult): CarrierWindowView {
  return {
    verdict: r.verdict,
    version: r.version,
    member: r.member ? { index: r.member.index, count: r.member.count } : null,
    reasons: r.reasons,
  };
}

/** One line for a person: the carried proof's verdict, and the tree member when there is one. */
export function carrierLine(view: CarrierWindowView): string {
  const parts: string[] = [`carried proof ${view.verdict}`];
  if (view.member) parts.push(`tree member: leaf ${view.member.index} of ${view.member.count}`);
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
 * Read a tail-confirmed carrier whole and judge it offline from the proof it
 * carries (attestation depth stays the audit CLI's job).
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

/** Files above this are not loaded whole into memory. */
export const MAX_LOADED_BYTES = 256 * 1024 * 1024;

/** A BitGraphed file, judged offline from the proof it carries. */
export interface CarrierRow {
  kind: "carrier";
  path: string;
  status: "ok" | "corrupt" | "too-large";
  /** Standard base64 SHA-256 of the committed bytes inside (status "ok"). */
  innerDigestB64: string | null;
  view: CarrierWindowView | null;
  /** The carried bitgraph/1 proof, for offline answers when the ledger has no row. */
  proof: unknown | null;
  c2pa: boolean;
  reason: string | null;
}
export type ClassifiedPath = { kind: "plain"; file: ScannedFile } | CarrierRow;

/** A path is either plain bytes to hash or a BitGraphed file, decided by one 8-byte tail read. */
export async function classifyPath(p: string): Promise<ClassifiedPath> {
  const info = await stat(p);
  if (info.isFile() && (await sniffCarrierTail(p, info.size))) {
    if (info.size > MAX_LOADED_BYTES) {
      return {
        kind: "carrier", path: p, status: "too-large", innerDigestB64: null, view: null, proof: null, c2pa: false,
        reason: `a BitGraphed file larger than this tool loads (${Math.round(MAX_LOADED_BYTES / (1024 * 1024))} MiB); judge it offline with: npx @mikeargento/bitgraph-audit "${p}"`,
      };
    }
    const r = await readCarrierFile(p);
    if (r.status === "corrupt" || r.innerDigestB64 === null) {
      return {
        kind: "carrier", path: p, status: "corrupt", innerDigestB64: null, view: null, proof: null, c2pa: false,
        reason: `a carrier block was found at the end of the file but is unreadable: ${r.corruptReason ?? "unspecified"}. A corrupted block, not a forgery.`,
      };
    }
    return {
      kind: "carrier", path: p, status: "ok", innerDigestB64: r.innerDigestB64, view: r.view,
      proof: r.result?.payload?.proof ?? null, c2pa: r.inner !== null && sniffC2paBytes(r.inner), reason: null,
    };
  }
  return { kind: "plain", file: await scanFile(p) };
}
