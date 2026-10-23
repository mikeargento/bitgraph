/**
 * bitgraph-epoch-genesis/1 on the site: the record an epoch's first BitGraph binds when the epoch opened with a
 * Base write. The source of truth is packages/verify/src/epoch-genesis.ts; this is the small part the site needs
 * until the published verifier carries it. Keep the two in step.
 *
 *   calldata = "BGE1" || the 32 raw bytes of the epoch id, sent self-addressed from the ceiling writer.
 */

export const EPOCH_GENESIS_FORMAT = "bitgraph-epoch-genesis/1" as const;
export const EPOCH_FLOOR_FORMAT = "bitgraph-epoch-floor/1" as const;

export interface EpochGenesisFile {
  format: typeof EPOCH_GENESIS_FORMAT;
  epochId: string;
  chain: "base-mainnet" | "base-sepolia";
  chainId: 8453 | 84532;
  writer: string;
  txHash: string;
  blockNumber: number;
  blockHash: string;
  blockTimestamp: number;
}

/** The calldata as 0x hex, as a node reports a transaction's input. */
export function epochGenesisCalldataHex(epochId: string): string {
  const id = Buffer.from(epochId, "base64");
  if (id.length !== 32 || id.toString("base64") !== epochId) throw new TypeError("an epoch id is 32 bytes in standard base64");
  return "0x" + Buffer.concat([Buffer.from("BGE1", "ascii"), id]).toString("hex");
}

/** Strict parse; null when the text is not a genesis record. */
export function parseEpochGenesisFile(text: string): EpochGenesisFile | null {
  let o: Record<string, unknown>;
  try { o = JSON.parse(text) as Record<string, unknown>; } catch { return null; }
  if (!o || o["format"] !== EPOCH_GENESIS_FORMAT) return null;
  const epochId = o["epochId"], chainId = o["chainId"], writer = o["writer"], txHash = o["txHash"], blockHash = o["blockHash"];
  if (typeof epochId !== "string" || Buffer.from(epochId, "base64").length !== 32) return null;
  if (chainId !== 8453 && chainId !== 84532) return null;
  const chain = chainId === 8453 ? "base-mainnet" : "base-sepolia";
  if (o["chain"] !== chain) return null;
  if (typeof writer !== "string" || !/^0x[0-9a-f]{40}$/.test(writer)) return null;
  if (typeof txHash !== "string" || !/^0x[0-9a-f]{64}$/.test(txHash)) return null;
  if (typeof blockHash !== "string" || !/^0x[0-9a-f]{64}$/.test(blockHash)) return null;
  const blockNumber = o["blockNumber"], blockTimestamp = o["blockTimestamp"];
  if (!Number.isSafeInteger(blockNumber) || !Number.isSafeInteger(blockTimestamp)) return null;
  return { format: EPOCH_GENESIS_FORMAT, epochId, chain, chainId, writer, txHash, blockNumber: blockNumber as number, blockHash, blockTimestamp: blockTimestamp as number };
}

/**
 * Ask Base whether the genesis is as the file says: the writer's self-addressed transaction carrying this epoch's
 * id, mined in the named block at the named time. Null when Base could not be asked.
 */
export async function checkEpochGenesisOnBase(g: EpochGenesisFile, rpc: string): Promise<boolean | null> {
  const call = async (method: string, params: unknown[]): Promise<unknown> => {
    const res = await fetch(rpc, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return ((await res.json()) as { result?: unknown }).result ?? null;
  };
  try {
    const tx = (await call("eth_getTransactionByHash", [g.txHash])) as { from?: string; to?: string | null; input?: string; blockHash?: string | null } | null;
    if (!tx) return false;
    if ((tx.from ?? "").toLowerCase() !== g.writer || (tx.to ?? "").toLowerCase() !== g.writer) return false;
    if ((tx.input ?? "").toLowerCase() !== epochGenesisCalldataHex(g.epochId)) return false;
    if ((tx.blockHash ?? "").toLowerCase() !== g.blockHash) return false;
    const block = (await call("eth_getBlockByHash", [g.blockHash, false])) as { number?: string; timestamp?: string } | null;
    if (!block) return false;
    return parseInt(block.number ?? "0x0", 16) === g.blockNumber && parseInt(block.timestamp ?? "0x0", 16) === g.blockTimestamp;
  } catch {
    return null;
  }
}
