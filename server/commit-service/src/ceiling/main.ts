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
 *   CEILING_SETTLEMENT      "off" to skip settlement on Ethereum. On by default on Base mainnet
 *                           (the only chain whose batcher pins are built in); never on elsewhere.
 *   CEILING_L1_RPC_URL      Ethereum RPC for settlement (default publicnode).
 *   CEILING_BEACON_URL      Ethereum beacon API for blob sidecars (default publicnode).
 *   CEILING_SETTLEMENT_BUDGET_MS  Wall-clock budget of one settlement pass (default 10000).
 *   CEILING_OUTPUT_ROOT     "off" to skip settlement through Base's output root (bitgraph-output-root/1,
 *                           output-root-settler.ts, whose header is the operator note). On by default on
 *                           Base mainnet, never elsewhere. It runs beside the blob settlement above.
 *   CEILING_BASE_RPC_URLS   comma-separated Base RPCs for it, asked in turn with fallback (default
 *                           CEILING_RPC_URL, else https://mainnet.base.org). eth_getProof must reach P.
 *   CEILING_L1_RPC_URLS     comma-separated Ethereum RPCs for its claims (default CEILING_L1_RPC_URL,
 *                           else https://ethereum-rpc.publicnode.com).
 *   CEILING_BASE_RPC_INTERVAL_MS, CEILING_L1_RPC_INTERVAL_MS
 *                           least time between two requests to one endpoint (default 1000 and 100;
 *                           mainnet.base.org rate-limits eth_getProof even at 1.5 s, and a capture resumes).
 */

import { join } from "node:path";
import { parseEther, formatEther } from "viem";
import { BASE_MAINNET_SETTLEMENT_PINS } from "@mikeargento/bitgraph-verify";
import { BaseChain, CHAINS, loadKey } from "./base-chain.js";
import { createSettlementCache, findSettlement, settlementEndpointsFromEnv, DEFAULT_L1_RPC } from "./settlement.js";
import { CeilingWriter, type WriterSettlementOptions } from "./writer.js";
import { OUTPUT_ROOT_PREFIX, type CreateOnlyStore, type OutputRootOptions } from "./output-root-settler.js";
import { endpointList, endpointOrigin, rpcPool } from "./rpc-pool.js";

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
let publishBlob: ((name: string, bytes: Uint8Array) => Promise<void>) | undefined;
let outputRootStore: CreateOnlyStore | undefined;
if (bucket) {
  const { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({ region: env["CEILING_S3_REGION"] ?? "us-east-2" });
  publish = async (name, json) => {
    await s3.send(new PutObjectCommand({
      Bucket: bucket, Key: `ceilings/${name}`, Body: json, ContentType: "application/json", CacheControl: "no-cache",
    }));
  };
  // Blob bytes are content-addressed and immutable: an object already there is left alone.
  publishBlob = async (name, bytes) => {
    const Key = `ceilings/${name}`;
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key }));
      return;
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 404 && (e as Error).name !== "NotFound") throw e;
    }
    await s3.send(new PutObjectCommand({
      Bucket: bucket, Key, Body: bytes, ContentType: "application/octet-stream", CacheControl: "public, max-age=31536000, immutable",
    }));
  };
  // Output-root windows and settlements are written once and never replaced: If-None-Match "*" lets
  // S3 refuse a second write with 412 (the anchor claims in packages/hosted do the same in this bucket),
  // and the settler compares what is already there before counting it as stored.
  outputRootStore = {
    createOnly: async (key, body) => {
      try {
        await s3.send(new PutObjectCommand({
          Bucket: bucket, Key: `ceilings/${key}`, Body: body, ContentType: "application/json",
          CacheControl: "public, max-age=31536000, immutable", IfNoneMatch: "*",
        }));
        return "created";
      } catch (e) {
        const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 412 || (e as Error).name === "PreconditionFailed") return "exists";
        throw e; // 409 ConditionalRequestConflict and the rest: tried again next pass
      }
    },
    read: async (key) => {
      try {
        const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `ceilings/${key}` }));
        return (await r.Body?.transformToString()) ?? null;
      } catch (e) {
        const name = (e as Error).name;
        if (name === "NoSuchKey" || name === "NotFound") return null;
        throw e;
      }
    },
  };
}
let settlement: WriterSettlementOptions | undefined;
if (chainId === 8453 && env["CEILING_SETTLEMENT"] !== "off") {
  const endpoints = settlementEndpointsFromEnv(env);
  const cache = createSettlementCache();
  settlement = {
    find: (b) => findSettlement(b.blockNumber, b.blockHash, {
      ...endpoints,
      pins: BASE_MAINNET_SETTLEMENT_PINS,
      base: { blockTimestamp: b.blockTimestamp, txHash: b.txHash, ...(b.parentHash ? { parentHash: b.parentHash } : {}) },
      cache,
      log: (e) => console.log(JSON.stringify(e)),
    }),
    pins: BASE_MAINNET_SETTLEMENT_PINS,
    ...(env["CEILING_SETTLEMENT_BUDGET_MS"] ? { budgetMs: Number(env["CEILING_SETTLEMENT_BUDGET_MS"]) } : {}),
    ...(publishBlob ? { publishBlob } : {}),
  };
}
let outputRoot: OutputRootOptions | undefined;
let outputRootEndpoints: { base: string[]; l1: string[] } | null = null;
if (chainId === 8453 && env["CEILING_OUTPUT_ROOT"] !== "off") {
  const ms = (v: string | undefined, d: number): number => {
    const n = Number(v);
    return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? n : d;
  };
  const baseUrls = endpointList(env["CEILING_BASE_RPC_URLS"], [env["CEILING_RPC_URL"] ?? CHAINS[8453].rpcUrls.default.http[0]!]);
  const l1Urls = endpointList(env["CEILING_L1_RPC_URLS"], [env["CEILING_L1_RPC_URL"] ?? DEFAULT_L1_RPC]);
  const poolLog = (e: Record<string, unknown>): void => console.log(JSON.stringify({ at: new Date().toISOString(), ...e }));
  outputRoot = {
    base: rpcPool(baseUrls, { minIntervalMs: ms(env["CEILING_BASE_RPC_INTERVAL_MS"], 1000), log: poolLog }),
    l1: rpcPool(l1Urls, { minIntervalMs: ms(env["CEILING_L1_RPC_INTERVAL_MS"], 100), log: poolLog }),
    ...(outputRootStore ? { store: outputRootStore } : {}),
  };
  // Origins only: a URL may carry an API key.
  outputRootEndpoints = { base: baseUrls.map(endpointOrigin), l1: l1Urls.map(endpointOrigin) };
}
const writer = new CeilingWriter({
  ...(publish ? { publish } : {}),
  ...(settlement ? { settlement } : {}),
  ...(outputRoot ? { outputRoot } : {}),
  stateDir,
  queuePath: env["CEILING_QUEUE_PATH"] ?? join(stateDir, "queue.jsonl"),
  chain,
  minBalanceWei: parseEther(env["CEILING_MIN_BALANCE_ETH"] ?? "0.001"),
});

const bal = await chain.balanceWei();
console.log(JSON.stringify({
  type: "start", chainId, writer: chain.writer, balanceEth: formatEther(bal), stateDir, publishTo: bucket ? `s3://${bucket}/ceilings/` : null,
  settlement: settlement ? settlementEndpointsFromEnv(env) : null,
  outputRoot: outputRootEndpoints ? { ...outputRootEndpoints, storeTo: bucket ? `s3://${bucket}/ceilings/${OUTPUT_ROOT_PREFIX}/` : null } : null,
}));

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
