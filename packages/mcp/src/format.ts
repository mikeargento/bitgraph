// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * @mikeargento/bitgraph-mcp: output shaping.
 *
 * Markdown for human-facing summaries, JSON for complete structured data.
 * Time statements come from the Ethereum anchor bracket ("BitGraphed between
 * X and Y"), never from advisory clock fields.
 */

import { toUrlSafeB64 } from "./encoding.js";
import type { BitGraphProof, PositionView, ProofDetailResponse } from "./types.js";

export const CHARACTER_LIMIT = 25_000;

/** Public proof page URL for a digest, optionally pinned to one causal position. */
export function proofUrl(
  baseUrl: string,
  standardDigest: string,
  counter?: string,
  standardEpochId?: string
): string {
  let url = `${baseUrl}/proof/${encodeURIComponent(toUrlSafeB64(standardDigest))}`;
  if (counter !== undefined) {
    url += `?counter=${encodeURIComponent(counter)}`;
    if (standardEpochId !== undefined) {
      url += `&epoch=${encodeURIComponent(toUrlSafeB64(standardEpochId))}`;
    }
  }
  return url;
}

/**
 * One outcome per path, in the product's own vocabulary. "fused": a new fused
 * artifact was built from the file and committed under its own slot. "on
 * record": the bytes already had a recording or a fused artifact naming them
 * as origin, and nothing was minted. "not fused": the attempt failed; never
 * claim "on record" for bytes that have no proof.
 */
export interface RecordOutcome {
  path: string;
  /** The file's own digest (URL-safe): the origin of the fused artifact. */
  digest: string;
  outcome: "fused" | "on record" | "not fused";
  /** The fused artifact's digest (URL-safe), present on a "fused" outcome. */
  artifact_digest: string | null;
  placement: string | null;
  counter: string | null;
  epoch: string | null; // URL-safe
  total_positions: number;
  proof_url: string | null;
  error?: string;
}

export interface CheckOutcome {
  input: string;
  digest: string; // URL-safe
  on_record: boolean;
  positions: Array<{ counter: string | null; epoch: string | null }>;
  proof_url: string | null;
}

export function positionOf(proof: BitGraphProof): { counter: string | null; epoch: string | null } {
  const counter = proof.commit?.counter ?? null;
  const epochId = proof.commit?.epochId;
  return { counter, epoch: epochId !== undefined ? toUrlSafeB64(epochId) : null };
}

export function renderRecordMarkdown(outcomes: readonly RecordOutcome[]): string {
  const fused = outcomes.filter((o) => o.outcome === "fused");
  const onRecord = outcomes.filter((o) => o.outcome === "on record");
  const notFused = outcomes.filter((o) => o.outcome === "not fused");
  const lines: string[] = [];
  let headline = `${fused.length} fused, ${onRecord.length} already on record.`;
  if (notFused.length > 0) {
    headline = `${fused.length} fused, ${onRecord.length} already on record, ${notFused.length} NOT fused.`;
  }
  lines.push(headline);
  for (const o of outcomes) {
    if (o.outcome === "not fused") {
      lines.push(`- not fused · ${o.path}${o.error ? `: ${o.error}` : ""}`);
      continue;
    }
    const note =
      o.outcome === "on record"
        ? o.total_positions > 1
          ? ` (${o.total_positions} positions, earliest shown)`
          : ""
        : o.placement
          ? ` (${o.placement})`
          : "";
    lines.push(`- ${o.outcome} · #${o.counter ?? "?"} · ${o.path}${note}\n  ${o.proof_url}`);
  }
  if (fused.length > 0) {
    lines.push(
      "\nEach fused artifact was built in memory from the file, hashed and committed under its own slot; the file itself is unchanged and was not uploaded. The original plus the proof rebuilds the fused bytes; the Frame for each is in the structured result."
    );
  }
  if (onRecord.length > 0) {
    lines.push(
      "\nFiles already on record were left alone. To make a new fused artifact from one of them deliberately, call bitgraph_record with again=true."
    );
  }
  return lines.join("\n");
}

export function renderCheckMarkdown(outcomes: readonly CheckOutcome[]): string {
  const found = outcomes.filter((o) => o.on_record).length;
  const lines: string[] = [`${found} of ${outcomes.length} on record.`];
  for (const o of outcomes) {
    if (o.on_record) {
      const first = o.positions[0];
      const extra = o.positions.length > 1 ? ` and ${o.positions.length - 1} more position(s)` : "";
      lines.push(`- on record · #${first?.counter ?? "?"}${extra} · ${o.input}\n  ${o.proof_url}`);
    } else {
      lines.push(`- not on record · ${o.input}`);
    }
  }
  return lines.join("\n");
}

function renderWindow(detail: ProofDetailResponse): string | null {
  const w = detail.causalWindow;
  if (!w) return null;
  const lower = w.anchorBefore?.blockTime ?? null; // earlier block: BitGraphed after it
  const upper = w.anchorAfter?.blockTime ?? null; // later block: BitGraphed before it
  const lowerBlock = w.anchorBefore?.blockNumber ?? null;
  const upperBlock = w.anchorAfter?.blockNumber ?? null;
  if (lower && upper) {
    return `BitGraphed between ${lower} (Ethereum block ${lowerBlock ?? "?"}) and ${upper} (block ${upperBlock ?? "?"}).`;
  }
  if (upper) return `BitGraphed before ${upper} (Ethereum block ${upperBlock ?? "?"}).`;
  if (lower) return `BitGraphed after ${lower} (Ethereum block ${lowerBlock ?? "?"}).`;
  return null;
}

export function renderProofMarkdown(
  detail: ProofDetailResponse,
  baseUrl: string
): string {
  const proof = detail.proofs[0]?.proof;
  if (!proof) return "No proof found for that digest.";
  const digest = proof.artifact?.digestB64 ?? "";
  const { counter, epoch } = positionOf(proof);
  const lines: string[] = [];
  lines.push(`# BitGraph #${counter ?? "?"}`);
  lines.push("");
  lines.push(`- Digest (SHA-256): ${toUrlSafeB64(digest)}`);
  if (epoch) lines.push(`- Position: counter ${counter ?? "?"} in epoch ${epoch.slice(0, 12)}…`);
  const window = renderWindow(detail);
  if (window) lines.push(`- ${window}`);
  const etherscan =
    detail.causalWindow?.anchorAfter?.etherscanUrl ??
    detail.causalWindow?.anchorBefore?.etherscanUrl;
  if (etherscan) lines.push(`- Anchor block on Etherscan: ${etherscan}`);
  if (proof.environment?.enforcement) {
    lines.push(`- Enforcement: ${proof.environment.enforcement}`);
  }
  if (proof.attribution?.name || proof.attribution?.message) {
    const note = [proof.attribution.name, proof.attribution.message]
      .filter(Boolean)
      .join(": ");
    lines.push(`- Submitter's note (self-attributed, not verified): ${note}`);
  }
  const positions: PositionView[] = detail.positions ?? [];
  if (positions.length > 1) {
    lines.push("");
    lines.push(`## Causal positions (${positions.length})`);
    positions.forEach((p, i) => {
      const label = i === 0 ? " · original" : "";
      const bracket =
        p.lowerTime && p.upperTime ? ` · between ${p.lowerTime} and ${p.upperTime}` : "";
      lines.push(`- #${p.counter ?? "?"}${label}${bracket}`);
    });
  }
  lines.push("");
  lines.push(`Proof page: ${proofUrl(baseUrl, digest, counter ?? undefined, proof.commit?.epochId)}`);
  return lines.join("\n");
}

/**
 * Cap a JSON payload at CHARACTER_LIMIT. Attestation reports are the usual
 * culprit; elide them first, then fall back to hard truncation with a notice.
 */
export function capJson(value: unknown): { text: string; truncated: boolean } {
  let text = JSON.stringify(value, null, 2);
  if (text.length <= CHARACTER_LIMIT) return { text, truncated: false };
  const elided = JSON.parse(JSON.stringify(value)) as unknown;
  elideReports(elided);
  text = JSON.stringify(elided, null, 2);
  if (text.length <= CHARACTER_LIMIT) return { text, truncated: true };
  return {
    text: `${text.slice(0, CHARACTER_LIMIT)}\n… truncated at ${CHARACTER_LIMIT} characters. Request a single item or use markdown format for a summary.`,
    truncated: true,
  };
}

function elideReports(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) elideReports(item);
    return;
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const [key, v] of Object.entries(obj)) {
      if (key === "reportB64" && typeof v === "string" && v.length > 256) {
        obj[key] = `<elided ${v.length} base64 chars; fetch the proof page for the full attestation>`;
      } else {
        elideReports(v);
      }
    }
  }
}
