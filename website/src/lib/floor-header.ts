/**
 * A Base floor's header, as the parent saved it (enclave v10, 2026-10-06).
 *
 * When the parent hands the enclave the Base header a position's floor is
 * fixed from, it first saves those exact bytes to the ledger under Object
 * Lock: `base-floors/{blockNumber, 12 digits}-{blockHash}.rlp`. A floor is
 * never stood on before its header is saved, so every Base-floor proof's
 * header can be served from BitGraph's own copy, with no Base node asked.
 *
 * Nothing about the saved bytes is trusted: they are served only when they
 * decode as a block header, keccak-256 of them is the block hash asked for,
 * and they say the block number asked for (and a time on Base mainnet's 2 s
 * schedule). A reader checks them again against the floor its proof signs.
 *
 * Pure: the object getter is a parameter, so the route and node's test
 * runner run the same code.
 */
import { decodeHeader, evmBytesToHex, onBaseSchedule } from "@mikeargento/bitgraph-verify";

/** The ledger prefix the parent saves Base floor headers under. */
export const BASE_FLOORS_PREFIX = "base-floors/";

/** The key one Base floor header is saved under. */
export function baseFloorKey(blockNumber: number, blockHash: string): string {
  return `${BASE_FLOORS_PREFIX}${String(blockNumber).padStart(12, "0")}-${blockHash.toLowerCase()}.rlp`;
}

/** What GET /api/proofs/floor-header answers. */
export interface FloorHeaderAnswer {
  chain: "base";
  blockNumber: number;
  /** 0x-prefixed lowercase hex. */
  blockHash: string;
  /** Unix seconds, read from the header. */
  blockTimestamp: number;
  /** The raw RLP header, 0x-prefixed lowercase hex. */
  header: string;
}

/** The query, checked: a Base chain, a block number, a 32-byte hash. An error sentence otherwise. */
export function parseFloorHeaderQuery(q: { chain: string | null; block: string | null; hash: string | null }): { ok: true; blockNumber: number; blockHash: string } | { ok: false; error: string } {
  if (q.chain !== "base") return { ok: false, error: "chain must be base: Ethereum floor headers are at /api/proofs/witness" };
  const blockNumber = q.block !== null && /^(0|[1-9][0-9]{0,15})$/.test(q.block) ? Number(q.block) : NaN;
  if (!Number.isSafeInteger(blockNumber) || blockNumber <= 0) return { ok: false, error: "block must be a Base block number" };
  if (q.hash === null || !/^0x[0-9a-fA-F]{64}$/.test(q.hash)) return { ok: false, error: "hash must be 0x and 64 hex characters" };
  return { ok: true, blockNumber, blockHash: q.hash.toLowerCase() };
}

/**
 * The saved bytes as an answer, or null unless they decode as a header that
 * hashes to `blockHash`, at `blockNumber`, stamped on Base mainnet's schedule.
 */
export function checkSavedFloorHeader(bytes: Uint8Array, blockNumber: number, blockHash: string): FloorHeaderAnswer | null {
  try {
    const h = decodeHeader(bytes);
    if (h.hash !== blockHash.toLowerCase() || h.number !== blockNumber) return null;
    if (!onBaseSchedule(h.number, h.timestamp)) return null;
    return { chain: "base", blockNumber: h.number, blockHash: h.hash, blockTimestamp: h.timestamp, header: evmBytesToHex(bytes).toLowerCase() };
  } catch {
    return null;
  }
}

/**
 * One Base floor header from the ledger, checked. Null when it is not saved,
 * or what is saved is not that block's header. A ledger that cannot be read
 * throws (the getter's error): that is not an absent header.
 */
export async function readBaseFloorHeader(
  blockNumber: number,
  blockHash: string,
  getObjectBytes: (key: string) => Promise<Uint8Array | null>,
): Promise<FloorHeaderAnswer | null> {
  const bytes = await getObjectBytes(baseFloorKey(blockNumber, blockHash));
  if (bytes === null) return null;
  return checkSavedFloorHeader(bytes, blockNumber, blockHash);
}
