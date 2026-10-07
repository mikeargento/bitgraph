/**
 * Remote MCP endpoint: output shaping.
 *
 * Markdown for human-facing summaries, JSON for complete structured data.
 * A BitGraph's time is its attestation timestamp, the enclave platform's
 * signed clock, the same time its proof page leads with (RE-RULING
 * 2026-09-25; one clock everywhere, Mike 2026-09-27). Since enclave v10 the
 * floor is a Base block signed into the proof (commit.slotFloor) and no anchor
 * follows it. For earlier proofs the Ethereum bracket
 * confirms it: a floor block with its mine time, and a ceiling in POSITION,
 * the next anchor, never a later block's mine time (CANON 3.6). Never from
 * advisory clock fields.
 *
 * Ported from packages/mcp/src/format.ts; RecordOutcome is keyed by the
 * caller's digest string ("input") instead of a local file path.
 */

import { toUrlSafeB64 } from "./encoding";
import { recordedMsOf } from "@/lib/recorded-time";
import type { BitGraphProof, PositionView, ProofDetailResponse, SetMemberView } from "./types";

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
 * One recording outcome, in the product's own vocabulary. "not recorded" is
 * the honest label for a digest lost to a partial commit failure: never claim
 * "on record" for a digest that has no proof.
 */
export interface RecordOutcome {
  input: string;
  digest: string; // URL-safe
  outcome: "recorded" | "on record" | "not recorded";
  counter: string | null;
  epoch: string | null; // URL-safe
  total_positions: number;
  proof_url: string | null;
}

export interface CheckOutcome {
  input: string;
  digest: string; // URL-safe
  on_record: boolean;
  positions: Array<{ counter: string | null; epoch: string | null; member?: SetMemberView }>;
  proof_url: string | null;
  /** Present when the lookup did not complete: whether the bytes are in a tree is unknown, and why. */
  note?: string;
}

function memberNote(m: SetMemberView | undefined): string {
  return m ? ` (member ${m.index + 1} of ${m.count})` : "";
}

export function positionOf(proof: BitGraphProof): { counter: string | null; epoch: string | null } {
  const counter = proof.commit?.counter ?? null;
  const epochId = proof.commit?.epochId;
  return { counter, epoch: epochId !== undefined ? toUrlSafeB64(epochId) : null };
}

export function renderRecordMarkdown(outcomes: readonly RecordOutcome[]): string {
  const recorded = outcomes.filter((o) => o.outcome === "recorded");
  const onRecord = outcomes.filter((o) => o.outcome === "on record");
  const notRecorded = outcomes.filter((o) => o.outcome === "not recorded");
  const lines: string[] = [];
  let headline = `${recorded.length} recorded, ${onRecord.length} already on record.`;
  if (notRecorded.length > 0) {
    headline = `${recorded.length} recorded, ${onRecord.length} already on record, ${notRecorded.length} NOT recorded.`;
  }
  lines.push(headline);
  for (const o of outcomes) {
    if (o.outcome === "not recorded") {
      lines.push(`- not recorded (commit failed) · ${o.input}`);
      continue;
    }
    const positionNote =
      o.outcome === "on record"
        ? o.total_positions > 1
          ? ` (${o.total_positions} causal positions, earliest shown)`
          : ""
        : "";
    lines.push(
      `- ${o.outcome} · #${o.counter ?? "?"} · ${o.input}${positionNote}\n  ${o.proof_url}`
    );
  }
  if (onRecord.length > 0) {
    lines.push(
      `\nAlready-recorded digests were not re-recorded. To record one of them at a new causal position deliberately, call bitgraph_record with again=true.`
    );
  }
  return lines.join("\n");
}

export function renderCheckMarkdown(outcomes: readonly CheckOutcome[]): string {
  const found = outcomes.filter((o) => o.on_record).length;
  const lines: string[] = [`${found} of ${outcomes.length} found in BitGraph's copy. A miss is not a finding: a proof may live only with its holder.`];
  for (const o of outcomes) {
    if (o.on_record) {
      const first = o.positions[0];
      const extra = o.positions.length > 1 ? ` and ${o.positions.length - 1} more position(s)` : "";
      lines.push(`- on record · #${first?.counter ?? "?"}${memberNote(first?.member)}${extra} · ${o.input}\n  ${o.proof_url}`);
    } else {
      lines.push(`- not indexed (not a finding) · ${o.input}`);
    }
  }
  return lines.join("\n");
}

/** A Base floor the proof signs (commit.slotFloor, enclave v10), or null for an Ethereum floor or none. */
function baseFloorOf(detail: ProofDetailResponse): { blockNumber: number; blockTimestamp: number } | null {
  const f = (detail.proofs[0]?.proof?.commit as { slotFloor?: { chain?: unknown; blockNumber?: unknown; blockTimestamp?: unknown } } | undefined)?.slotFloor;
  if (!f || f.chain !== "base" || typeof f.blockNumber !== "number" || typeof f.blockTimestamp !== "number") return null;
  return { blockNumber: f.blockNumber, blockTimestamp: f.blockTimestamp };
}

function renderWindow(detail: ProofDetailResponse): string | null {
  // A Base floor (enclave v10): the block the enclave fixed when the position
  // opened, signed into the proof with its time. No anchor follows it: order
  // after a record is the next BitGraph in the chain.
  const base = baseFloorOf(detail);
  if (base !== null) return `Placed after Base block ${base.blockNumber} (mined ${new Date(base.blockTimestamp * 1000).toISOString().replace(".000Z", "Z")}).`;
  const w = detail.causalWindow;
  if (!w) return null;
  // The floor is a block and its mine time, Ethereum's clock. The ceiling is
  // the next anchor, stated as a position; the time given with it is when
  // BitGraph recorded that anchor, the enclave's clock, as on the proof page.
  // A later block's mine time is never offered as a bound.
  const lower = w.anchorBefore?.blockTime ?? null;
  const lowerBlock = w.anchorBefore?.blockNumber ?? null;
  const after = w.anchorAfter;
  const ceiling = after?.counter
    ? `before anchor #${after.counter}${typeof after.recordedMs === "number" ? `, which BitGraph recorded at ${new Date(after.recordedMs).toISOString()}` : ""}`
    : null;
  if (lower && ceiling) return `Placed after Ethereum block ${lowerBlock ?? "?"} (mined ${lower}), ${ceiling}.`;
  if (ceiling) return `Placed ${ceiling}; no floor is known here.`;
  if (lower) return `Placed after Ethereum block ${lowerBlock ?? "?"} (mined ${lower}); no anchor follows yet.`;
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
  const positions: PositionView[] = detail.positions ?? [];
  const here = positions.find((p) => p.counter === counter) ?? positions[0];
  const lines: string[] = [];
  lines.push(`# BitGraph #${counter ?? "?"}`);
  lines.push("");
  lines.push(`- Digest (SHA-256): ${toUrlSafeB64(digest)}`);
  if (epoch) lines.push(`- Position: counter ${counter ?? "?"} in epoch ${epoch.slice(0, 12)}…`);
  const recorded = recordedMsOf(proof);
  if (recorded !== null) lines.push(`- Recorded: ${new Date(recorded).toISOString()}, by the enclave platform's signed clock`);
  if (here?.member) {
    const role = here.member.role === "fused" ? "its new fused bytes" : "the original";
    lines.push(`- Set: member ${here.member.index + 1} of ${here.member.count}, as ${role}${here.placement ? ` (${here.placement})` : ""}`);
  }
  const window = renderWindow(detail);
  if (window) lines.push(`- ${window}`);
  const baseFloor = baseFloorOf(detail);
  if (baseFloor !== null) {
    lines.push(`- Floor block on Basescan: https://basescan.org/block/${baseFloor.blockNumber}`);
  } else {
    const etherscan =
      detail.causalWindow?.anchorAfter?.etherscanUrl ??
      detail.causalWindow?.anchorBefore?.etherscanUrl;
    if (etherscan) lines.push(`- Anchor block on Etherscan: ${etherscan}`);
  }
  if (proof.environment?.enforcement) {
    lines.push(`- Enforcement: ${proof.environment.enforcement}`);
  }
  if (proof.attribution?.name || proof.attribution?.message) {
    const note = [proof.attribution.name, proof.attribution.message]
      .filter(Boolean)
      .join(": ");
    lines.push(`- Submitter's note (self-attributed, not verified): ${note}`);
  }
  if (positions.length > 1) {
    lines.push("");
    lines.push(`## Causal positions (${positions.length})`);
    positions.forEach((p, i) => {
      const label = i === 0 ? " · original" : "";
      const when = typeof p.recordedMs === "number"
        ? ` · recorded ${new Date(p.recordedMs).toISOString()}`
        : p.lowerTime ? ` · no earlier than ${p.lowerTime}` : "";
      lines.push(`- #${p.counter ?? "?"}${label}${p.member ? ` · set of ${p.member.count}` : ""}${when}`);
    });
  }
  lines.push("");
  lines.push(`Proof page (what BitGraph's copy holds; the proof itself is returned in json and kept by its holder): ${proofUrl(baseUrl, digest, counter ?? undefined, proof.commit?.epochId)}`);
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
        obj[key] = `<elided ${v.length} base64 chars>`;
      } else {
        elideReports(v);
      }
    }
  }
}
