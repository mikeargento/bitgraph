#!/usr/bin/env node
// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

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
 * rejections), 2 chain anomalies or divergences between valid proofs,
 * 3 both, 64 usage or input error (no report was produced).
 */

import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
    "The bundle may be a directory, a .tar archive, or a .tar.gz/.tgz",
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
    "  2   Chain anomalies or divergences between valid proofs:",
    "      unexplained counter positions, chain breaks, collisions,",
    "      forks, authority changes inside an epoch, or epoch link",
    "      anomalies. Benign ingest findings (duplicate copies, manifest",
    "      advisories, unsafe paths, embedded proofHash mismatches) are",
    "      reported but never set exit bits.",
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
    parts.push("chain anomalies or divergences between valid proofs");
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

  let result;
  try {
    result = await runAudit(
      parsed.bundlePath,
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
