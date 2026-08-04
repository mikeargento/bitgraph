// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * BitGraph connection for Zapier.
 *
 * Uses the API's existing credential model: a bearer token checked at the
 * commit boundary, whose effect is exemption from the digest-denominated rate
 * limiter. Reads are served from the ledger and take no credential, so the key
 * is only ever sent on writes (see BitGraphClient.writeHeaders).
 *
 * Why the key exists here even though the API accepts anonymous writes: every
 * Zapier customer's traffic leaves through Zapier's own egress addresses, so
 * without a key they all share ONE per-IP bucket (5000 digests, refilling
 * 20/minute). One busy account would throttle everyone else. A key per
 * customer is what keeps them separate.
 *
 * It is OPTIONAL, not required, and that is deliberate. The field was
 * `required: true` until 2026-08-03, which made it the first thing a new user
 * hit and an impossible one: no issuance mechanism exists, and the boundary
 * does not check keys at all today (`REQUIRE_API_KEY` off, `API_KEYS` unset),
 * so a key grants only a rate-limit exemption that is currently nobody's to
 * grant. A mandatory field with no obtainable value is a dead end, and the
 * public invite link on /docs/automation leads straight into it. Make this
 * required again only in the same change that ships real key issuance.
 */

import type { Bundle, ZObject } from "zapier-platform-core";
import { DEFAULT_BASE_URL, baseUrl } from "./lib/client";

/**
 * Connection test.
 *
 * Posts an empty digests array to the real commit endpoint. That request
 * passes through the identical auth check a real recording does and then fails
 * validation, so it proves the credential end to end while minting nothing:
 * the boundary checks the key before it looks at the body, and rejects an
 * empty array after. Recordings are permanent, so a connection test must not
 * be capable of creating one.
 */
const test = async (z: ZObject, bundle: Bundle) => {
  const base = baseUrl(bundle);
  const apiKey = (bundle.authData?.["apiKey"] ?? "").trim();

  const response = await z.request({
    method: "POST",
    url: `${base}/api/commit`,
    headers: {
      "Content-Type": "application/json",
      ...(apiKey.length > 0 ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ digests: [] }),
    skipThrowForStatus: true,
    timeout: 30_000,
  });

  if (response.status === 401 || response.status === 403) {
    throw new z.errors.Error(
      "BitGraph did not accept that API key.",
      "AuthenticationError",
      response.status
    );
  }

  // 400 is the expected answer: the key was accepted and the empty batch was
  // then rejected by validation. 503 is the daily epoch rotation window, which
  // says the endpoint is alive and the key was not the problem.
  if (response.status === 400 || response.status === 503 || (response.status >= 200 && response.status < 300)) {
    return { connected: true, endpoint: base };
  }

  throw new z.errors.Error(
    `Could not reach BitGraph at ${base} (HTTP ${response.status}).`,
    "ConnectionError",
    response.status
  );
};

export default {
  type: "custom" as const,
  test,

  fields: [
    {
      key: "apiKey",
      label: "API Key",
      type: "password" as const,
      required: false,
      // The link satisfies Zapier's D002 check, which wants each auth field to
      // point at documentation rather than explain itself in a tooltip alone.
      // It is a publishing task for the App Directory, not just advice.
      helpText:
        "Optional. Leave this blank to record at the shared rate limit. A key exempts your " +
        "recordings from it, so your account gets its own budget rather than competing with " +
        "other Zapier users for one. Keys are not being issued yet. " +
        "[How this works](https://bitgraph.ing/docs/automation)",
    },
    {
      key: "baseUrl",
      label: "API Endpoint",
      type: "string" as const,
      required: false,
      default: DEFAULT_BASE_URL,
      helpText:
        "Leave as is unless you run your own BitGraph boundary. Must be the canonical apex host, " +
        "with no trailing slash. [Running your own](https://bitgraph.ing/docs/self-host-tee)",
    },
  ],

  // Shown on the connection in the Zap editor, so someone with a production
  // and a staging connection can tell them apart at a glance. Interpolates a
  // field from the test's return value, which is what makes it a real label
  // rather than a constant.
  connectionLabel: "{{endpoint}}",
};
