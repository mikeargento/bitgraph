// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * @mikeargento/bitgraph-mcp: output shaping.
 *
 * Markdown for human-facing summaries, JSON for complete structured data.
 * Time statements come from the Ethereum anchor bracket, never from advisory
 * clock fields, and they keep the canon's units: the floor is temporal
 * ("after T", cryptographic), the ceiling is POSITIONAL ("before the
 * anchoring of block M"), because an anchor is built after the block it
 * carries, so a block's mine time is never an upper clock bound.
 */

import { toUrlSafeB64, carrierLine, type CarrierWindowView, type BitGraphProof, type PositionView, type ProofDetailResponse, type SetMemberView } from "@mikeargento/bitgraph-sdk";

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
 * a leaf of the tree just made, and its committed bytes (listed by digest in
 * its leaf) carry the position commitment. "recorded": the file is a leaf
 * recorded as is (over 256 MiB): its own digest is its leaf; it existed by
 * the commit, and nothing bounds it from below. "on record": the bytes
 * already had a recording or a fused artifact naming them as origin, and
 * nothing was made. "not fused": the attempt failed or the file was left out;
 * never claim "on record" for bytes that have no proof. "carried": the file
 * is a BitGraphed file, its proof travels inside it; the committed bytes it
 * holds were judged offline and NOTHING was minted, because the envelope is
 * never the recorded thing.
 */
export interface RecordOutcome {
  path: string;
  /** The file's own digest (URL-safe): the origin of its committed bytes. For a "carried" row, the COMMITTED bytes' digest. */
  digest: string;
  outcome: "fused" | "recorded" | "on record" | "not fused" | "carried";
  /** The file's own export (bitgraph-export/1), when one export per file was written. */
  export?: string;
  /** A BitGraphed file's offline judgment: the carried proof's verdict and window. */
  carrier?: CarrierWindowView;
  /** True when the bytes carry Content Credentials (a C2PA manifest); the proof page displays them. */
  c2pa?: boolean;
  /** The leaf's artifact (URL-safe): the committed bytes' digest; for "recorded" (as is), the file's own. */
  artifact_digest: string | null;
  /** "as-is", or the placement of the committed bytes. */
  placement: string | null;
  counter: string | null;
  epoch: string | null; // URL-safe
  /** The file's leaf in the tree just made (1-based, of member_count), or its row in an earlier set the ledger reports. */
  member: number | null;
  member_count: number | null;
  total_positions: number;
  proof_url: string | null;
  error?: string;
}

/** The one BitGraph a record call makes: a tree/1, one position for every recorded row. */
export interface TreeOutcome {
  format: "tree/1";
  count: number;
  counter: string | null;
  epoch: string | null; // URL-safe
  /** The committed artifact's digest (URL-safe): the root document's. */
  artifact_digest: string;
  proof_url: string;
  /** The committed artifact: the 84-byte root document, hex. */
  root_document: string;
  /** The Ethereum block the commitment binds: the floor. */
  floor_block: number;
  /** True when the boundary echoed the root document in the proof's metadata. Exports carry it either way. */
  root_document_echoed: boolean;
  /** True when the commit response was lost and the proof was read back by digest. */
  recovered: boolean;
  export: {
    kind: "owner" | "members" | "both" | "none";
    /** Where the exports were written; null when none were asked for. */
    dir: string | null;
    /** The owner's export: every file's leaf and name. */
    owner: string | null;
    /** The folder of per-file exports. */
    members_dir: string | null;
    members: number;
    /** SPEC.md beside the exports: the rules the proof pins, written when the site served that exact text. */
    spec: string | null;
    /** True when the floor block's header is in the export (fetched and checked at make time). */
    floor_header: boolean;
    /** Why the exports could not be written where asked, when they could not. */
    error?: string;
  };
}

/** Superseded by TreeOutcome: the set a record call made before tree/1. Kept for code that imports the type. */
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

export function renderRecordMarkdown(outcomes: readonly RecordOutcome[], tree: TreeOutcome | null = null, omitted = 0): string {
  const fused = outcomes.filter((o) => o.outcome === "fused");
  const asIs = outcomes.filter((o) => o.outcome === "recorded");
  const made = outcomes.filter((o) => o.outcome === "fused" || o.outcome === "recorded");
  const onRecord = outcomes.filter((o) => o.outcome === "on record");
  const carried = outcomes.filter((o) => o.outcome === "carried");
  const notFused = outcomes.filter((o) => o.outcome === "not fused");
  const lines: string[] = [];
  const parts: string[] = [];
  if (tree !== null && made.length > 0) {
    parts.push(`${fmt(made.length)} file${made.length === 1 ? "" : "s"} BitGraphed as one tree at #${tree.counter ?? "?"} (tree of ${fmt(tree.count)})`);
  } else {
    parts.push(`${fmt(fused.length)} fused`);
  }
  parts.push(`${fmt(onRecord.length)} already on record`);
  if (carried.length > 0) parts.push(`${fmt(carried.length)} BitGraphed file${carried.length === 1 ? "" : "s"} (proof inside, nothing minted)`);
  if (notFused.length > 0) parts.push(`${fmt(notFused.length)} NOT fused`);
  lines.push(`${parts.join(", ")}.`);
  if (tree !== null && made.length > 0) {
    lines.push(`- #${tree.counter ?? "?"} · tree of ${fmt(tree.count)} · ${tree.proof_url}`);
    const ex = tree.export;
    if (ex.owner !== null) lines.push(`  Export, every file's leaf and name (keep it with the files): ${ex.owner}`);
    if (ex.members_dir !== null) lines.push(`  One export per file: ${ex.members_dir}`);
    if (ex.spec !== null) lines.push(`  The rules the proof pins (SPEC.md), beside it: ${ex.spec}`);
    if (ex.error !== undefined) lines.push(`  The export could not be written where asked: ${ex.error}`);
    if (ex.kind === "none") lines.push("  No export was written (exports='none'). The proof commits only the tree's root: without an export no file here can show it is in this BitGraph.");
    else if (ex.owner !== null || ex.members_dir !== null) {
      const first = ex.owner ?? ex.members_dir ?? "";
      lines.push(`  The Base ceiling lands seconds after the commit and its settlement on Ethereum later; to add them${ex.floor_header ? "" : ", and the floor block's header,"} to an export: npx -p @mikeargento/bitgraph-sdk bitgraph export complete ${JSON.stringify(first)}`);
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
      const carrier = o.carrier ? `\n  ${carrierLine(o.carrier)}` : "";
      return `- on record · #${o.counter ?? "?"}${row} · ${o.path}${note}${carrier}${c2paNote(o)}\n  ${o.proof_url}`;
    },
    (n) => `and ${fmt(n)} more already on record`
  );
  group(
    carried,
    (o) => {
      const where = o.proof_url !== null ? `\n  ${o.proof_url}` : "\n  Not in this ledger; the proof travels in the file itself.";
      return `- BitGraphed file · ${o.path}\n  ${o.carrier ? carrierLine(o.carrier) : "carried proof"} · nothing minted: the envelope is never the recorded thing, the bytes inside are${c2paNote(o)}${where}`;
    },
    (n) => `and ${fmt(n)} more BitGraphed files`
  );
  group(
    made,
    (o) =>
      o.member === null
        ? `- ${o.outcome === "recorded" ? "recorded as is" : "fused"} · #${o.counter ?? "?"} · ${o.path} (${o.placement ?? "?"})${c2paNote(o)}\n  ${o.proof_url}`
        : o.outcome === "recorded"
          ? `- recorded as is · ${o.path} (${fmt(o.member)} of ${fmt(o.member_count ?? 0)})${c2paNote(o)}`
          : `- fused · ${o.path} (${fmt(o.member)} of ${fmt(o.member_count ?? 0)}, ${o.placement ?? "?"})${c2paNote(o)}`,
    (n) => `and ${fmt(n)} more files in the same tree`
  );
  if (tree !== null && made.length > 0) {
    lines.push(
      "\nOne BitGraph holds every file made here: one position, one Merkle tree, each file a leaf naming the digest of its committed bytes and its own. The committed bytes were hashed on this machine and never written or uploaded; the files are unchanged, and each original plus the proof rebuilds them." +
        (asIs.length > 0 ? " A file over 256 MiB is recorded as is: it existed by the commit, and nothing bounds it from below." : "") +
        " The proof commits only the tree's root: keep the export with the files, because with a file it shows that file is in this BitGraph, with nothing of BitGraph's required."
    );
  } else if (fused.length > 0) {
    lines.push(
      "\nThe new fused file was built in memory from the file, hashed and committed under its own position; the file itself is unchanged and was not uploaded. The original plus the proof rebuilds the new file."
    );
  }
  if (onRecord.length > 0) {
    lines.push(
      "\nFiles already on record were left alone. A file can also hold a BitGraph in its holder's folder, which no lookup here can see. To make a new one regardless, call bitgraph_record with again=true."
    );
  }
  if (omitted > 0) {
    lines.push(`\nThe structured result lists the first rows only (${fmt(omitted)} omitted); every file made here shares the tree's position above.`);
  }
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

function renderWindow(detail: ProofDetailResponse): string | null {
  const w = detail.causalWindow;
  if (!w) return null;
  const lower = w.anchorBefore?.blockTime ?? null; // earlier block: BitGraphed after it
  const upper = w.anchorAfter?.blockTime ?? null; // later block: BitGraphed before it
  const lowerBlock = w.anchorBefore?.blockNumber ?? null;
  const upperBlock = w.anchorAfter?.blockNumber ?? null;
  if (lower && upper) {
    return `BitGraphed after ${lower} (Ethereum block ${lowerBlock ?? "?"}), and before the anchoring of block ${upperBlock ?? "?"} (that block mined ${upper}).`;
  }
  if (upper) return `BitGraphed before the anchoring of Ethereum block ${upperBlock ?? "?"} (that block mined ${upper}).`;
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
        p.lowerTime && p.upperTime ? ` · after ${p.lowerTime}, before the closing anchor (its block mined ${p.upperTime})` : "";
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
