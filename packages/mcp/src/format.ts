// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * @mikeargento/bitgraph-mcp: output shaping.
 *
 * Markdown for human-facing summaries, JSON for complete structured data.
 * Time statements come from the Ethereum anchor bracket ("BitGraphed between
 * X and Y"), never from advisory clock fields.
 */

import { toUrlSafeB64 } from "./encoding.js";
import type { BitGraphProof, PositionView, ProofDetailResponse, SetMemberView } from "./types.js";

export const CHARACTER_LIMIT = 25_000;
/** Rows per group a markdown summary lists before "and N more". */
export const MARKDOWN_ROWS = 50;

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
 * One outcome per path, in the product's own vocabulary. "fused": the file is
 * a member of the set just made, its new fused bytes listed by digest in the
 * committed artifact. "on record": the bytes already had a recording or a
 * fused artifact naming them as origin, and nothing was made. "not fused":
 * the attempt failed or the file was left out; never claim "on record" for
 * bytes that have no proof.
 */
export interface RecordOutcome {
  path: string;
  /** The file's own digest (URL-safe): the origin of its fused bytes. */
  digest: string;
  outcome: "fused" | "on record" | "not fused";
  /** The member's fused digest (URL-safe), present on a "fused" outcome. */
  artifact_digest: string | null;
  placement: string | null;
  counter: string | null;
  epoch: string | null; // URL-safe
  /** The file's row in the set just made, 1-based, of member_count. */
  member: number | null;
  member_count: number | null;
  total_positions: number;
  proof_url: string | null;
  error?: string;
}

/** The one BitGraph a record call makes: a set, one position for every fused row. */
export interface SetOutcome {
  /** "set/1": the committed artifact lists every member. "set/2": it is a Merkle root over the rows, and each member's evidence is indexed on the site. */
  set: "set/1" | "set/2";
  count: number;
  counter: string | null;
  epoch: string | null; // URL-safe
  /** The committed artifact's digest (URL-safe): the manifest or the root document. */
  artifact_digest: string;
  proof_url: string;
  /** True when the boundary echoed the committed artifact in the proof's metadata, so the ledger's copy carries it. */
  manifest_echoed: boolean;
  /** True when the commit response was lost and the proof was read back by digest. */
  recovered: boolean;
  /** set/2 only: members whose evidence the site has indexed, and members still waiting. */
  index: { written: number; pending: number } | null;
}

export interface CheckOutcome {
  input: string;
  digest: string; // URL-safe
  on_record: boolean;
  positions: Array<{ counter: string | null; epoch: string | null; member?: SetMemberView }>;
  proof_url: string | null;
}

export function positionOf(proof: BitGraphProof): { counter: string | null; epoch: string | null } {
  const counter = proof.commit?.counter ?? null;
  const epochId = proof.commit?.epochId;
  return { counter, epoch: epochId !== undefined ? toUrlSafeB64(epochId) : null };
}

const fmt = (n: number): string => n.toLocaleString("en-US");

function memberNote(m: SetMemberView | undefined): string {
  return m ? ` (member ${fmt(m.index + 1)} of ${fmt(m.count)})` : "";
}

export function renderRecordMarkdown(outcomes: readonly RecordOutcome[], set: SetOutcome | null = null, omitted = 0): string {
  const fused = outcomes.filter((o) => o.outcome === "fused");
  const onRecord = outcomes.filter((o) => o.outcome === "on record");
  const notFused = outcomes.filter((o) => o.outcome === "not fused");
  const lines: string[] = [];
  const parts: string[] = [];
  if (set !== null && fused.length > 0) {
    parts.push(`${fmt(fused.length)} file${fused.length === 1 ? "" : "s"} BitGraphed as one set at #${set.counter ?? "?"} (set of ${fmt(set.count)})`);
  } else {
    parts.push(`${fmt(fused.length)} fused`);
  }
  parts.push(`${fmt(onRecord.length)} already on record`);
  if (notFused.length > 0) parts.push(`${fmt(notFused.length)} NOT fused`);
  lines.push(`${parts.join(", ")}.`);
  if (set !== null && fused.length > 0) {
    lines.push(`- #${set.counter ?? "?"} · set of ${fmt(set.count)} · ${set.proof_url}`);
    if (set.index !== null && set.index.pending > 0) {
      lines.push(`  The set is on the ledger, but the evidence for ${fmt(set.index.pending)} of its ${fmt(set.count)} members is not indexed yet, so those files are not findable by hash until it is. It is sent again at the start of the next bitgraph_record call.`);
    }
    if (!set.manifest_echoed) {
      lines.push(`  The boundary did not echo the committed artifact; the ledger's copy of this proof carries no member list. Keep the set's proof page.`);
    }
  }
  const group = (rows: readonly RecordOutcome[], render: (o: RecordOutcome) => string, more: (n: number) => string) => {
    for (const o of rows.slice(0, MARKDOWN_ROWS)) lines.push(render(o));
    if (rows.length > MARKDOWN_ROWS) lines.push(`- ${more(rows.length - MARKDOWN_ROWS)}`);
  };
  group(
    notFused,
    (o) => `- not fused · ${o.path}${o.error ? `: ${o.error}` : ""}`,
    (n) => `and ${fmt(n)} more not fused`
  );
  group(
    onRecord,
    (o) => {
      const note = o.total_positions > 1 ? ` (${fmt(o.total_positions)} positions, earliest shown)` : "";
      const row = o.member !== null && o.member_count !== null ? ` (member ${fmt(o.member)} of ${fmt(o.member_count)})` : "";
      return `- on record · #${o.counter ?? "?"}${row} · ${o.path}${note}\n  ${o.proof_url}`;
    },
    (n) => `and ${fmt(n)} more already on record`
  );
  group(
    fused,
    (o) =>
      o.member === null
        ? `- fused · #${o.counter ?? "?"} · ${o.path} (${o.placement ?? "?"})\n  ${o.proof_url}`
        : `- fused · ${o.path} (${fmt(o.member)} of ${fmt(o.member_count ?? 0)}, ${o.placement ?? "?"})`,
    (n) => `and ${fmt(n)} more files in the same set`
  );
  if (set !== null && fused.length > 0) {
    lines.push(
      "\nOne BitGraph holds every file made here: one slot, one position, and the committed artifact lists each file's new fused bytes by digest. Those bytes were hashed on this machine and never written or uploaded; the file itself is unchanged, and the original plus the set proof rebuilds them. A lookup by any file's own digest finds the set."
    );
  } else if (fused.length > 0) {
    lines.push(
      "\nThe new fused file was built in memory from the file, hashed and committed under its own slot; the file itself is unchanged and was not uploaded. The original plus the proof rebuilds the new file; its Frame is in the structured result."
    );
  }
  if (onRecord.length > 0) {
    lines.push(
      "\nFiles already on record were left alone. To make a new BitGraph of them deliberately, call bitgraph_record with again=true."
    );
  }
  if (omitted > 0) {
    lines.push(`\nThe structured result lists the first rows only (${fmt(omitted)} omitted); every fused file shares the set's position above.`);
  }
  return lines.join("\n");
}

export function renderCheckMarkdown(outcomes: readonly CheckOutcome[]): string {
  const found = outcomes.filter((o) => o.on_record).length;
  const lines: string[] = [`${fmt(found)} of ${fmt(outcomes.length)} on record.`];
  for (const o of outcomes.slice(0, MARKDOWN_ROWS)) {
    if (o.on_record) {
      const first = o.positions[0];
      const extra = o.positions.length > 1 ? ` and ${fmt(o.positions.length - 1)} more position(s)` : "";
      lines.push(`- on record · #${first?.counter ?? "?"}${memberNote(first?.member)}${extra} · ${o.input}\n  ${o.proof_url}`);
    } else {
      lines.push(`- not on record · ${o.input}`);
    }
  }
  if (outcomes.length > MARKDOWN_ROWS) lines.push(`- and ${fmt(outcomes.length - MARKDOWN_ROWS)} more; the structured result lists every one`);
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
  const positions: PositionView[] = detail.positions ?? [];
  const here = positions.find((p) => p.counter === counter) ?? positions[0];
  const lines: string[] = [];
  lines.push(`# BitGraph #${counter ?? "?"}`);
  lines.push("");
  lines.push(`- Digest (SHA-256): ${toUrlSafeB64(digest)}`);
  if (epoch) lines.push(`- Position: counter ${counter ?? "?"} in epoch ${epoch.slice(0, 12)}…`);
  if (here?.member) {
    const role = here.member.role === "fused" ? "its new fused bytes" : "the original";
    lines.push(`- Set: member ${fmt(here.member.index + 1)} of ${fmt(here.member.count)}, as ${role}${here.placement ? ` (${here.placement})` : ""}`);
  }
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
  if (positions.length > 1) {
    lines.push("");
    lines.push(`## Causal positions (${fmt(positions.length)})`);
    positions.forEach((p, i) => {
      const label = i === 0 ? " · original" : "";
      const bracket =
        p.lowerTime && p.upperTime ? ` · between ${p.lowerTime} and ${p.upperTime}` : "";
      lines.push(`- #${p.counter ?? "?"}${label}${p.member ? ` · set of ${fmt(p.member.count)}` : ""}${bracket}`);
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
