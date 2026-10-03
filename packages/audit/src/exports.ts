// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * Exports (bitgraph-export/1) through the audit.
 *
 * An export is one JSON file that, with the file it covers, checks a tree/1
 * BitGraph with nothing of BitGraph's required: the signed proof, the tree's
 * 84-byte root document, one member's evidence (a member export) or the
 * whole list of leaves (the owner's export), the floor block's header, and
 * the ceiling and the settlement, each carried or pending. Ingest finds every
 * export by its format field, wherever it sits; the proof it carries joins
 * the proof analysis like any other. This stage checks each export with
 * verifyExport from bitgraph-verify, once per file in the bundle it covers:
 *
 *   member export  the files whose SHA-256 is the leaf's artifact digest
 *                  (the committed bytes) or its origin digest (the original);
 *   owner export   every file whose SHA-256 is any leaf's artifact or origin;
 *   no such file   one run without a file: the claims about the file read
 *                  NOT_CARRIED, which is never a failure.
 *
 * verifyExport's claims are reported exactly as it states them, each with
 * what it rests on. Claims every run states alike are kept once on the
 * export (ExportCheck.claims); each run keeps its own (in practice the ones
 * about its file) with their places in verifyExport's order, and
 * exportRunClaims puts a run's whole list back together. The three time
 * claims are kept apart, never merged: the floor (the committed bytes were
 * finished after Ethereum block N; an as-is leaf has no floor), the ceiling
 * on Base (the record existed by Base block B, provisional until B is
 * checked against Base) and the ceiling on Ethereum (the record existed by
 * Ethereum block H). An export with any FALSE claim fails the audit (exit
 * bit 1), as a bad proof does; its attestation claims count, because an
 * export is checked as one self-contained object, as a carrier is.
 *
 * Owner exports at scale: verifyExport rebuilds the whole tree from the
 * owner's list on every call, so checking m files against a list of n
 * leaves as given costs n x m. When the list holds (its claim tree.leaves is
 * TRUE, checked once), each file's member evidence is derived from the list
 * exactly as verifyExport derives it, verifyExport runs on that member form,
 * and the list's claim is put back where verifyExport places it: the same
 * run, for the cost of one path. When the list fails, files are checked as
 * given, within a budget of rebuilt leaves (asGivenLeafBudget).
 *
 * Zero network: no lookup is made unless an embedder passes its own
 * (ExportAuditOptions.lookups). The CLI never does, so every confirmed claim
 * reads UNDETERMINED ("not checked").
 */

import {
  base64ToBytes,
  buildTreeMemberEvidence,
  bytesToHex,
  decodeTreeLeaves,
  LEAF_PLACEMENTS,
  MerkleTree,
  parseExport,
  parseTreeMemberEvidence,
  treeLeafHash,
  verifyExport,
} from "@mikeargento/bitgraph-verify";
import type { BitGraphExport, ExportLookups, ExportVerifyOptions, ExportVerifyResult, TreeLeaf } from "@mikeargento/bitgraph-verify";
import { streamArtifactsByHash } from "./ingest.js";
import type {
  ExportAnalysis,
  ExportCheck,
  ExportClaimRecord,
  ExportCoveredFile,
  ExportFile,
  ExportOwnClaim,
  ExportRun,
  ExportTimes,
  IngestResult,
} from "./types.js";

export interface ExportAuditOptions {
  /** Spec hashes (base64 SHA-256 of SPEC.md) to accept beyond the ones bitgraph-verify knows. */
  extraSpecHashes?: readonly string[];
  /** PCR0 values the reader accepts (claim attestation.pins). Without a list, PCR0 is reported, not judged. */
  pcr0?: readonly string[];
  /** The address an export's Base ceiling must come from. Default: BitGraph's published writer. */
  ceilingWriter?: string;
  /** The Base chain id for an export's ceiling. Default 8453. */
  baseChainId?: number;
  /**
   * An embedder's own chain lookups, for the confirmed claims. The audit
   * makes no network call of its own, and the CLI never sets these.
   */
  lookups?: ExportLookups;
  /**
   * Resource cap: how many leaves may be rebuilt checking one export that
   * carries the owner's list as given, file by file (each run rebuilds the
   * whole list). Spent only when the list does not hold, so no member
   * evidence can be derived from it. At least one file is always checked.
   * Default DEFAULT_AS_GIVEN_LEAF_BUDGET.
   */
  asGivenLeafBudget?: number;
}

/** Default for ExportAuditOptions.asGivenLeafBudget: on the order of 15 s of rebuilding on a laptop. */
export const DEFAULT_AS_GIVEN_LEAF_BUDGET = 2_000_000;

/** The claim verifyExport places the owner's list check before, in the same run. */
const LIST_CLAIM_ID = "tree.leaves";
const LIST_CLAIM_BEFORE = "spec.pin";

/**
 * A run's whole claim list, in verifyExport's order: the export's common
 * claims with the run's own claims put back at their positions.
 */
export function exportRunClaims(check: Pick<ExportCheck, "claims">, run: Pick<ExportRun, "claims">): ExportClaimRecord[] {
  const total = check.claims.length + run.claims.length;
  const out: Array<ExportClaimRecord | undefined> = new Array(total);
  for (const own of run.claims) {
    const { position, ...claim } = own;
    if (position >= 0 && position < total && out[position] === undefined) out[position] = claim;
  }
  let next = 0;
  for (let i = 0; i < total; i++) {
    if (out[i] === undefined) out[i] = check.claims[next++];
  }
  return out.filter((c): c is ExportClaimRecord => c !== undefined);
}

/** A run before the export's runs are compared: its whole claim list, claims interned per export. */
interface FullRun {
  file: ExportCoveredFile | null;
  verdict: ExportRun["verdict"];
  claims: ExportClaimRecord[];
  member: ExportRun["member"];
  times: ExportTimes;
  floorCovers: ExportRun["floorCovers"];
  reading: string;
}

interface Match {
  leafIndex: number | null;
  placement: string | null;
  matchedAs: ExportCoveredFile["matchedAs"];
  nameInExport?: string;
  /** Where the leaf came from: the owner's list (tree.leaves) or the member's evidence (tree.member). */
  source: "list" | "member";
}

interface Plan {
  file: ExportFile;
  exp: BitGraphExport | null;
  kind?: ExportCheck["kind"];
  /** Digest (lowercase hex) to the leaf it matches, first in tree order. */
  digests: Map<string, Match>;
  leaves: TreeLeaf[] | null;
  covered: ExportCoveredFile[];
  /** covered, by SHA-256, with where its leaf came from. */
  coveredByHash: Map<string, { covered: ExportCoveredFile; source: Match["source"] }>;
  runs: Map<string, FullRun>;
  unchecked: Map<string, { file: ExportCoveredFile; reason: string }>;
  /** One object per distinct claim, so identical claims across runs cost one copy. */
  intern: Map<string, ExportClaimRecord>;
  /** Set for an owner's export whose list holds: per-file runs derive member evidence from it. */
  fromList?: { tree: MerkleTree; listClaim: ExportClaimRecord };
  /** As-given per-file runs still allowed for an export carrying a list (each rebuilds the whole list). */
  asGivenLeft: number;
  noFileRun?: FullRun;
}

/**
 * Check every export in the bundle with verifyExport, per covered file.
 * Deterministic: exports in observation order, runs in the order of their
 * covered files (sorted by first path).
 */
export async function verifyExports(ingest: IngestResult, options: ExportAuditOptions = {}): Promise<ExportAnalysis> {
  const files = ingest.exports ?? [];
  if (files.length === 0) return { checks: [] };

  const pins: NonNullable<ExportVerifyOptions["pins"]> = {
    ...(options.pcr0 !== undefined ? { pcr0: [...options.pcr0] } : {}),
    ...(options.ceilingWriter !== undefined ? { ceilingWriter: options.ceilingWriter } : {}),
    ...(options.baseChainId !== undefined ? { baseChainId: options.baseChainId } : {}),
  };
  const common: ExportVerifyOptions = {
    pins,
    ...(options.extraSpecHashes !== undefined ? { extraSpecHashes: options.extraSpecHashes } : {}),
    ...(options.lookups !== undefined ? { lookups: options.lookups } : {}),
  };

  const budget = options.asGivenLeafBudget ?? DEFAULT_AS_GIVEN_LEAF_BUDGET;
  const plans = files.map((file) => planExport(file, ingest, budget));

  // Owner exports first check their list once: the per-file runs depend on it.
  for (const plan of plans) {
    if (plan.kind !== "owner" || plan.covered.length === 0 || plan.exp === null) continue;
    const r0 = await runExport(plan, plan.exp, null, common);
    const listClaim = r0.claims.find((c) => c.id === LIST_CLAIM_ID);
    if (listClaim?.result === "TRUE" && plan.leaves !== null) {
      plan.fromList = { tree: new MerkleTree(plan.leaves.map(treeLeafHash)), listClaim };
    } else {
      plan.noFileRun = r0;
    }
  }

  // Every covered file's bytes, read once, whichever exports cover it.
  const byHash = new Map<string, Plan[]>();
  for (const plan of plans) {
    for (const c of plan.covered) {
      const list = byHash.get(c.sha256Hex);
      if (list === undefined) byHash.set(c.sha256Hex, [plan]);
      else list.push(plan);
    }
  }
  for await (const artifact of streamArtifactsByHash(ingest, byHash.keys())) {
    for (const plan of byHash.get(artifact.sha256Hex) ?? []) {
      const entry = plan.coveredByHash.get(artifact.sha256Hex);
      if (entry === undefined || plan.runs.has(artifact.sha256Hex)) continue;
      const run = await runForFile(plan, entry.covered, entry.source, artifact.bytes, common);
      if (run === null) {
        plan.unchecked.set(artifact.sha256Hex, {
          file: entry.covered,
          reason:
            `not checked one by one: checking a file against this export as given rebuilds the owner's whole list ` +
            `(${withCommas(plan.leaves?.length ?? 0)} leaves) each time, and the budget of ${withCommas(budget)} ` +
            `rebuilt leaves ran out; the runs that were made carry the list's own claim (tree.leaves)`,
        });
      } else {
        plan.runs.set(artifact.sha256Hex, run);
      }
    }
  }

  const checks: ExportCheck[] = [];
  for (const plan of plans) {
    for (const c of plan.covered) {
      if (!plan.runs.has(c.sha256Hex) && !plan.unchecked.has(c.sha256Hex)) {
        plan.unchecked.set(c.sha256Hex, { file: c, reason: "not checked: the file's bytes could not be re-read from the bundle" });
      }
    }
    const runs = plan.covered.map((c) => plan.runs.get(c.sha256Hex)).filter((r): r is FullRun => r !== undefined);
    if (runs.length === 0) {
      runs.push(plan.noFileRun ?? (await runExport(plan, plan.exp ?? plan.file.json, null, common)));
    }
    checks.push(assemble(plan, runs));
  }
  return { checks };
}

// ---------------------------------------------------------------------------
// Planning: which bundle files an export covers
// ---------------------------------------------------------------------------

function planExport(file: ExportFile, ingest: IngestResult, budget: number): Plan {
  const plan: Plan = {
    file,
    exp: null,
    digests: new Map(),
    leaves: null,
    covered: [],
    coveredByHash: new Map(),
    runs: new Map(),
    unchecked: new Map(),
    intern: new Map(),
    asGivenLeft: Number.POSITIVE_INFINITY,
  };
  if (file.status !== "ok") return plan;
  const exp = parseExport(file.json);
  if (exp === null) return plan;
  plan.exp = exp;

  const tree = exp.tree as unknown as Record<string, unknown>;
  const hasMember = tree["member"] !== undefined;
  const hasLeaves = tree["leaves"] !== undefined;
  plan.kind = hasLeaves ? "owner" : hasMember ? "member" : "root-only";

  if (hasLeaves) {
    const bytes = typeof tree["leaves"] === "string" ? base64ToBytes(tree["leaves"]) : null;
    const leaves = bytes === null ? null : decodeTreeLeaves(bytes);
    plan.leaves = leaves;
    if (leaves !== null) {
      const names = tree["names"];
      const named = Array.isArray(names) && names.length === leaves.length && names.every((n) => typeof n === "string") ? (names as string[]) : null;
      leaves.forEach((leaf, i) => addLeaf(plan.digests, leaf, i, named?.[i], "list"));
      // Checking as given rebuilds the whole list per file.
      plan.asGivenLeft = Math.max(1, Math.floor(budget / Math.max(1, leaves.length)));
    }
  }
  if (hasMember) {
    // After the list: a digest the list already places keeps the list's leaf, as verifyExport does.
    const ev = parseTreeMemberEvidence(tree["member"]);
    if (ev !== null) addLeaf(plan.digests, ev.leaf, ev.index, undefined, "member");
  }

  for (const artifact of ingest.artifacts) {
    const match = plan.digests.get(artifact.sha256Hex);
    if (match === undefined) continue;
    const covered: ExportCoveredFile = {
      sha256Hex: artifact.sha256Hex,
      paths: [...artifact.paths],
      byteLength: artifact.byteLength,
      leafIndex: match.leafIndex,
      placement: match.placement,
      matchedAs: match.matchedAs,
      ...(match.nameInExport !== undefined ? { nameInExport: match.nameInExport } : {}),
    };
    plan.covered.push(covered);
    plan.coveredByHash.set(artifact.sha256Hex, { covered, source: match.source });
  }
  plan.covered.sort((a, b) => cmp(a.paths[0] ?? "", b.paths[0] ?? "") || cmp(a.sha256Hex, b.sha256Hex));
  return plan;
}

/** Record a leaf's two digests, keeping the first leaf in tree order for each (verifyExport's findIndex). */
function addLeaf(digests: Map<string, Match>, leaf: TreeLeaf, index: number, name: string | undefined, source: Match["source"]): void {
  const artifact = bytesToHex(leaf.artifact);
  const origin = bytesToHex(leaf.origin);
  const placement = LEAF_PLACEMENTS[leaf.placement] ?? null;
  const at = { leafIndex: index, placement, source, ...(name !== undefined ? { nameInExport: name } : {}) };
  if (!digests.has(artifact)) digests.set(artifact, { ...at, matchedAs: artifact === origin ? "as-is" : "committed-bytes" });
  if (origin !== artifact && !digests.has(origin)) digests.set(origin, { ...at, matchedAs: "original" });
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

async function runForFile(
  plan: Plan,
  covered: ExportCoveredFile,
  source: Match["source"],
  bytes: Uint8Array,
  common: ExportVerifyOptions
): Promise<FullRun | null> {
  const exp = plan.exp!;
  if (plan.fromList !== undefined && plan.leaves !== null && source === "list" && covered.leafIndex !== null) {
    // The owner's list holds: derive this file's member evidence from it
    // exactly as verifyExport does internally (the first leaf in tree order
    // whose committed or original digest is the file's, its path in the tree
    // the whole list builds), run on that member form, and put the list's
    // claim back where verifyExport places it. A test holds this equal to the
    // as-given run.
    const k = covered.leafIndex;
    const evidence = buildTreeMemberEvidence(plan.leaves[k]!, k, plan.leaves.length, plan.fromList.tree.path(k));
    const memberForm = { ...exp, tree: { rootDocument: exp.tree.rootDocument, member: evidence } };
    const run = await runExport(plan, memberForm, covered, common, bytes);
    const at = run.claims.findIndex((c) => c.id === LIST_CLAIM_BEFORE);
    run.claims.splice(at < 0 ? run.claims.length : at, 0, plan.fromList.listClaim);
    return run;
  }
  if (plan.leaves !== null) {
    if (plan.asGivenLeft <= 0) return null;
    plan.asGivenLeft--;
  }
  return runExport(plan, exp, covered, common, bytes);
}

/** One verifyExport call. A verifier that throws fails the export closed. */
async function runExport(plan: Plan, input: unknown, file: ExportCoveredFile | null, common: ExportVerifyOptions, bytes?: Uint8Array): Promise<FullRun> {
  let r: ExportVerifyResult;
  try {
    r = await verifyExport(input, bytes !== undefined ? { ...common, bytes } : common);
  } catch (err) {
    const detail = `verifyExport could not complete on this export (${err instanceof Error ? err.message : String(err)}); the audit fails it closed`;
    return {
      file,
      verdict: "FALSE",
      claims: [intern(plan, { id: "verifier", name: "The verifier completed its checks", result: "FALSE", restsOn: "", detail, level: "offline" })],
      member: null,
      times: { floor: null, ceilingBase: null, ceilingEthereum: null },
      floorCovers: null,
      reading: "This export could not be checked: the verifier stopped on it. The audit counts that as a failure.",
    };
  }
  const claims = r.claims.map((c) =>
    intern(plan, { id: c.id, name: c.name, result: c.result, restsOn: c.restsOn, detail: c.detail, level: c.level })
  );
  const isMember = claims.some((c) => c.id === "bytes.member" && c.result === "TRUE");
  return {
    file,
    verdict: r.verdict,
    claims,
    member: r.member === null ? null : { ...r.member },
    times: copyTimes(r.times),
    floorCovers: file === null || !isMember || r.member === null ? null : r.member.placement === "as-is" ? "record" : "content",
    reading: r.reading,
  };
}

function intern(plan: Plan, claim: ExportClaimRecord): ExportClaimRecord {
  const key = claimKey(claim);
  const known = plan.intern.get(key);
  if (known !== undefined) return known;
  plan.intern.set(key, claim);
  return claim;
}

function claimKey(c: ExportClaimRecord): string {
  return `${c.id}\u0000${c.result}\u0000${c.level}\u0000${c.restsOn}\u0000${c.detail}`;
}

function copyTimes(t: ExportVerifyResult["times"]): ExportTimes {
  return {
    floor: t.floor === null ? null : { blockNumber: t.floor.blockNumber, blockHash: t.floor.blockHash, blockTimestamp: t.floor.blockTimestamp },
    ceilingBase:
      t.ceilingBase === null
        ? null
        : { blockNumber: t.ceilingBase.blockNumber, blockHash: t.ceilingBase.blockHash, blockTimestamp: t.ceilingBase.blockTimestamp, provisional: t.ceilingBase.provisional },
    ceilingEthereum:
      t.ceilingEthereum === null
        ? null
        : { blockNumber: t.ceilingEthereum.blockNumber, blockHash: t.ceilingEthereum.blockHash, blockTimestamp: t.ceilingEthereum.blockTimestamp },
  };
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

function assemble(plan: Plan, full: FullRun[]): ExportCheck {
  const { file } = plan;

  // Claims every run states alike (interned: the same object), in the first run's order.
  const inRuns = new Map<ExportClaimRecord, number>();
  for (const run of full) for (const c of new Set(run.claims)) inRuns.set(c, (inRuns.get(c) ?? 0) + 1);
  const isCommon = (c: ExportClaimRecord) => inRuns.get(c) === full.length;
  const claims = full[0]!.claims.filter(isCommon);
  const runs: ExportRun[] = full.map((run) => ({
    file: run.file,
    verdict: run.verdict,
    claims: run.claims.flatMap((c, position): ExportOwnClaim[] => (isCommon(c) ? [] : [{ ...c, position }])),
    member: run.member,
    floorCovers: run.floorCovers,
    reading: run.reading,
  }));

  const failedClaims: string[] = [];
  for (const run of full) {
    for (const c of run.claims) if (c.result === "FALSE" && !failedClaims.includes(c.id)) failedClaims.push(c.id);
  }
  const verdict: ExportCheck["verdict"] =
    failedClaims.length > 0 || full.some((r) => r.verdict === "FALSE")
      ? "FALSE"
      : full.some((r) => r.verdict === "UNDETERMINED")
        ? "UNDETERMINED"
        : "TRUE";
  const status: ExportCheck["status"] = file.status === "ok" ? "checked" : file.status;
  const reason =
    file.status === "malformed"
      ? `declares ${file.format} but lacks an export's structure (a proof object and tree.rootDocument)`
      : file.status === "unsupported-format"
        ? `format "${file.format}" is not bitgraph-export/1`
        : file.status === "too-large"
          ? "opens an export but is larger than the audit's cap for one export's JSON (IngestLimits.maxExportJsonBytes)"
          : undefined;
  return {
    path: file.path,
    fileSha256Hex: file.fileSha256Hex,
    format: file.format,
    status,
    ...(reason !== undefined ? { reason } : {}),
    ...(plan.kind !== undefined ? { kind: plan.kind } : {}),
    ...(file.proofHash !== undefined ? { proofHash: file.proofHash } : {}),
    // A rejected file is never judged TRUE; its exit bit comes from its status.
    verdict: status === "checked" ? verdict : verdict === "FALSE" ? "FALSE" : "UNDETERMINED",
    failedClaims,
    // The time claims do not depend on the file, so every run that completed states the same.
    times: (full.find((r) => !r.claims.some((c) => c.id === "verifier")) ?? full[0]!).times,
    claims,
    files: plan.covered,
    runs,
    ...(plan.kind === "owner" && plan.covered.length > 0 ? { runMode: plan.fromList !== undefined ? ("member-from-list" as const) : ("as-given" as const) } : {}),
    ...(plan.unchecked.size > 0
      ? { unchecked: plan.covered.filter((c) => plan.unchecked.has(c.sha256Hex)).map((c) => plan.unchecked.get(c.sha256Hex)!) }
      : {}),
  };
}

function withCommas(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
