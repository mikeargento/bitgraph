// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * API key policy for POST /commit.
 *
 * A key answers two independent questions, and the original code conflated
 * them into one switch:
 *
 *   1. May this caller commit at all?        -> REQUIRE_API_KEY
 *   2. Is this caller exempt from the limit? -> API_KEYS
 *
 * Conflated, populating API_KEYS also closed the door on everyone without a
 * key, which made keys impossible to introduce at all: the moment the first
 * one existed, the drop zone, every installed Folder, MCP, and the anchor
 * service would start getting 401s. The anchor service is the fatal one. Stop
 * anchoring and the next epoch never receives its first anchor, at which point
 * the anchor-first gate holds every commit at 503 indefinitely, so the auth
 * change would take the product down more thoroughly than any attacker.
 *
 * Split, keys are additive. Populate API_KEYS and keyed callers get the
 * rate-limit exemption while every other caller keeps working exactly as
 * before. Closing the door becomes a separate, deliberate act.
 *
 * Built as a factory over an env-like object so the policy can be tested
 * across configurations in one process, the same way rate-limit.ts exposes
 * rateLimitConfig().
 */

export interface AuthPolicy {
  /** May this caller commit? False only when a key is required and absent or wrong. */
  allows(authorizationHeader: string | undefined): boolean;
  /** Is this caller exempt from rate limiting? Requires a valid configured key. */
  isExempt(authorizationHeader: string | undefined): boolean;
  /** True when a valid key is mandatory to commit. */
  readonly required: boolean;
  /** How many keys are configured. */
  readonly keyCount: number;
}

export class AuthMisconfigured extends Error {}

function parseKeys(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0)
  );
}

function bearer(header: string | undefined): string | null {
  if (header === undefined || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * @throws {AuthMisconfigured} when a key is required but none are configured,
 * which accepts nobody. That must fail at boot rather than one request at a
 * time, because a boundary that rejects every caller looks identical to an
 * outage from the outside.
 */
export function createAuthPolicy(env: Record<string, string | undefined>): AuthPolicy {
  const keys = parseKeys(env["API_KEYS"]);
  const required = env["REQUIRE_API_KEY"] === "true";

  if (required && keys.size === 0) {
    throw new AuthMisconfigured(
      "REQUIRE_API_KEY=true but API_KEYS is empty. That configuration rejects every caller, " +
        "including the anchor service. Set API_KEYS, or unset REQUIRE_API_KEY."
    );
  }

  const isExempt = (header: string | undefined): boolean => {
    if (keys.size === 0) return false;
    const token = bearer(header);
    return token !== null && keys.has(token);
  };

  return {
    // Note the ordering: the gate is checked first and short-circuits. When no
    // key is required this returns true without ever consulting API_KEYS, which
    // is precisely what keeps keys from becoming a gate by accident.
    allows: (header) => (required ? isExempt(header) : true),
    isExempt,
    required,
    keyCount: keys.size,
  };
}

/** One-line startup summary, so the running policy is visible in the log. */
export function describeAuthPolicy(policy: AuthPolicy): string {
  const exemption =
    policy.keyCount > 0
      ? `${policy.keyCount} API key(s) configured (rate-limit exemption)`
      : "no API_KEYS set, nobody is rate-limit exempt";
  const gate = policy.required
    ? "REQUIRE_API_KEY=true, /commit refuses callers without a valid key"
    : "/commit is open to unauthenticated callers";
  return `${gate}; ${exemption}`;
}
