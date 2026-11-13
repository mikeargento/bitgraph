// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The hourly publisher as a service on the host, beside the parent (publisher.ts says what it does).
 *
 * It is not part of the enclave image and does not touch the parent's code: it reads the ledger, writes to Base, and
 * binds each hour's floor through the parent's POST /commit like any client.
 *
 * Env:
 *   PUBLICATION_STATE_DIR       required: where publisher.json lives
 *   PUBLICATION_KEY_FILE        required: the writer's 0x-hex key, mode 600
 *   BASE_RPC_URL                required: a Base JSON-RPC endpoint
 *   BASE_CHAIN_ID               default 8453 (Base mainnet; 84532 for Base Sepolia)
 *   LEDGER_BUCKET, LEDGER_REGION   the ledger (default region us-east-2), as the parent uses
 *   PARENT_URL                  default http://127.0.0.1:8787
 *   PARENT_API_KEY              optional: sent as the bearer key on the floor's POST /commit
 *   PUBLICATION_INTERVAL_MS     default 3600000 (on the hour)
 *   PUBLICATION_REPLACE_BLOCKS  default 30 (a minute on Base)
 *   PUBLICATION_FINAL_GRACE_MS  default 120000
 *   PUBLICATION_FINAL_MAX_WAIT_MS  default 1800000: how long the old epoch's last write waits for its closing BitGraph
 *   PUBLICATION_CONFIRMATIONS   default 10 (20 seconds on Base)
 *   PUBLICATION_TICK_MS         default 15000
 *
 * Run: node --import tsx/esm src/publication/main.ts, or as one file built from the repository root (packages/audit
 * built first, `npm run build` there):
 *
 *   node_modules/.bin/esbuild server/commit-service/src/publication/main.ts --bundle --platform=node --target=node20 \
 *     --format=esm --outfile=server/commit-service/dist-publication/publisher.mjs --external:@aws-sdk/client-s3 \
 *     "--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
 *
 * (No npm script: this service's package.json is copied into the enclave image, so it is left as it is.)
 *
 * Tests: node --import tsx/esm --test src/publication/__tests__/publisher.test.ts src/publication/__tests__/e2e.test.ts
 */

import { BaseChain, loadKey } from "./base.js";
import { s3Line, s3Store, parentBind } from "./ledger.js";
import { Publisher } from "./publisher.js";

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is required`);
  return v;
}
const num = (name: string, dflt: number): number => {
  const v = Number(process.env[name] ?? dflt);
  return Number.isFinite(v) && v > 0 ? v : dflt;
};

const stateDir = need("PUBLICATION_STATE_DIR");
const account = loadKey(need("PUBLICATION_KEY_FILE"));
const chain = new BaseChain({ chainId: num("BASE_CHAIN_ID", 8453), rpcUrl: need("BASE_RPC_URL"), account });
const bucket = need("LEDGER_BUCKET");
const region = process.env["LEDGER_REGION"] || "us-east-2";
const parentUrl = process.env["PARENT_URL"] || "http://127.0.0.1:8787";
const apiKey = process.env["PARENT_API_KEY"] || undefined;

const log = (event: Record<string, unknown>): void => console.log(JSON.stringify({ at: new Date().toISOString(), ...event }));

const publisher = new Publisher({
  stateDir,
  chain,
  line: s3Line({ bucket, region, parentUrl }),
  store: s3Store({ bucket, region }),
  bind: (digestB64) => parentBind(parentUrl, digestB64, apiKey),
  intervalMs: num("PUBLICATION_INTERVAL_MS", 3_600_000),
  replaceAfterBlocks: num("PUBLICATION_REPLACE_BLOCKS", 30),
  finalGraceMs: num("PUBLICATION_FINAL_GRACE_MS", 120_000),
  finalMaxWaitMs: num("PUBLICATION_FINAL_MAX_WAIT_MS", 1_800_000),
  confirmations: num("PUBLICATION_CONFIRMATIONS", 10),
  now: Date.now,
  log,
});

log({ type: "start", writer: chain.writer, chainId: chain.chainId, balanceWei: (await chain.balanceWei().catch(() => -1n)).toString() });

let stopping = false;
const loop = async (): Promise<void> => {
  while (!stopping) {
    try {
      const did = await publisher.tick();
      if (did !== "idle" && did !== "pending") log({ type: "tick", did });
    } catch (e) {
      log({ type: "tick-error", error: (e as Error).message.slice(0, 500) });
    }
    await new Promise((r) => setTimeout(r, num("PUBLICATION_TICK_MS", 15_000)));
  }
};
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stopping = true; });
await loop();
