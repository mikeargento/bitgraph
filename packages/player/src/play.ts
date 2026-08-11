// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * One-call evaluation: play(rulePath, bundlePath) -> verdict.
 *
 * This is the whole pipeline in one place — read, parse, audit, resolve,
 * evaluate, build, serialize — so the CLI and every embedder run the SAME
 * composition and cannot drift apart. `playAudit` is the pure tail of the
 * pipeline over an already-obtained AuditResult; `play` is the thin
 * filesystem front.
 *
 * Errors are typed by stage so a caller can say exactly what failed:
 * RuleError for an invalid rule, PlayError("rule-read") when the rule
 * file cannot be read, PlayError("audit") when bundle ingest fails.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runAudit } from "@mikeargento/bitgraph-audit";
import type { AuditResult } from "@mikeargento/bitgraph-audit";
import { resolveCast } from "./cast.js";
import { evaluate } from "./evaluate.js";
import { parseRule } from "./rule.js";
import type { Rule, Verdict } from "./types.js";
import { buildVerdict, serializeVerdict } from "./verdict.js";

export type PlayStage = "rule-read" | "audit";

export class PlayError extends Error {
  readonly stage: PlayStage;
  constructor(stage: PlayStage, message: string, cause: unknown) {
    super(message, { cause });
    this.name = "PlayError";
    this.stage = stage;
  }
}

export interface PlayResult {
  verdict: Verdict;
  /** serializeVerdict(verdict): the byte-identical reproduction target. */
  bytes: string;
  /** SPEC section 8 mapping of verdict.result: 0 TRUE, 1 FALSE, 2 UNDETERMINED. */
  exitCode: 0 | 1 | 2;
  /** The audit the verdict was evaluated over, for callers that want the evidence. */
  audit: AuditResult;
}

/** The pure tail of the pipeline: no filesystem, no network. */
export function playAudit(rule: Rule, ruleSha256Hex: string, audit: AuditResult): PlayResult {
  const resolutions = resolveCast(rule.cast, audit);
  const evaluation = evaluate(rule, resolutions, audit);
  const verdict = buildVerdict(rule, ruleSha256Hex, resolutions, evaluation, audit);
  const exitCode = evaluation.result === "TRUE" ? 0 : evaluation.result === "FALSE" ? 1 : 2;
  return { verdict, bytes: serializeVerdict(verdict), exitCode, audit };
}

/**
 * Evaluate a rule file against a bundle (directory, .tar, .tar.gz, or
 * .tgz). Offline past the filesystem reads; throws RuleError or PlayError.
 */
export async function play(rulePath: string, bundlePath: string): Promise<PlayResult> {
  let ruleBytes: Buffer;
  try {
    ruleBytes = readFileSync(rulePath);
  } catch (err) {
    throw new PlayError("rule-read", `cannot read rule file: ${(err as Error).message}`, err);
  }
  const ruleSha256Hex = createHash("sha256").update(ruleBytes).digest("hex");
  const rule = parseRule(ruleBytes.toString("utf8"));

  let audit: AuditResult;
  try {
    audit = await runAudit(bundlePath);
  } catch (err) {
    throw new PlayError("audit", `bundle audit failed: ${(err as Error).message}`, err);
  }
  return playAudit(rule, ruleSha256Hex, audit);
}
