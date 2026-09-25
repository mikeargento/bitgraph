#!/usr/bin/env node
// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-audit CLI: run the full offline audit pipeline over a bundle
 * and write audit-report.json and/or audit-report.md.
 *
 * Report content goes to files only; stdout carries a short completion
 * line naming the written files and the exit meaning. The CLI performs
 * no network access. Arguments are parsed with plain process.argv
 * handling, no dependency.
 *
 * Exit codes are bit flags (documented in --help and on the ExitFlags
 * type): 0 clean, 1 verification failures (including unsupported-version
 * rejections), 2 chain or authority anomalies, divergences between valid
 * proofs, or anchor witness verification failures, 3 both, 64 usage or
 * input error (no report was produced).
 */

import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { parseCarrier, verifyCarrier } from "@mikeargento/bitgraph-verify";
import type { VerificationPolicy } from "@mikeargento/bitgraph-verify";
import { auditToolVersion, computeExitFlags, runAudit } from "./audit.js";
import { buildJsonReport } from "./report-json.js";
import { buildMarkdownReport } from "./report-md.js";
import type { ExitFlags } from "./types.js";

const USAGE_EXIT_CODE = 64;

/** The 14 fields of the canonical VerificationPolicy (verify package, G7). */
const KNOWN_POLICY_FIELDS: readonly string[] = [
  "requireEnforcement",
  "allowedMeasurements",
  "allowedPublicKeys",
  "requireAttestation",
  "requireAttestationFormat",
  "minCounter",
  "maxCounter",
  "minTime",
  "maxTime",
  "requireEpochId",
  "requireActor",
  "allowedActorKeyIds",
  "allowedActorProviders",
  "requireSlot",
];

class UsageError extends Error {}

const USAGE_LINE =
  "Usage: bitgraph-audit <path-to-bundle> [--out <dir>] [--format json,md] [--trust-policy <path>]";

function helpText(): string {
  return [
    `bitgraph-audit ${auditToolVersion()}: offline audit of BitGraph proof bundles.`,
    "",
    USAGE_LINE,
    "",
    "The bundle may be a directory, a .tar archive, a .tar.gz/.tgz,",
    "or a single bitgraph-carrier/1 file (a file with its proof inside):",
    "a carrier is unpacked and audited as the bundle it carries, and its",
    "own verdict (TRUE / FALSE / UNDETERMINED, with the time window) is",
    "printed first.",
    "archive. The audit runs entirely offline: no RPC, no HTTP, no DNS.",
    "",
    "Options:",
    "  --out <dir>            Directory to write the report files into",
    "                         (default: current directory; created if missing).",
    "  --format <list>        Comma-separated formats to write: json, md",
    "                         (default: json,md). json writes audit-report.json;",
    "                         md writes audit-report.md.",
    "  --trust-policy <path>  JSON file parsed as the canonical",
    "                         VerificationPolicy and applied at both",
    "                         verification tiers. Valid fields:",
    `                         ${KNOWN_POLICY_FIELDS.join(", ")}.`,
    "                         Any other field is an error.",
    "  --help, -h             Print this help and exit 0.",
    "",
    "Exit codes (bit flags):",
    "  0   Clean: no verification failures, no chain anomalies, no",
    "      divergences.",
    "  1   Verification failures: at least one proof failed its canonical",
    "      cryptographic checks at either tier, or at least one",
    "      proof-shaped input was rejected as an unsupported version",
    "      (only bitgraph/1 is supported). A proof whose artifact bytes",
    "      are absent from the bundle is NOT a failure by itself: its",
    "      bytes-free checks decide, unless a supplied trust policy makes",
    "      them fail (for example requireSlot), in which case it counts",
    "      here.",
    "  2   Chain or authority anomalies, divergences between valid proofs,",
    "      or anchor witness verification failures: unexplained counter",
    "      positions, chain breaks, collisions, cross-kind position reuse,",
    "      forks, authority changes inside an epoch, epoch link anomalies,",
    "      or a supplied anchor witness that fails its offline verification",
    "      (block-hash mismatch, digest binding, block number, header or",
    "      RLP malformation, an invalid candidate anchor, or an unmatched",
    "      witness). Benign findings are reported but never set exit bits:",
    "      duplicate copies, manifest advisories, unsafe paths, embedded",
    "      proofHash mismatches, and informational anchor findings (unsigned",
    "      metadata disagreements, metadata-only anchor claims, and",
    "      unparseable anchor titles, all overridden by the signed body).",
    "  3   Both 1 and 2.",
    "  64  Usage or input error: unknown option, unreadable bundle, or",
    "      invalid trust policy. No report was produced.",
    "",
    "Attestation validation results are always reported in full but never",
    "change the exit code on their own: an invalid attestation document on",
    "an otherwise verified proof is reported without affecting the exit",
    "code, and counts under exit bit 1 only when a supplied trust policy",
    "made verification itself fail.",
  ].join("\n");
}

interface ParsedArgs {
  bundlePath: string;
  outDir: string;
  formats: ReadonlySet<"json" | "md">;
  trustPolicyPath?: string;
}

function parseArgs(argv: string[]): ParsedArgs | "help" {
  let bundlePath: string | undefined;
  let outDir = ".";
  let formats: Set<"json" | "md"> = new Set(["json", "md"]);
  let trustPolicyPath: string | undefined;

  const takeValue = (flag: string, index: number): string => {
    const value = argv[index + 1];
    if (value === undefined) throw new UsageError(`${flag} requires a value.`);
    return value;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--help" || arg === "-h") return "help";
    if (arg === "--out") {
      outDir = takeValue(arg, i);
      i++;
    } else if (arg === "--format") {
      const raw = takeValue(arg, i);
      i++;
      const parts = raw
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      if (parts.length === 0) throw new UsageError("--format requires at least one of: json, md.");
      formats = new Set();
      for (const part of parts) {
        if (part !== "json" && part !== "md") {
          throw new UsageError(`unknown format "${part}". Valid formats: json, md.`);
        }
        formats.add(part);
      }
    } else if (arg === "--trust-policy") {
      trustPolicyPath = takeValue(arg, i);
      i++;
    } else if (arg.startsWith("-")) {
      throw new UsageError(`unknown option "${arg}".`);
    } else if (bundlePath === undefined) {
      bundlePath = arg;
    } else {
      throw new UsageError("more than one bundle path was given.");
    }
  }

  if (bundlePath === undefined) throw new UsageError("missing bundle path.");
  return {
    bundlePath,
    outDir,
    formats,
    ...(trustPolicyPath !== undefined ? { trustPolicyPath } : {}),
  };
}

function loadTrustPolicy(path: string): VerificationPolicy {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new UsageError(
      `cannot read trust policy file "${path}": ${err instanceof Error ? err.message : String(err)}`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UsageError(`trust policy file "${path}" is not valid JSON.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new UsageError("trust policy must be a JSON object.");
  }
  const unknown = Object.keys(parsed).filter((key) => !KNOWN_POLICY_FIELDS.includes(key));
  if (unknown.length > 0) {
    throw new UsageError(
      `unknown trust policy ${unknown.length === 1 ? "field" : "fields"}: ` +
        `${unknown.join(", ")}. Valid fields: ${KNOWN_POLICY_FIELDS.join(", ")}.`
    );
  }
  return parsed as VerificationPolicy;
}

function exitMeaning(flags: ExitFlags): string {
  if (flags.code === 0) return "clean: no verification failures, no chain anomalies, no divergences";
  const parts: string[] = [];
  if (flags.verificationFailures) parts.push("verification failures");
  if (flags.chainAnomaliesOrDivergences) {
    parts.push("chain anomalies, divergences, or anchor witness verification failures");
  }
  return parts.join("; ");
}

async function main(): Promise<number> {
  let parsed: ParsedArgs | "help";
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`bitgraph-audit: ${err.message}\n${USAGE_LINE}\nSee --help for details.\n`);
      return USAGE_EXIT_CODE;
    }
    throw err;
  }
  if (parsed === "help") {
    process.stdout.write(helpText() + "\n");
    return 0;
  }

  let trustAnchors: VerificationPolicy | undefined;
  try {
    if (parsed.trustPolicyPath !== undefined) {
      trustAnchors = loadTrustPolicy(parsed.trustPolicyPath);
    }
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`bitgraph-audit: ${err.message}\n${USAGE_LINE}\nSee --help for details.\n`);
      return USAGE_EXIT_CODE;
    }
    throw err;
  }

  /* A single carrier file: unpack it to a temp bundle (the committed bytes,
     the proof, the floor anchor and witness, the ceiling pair when present)
     and audit THAT, after printing the carrier's own offline verdict. The
     temp dir is the audit's input, so the reports describe exactly what the
     file carries; everything else about the run is unchanged. Detection is
     from the last 8 bytes only, so no ordinary bundle path changes behaviour. */
  let bundlePath = parsed.bundlePath;
  let carrierFlags = 0;
  try {
    const info = await stat(parsed.bundlePath);
    const lower = parsed.bundlePath.toLowerCase();
    const isArchive = lower.endsWith(".tar") || lower.endsWith(".tar.gz") || lower.endsWith(".tgz");
    if (info.isFile() && !isArchive && info.size >= 26) {
      const bytes = new Uint8Array(readFileSync(parsed.bundlePath));
      const parsedCarrier = parseCarrier(bytes);
      if (parsedCarrier.kind !== "none") {
        const verdict = await verifyCarrier(bytes);
        const b = verdict.bounds;
        // The floor is temporal (after the block's own time, cryptographically).
        // The ceiling is POSITIONAL: the commit precedes the ANCHORING of the
        // later block, never that block's mine time, because an anchor is
        // built after the block it carries. Canon: floor in time, ceiling in
        // position; a block's clock never reads as an upper bound.
        const lines = [
          `carrier: ${verdict.verdict}${verdict.carrier === "corrupt" ? " (block unreadable: corrupted, not judged)" : ""}`,
          b ? `  no earlier than: block ${b.notBefore.blockNumber}${b.notBefore.timestamp !== null ? ` (mined ${new Date(b.notBefore.timestamp * 1000).toISOString()})` : ""}` : null,
          b ? `  committed before: ${b.notAfter === null ? "NOT FETCHED (the closing anchor is not inside this file)" : `the anchoring of block ${b.notAfter.blockNumber}${b.notAfter.timestamp !== null ? ` (that block mined ${new Date(b.notAfter.timestamp * 1000).toISOString()})` : ""}`}` : null,
          ...verdict.reasons.map((r) => `  - ${r}`),
        ].filter((l): l is string => l !== null);
        process.stdout.write(lines.join("\n") + "\n");
        if (verdict.verdict === "FALSE") carrierFlags |= 1;
        if (verdict.carrier === "corrupt") carrierFlags |= 2;
        if (parsedCarrier.kind === "carrier") {
          const dir = await mkdtemp(join(tmpdir(), "bitgraph-carrier-"));
          const name = basename(parsed.bundlePath).replace(/\.bitgraph(\.[^.]+)$/i, "$1").replace(/\.bitgraph$/i, "") || "artifact";
          await writeFile(join(dir, name), parsedCarrier.inner);
          await writeFile(join(dir, "proof.json"), JSON.stringify(parsedCarrier.payload.proof, null, 2));
          const anchors = join(dir, "ethereum-anchors");
          await mkdir(anchors);
          await writeFile(join(anchors, "anchor-floor.json"), JSON.stringify(parsedCarrier.payload.floor.anchor, null, 2));
          await writeFile(join(anchors, "anchor-floor.witness.json"), JSON.stringify({ version: "bitgraph-anchor-witness/1", ...parsedCarrier.payload.floor.witness }, null, 2));
          if (parsedCarrier.payload.ceiling.status === "present") {
            await writeFile(join(anchors, "anchor-ceiling.json"), JSON.stringify(parsedCarrier.payload.ceiling.anchor, null, 2));
            await writeFile(join(anchors, "anchor-ceiling.witness.json"), JSON.stringify({ version: "bitgraph-anchor-witness/1", ...parsedCarrier.payload.ceiling.witness }, null, 2));
          }
          bundlePath = dir;
        }
      }
    }
  } catch (err) {
    // Detection must never take down an ordinary audit: fall through whole.
    process.stderr.write(`bitgraph-audit: carrier detection skipped: ${err instanceof Error ? err.message : String(err)}\n`);
  }

  let result;
  try {
    result = await runAudit(
      bundlePath,
      trustAnchors !== undefined ? { trustAnchors } : undefined
    );
  } catch (err) {
    process.stderr.write(
      `bitgraph-audit: cannot audit "${parsed.bundlePath}": ` +
        `${err instanceof Error ? err.message : String(err)}\n`
    );
    return USAGE_EXIT_CODE;
  }

  await mkdir(parsed.outDir, { recursive: true });
  const written: string[] = [];
  if (parsed.formats.has("json")) {
    const path = join(parsed.outDir, "audit-report.json");
    await writeFile(path, JSON.stringify(buildJsonReport(result), null, 2) + "\n", "utf8");
    written.push(path);
  }
  if (parsed.formats.has("md")) {
    const path = join(parsed.outDir, "audit-report.md");
    await writeFile(path, buildMarkdownReport(result), "utf8");
    written.push(path);
  }

  const flags = computeExitFlags(result);
  // A carrier target folds its own verdict into the same two bits.
  if (carrierFlags & 1) { flags.verificationFailures = true; }
  if (carrierFlags & 2) { flags.chainAnomaliesOrDivergences = true; }
  flags.code = flags.code | carrierFlags;
  process.stdout.write(
    `bitgraph-audit ${auditToolVersion()}: wrote ${written.join(", ")}\n` +
      `exit ${flags.code}: ${exitMeaning(flags)}\n`
  );
  return flags.code;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(
      `bitgraph-audit: unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`
    );
    process.exitCode = USAGE_EXIT_CODE;
  }
);
