/**
 * A stub boundary for the site's tree/1 tests: it signs position records and
 * proofs with a throwaway TEST key, runs the site's REAL commit-route checks
 * (validateTreeCommit, reconcileTreeMetadata; validateSetCommit for sets) on
 * every commit, and serves the read-only routes an export is filled from
 * (the floor's header, the Base ceiling, the settlement, SPEC.md). No
 * network, no ledger, nothing written anywhere. The proofs it makes are not
 * BitGraphs: they carry no attestation, so every attestation claim fails,
 * and the tests say so.
 */
import { readFileSync } from "node:fs";
import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import {
  bytesToBase64,
  canonicalize,
  computeSlotRecordHash,
  evmBytesToHex,
  keccak256,
  rlpEncode,
  type BitGraphProof,
  type SlotAllocation,
} from "@mikeargento/bitgraph-verify";
import { validateTreeCommit, reconcileTreeMetadata } from "../fuse-tree.ts";
import { validateSetCommit, reconcileSetMetadata } from "../fuse-set.ts";
import { boundFloorOf, signedFloorMatchesBound } from "../fuse-core.ts";

export const SPEC_BYTES = new Uint8Array(readFileSync(new URL("../../../../spec/SPEC.md", import.meta.url)));
/** SPEC v2 (tree/1 under bitgraph-fuse/3, a Base floor), as the site serves it. */
export const SPEC_V2_BYTES = new Uint8Array(readFileSync(new URL("../../../public/spec/SPEC-v2.md", import.meta.url)));

/** The Base floor the v10 harness enclave fixed for the fuse/3 fixtures: a real Base mainnet header (block #52,271,417). */
const FUSE3_FIX = new URL("../../../../src/__tests__/fuse3-fixtures/", import.meta.url);
export const BASE_FLOOR_HEADER_HEX = readFileSync(new URL("floor-base-52271417.rlp.hex", FUSE3_FIX), "utf8").trim();
const baseBlock = JSON.parse(readFileSync(new URL("floor-base-52271417.block.json", FUSE3_FIX), "utf8")) as { hash: string; number: string; timestamp: string };
export const BASE_FLOOR = {
  chain: "base" as const,
  evmChainId: 8453 as const,
  blockNumber: Number(baseBlock.number),
  blockHash: baseBlock.hash.toLowerCase(),
  blockTimestamp: Number(baseBlock.timestamp),
};
export const utf8 = (s: string) => new TextEncoder().encode(s);
export const b64 = (b: Uint8Array) => bytesToBase64(b);
export const digestB64 = (b: Uint8Array) => bytesToBase64(sha256(b));

/** A synthetic Ethereum header (RLP, 17 items, number at 8 and time at 11): its keccak is the floor block hash. */
export function syntheticHeader(blockNumber: number, timestamp: number): { headerHex: string; blockHash: string } {
  const be = (n: number) => {
    const out: number[] = [];
    for (let v = BigInt(n); v > 0n; v >>= 8n) out.unshift(Number(v & 0xffn));
    return new Uint8Array(out);
  };
  const items = Array.from({ length: 17 }, (_, i) => (i === 8 ? be(blockNumber) : i === 11 ? be(timestamp) : new Uint8Array(32).fill(i + 7)));
  const header = rlpEncode(items);
  return { headerHex: evmBytesToHex(header), blockHash: evmBytesToHex(keccak256(header)) };
}

export interface StubOptions {
  /** What the boundary does with metadata on a held-position commit. Default "echo". */
  metadata?: "echo" | "drop" | "tamper";
  /** Withhold the floor anchor from the allocation (an enclave before v9). */
  noAnchor?: boolean;
  /** Answer the first commit with a 503 tee-restarting AFTER minting it (a lost reply). */
  loseFirstReply?: boolean;
  /** Enclave v10: the allocation returns a Base floor (`floor`) and the proof signs commit.slotFloor, no anchor. */
  baseFloor?: boolean;
  /** With baseFloor: sign a different Base block than the one the allocation handed out (a boundary that lies). */
  signOtherFloor?: boolean;
}

export interface Stub {
  fetch: typeof fetch;
  calls: string[];
  commits: Array<Record<string, unknown>>;
  minted: BitGraphProof[];
  floor: { blockNumber: number; blockHash: string; headerHex: string; timestamp: number };
  publicKeyB64: string;
  options: StubOptions;
}

const EPOCH = bytesToBase64(sha256(utf8("site tree/1 test epoch")));

export async function makeStub(options: StubOptions = {}): Promise<Stub> {
  const priv = sha256(utf8(`site tree/1 test key ${Math.random()}`));
  const publicKeyB64 = bytesToBase64(await ed.getPublicKeyAsync(priv));
  const floorHeader = syntheticHeader(25_100_000, 1_790_000_000);
  const floor = { blockNumber: 25_100_000, blockHash: floorHeader.blockHash, headerHex: floorHeader.headerHex, timestamp: 1_790_000_000 };
  let counter = 1000n;
  const slots = new Map<string, SlotAllocation>();
  const consumed = new Set<string>();
  const byDigest = new Map<string, BitGraphProof[]>();
  const stub: Stub = { fetch: undefined as unknown as typeof fetch, calls: [], commits: [], minted: [], floor, publicKeyB64, options };
  let lost = options.loseFirstReply === true;

  async function allocate(): Promise<Response> {
    counter += 2n;
    const body = { version: "bitgraph/slot/1" as const, nonceB64: bytesToBase64(crypto.getRandomValues(new Uint8Array(32))), counter: String(counter), epochId: EPOCH, publicKeyB64, chainId: "bitgraph:main" };
    const slot = { ...body, signatureB64: bytesToBase64(await ed.signAsync(canonicalize(body), priv)) } as SlotAllocation;
    slots.set(slot.nonceB64, slot);
    const anchor = { counter: String(counter - 1n), blockNumber: floor.blockNumber, blockHash: floor.blockHash };
    if (options.baseFloor) return Response.json({ slotId: slot.nonceB64, slot, chainId: "bitgraph:main", floor: BASE_FLOOR });
    return Response.json({ slotId: slot.nonceB64, slot, chainId: "bitgraph:main", ...(options.noAnchor ? {} : { anchor }) });
  }

  async function commit(body: Record<string, unknown>): Promise<Response> {
    stub.commits.push(body);
    const slot = slots.get(String(body.slotId));
    if (!slot) return Response.json({ error: "unknown position" }, { status: 400 });
    if (consumed.has(slot.nonceB64)) return Response.json({ error: "the position is no longer available", code: "slot-unavailable" }, { status: 409 });
    const attr = body.attribution as { name: string; title: string; message?: string };
    const digest = (body.digests as Array<{ digestB64: string }>)[0]!.digestB64;
    // The site's own route, as it runs before the boundary sees anything: the
    // floor the marker binds (body.anchor for fuse/2, body.floor for fuse/3).
    const named = boundFloorOf(attr.name, { anchor: body.anchor, floor: body.floor });
    if (!named.ok) return Response.json({ error: named.error }, { status: 400 });
    const floorBlockHash = named.bound?.mark.blockHash ?? null;
    const floorChain = named.bound?.chain;
    let tree: { hex: string } | null = null;
    let set: Parameters<typeof reconcileSetMetadata>[1] | null = null;
    if (attr.title === "tree/1") {
      const v = validateTreeCommit({ name: attr.name, message: attr.message, metadata: body.metadata, digestB64: digest, slot, floorBlockHash, floorChain });
      if (!v.ok) return Response.json({ error: v.error }, { status: v.status });
      tree = v;
    } else if (attr.title === "set/1" || attr.title === "set/2" || body.metadata !== undefined) {
      const v = await validateSetCommit({ title: attr.title, message: attr.message, metadata: body.metadata, digestB64: digest, slot, floorBlockHash, floorChain });
      if (!v.ok) return Response.json({ error: v.error }, { status: v.status });
      set = v;
    }
    consumed.add(slot.nonceB64);
    const c: Record<string, unknown> = {
      nonceB64: slot.nonceB64,
      counter: (BigInt(slot.counter) + 1n).toString(),
      epochId: slot.epochId,
      slotCounter: slot.counter,
      slotHashB64: bytesToBase64(computeSlotRecordHash(slot)),
      ...(options.baseFloor
        ? { slotFloor: options.signOtherFloor ? { ...BASE_FLOOR, blockHash: "0x" + "5a".repeat(32) } : BASE_FLOOR }
        : { slotAnchor: { counter: String(BigInt(slot.counter) - 1n), blockNumber: floor.blockNumber, blockHash: floor.blockHash } }),
      chainId: "bitgraph:main",
    };
    const artifact = { hashAlg: "sha256" as const, digestB64: digest };
    const signedBody = { version: "bitgraph/1", artifact, commit: c, publicKeyB64, enforcement: "stub", measurement: "test-measurement-site-tree1", attribution: attr };
    const signatureB64 = bytesToBase64(await ed.signAsync(canonicalize(signedBody as never), priv));
    const proof = {
      version: "bitgraph/1",
      artifact,
      commit: c,
      signer: { publicKeyB64, signatureB64 },
      environment: { enforcement: "stub", measurement: "test-measurement-site-tree1" },
      attribution: attr,
      slotAllocation: slot,
    } as unknown as BitGraphProof & { metadata?: Record<string, unknown> };
    const md = options.metadata ?? "echo";
    if (body.metadata !== undefined && md === "echo") proof.metadata = structuredClone(body.metadata) as Record<string, unknown>;
    if (body.metadata !== undefined && md === "tamper") proof.metadata = { "bitgraph-tree/1": "00".repeat(84), "bitgraph-fuse/1": { tampered: true } };
    // The route's half after the boundary answers.
    if (tree && reconcileTreeMetadata(proof as unknown as Record<string, unknown>, tree) === "mismatch") return Response.json({ error: "The boundary returned a different root document", code: "root-mismatch" }, { status: 502 });
    if (set && reconcileSetMetadata(proof as unknown as Record<string, unknown>, set) === "mismatch") return Response.json({ error: "The boundary returned a different set manifest", code: "manifest-mismatch" }, { status: 502 });
    if (named.bound && !signedFloorMatchesBound(proof as unknown as Record<string, unknown>, named.bound)) {
      return Response.json({ error: "The boundary signed a different floor than the one this file bound", code: "floor-mismatch" }, { status: 502 });
    }
    stub.minted.push(proof);
    const list = byDigest.get(digest) ?? [];
    list.push(proof);
    byDigest.set(digest, list);
    if (lost) {
      lost = false;
      return Response.json({ error: "the boundary is restarting", code: "tee-restarting" }, { status: 503 });
    }
    return Response.json({ proof });
  }

  stub.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "https://stub.test");
    stub.calls.push(url.pathname);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (url.pathname === "/api/fuse/allocate") return allocate();
    if (url.pathname === "/api/fuse/commit") return commit(body);
    if (url.pathname.startsWith("/api/proofs/witness")) {
      const n = Number(url.searchParams.get("block"));
      const h = url.searchParams.get("hash");
      if (n === floor.blockNumber && h === floor.blockHash) return Response.json({ version: "bitgraph-anchor-witness/1", headerRlpHex: floor.headerHex, blockNumber: n, blockHash: h });
      return Response.json({ error: "witness unavailable" }, { status: 404 });
    }
    if (url.pathname === "/api/proofs/floor-header") {
      const ok = url.searchParams.get("chain") === "base" && Number(url.searchParams.get("block")) === BASE_FLOOR.blockNumber && url.searchParams.get("hash") === BASE_FLOOR.blockHash;
      if (ok) return Response.json({ chain: "base", blockNumber: BASE_FLOOR.blockNumber, blockHash: BASE_FLOOR.blockHash, blockTimestamp: BASE_FLOOR.blockTimestamp, header: BASE_FLOOR_HEADER_HEX });
      return Response.json({ error: "no saved header for that Base block" }, { status: 404 });
    }
    if (url.pathname.startsWith("/api/ceilings/settlement/")) return Response.json({ error: "not settled" }, { status: 404 });
    if (url.pathname.startsWith("/api/ceilings/")) return Response.json({ error: "no ceiling recorded" }, { status: 404 });
    if (url.pathname.startsWith("/api/proofs/")) {
      const d = decodeURIComponent(url.pathname.slice("/api/proofs/".length)).replace(/-/g, "+").replace(/_/g, "/");
      const std = d.length === 43 ? `${d}=` : d;
      return Response.json({ proofs: (byDigest.get(std) ?? []).map((proof) => ({ proof })) });
    }
    if (url.pathname === "/spec/SPEC.md") return new Response(SPEC_BYTES.slice());
    if (url.pathname === "/spec/SPEC-v2.md") return new Response(SPEC_V2_BYTES.slice());
    return Response.json({ error: `no route ${url.pathname}` }, { status: 404 });
  }) as typeof fetch;
  return stub;
}

/** A Blob whose bytes must never be read: proves a member was never loaded. */
export function unreadable(size: number): Blob {
  return {
    size,
    type: "",
    arrayBuffer: () => Promise.reject(new Error("this file must not be read")),
    slice: () => { throw new Error("this file must not be read"); },
    stream: () => { throw new Error("this file must not be read"); },
    text: () => Promise.reject(new Error("this file must not be read")),
  } as unknown as Blob;
}
