// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The epoch's closing BitGraph (server.ts, bindEpochEnd): the note it binds, and where the nightly rotation leaves the
 * request for it.
 *
 * The note depends only on the epoch id, so anyone can rebuild it and check it against the epoch's last proof; the
 * ledger does exactly that to label the row (website/src/components/ledger-rows.tsx, epochEndText). The two must stay
 * byte for byte the same.
 */

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const EPOCH_END_FORMAT = "bitgraph-epoch-end/1";

/** The closing note for an epoch, by its id in standard base64: 2-space JSON and a final newline. */
export function epochEndFileText(epochId: string): string {
  return JSON.stringify({
    format: EPOCH_END_FORMAT,
    epochId,
    note: "The last BitGraph of this epoch. Nothing is bound after it: the enclave stops and its key is gone.",
  }, null, 2) + "\n";
}

/** The close request the rotation leaves for an epoch: <dir>/<id in URL-safe base64, no padding>.request.json. */
export function closeRequestPath(dir: string, epochId: string): string {
  return join(dir, `${epochId.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.request.json`);
}

/**
 * The publish request for an epoch (ceiling/publish.ts reads it): the closing BitGraph's chain hash, which the writer
 * puts on Base as "BGP1" + epoch id + hash. The format string must match EPOCH_PUBLISH_REQUEST_FORMAT there.
 */
export const EPOCH_PUBLISH_REQUEST_FORMAT = "bitgraph-epoch-publish-request/1";

export function writePublishRequest(dir: string, epochId: string, closingChainHashB64: string, closingCounter: string, now: Date = new Date()): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${epochId.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.request.json`);
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify({ format: EPOCH_PUBLISH_REQUEST_FORMAT, epochId, closingChainHashB64, closingCounter, requestedAt: now.toISOString() }, null, 2) + "\n", { mode: 0o644 });
  renameSync(tmp, path);
  return path;
}
