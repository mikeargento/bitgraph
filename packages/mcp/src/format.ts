// Copyright (c) 2025-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * @mikeargento/bitgraph-mcp: output shaping. Markdown for human-facing
 * summaries, JSON for complete structured data.
 */

import { toUrlSafeB64, carrierLine, type CarrierWindowView, type BitGraphProof, type PositionView, type ProofDetailResponse, type RecordResult, type SetMemberView } from "@mikeargento/bitgraph-sdk";

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

export interface CheckOutcome {
  input: string;
  /** URL-safe. For a BitGraphed file, the digest of the COMMITTED bytes inside, never the envelope's. */
  digest: string;
  on_record: boolean;
  positions: Array<{ counter: string | null; epoch: string | null; member?: SetMemberView }>;
  proof_url: string | null;
  /** Present when the input is a BitGraphed file: the carried proof's offline judgment. */
  carrier?: CarrierWindowView;
  /** True when the bytes carry Content Credentials (a C2PA manifest). */
  c2pa?: boolean;
  /** A stated condition (an unreadable carrier block, an oversized file), never a verdict. */
  note?: string;
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

/** The C2PA note a row earns, or an empty string. */
const c2paNote = (o: { c2pa?: boolean }): string =>
  o.c2pa === true ? `\n  Content Credentials (C2PA) detected in the file; the proof page displays them.` : "";

/** What a bitgraph_record call made, in a few lines: the BitGraph with its nonce, then each file. */
export function renderRecordMarkdown(r: RecordResult): string {
  const lines: string[] = [];
  const m = r.made;
  const made = r.files.filter((f) => f.outcome === "made");
  const onRecord = r.files.filter((f) => f.outcome === "on record");
  const skipped = r.files.filter((f) => f.outcome === "skipped");
  if (m !== null) {
    const what = m.tree !== null ? `${fmt(m.tree.files)} files as one tree` : "1 file";
    lines.push(`Made BitGraph #${m.number ?? "?"} of ${what}.`);
    lines.push(`- Nonce: ${m.nonce ?? "?"}`);
    lines.push(`- Counts: ${m.counts?.join(", ") ?? "?"} (the fresh nonce at the first, the ${m.tree !== null ? "tree's root" : "file's SHA-256"} at the next)`);
    lines.push(`- Proof page: ${m.proofUrl}`);
    if (m.tree !== null) {
      lines.push(m.tree.indexError === null
        ? `- Each file is indexed under its own hash (${fmt(m.tree.indexed)} of ${fmt(m.tree.files)}).`
        : `- Index: ${m.tree.indexError}. Each file's own proof still verifies against the file.`);
    }
  } else {
    lines.push("Nothing new was made.");
  }
  const group = (rows: typeof r.files, render: (f: (typeof r.files)[number]) => string, more: (n: number) => string) => {
    for (const f of rows.slice(0, MARKDOWN_ROWS)) lines.push(render(f));
    if (rows.length > MARKDOWN_ROWS) lines.push(`- ${more(rows.length - MARKDOWN_ROWS)}`);
  };
  group(
    made,
    (f) => `- made · ${f.path}${f.member !== null ? ` (file ${fmt(f.member.index + 1)} of ${fmt(f.member.files)})` : ""}\n  ${f.proofPath !== null ? `proof saved: ${f.proofPath}` : "proof not saved (write=false)"}`,
    (n) => `and ${fmt(n)} more files in the same BitGraph`
  );
  group(
    onRecord,
    (f) => `- already a BitGraph · #${f.number ?? "?"} · ${f.path}\n  nonce ${f.nonce ?? "?"} · ${f.proofUrl ?? ""}`,
    (n) => `and ${fmt(n)} more already on record`
  );
  group(skipped, (f) => `- skipped · ${f.path}: ${f.reason ?? ""}`, (n) => `and ${fmt(n)} more skipped`);
  if (made.length > 0) lines.push("\nKeep each proof file whole and unedited beside its file: it verifies offline with @mikeargento/bitgraph-verify.");
  if (onRecord.length > 0) lines.push("\nFiles that already had a BitGraph were left alone: there is one BitGraph per file's bytes.");
  return lines.join("\n");
}

export function renderCheckMarkdown(outcomes: readonly CheckOutcome[]): string {
  const found = outcomes.filter((o) => o.on_record).length;
  const lines: string[] = [`${fmt(found)} of ${fmt(outcomes.length)} on record.`];
  for (const o of outcomes.slice(0, MARKDOWN_ROWS)) {
    const carrier = o.carrier ? `\n  BitGraphed file: ${carrierLine(o.carrier)} (judged offline from the proof inside)` : "";
    if (o.on_record) {
      const first = o.positions[0];
      const extra = o.positions.length > 1 ? ` and ${fmt(o.positions.length - 1)} more position(s)` : "";
      lines.push(`- on record · #${first?.counter ?? "?"}${memberNote(first?.member)}${extra} · ${o.input}${carrier}${c2paNote(o)}\n  ${o.proof_url}`);
    } else if (o.carrier) {
      lines.push(`- not in this ledger · ${o.input}${carrier}${c2paNote(o)}`);
    } else if (o.note !== undefined) {
      lines.push(`- not judged · ${o.input}\n  ${o.note}`);
    } else {
      lines.push(`- not on record · ${o.input}${c2paNote(o)}`);
    }
  }
  if (outcomes.length > MARKDOWN_ROWS) lines.push(`- and ${fmt(outcomes.length - MARKDOWN_ROWS)} more; the structured result lists every one`);
  return lines.join("\n");
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
  if (proof.commit?.nonceB64) lines.push(`- Nonce: ${proof.commit.nonceB64}`);
  if (proof.commit?.slotCounter && proof.commit?.counter) lines.push(`- Counts: ${proof.commit.slotCounter}, ${proof.commit.counter} (the fresh nonce at the first, the content at the next)`);
  if (epoch) lines.push(`- Position: counter ${counter ?? "?"} in epoch ${epoch.slice(0, 12)}…`);
  if (typeof proof.commit?.time === "number") lines.push(`- Enclave time: ${new Date(proof.commit.time).toISOString()}`);
  if (proof.commit?.prevB64) lines.push(`- Previous proof: ${proof.commit.prevB64}`);
  if (here?.member) lines.push(`- Tree: file ${fmt(here.member.index + 1)} of ${fmt(here.member.count)}`);
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
    lines.push(`## Positions (${fmt(positions.length)})`);
    positions.forEach((p, i) => {
      const label = i === 0 ? " · first" : "";
      lines.push(`- #${p.counter ?? "?"}${label}${p.member ? ` · tree of ${fmt(p.member.count)}` : ""}`);
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
