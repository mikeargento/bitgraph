/**
 * Hourly publication on Base, as the site reads it.
 *
 * Every hour the publisher (server/commit-service/src/publication) writes one transaction to Base holding the root of
 * a tree over that hour's BitGraphs, then binds a note naming that block as a BitGraph (the floor). For each BitGraph
 * it keeps a bitgraph-publication/1 block in the ledger at publication/proofs/<epoch>/<count, 12 digits>.json: the
 * proof's path to the hour's root, the write's transaction with its block header and inclusion proof, and the floor.
 * The block rides in a downloaded proof's unsigned metadata, and @mikeargento/bitgraph-audit checks it offline
 * (checkPublication). The site only reads it and shows two lines: the block the BitGraph was published in, and the
 * block it was made after.
 */

export const PUBLICATION_METADATA_KEY = "bitgraph-publication/1";

export interface PublicationSummary {
  chainId: number;
  /** The block that published the BitGraph's hour: it existed by this block. */
  publishedIn: { blockNumber: number; blockTimestamp: number; txHash: string };
  /** The block it was made after, from its floor; null before its epoch's first floor. */
  madeAfter: { blockNumber: number; blockTimestamp: number; txHash: string } | null;
}

type Block = {
  format?: string;
  write?: { chainId?: number; blockNumber?: number; blockTimestamp?: number; txHash?: string };
  floor?: { note?: string } | null;
};

/** The two lines a proof page shows, from a publication block; null when the block is not one. */
export function summarize(block: unknown): PublicationSummary | null {
  const b = block as Block | null;
  if (!b || b.format !== PUBLICATION_METADATA_KEY || !b.write) return null;
  const w = b.write;
  if (typeof w.chainId !== "number" || typeof w.blockNumber !== "number" || typeof w.blockTimestamp !== "number" || typeof w.txHash !== "string") return null;
  let madeAfter: PublicationSummary["madeAfter"] = null;
  const m = typeof b.floor?.note === "string"
    ? /\nblock: (\d+)\nblock hash: 0x[0-9a-f]{64}\nblock time: (\d+)\ntransaction: (0x[0-9a-f]{64})\n/.exec(b.floor.note)
    : null;
  if (m) madeAfter = { blockNumber: Number(m[1]), blockTimestamp: Number(m[2]), txHash: m[3]! };
  return { chainId: w.chainId, publishedIn: { blockNumber: w.blockNumber, blockTimestamp: w.blockTimestamp, txHash: w.txHash }, madeAfter };
}

/** Where a transaction can be looked at. */
export function explorerTx(chainId: number, txHash: string): string {
  return `${chainId === 84532 ? "https://sepolia.basescan.org" : "https://basescan.org"}/tx/${txHash}`;
}

/** The ledger key of a BitGraph's publication block. */
export function publicationKey(epochId: string, counter: string | number): string {
  const safe = epochId.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `publication/proofs/${safe}/${String(counter).padStart(12, "0")}.json`;
}

/** The ledger key of a floor BitGraph's record: the note it binds and the hourly write that note names. */
export function floorKey(epochId: string, counter: string | number): string {
  const safe = epochId.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `publication/floors/${safe}/${String(counter).padStart(12, "0")}.json`;
}

/** What a floor's page shows: the write it binds. Null when the record is not one. */
export function floorWrite(record: unknown): { chainId: number; blockNumber: number; blockTimestamp: number; txHash: string } | null {
  const r = record as { format?: string; write?: { chainId?: unknown; blockNumber?: unknown; blockTimestamp?: unknown; txHash?: unknown } } | null;
  if (!r || r.format !== "bitgraph-hour-floor/1" || !r.write) return null;
  const w = r.write;
  if (typeof w.chainId !== "number" || typeof w.blockNumber !== "number" || typeof w.blockTimestamp !== "number" || typeof w.txHash !== "string") return null;
  return { chainId: w.chainId, blockNumber: w.blockNumber, blockTimestamp: w.blockTimestamp, txHash: w.txHash };
}
