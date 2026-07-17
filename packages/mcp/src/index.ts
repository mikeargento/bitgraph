#!/usr/bin/env node
// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * @mikeargento/bitgraph-mcp: stdio entry point.
 *
 * Environment:
 *   BITGRAPH_API_URL  optional, defaults to https://bitgraph.ing
 *   BITGRAPH_API_KEY  optional; sent as a Bearer token on recordings
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { configFromEnv } from "./api.js";
import { buildServer, SERVER_VERSION } from "./server.js";

async function main(): Promise<void> {
  const config = configFromEnv();
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio servers must never write to stdout; stderr only.
  console.error(
    `bitgraph-mcp ${SERVER_VERSION} running (endpoint: ${config.baseUrl}, api key: ${config.apiKey ? "set" : "not set"})`
  );
}

main().catch((err) => {
  console.error("bitgraph-mcp failed to start:", err);
  process.exit(1);
});
