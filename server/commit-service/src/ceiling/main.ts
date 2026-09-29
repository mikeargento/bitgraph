// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * The ceiling writer process. Configuration is environment only:
 *
 *   CEILING_STATE_DIR       required. Batches, sidecars, cursor, events, costs.
 *   CEILING_QUEUE_PATH      the parent's queue file (default <state>/queue.jsonl).
 *   CEILING_KEY_FILE        required. 0x hex key, mode 600, outside the repo.
 *   CEILING_CHAIN_ID        84532 (Base Sepolia, default) or 8453 (Base mainnet).
 *   CEILING_MAINNET         must be "yes" for 8453. Mainnet is switched on by a person, not a default.
 *   CEILING_RPC_URL         Base RPC (default the chain's public endpoint).
 *   CEILING_ETH_RPC_URL     Ethereum RPC for floor headers (default publicnode).
 *   CEILING_MIN_BALANCE_ETH warn below this balance (default 0.001).
 *   CEILING_TICK_MS         loop interval (default 1000).
 *   CEILING_S3_BUCKET       publish sidecars to s3://<bucket>/ceilings/ (optional).
 *   CEILING_S3_REGION       default us-east-2.
 */

import { join } from "node:path";
import { parseEther, formatEther } from "viem";
import { BaseChain, CHAINS, loadKey } from "./base-chain.js";
import { CeilingWriter } from "./writer.js";

const env = process.env;
const stateDir = env["CEILING_STATE_DIR"];
const keyFile = env["CEILING_KEY_FILE"];
if (!stateDir || !keyFile) {
  console.error("CEILING_STATE_DIR and CEILING_KEY_FILE are required");
  process.exit(2);
}
const chainId = Number(env["CEILING_CHAIN_ID"] ?? 84532);
if (chainId !== 8453 && chainId !== 84532) {
  console.error(`CEILING_CHAIN_ID must be 8453 or 84532, not ${chainId}`);
  process.exit(2);
}
if (chainId === 8453 && env["CEILING_MAINNET"] !== "yes") {
  console.error("Base mainnet needs CEILING_MAINNET=yes, set by the operator on purpose");
  process.exit(2);
}
const account = loadKey(keyFile);
const chain = new BaseChain({
  chainId,
  rpcUrl: env["CEILING_RPC_URL"] ?? CHAINS[chainId].rpcUrls.default.http[0]!,
  ethRpcUrl: env["CEILING_ETH_RPC_URL"] ?? "https://ethereum-rpc.publicnode.com",
  account,
});
const bucket = env["CEILING_S3_BUCKET"];
let publish: ((name: string, json: string) => Promise<void>) | undefined;
if (bucket) {
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({ region: env["CEILING_S3_REGION"] ?? "us-east-2" });
  publish = async (name, json) => {
    await s3.send(new PutObjectCommand({
      Bucket: bucket, Key: `ceilings/${name}`, Body: json, ContentType: "application/json", CacheControl: "no-cache",
    }));
  };
}
const writer = new CeilingWriter({
  ...(publish ? { publish } : {}),
  stateDir,
  queuePath: env["CEILING_QUEUE_PATH"] ?? join(stateDir, "queue.jsonl"),
  chain,
  minBalanceWei: parseEther(env["CEILING_MIN_BALANCE_ETH"] ?? "0.001"),
});

const bal = await chain.balanceWei();
console.log(JSON.stringify({ type: "start", chainId, writer: chain.writer, balanceEth: formatEther(bal), stateDir, publishTo: bucket ? `s3://${bucket}/ceilings/` : null }));

const tickMs = Number(env["CEILING_TICK_MS"] ?? 1000);
let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stopping = true; });
while (!stopping) {
  try {
    await writer.tick();
  } catch (e) {
    console.error(JSON.stringify({ type: "tick-error", error: (e as Error).message.slice(0, 400) }));
  }
  await new Promise((r) => setTimeout(r, tickMs));
}
console.log(JSON.stringify({ type: "stop" }));
