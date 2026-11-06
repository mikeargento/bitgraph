// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Check a closed roll's write from the ceiling writer's state directory (src/ceiling/roll-check.ts). Read-only.
 *
 *   node --import tsx/esm scripts/roll-check.ts --state /path/to/ceiling-state
 *        [--queue path]        the parent's queue file (default <state>/queue.jsonl)
 *        [--epoch <epoch id>]  the epoch to check (default: the epoch of the newest write)
 *        [--writer 0x...]      compare the sender with this address
 *        [--rpc URL]           also ask this Base node what the transaction holds (e.g. https://mainnet.base.org)
 *        [--json]
 *
 * Run it on the writer's host, or on a copy of the state directory. Exit 0 PASS, 1 FAIL, 2 could not run.
 */

import { checkRoll, formatRollReport } from "../src/ceiling/roll-check.js";

const argv = process.argv.slice(2);
const flag = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1] : undefined; };

const stateDir = flag("state") ?? process.env["CEILING_STATE_DIR"];
if (!stateDir) { console.error("give --state <the writer's state directory> (or set CEILING_STATE_DIR)"); process.exit(2); }
const rpc = flag("rpc");

async function onChain(txHash: string) {
  const res = await fetch(rpc!, {
    method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: [txHash] }),
  });
  const t = ((await res.json()) as { result?: { from?: string; to?: string | null; input?: string; blockHash?: string | null; blockNumber?: string | null } | null }).result;
  if (!t) return null;
  return { from: t.from ?? "", to: t.to ?? null, input: t.input ?? "", blockHash: t.blockHash ?? null, blockNumber: t.blockNumber ? parseInt(t.blockNumber, 16) : null };
}

try {
  const queuePath = flag("queue") ?? process.env["CEILING_QUEUE_PATH"];
  const epochId = flag("epoch");
  const writer = flag("writer");
  const report = await checkRoll({
    stateDir,
    ...(queuePath ? { queuePath } : {}),
    ...(epochId ? { epochId } : {}),
    ...(writer ? { writer } : {}),
    ...(rpc ? { onChain } : {}),
  });
  process.stdout.write(argv.includes("--json") ? JSON.stringify(report, null, 2) + "\n" : formatRollReport(report));
  process.exit(report.ok ? 0 : 1);
} catch (e) {
  console.error(`could not run: ${(e as Error).message}`);
  process.exit(2);
}
