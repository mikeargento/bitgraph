// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * BitGraph for Zapier.
 *
 * A thin adapter over the hosted BitGraph API at bitgraph.ing. Every protocol
 * behaviour lives behind that API, inside the enclave: slot allocation,
 * signing, epochs, counters, and Ethereum anchoring. This package allocates
 * nothing, signs nothing, and constructs no proofs. It hashes the caller's
 * bytes, sends the digest, and reshapes what comes back into fields a Zap can
 * map.
 *
 * The same backend serves three audiences: the HTTP API for developers, the
 * MCP server for AI clients, and this connector for no-code automation. They
 * all record to one ledger, so a file recorded by a Zap is the same proof a
 * developer or an agent would find.
 */

import { version as platformVersion } from "zapier-platform-core";

import authentication from "./authentication";
import createBitGraph from "./creates/create-bitgraph";
import verifyBitGraph from "./creates/verify-bitgraph";
import findProof from "./searches/find-proof";

// Resolved at runtime from the emitted file, which lands at dist/src/index.js,
// so this walks up out of dist to the package root. `zapier push` publishes
// whatever version this reports, so it must come from package.json rather than
// a second copy of the number that can drift away from it.
const packageJson = require("../../package.json") as { version: string };

/**
 * Zapier retries a step when the platform sees a 429 or a throttle error. The
 * client raises ThrottledError for the two cases where a retry is both safe
 * and correct: the rate limiter, and the daily epoch rotation window. Neither
 * mints anything before rejecting, so a retry cannot produce a duplicate
 * recording.
 */
export default {
  version: packageJson.version,
  platformVersion,

  // Zapier otherwise strips empty values and trims strings before a perform
  // sees them. Turning it off keeps what the user mapped and what the step
  // receives identical, which matters here more than usual: these steps decide
  // between "a file was supplied" and "a digest was supplied" by inspecting
  // exactly those fields, and a digest is an encoding where silent whitespace
  // handling is not something to leave to a platform default.
  flags: { cleanInputData: false },

  authentication,

  creates: {
    [createBitGraph.key]: createBitGraph,
    [verifyBitGraph.key]: verifyBitGraph,
  },

  searches: {
    [findProof.key]: findProof,
  },

  triggers: {},
  resources: {},
};
