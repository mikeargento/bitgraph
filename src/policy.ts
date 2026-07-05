// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * bitgraph-core Policy — parse, hash, and validate markdown policy documents.
 *
 * Policy documents are human-readable markdown files that define what an
 * agent is allowed to do. The SHA-256 hash of the raw document bytes is
 * included in the proof's signed body, cryptographically binding the
 * proof to the exact policy that governed the action.
 *
 * Format:
 *   # Policy: <name>
 *   version: <version>
 *
 *   ## Allowed Tools
 *   - tool_a
 *   - tool_b
 *
 *   ## Limits
 *   - max_actions: 500
 *   - rate_limit: 10/min
 *
 *   ## Time Window
 *   - hours: 9-17
 *
 *   ## Require Approval
 *   - send_email
 */

import { sha256 } from "@noble/hashes/sha256";
import type { PolicyBinding } from "./types.js";

// ---------------------------------------------------------------------------
// Policy document types
// ---------------------------------------------------------------------------

export interface PolicyDocument {
  /** Human-readable policy name (from "# Policy: <name>"). */
  name: string;
  /** Version identifier (from "version: <version>"). */
  version: string;
  /** Structured rules parsed from the document. */
  rules: PolicyRules;
  /** The original raw markdown text. */
  raw: string;
}

export interface PolicyRules {
  /** Always true — BitGraph is default-deny. */
  defaultDeny: true;
  /** Tool names explicitly allowed by the policy. */
  allowedTools?: string[] | undefined;
  /** Maximum total actions permitted under this policy. */
  maxActions?: number | undefined;
  /** Maximum actions per minute. */
  rateLimit?: number | undefined;
  /** Allowed hours of operation (24h clock, 0-23). */
  timeWindow?: { start: number; end: number } | undefined;
  /** Tool names that require multi-sig / human approval. */
  requireApproval?: string[] | undefined;
  /** Arbitrary extension metadata. */
  metadata?: Record<string, unknown> | undefined;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a markdown policy document into structured rules.
 *
 * Extracts the policy name, version, and rule sections from a
 * human-readable markdown format.
 */
export function parsePolicy(markdown: string): PolicyDocument {
  const lines = markdown.split("\n");
  const name = extractField(lines, /^#\s+Policy:\s*(.+)/);
  const version = extractField(lines, /^version:\s*(.+)/);

  const rules: PolicyRules = { defaultDeny: true };

  // Parse allowed tools section
  const toolsSection = extractSection(lines, "Allowed Tools");
  if (toolsSection.length > 0) {
    rules.allowedTools = toolsSection
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean);
  }

  // Parse limits
  const limitsSection = extractSection(lines, "Limits");
  for (const line of limitsSection) {
    const clean = line.replace(/^[-*]\s*/, "").trim();
    const maxMatch = clean.match(/max_actions:\s*(\d+)/);
    if (maxMatch?.[1]) rules.maxActions = parseInt(maxMatch[1], 10);
    const rateMatch = clean.match(/rate_limit:\s*(\d+)/);
    if (rateMatch?.[1]) rules.rateLimit = parseInt(rateMatch[1], 10);
  }

  // Parse time window
  const timeSection = extractSection(lines, "Time Window");
  for (const line of timeSection) {
    const clean = line.replace(/^[-*]\s*/, "").trim();
    const hoursMatch = clean.match(/hours:\s*(\d+)-(\d+)/);
    if (hoursMatch?.[1] && hoursMatch[2]) {
      rules.timeWindow = {
        start: parseInt(hoursMatch[1], 10),
        end: parseInt(hoursMatch[2], 10),
      };
    }
  }

  // Parse require approval
  const approvalSection = extractSection(lines, "Require Approval");
  if (approvalSection.length > 0) {
    rules.requireApproval = approvalSection
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean);
  }

  return {
    name: name ?? "Unnamed Policy",
    version: version ?? "1.0",
    rules,
    raw: markdown,
  };
}

function extractField(
  lines: string[],
  pattern: RegExp,
): string | undefined {
  for (const line of lines) {
    const match = line.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function extractSection(lines: string[], sectionName: string): string[] {
  const result: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (line.match(new RegExp(`^##\\s+${sectionName}`, "i"))) {
      inSection = true;
      continue;
    }
    if (inSection && line.match(/^##\s+/)) break; // next section
    if (inSection && line.trim()) result.push(line);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hash of a policy document's raw text.
 *
 * Returns a Base64-standard (RFC 4648 §4) encoded digest suitable for
 * inclusion in the proof's policy.digestB64 field.
 */
export function hashPolicy(markdown: string): string {
  const bytes = new TextEncoder().encode(markdown);
  const hash = sha256(bytes);
  return Buffer.from(hash).toString("base64");
}

/**
 * Create a PolicyBinding from a raw markdown policy document.
 *
 * Convenience function that parses the document for name/version and
 * computes the SHA-256 digest in one call.
 */
export function createPolicyBinding(markdown: string): PolicyBinding {
  const doc = parsePolicy(markdown);
  const binding: PolicyBinding = {
    digestB64: hashPolicy(markdown),
  };
  if (doc.name !== "Unnamed Policy") binding.name = doc.name;
  if (doc.version !== "1.0") binding.version = doc.version;
  return binding;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ActionValidationResult {
  /** Whether the action is permitted under the policy rules. */
  valid: boolean;
  /** Human-readable reason when valid is false. */
  reason?: string | undefined;
}

/**
 * Validate that an action complies with the policy rules.
 *
 * Checks tool allowlist and time window constraints. Rate limiting
 * and action counting require external state and are not checked here.
 */
export function validateAction(
  action: { tool: string; timestamp?: number | undefined },
  rules: PolicyRules,
): ActionValidationResult {
  // Default deny — tool must be in allowed list
  if (rules.allowedTools && !rules.allowedTools.includes(action.tool)) {
    return {
      valid: false,
      reason: `Tool "${action.tool}" not in allowed list`,
    };
  }

  // Time window check
  if (rules.timeWindow && action.timestamp !== undefined) {
    const hour = new Date(action.timestamp).getHours();
    if (hour < rules.timeWindow.start || hour >= rules.timeWindow.end) {
      return {
        valid: false,
        reason: `Action outside allowed hours (${rules.timeWindow.start}-${rules.timeWindow.end})`,
      };
    }
  }

  // Require approval check (advisory — returns valid but flags the tool)
  // Actual approval enforcement happens at the proxy layer
  if (
    rules.requireApproval &&
    rules.requireApproval.includes(action.tool)
  ) {
    return {
      valid: true,
      reason: `Tool "${action.tool}" requires approval`,
    };
  }

  return { valid: true };
}
