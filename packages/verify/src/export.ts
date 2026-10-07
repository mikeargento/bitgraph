// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-export/1: one JSON file that, with the file it is about, checks a
 * tree/1 BitGraph with nothing of BitGraph's required (2026-10-03).
 *
 *   {
 *     "format":     "bitgraph-export/1",
 *     "spec":       base64 SHA-256 of SPEC.md (informational; the proof's SIGNED attribution.message is authoritative),
 *     "proof":      the signed bitgraph/1 proof,
 *     "tree":       { "rootDocument": hex(84 bytes),
 *                     "member": TreeMemberEvidence            one file's export
 *                   or "leaves": base64(count x 65 bytes),   the owner's export
 *                     "names"?: [file name per leaf] },       unsigned, informational
 *     "floor":      { "chain"?, "blockNumber", "blockHash", "header" } | null,   chain: "ethereum" (absent) or "base"
 *     "ceiling":    a bitgraph-ceiling/1 sidecar | { "status": "pending" } | null,
 *     "settlement": a bitgraph-output-root/1 settlement | { "status": "pending", "baseBlock"? } | null
 *   }
 *
 * verifyExport answers one line per claim, each saying what it rests on, at
 * two levels: OFFLINE (every link recomputed from the bytes, block headers
 * taken as the ones matching their hashes) and CONFIRMED (the caller's own
 * lookups say those blocks are the chains' own). This module never fetches.
 *
 * Three time claims, never merged:
 *   floor            the committed bytes were finished after the floor block N, on the chain the
 *                    proof signs: an Ethereum anchor (commit.slotAnchor, enclave v7 to v9) or a Base
 *                    block (commit.slotFloor, enclave v10)                     (needs N canonical on that chain)
 *   ceiling.base     the record existed by Base block B, at B's time          (needs B canonical on Base; provisional until then)
 *   ceiling.ethereum the record existed by Ethereum block H                   (needs H canonical; Base's honesty not needed)
 */

import { sha256 } from "@noble/hashes/sha256";
import { verifyProofIntegrity, createVerificationContext } from "./verifier.js";
import { computeSignedBodyHash } from "./proof-hash.js";
import { verifyNitroAttestation } from "./nitro.js";
import { CEILING_VERSION, baseTimeIsBound, checkFloorHeader, floorTimeIsBound, verifyCeiling, type CeilingSidecar } from "./ceiling.js";
import { hexToBytes as evmHex } from "./ceiling-evm.js";
import { base64ToBytes, bytesEqual, hexToBytes, signedFloorOf, type SignedFloor } from "./fuse.js";
import { OUTPUT_ROOT_VERSION, verifyOutputRootSettlement, type OutputRootSettlement } from "./output-root.js";
import { MerkleTree } from "./fuse-merkle.js";
import { streamDigest, type ByteSource } from "./stream.js";
import { PUBLISHED_PCR0S, publishedMeasurement } from "./measurements.js";
import {
  buildTreeMemberEvidence,
  decodeTreeLeaves,
  TREE_MEMBER_CATEGORIES,
  treeLeafHash,
  verifyTreeLeaves,
  verifyTreeMember,
  type TreeMemberEvidence,
  type TreeVerifyResult,
} from "./tree.js";
import type { BitGraphProof } from "./types.js";

export const EXPORT_FORMAT = "bitgraph-export/1" as const;

export interface BitGraphExport {
  format: typeof EXPORT_FORMAT;
  spec: string;
  proof: BitGraphProof;
  tree: {
    rootDocument: string;
    member?: TreeMemberEvidence;
    leaves?: string;
    names?: string[];
  };
  /** The floor block's header. `chain` absent is Ethereum (every export before enclave v10); "base" a Base floor. */
  floor: { chain?: "ethereum" | "base"; blockNumber: number; blockHash: string; header: string } | null;
  ceiling: CeilingSidecar | { status: "pending" } | null;
  settlement: OutputRootSettlement | { status: "pending"; baseBlock?: number } | null;
}

export type ExportClaimResult = "TRUE" | "FALSE" | "UNDETERMINED" | "NOT_CARRIED";

export interface ExportClaim {
  id: string;
  name: string;
  result: ExportClaimResult;
  restsOn: string;
  detail: string;
  level: "offline" | "confirmed";
}

export interface ExportLookups {
  /** Ethereum mainnet: the chain's block hash at a height, or null. */
  ethereumBlockHash?: (blockNumber: number) => Promise<string | null>;
  /** Base mainnet: the chain's block hash at a height, or null. */
  baseBlockHash?: (blockNumber: number) => Promise<string | null>;
}

export interface ExportVerifyOptions {
  /** The file in hand (the original or the committed bytes). Without it, the claims about the file are NOT_CARRIED. */
  bytes?: Uint8Array;
  /** The file in hand as a stream (stream.ts): the same judgment as `bytes` for a file of any size. An owner's export reads it twice (once to find the leaf). */
  source?: ByteSource;
  lookups?: ExportLookups;
  pins?: {
    /**
     * PCR0 values the verifier accepts. Default: BitGraph's published images
     * (SPEC section 16, PUBLISHED_PCR0S), so a proof from any other enclave
     * image is not a BitGraph. An empty list accepts nothing and leaves the
     * claim, and so the verdict, undetermined.
     */
    pcr0?: readonly string[];
    ceilingWriter?: string;
    baseChainId?: number;
    /** The chain the settlement is on. Default Ethereum mainnet, 1. */
    ethereumChainId?: number;
    /** Another attestation trust root, DER, for a verifier that pins its own (tests use this). Default: the embedded AWS Nitro root. */
    rootDer?: Uint8Array;
  };
  /** Spec hashes (base64) to accept beyond the ones this verifier knows. */
  extraSpecHashes?: readonly string[];
}

export interface ExportVerifyResult {
  verdict: "TRUE" | "FALSE" | "UNDETERMINED";
  reasons: string[];
  claims: ExportClaim[];
  /** The member the file matched (or the export's own member), when one did. */
  member: TreeVerifyResult["member"];
  /** What the floor covers for the file in hand: "content" (placements 0x01-0x03: the committed bytes), "record" (as is: the record only), or null when no file was matched. */
  floorCovers: TreeVerifyResult["floorCovers"];
  /** The three time claims, as established. Null fields were not established. */
  times: {
    /** `chain` is present only for a Base floor, so an Ethereum floor's result is exactly what it was before enclave v10. */
    floor: { chain?: "base"; blockNumber: number; blockHash: string; blockTimestamp: number } | null;
    ceilingBase: { chainId: number; blockNumber: number; blockHash: string; blockTimestamp: number; provisional: boolean } | null;
    ceilingEthereum: { chainId: number; blockNumber: number; blockHash: string; blockTimestamp: number } | null;
  };
  /**
   * Why the Base block's time is not stated as a bound, when it is not: the
   * block was stamped earlier than the floor block or the attestation
   * document (see baseTimeIsBound). The inclusion itself still holds.
   */
  baseTimeWithheld: string | null;
  /**
   * Why the floor block's time is not stated as a bound, when it is not: the
   * block is stamped after the attestation document (see floorTimeIsBound).
   * The floor itself still holds: the record was made after that block.
   */
  floorTimeWithheld: string | null;
  /** Plain language, written from the claims. */
  reading: string;
}

/** Parse an export from JSON text or a parsed object. Structural only; null when it is not export/1. */
export function parseExport(input: unknown): BitGraphExport | null {
  let v: unknown = input;
  if (typeof input === "string") {
    try {
      v = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const e = v as Record<string, unknown>;
  if (e["format"] !== EXPORT_FORMAT) return null;
  if (typeof e["proof"] !== "object" || e["proof"] === null) return null;
  const tree = e["tree"] as Record<string, unknown> | undefined;
  if (!tree || typeof tree !== "object" || typeof tree["rootDocument"] !== "string") return null;
  return v as BitGraphExport;
}

const iso = (unix: number) => new Date(unix * 1000).toISOString().replace(".000Z", "Z");
export async function verifyExport(input: unknown, opts: ExportVerifyOptions = {}): Promise<ExportVerifyResult> {
  const claims: ExportClaim[] = [];
  const add = (id: string, name: string, result: ExportClaimResult, restsOn: string, detail: string, level: "offline" | "confirmed" = "offline") =>
    claims.push({ id, name, result, restsOn, detail, level });
  const times: ExportVerifyResult["times"] = { floor: null, ceilingBase: null, ceilingEthereum: null };
  let member: TreeVerifyResult["member"] = null;

  let baseTimeWithheld: string | null = null;
  let floorTimeWithheld: string | null = null;

  const exp = parseExport(input);
  if (exp === null) {
    // A document that says it is export/1 and lacks its parts is broken; one
    // in another format is not judged here.
    let declared: unknown;
    try {
      declared = ((typeof input === "string" ? JSON.parse(input) : input) as { format?: unknown } | null)?.format;
    } catch {
      declared = undefined;
    }
    if (declared === EXPORT_FORMAT) add("format", "This is a bitgraph-export/1 file", "FALSE", "its structure", "it says bitgraph-export/1 but lacks the parts that format requires (proof, tree.rootDocument)");
    else if (typeof declared === "string" && declared.startsWith("bitgraph-export/")) add("format", "This is a bitgraph-export/1 file", "UNDETERMINED", "", `not judged: a format this verifier does not know (${declared})`);
    else add("format", "This is a bitgraph-export/1 file", "UNDETERMINED", "", "not a bitgraph-export/1 document");
    return finish(claims, null, times, member, null, null, null);
  }
  add("format", "This is a bitgraph-export/1 file", "TRUE", "its structure", "format, proof and tree present");
  const proof = exp.proof;
  // The floor the proof signs, whichever chain it is on. A proof that signs two is ambiguous: no floor is read from it.
  let signedFloor: SignedFloor | null = null;
  let floorAmbiguous: string | null = null;
  try {
    signedFloor = signedFloorOf(proof);
  } catch (e) {
    floorAmbiguous = (e as Error).message;
  }
  const chainName = (c: "ethereum" | "base") => (c === "base" ? "Base" : "Ethereum");

  // An optional part is absent (null or missing) or an object of its format;
  // anything else is a malformed part, never read as "not carried".
  const isAbsent = (v: unknown) => v === null || v === undefined;
  const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

  // Every part below is read defensively, and anything that still throws on
  // a malformed part of a known format becomes a FALSE claim, never an
  // exception (formats it does not know are UNDETERMINED, above and below).
  const run = async (): Promise<ExportVerifyResult> => {

  // 1. The proof, and the attestation bound to it.
  const integrity = await verifyProofIntegrity({ proof, context: createVerificationContext() });
  add("proof.signature", "The proof is signed and its position record is bound to it", integrity.valid ? "TRUE" : "FALSE", "Ed25519",
    integrity.valid ? "the enclave's signature over the canonical signed body verifies, and the position record's checks pass" : `the proof does not verify: ${integrity.reason ?? "unspecified"}`);
  // The measurement is signed; a proof whose measurement is not hex is broken, not unknown.
  const env = (proof as { environment?: { measurement?: unknown; attestation?: { format?: unknown; reportB64?: unknown } } }).environment;
  const measurement = typeof env?.measurement === "string" && /^[0-9a-fA-F]+$/.test(env.measurement) ? env.measurement.toLowerCase() : null;
  // The attestation document's own time, kept only when the document is AWS's (signature, chain and root all hold).
  let attestedAtMs: number | null = null;
  const att = env?.attestation;
  if (att && att.format === "aws-nitro" && typeof att.reportB64 === "string") {
    const n = verifyNitroAttestation(att.reportB64, { ...(measurement !== null ? { expectedPcr0: measurement } : {}), expectedUserDataB64: computeSignedBodyHash(proof), ...(opts.pins?.rootDer ? { rootDer: opts.pins.rootDer } : {}) });
    if (n.doc === null) {
      // Not a Nitro document at all: that contradicts the proof's own claim to carry one.
      add("attestation.signature", "AWS hardware signed the attestation", "FALSE", "", `the attestation does not decode as an AWS Nitro document (${n.checks[0]?.detail ?? "unreadable"})`);
    }
    const byName = (prefix: string) => n.checks.find((c) => c.name.startsWith(prefix));
    const r = (c: { pass: boolean } | undefined): ExportClaimResult => (c === undefined ? "UNDETERMINED" : c.pass ? "TRUE" : "FALSE");
    const sig = byName("AWS signature"), chain = byName("Certificate chain"), root = byName("Chains to") ?? byName("Trust root"), validity = byName("Certificate validity"), pcr0 = byName("PCR0"), bound = byName("Bound to this proof");
    if (n.doc !== null) add("attestation.signature", "AWS hardware signed the attestation", r(sig), "ES384 (P-384)", sig?.detail ?? "not reached");
    add("attestation.chain", "The certificate chain holds together", r(chain), "ES384 (P-384)", chain?.detail ?? "not reached");
    add("attestation.root", "The chain reaches the AWS Nitro root", r(root), `the AWS Nitro Enclaves Root CA G1 (${n.rootSha256.slice(0, 8)}…)`, root?.detail ?? "not reached");
    add("attestation.validity", "Every certificate was valid at the document's own instant (archival policy, not freshness)", r(validity), "the document's signed timestamp", validity?.detail ?? "not reached");
    if (measurement === null) add("attestation.pcr0", "The attested image is the one the proof names", "FALSE", "", "the proof's environment.measurement is not a hex string, so it names no image");
    else add("attestation.pcr0", "The attested image is the one the proof names", r(pcr0), "PCR0 inside the signed document", pcr0?.detail ?? "not reached");
    add("attestation.binding", "The attestation is bound to this proof (user_data = SHA-256 of the signed body)", r(bound), "user_data inside the signed document", bound?.detail ?? "not reached");
    const hardwareOk = n.doc !== null && measurement !== null && [sig, chain, root, validity, pcr0, bound].every((c) => c?.pass === true);
    if (sig?.pass && chain?.pass && root?.pass && typeof n.doc?.timestampMs === "number") attestedAtMs = n.doc.timestampMs;

    // Which image is BitGraph's is a measurement policy: BitGraph's published images unless the caller names its own.
    // The image judged is the one the DOCUMENT attests, and only once the hardware's word verified in full.
    const docPcr0 = (n.doc?.pcrs as Record<number, unknown> | undefined)?.[0];
    const measured = typeof docPcr0 === "string" ? docPcr0.toLowerCase() : null;
    const usingDefault = opts.pins?.pcr0 === undefined;
    const policy = (opts.pins?.pcr0 ?? PUBLISHED_PCR0S).map((x) => String(x).toLowerCase());
    if (!hardwareOk || measured === null) {
      add("attestation.pins", "The image is one the verifier accepts", "UNDETERMINED", "", "not judged: the attestation did not verify in full, and a declared measurement is not hardware evidence");
    } else if (policy.length === 0) {
      add("attestation.pins", "The image is one the verifier accepts", "UNDETERMINED", "", `no accepted images were given: PCR0 is ${measured}; any AWS Nitro enclave can produce a valid attestation, and only a measurement policy says whose this is`);
    } else {
      const ok = policy.includes(measured);
      const pub = publishedMeasurement(measured);
      add("attestation.pins", "The image is one the verifier accepts", ok ? "TRUE" : "FALSE",
        usingDefault ? "BitGraph's published enclave images (SPEC section 16)" : "the verifier's own list",
        ok
          ? usingDefault && pub ? `PCR0 ${measured.slice(0, 16)}… is BitGraph's published ${pub.version} image (since ${pub.since})` : `PCR0 ${measured.slice(0, 16)}… is on the verifier's list`
          : usingDefault ? `PCR0 ${measured.slice(0, 16)}… is not an image BitGraph published, so this proof is not BitGraph's` : `PCR0 ${measured.slice(0, 16)}… is not on the verifier's list`);
    }
  } else {
    add("attestation.signature", "AWS hardware signed the attestation", "FALSE", "", "the proof carries no aws-nitro attestation");
  }

  // 2. The tree: the spec pin, the root document, and the member or the whole list.
  const rootDoc = hexToBytes(exp.tree.rootDocument);
  const extra = opts.extraSpecHashes ?? [];
  let memberEvidence: unknown = exp.tree.member;
  let ownerList: { ok: boolean; found: boolean } | null = null;
  const leavesBytes = typeof exp.tree.leaves === "string" ? base64ToBytes(exp.tree.leaves) : null;
  if (exp.tree.leaves !== undefined) {
    const lc = rootDoc === null ? { ok: false, reason: "the root document is not hex" } : leavesBytes === null ? { ok: false, reason: "the leaves are not base64" } : verifyTreeLeaves(rootDoc, leavesBytes);
    add("tree.leaves", "The whole list rebuilds the committed root, sorted and without duplicates", lc.ok ? "TRUE" : "FALSE", "SHA-256 (RFC 6962 tree)", lc.ok ? `${lc.count} leaves` : lc.reason ?? "invalid");
    // The owner's export: find the file's leaf in the list and build its path here.
    ownerList = { ok: lc.ok, found: false };
    if (lc.ok && (opts.bytes !== undefined || opts.source !== undefined) && leavesBytes !== null && rootDoc !== null) {
      const leaves = decodeTreeLeaves(leavesBytes)!;
      const d = opts.bytes !== undefined ? sha256(opts.bytes) : await streamDigest(opts.source!);
      const k = leaves.findIndex((l) => bytesEqual(l.artifact, d) || bytesEqual(l.origin, d));
      if (k >= 0) {
        const t = new MerkleTree(leaves.map(treeLeafHash));
        memberEvidence = buildTreeMemberEvidence(leaves[k]!, k, leaves.length, t.path(k));
        ownerList.found = true;
      }
    }
  }
  const haveFile = opts.bytes !== undefined || opts.source !== undefined;
  const tr = await verifyTreeMember({
    proof,
    ...(opts.bytes !== undefined ? { bytes: opts.bytes } : {}),
    ...(opts.source !== undefined ? { source: opts.source } : {}),
    ...(memberEvidence !== undefined ? { member: memberEvidence } : {}),
    // The export's own root document, never the proof's unsigned echo: a malformed one fails.
    rootDocument: rootDoc ?? new Uint8Array(0),
    extraSpecHashes: extra,
    proofAlreadyVerified: integrity.valid,
  });
  // A spec this verifier does not know is not judged: its rules may differ
  // from every rule here, so neither TRUE nor FALSE is earned (SPEC 8.4).
  const unknownSpec = tr.category === "UNKNOWN_SPEC";
  const specOk = !unknownSpec && tr.category !== "INVALID_TREE_MARKER" && tr.category !== "NOT_TREE";
  add("spec.pin", "The proof pins a spec this verifier knows", specOk ? "TRUE" : unknownSpec ? "UNDETERMINED" : "FALSE", "the signed attribution.message",
    (specOk ? `SPEC.md SHA-256 ${tr.specHashB64}` : unknownSpec ? `${tr.reason}; a verifier that knows that spec can judge the tree` : tr.reason) + (exp.spec !== proof.attribution?.message ? `; note: the export's unsigned "spec" label (${String(exp.spec)}) differs, and only the signed value counts` : ""));
  if (unknownSpec) {
    // The owner's list was read under this verifier's rules before the pin was known: not judged either.
    const leavesClaim = claims.find((c) => c.id === "tree.leaves");
    if (leavesClaim) {
      leavesClaim.result = "UNDETERMINED";
      leavesClaim.detail = `not judged: the proof follows a spec this verifier does not know (under this verifier's rules: ${leavesClaim.detail})`;
    }
  }
  const rootOk = tr.tree !== null;
  add("tree.root", "The root document is the signed one and carries this position's commitment", rootOk ? "TRUE" : specOk || rootDoc === null ? "FALSE" : "UNDETERMINED", "SHA-256 over the signed position record, its nonce and the signed floor block hash",
    rootOk ? `a tree of ${tr.tree!.count} leaves, root ${tr.tree!.rootHex.slice(0, 16)}…` : tr.reason);
  member = tr.member;
  if (memberEvidence === undefined) {
    const why = ownerList === null
      ? "the export carries no member evidence"
      : !ownerList.ok
        ? "the owner's list did not verify, so no member can be read from it"
        : !haveFile
          ? "no file in hand to look up in the owner's list"
          : "the file in hand is not in the owner's list";
    add("tree.member", "The file's leaf is in the committed tree", "NOT_CARRIED", "", why);
  } else {
    const pathOk = tr.member !== null;
    add("tree.member", "The file's leaf is in the committed tree", pathOk ? "TRUE" : rootOk ? "FALSE" : "UNDETERMINED", "SHA-256 (RFC 9162 path)",
      pathOk ? `leaf ${tr.member!.index} of ${tr.member!.count}; a path proves this leaf only, not the order of the others` : tr.reason);
  }
  if (!haveFile) {
    add("bytes.member", "The file in hand is that member", "NOT_CARRIED", "", "the file is not in hand");
  } else if (ownerList !== null && ownerList.ok && !ownerList.found && tr.tree !== null) {
    // The whole list is verified (sorted, unique, rebuilds the signed root), so its absence from it is a finding, not a gap.
    add("bytes.member", "The file in hand is that member", "FALSE", "the verified complete list of the committed tree",
      tr.category === "TREE_MEMBERSHIP_UNPROVEN"
        ? "these bytes carry this position's commitment, so they were made after the position existed, but they are not in the committed tree"
        : "the file is not among the committed tree's leaves");
  } else {
    const isMember = (TREE_MEMBER_CATEGORIES as readonly string[]).includes(tr.category);
    add("bytes.member", "The file in hand is that member", isMember ? "TRUE" : tr.member !== null ? "FALSE" : "UNDETERMINED", tr.category === "TREE_MEMBER_FROM_ORIGIN" ? "the placement rule, rebuilt here" : "SHA-256",
      `${tr.category}: ${tr.reason}`);
    if (isMember) {
      // Two floors, stated apart (SPEC 8.6). The record floor is every member's:
      // the root document was signed after the floor block. The content floor
      // is a placed member's: its committed bytes carry the commitment.
      const block = signedFloor ? `${chainName(signedFloor.chain)} block ${signedFloor.blockNumber}` : "the signed floor block";
      add("floor.record", "The record was made after the floor block", "TRUE", "the signed root document, which carries the commitment to the floor block",
        `recorded after ${block}: the tree this file is a leaf of was signed after it`);
      if (tr.floorCovers === "content") {
        add("floor.content", "The committed bytes were finished after the floor block", "TRUE", "SHA-256: the commitment is inside the committed bytes",
          `the committed bytes carry the commitment to ${block}, so they were finished after it; the original inside them is not dated by it`);
      } else {
        add("floor.content", "The committed bytes were finished after the floor block", "NOT_CARRIED", "",
          "recorded as is: the bytes carry no commitment, so the bytes themselves are not dated");
      }
    }
  }

  // 3. The floor: the header hashes to the SIGNED floor block hash, on the chain the proof signs.
  let floorBlock: { chain: "ethereum" | "base"; blockNumber: number; blockHash: string } | null = null;
  let floorHeaderTs: number | null = null;
  const fname = "The floor block's header is the one the proof signs";
  if (isAbsent(exp.floor)) {
    add("floor.header", fname, "NOT_CARRIED", "", "no floor header in the export");
  } else if (!isObject(exp.floor)) {
    add("floor.header", fname, "FALSE", "", "the export's floor is neither absent nor a { blockNumber, blockHash, header } object");
  } else if (floorAmbiguous !== null) {
    add("floor.header", fname, "FALSE", "", floorAmbiguous);
  } else if (!signedFloor) {
    add("floor.header", fname, "FALSE", "", "the proof signs no floor block (commit.slotAnchor or commit.slotFloor)");
  } else {
    const f = exp.floor as Record<string, unknown>;
    const chain = chainName(signedFloor.chain);
    let raw: Uint8Array | null = null;
    try {
      raw = evmHex(String(f["header"]));
    } catch {
      raw = null;
    }
    const fh = raw === null ? { ok: false as const, reason: "the header is not hex" } : checkFloorHeader(signedFloor, raw, f["chain"]);
    if (!fh.ok) {
      add("floor.header", fname, "FALSE", "", `floor header: ${fh.reason}`);
    } else if (String(f["blockHash"]).toLowerCase() !== fh.header.hash || f["blockNumber"] !== fh.header.number) {
      add("floor.header", fname, "FALSE", "", "the export's floor names a different block than its header");
    } else {
      const h = fh.header;
      floorBlock = { chain: signedFloor.chain, blockNumber: h.number, blockHash: h.hash };
      floorHeaderTs = h.timestamp;
      // The floor's time is a bound only when it is no later than the attestation document.
      const bound = floorTimeIsBound(h.timestamp, attestedAtMs);
      if (bound.ok) {
        times.floor = { ...(signedFloor.chain === "base" ? { chain: "base" as const } : {}), blockNumber: h.number, blockHash: h.hash, blockTimestamp: h.timestamp };
        add("floor.header", fname, "TRUE", `${chain} block ${h.number}, header as given`,
          `keccak-256 of the header equals the signed block hash${signedFloor.chain === "base" ? ", and its time is the signed one, on Base mainnet's schedule" : ""}; its time is ${iso(h.timestamp)}`);
      } else {
        floorTimeWithheld = bound.reason;
        add("floor.header", fname, "TRUE", `${chain} block ${h.number}, header as given`,
          `keccak-256 of the header equals the signed block hash; ${bound.reason}, so its time is not used as a bound`);
      }
    }
  }

  // 4. The ceiling on Base: the record is under a root in a Base transaction in block B.
  const writer = opts.pins?.ceilingWriter ?? "0xf3972408D853c975F86351C311f4310220bbF2a3";
  const baseChainId = opts.pins?.baseChainId ?? 8453;
  let ceilingB: { blockNumber: number; blockHash: string } | null = null;
  const c = exp.ceiling;
  const ceilingVersion = (c as { version?: unknown } | null)?.version;
  const ceilingUnknown = typeof ceilingVersion === "string" && ceilingVersion !== CEILING_VERSION;
  if (ceilingUnknown) {
    add("ceiling.base", "The record is in a Base block", "UNDETERMINED", "", `not judged: a ceiling format this verifier does not know (${ceilingVersion})`);
  } else if (isAbsent(c)) {
    add("ceiling.base", "The record is in a Base block", "NOT_CARRIED", "", "no ceiling in the export");
  } else if (!isObject(c) || (!(c as Record<string, unknown>)["anchor"] && (c as Record<string, unknown>)["status"] !== "pending")) {
    add("ceiling.base", "The record is in a Base block", "FALSE", "", "the export's ceiling is neither absent, pending, nor a sidecar with its transaction");
  } else if (!(c as Record<string, unknown>)["anchor"]) {
    // Pending means no transaction to check. With a transaction, the
    // sidecar's status is the writer's report and is never read as evidence.
    add("ceiling.base", "The record is in a Base block", "NOT_CARRIED", "", "ceiling pending: the Base write had not landed when this export was made");
  } else {
    let r: Awaited<ReturnType<typeof verifyCeiling>>;
    try {
      r = await verifyCeiling(proof, c as CeilingSidecar, { writerAddress: writer, chainId: baseChainId, proofAlreadyVerified: integrity.valid });
    } catch (e) {
      r = { ok: false, reason: `the ceiling is malformed (${(e as Error).message})`, checks: [], headerCheckedAgainstChain: false };
    }
    if (r.ok && r.window) {
      ceilingB = { blockNumber: r.window.ceiling.blockNumber, blockHash: r.window.ceiling.blockHash };
      const where = `under the root in transaction ${(c as CeilingSidecar).anchor!.txIndex} of Base block ${r.window.ceiling.blockNumber}`;
      // The floor's time: the export's own header, else the verified header the sidecar carries.
      const stamp = baseTimeIsBound(r.window.ceiling.blockTimestamp, { floorTimestampSec: floorHeaderTs ?? r.window.floor.blockTimestamp ?? null, attestedAtMs });
      if (stamp.ok) {
        times.ceilingBase = { ...r.window.ceiling, provisional: true };
        add("ceiling.base", "The record is in a Base block", "TRUE", `SHA-256 path, the BGC1 payload, secp256k1, Merkle-Patricia; Base block ${r.window.ceiling.blockNumber}, header as given`,
          `${where}; its time ${iso(r.window.ceiling.blockTimestamp)} is provisional until the block is checked against Base`);
      } else {
        // The inclusion holds; only the stamp is withheld as a bound.
        baseTimeWithheld = stamp.reason;
        add("ceiling.base", "The record is in a Base block", "TRUE", `SHA-256 path, the BGC1 payload, secp256k1, Merkle-Patricia; Base block ${r.window.ceiling.blockNumber}, header as given`,
          `${where}; ${stamp.reason}, so its time is not used as a bound`);
      }
    } else {
      add("ceiling.base", "The record is in a Base block", "FALSE", "", r.reason ?? "the ceiling does not verify");
    }
  }

  // 5. The settlement: the Base transaction existed by Ethereum block H.
  const s = exp.settlement;
  const settlementVersion = (s as { version?: unknown } | null)?.version;
  if (typeof settlementVersion === "string" && settlementVersion !== OUTPUT_ROOT_VERSION) {
    add("ceiling.ethereum", "The record existed by an Ethereum block", "UNDETERMINED", "", `not judged: a settlement format this verifier does not take in an export (${settlementVersion})`);
  } else if (isAbsent(s)) {
    add("ceiling.ethereum", "The record existed by an Ethereum block", "NOT_CARRIED", "", "no settlement in the export");
  } else if (!isObject(s)) {
    add("ceiling.ethereum", "The record existed by an Ethereum block", "FALSE", "", "the export's settlement is neither absent, pending, nor a settlement object");
  } else if ((s as Record<string, unknown>)["status"] === "pending" && (s as Record<string, unknown>)["version"] === undefined) {
    add("ceiling.ethereum", "The record existed by an Ethereum block", "NOT_CARRIED", "", "settlement pending: Base's claim for this block had not reached Ethereum when this export was made");
  } else {
    const so = s as unknown as OutputRootSettlement;
    let r: ReturnType<typeof verifyOutputRootSettlement>;
    try {
      r = verifyOutputRootSettlement(so, { baseChainId, ethereumChainId: opts.pins?.ethereumChainId ?? 1 });
    } catch (e) {
      r = { ok: false, reason: `the settlement is malformed (${(e as Error).message})`, checks: [] };
    }
    const linked = ceilingB !== null && so.base?.blockNumber === ceilingB.blockNumber && typeof so.base?.blockHash === "string" && so.base.blockHash.toLowerCase() === ceilingB.blockHash.toLowerCase();
    if (r.ok && linked) {
      times.ceilingEthereum = r.existedBy!;
      add("ceiling.ethereum", "The record existed by an Ethereum block", "TRUE", `keccak-256 output root, EIP-2935 storage proof, Merkle-Patricia; Ethereum block ${r.existedBy!.blockNumber}, header as given`,
        `Base's output root for block ${so.outputRoot.blockNumber} commits to the ceiling's Base block and is carried by transaction ${so.ethereum.txIndex} of Ethereum block ${r.existedBy!.blockNumber} (${iso(r.existedBy!.blockTimestamp)}); this holds whatever Base's claim turns out to be`);
    } else if (r.ok && !linked && ceilingUnknown) {
      add("ceiling.ethereum", "The record existed by an Ethereum block", "UNDETERMINED", "", "the settlement verifies, but the ceiling it settles is in a format this verifier does not know, so the link is not judged");
    } else if (r.ok && !linked) {
      add("ceiling.ethereum", "The record existed by an Ethereum block", "FALSE", "", ceilingB === null ? "the settlement settles a Base block, but the ceiling did not verify" : "the settlement is for a different Base block than the ceiling");
    } else {
      add("ceiling.ethereum", "The record existed by an Ethereum block", "FALSE", "", r.reason ?? "the settlement does not verify");
    }
  }

  // 6. Confirmed: the caller's lookups say the blocks are the chains' own.
  const confirm = async (id: string, name: string, chain: "ethereum" | "base", at: { blockNumber: number; blockHash: string } | null) => {
    if (at === null) return;
    const ask = chain === "ethereum" ? opts.lookups?.ethereumBlockHash : opts.lookups?.baseBlockHash;
    if (!ask) {
      add(id, name, "UNDETERMINED", "", `not checked: no ${chain === "ethereum" ? "Ethereum" : "Base"} lookup was given (block ${at.blockNumber}, ${at.blockHash})`, "confirmed");
      return;
    }
    try {
      const got = (await ask(at.blockNumber))?.toLowerCase() ?? null;
      if (got === null) add(id, name, "UNDETERMINED", "", `the lookup did not return block ${at.blockNumber}`, "confirmed");
      else add(id, name, got === at.blockHash.toLowerCase() ? "TRUE" : "FALSE", `the caller's ${chain === "ethereum" ? "Ethereum" : "Base"} node`, got === at.blockHash.toLowerCase() ? `block ${at.blockNumber} is the chain's own` : `the chain's block ${at.blockNumber} is ${got}`, "confirmed");
    } catch (e) {
      add(id, name, "UNDETERMINED", "", `lookup failed: ${(e as Error).message}`, "confirmed");
    }
  };
  // The floor is asked of its own chain, by height: the chain's block at N must be the signed one.
  if (floorBlock !== null) await confirm("confirmed.floor", `The floor block is ${chainName(floorBlock.chain)}'s own`, floorBlock.chain, floorBlock);
  await confirm("confirmed.ceiling.base", "The ceiling block is Base's own (makes its time final)", "base", ceilingB);
  await confirm("confirmed.ceiling.ethereum", "The settlement block is Ethereum's own", "ethereum", times.ceilingEthereum);
  const baseConfirmed = claims.find((x) => x.id === "confirmed.ceiling.base")?.result === "TRUE";
  if (times.ceilingBase) times.ceilingBase.provisional = !baseConfirmed;

  return finish(claims, exp, times, member, tr.floorCovers, baseTimeWithheld, floorTimeWithheld, floorBlock);
  };
  try {
    return await run();
  } catch (e) {
    add("wellformed", "Every part of the export is well formed", "FALSE", "", `a part of this export is malformed: ${(e as Error).message}`);
    return finish(claims, exp, times, member, null, baseTimeWithheld, floorTimeWithheld);
  }
}

/**
 * The verdict and the reading, from the claims (SPEC section 12.1).
 *
 * FALSE when any claim is FALSE, a lookup the reader made included: a block
 * a node says is not the chain's own refutes every time read from it.
 * UNDETERMINED when any offline claim is undetermined, the measurement
 * policy included. Otherwise TRUE. The reading states a time as fact only
 * when nothing refutes it, says when a header is taken as given, and never
 * states a Base time that was withheld as a bound.
 */
function finish(
  claims: ExportClaim[],
  exp: BitGraphExport | null,
  times: ExportVerifyResult["times"],
  member: TreeVerifyResult["member"],
  floorCovers: TreeVerifyResult["floorCovers"] = null,
  baseTimeWithheld: string | null = null,
  floorTimeWithheld: string | null = null,
  floorBlock: { chain: "ethereum" | "base"; blockNumber: number } | null = null,
): ExportVerifyResult {
  const offline = claims.filter((c) => c.level === "offline");
  const failed = claims.filter((c) => c.result === "FALSE");
  const reasons = claims.filter((c) => c.result === "FALSE" || c.result === "UNDETERMINED").map((c) => `${c.id}: ${c.detail}`);
  const unjudged = offline.filter((c) => c.result === "UNDETERMINED");
  const verdict = failed.length > 0 ? "FALSE" : exp === null || unjudged.length > 0 ? "UNDETERMINED" : "TRUE";
  const confirmedTrue = (id: string) => claims.find((c) => c.id === id)?.result === "TRUE";
  const parts: string[] = [];
  if (verdict === "FALSE") {
    if (failed.every((c) => c.level === "confirmed")) {
      parts.push(`A lookup refutes this export: ${failed.map((c) => c.detail).join("; ")}. A block it names is not the chain's own, so the times it states do not hold.`);
    } else {
      parts.push("Something in this export contradicts the proof; see the failed claims.");
    }
  } else if (exp === null) {
    parts.push("This is not a bitgraph-export/1 file.");
  } else {
    const lc1 = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
    if (unjudged.length > 0) parts.push(`Not judged in full: ${unjudged.map((c) => lc1(c.name)).join("; ")}.`);
    const givenEth = "; that block's header is taken as given until it is checked against Ethereum";
    const floorRead = floorBlock ?? (times.floor ? { chain: times.floor.chain ?? "ethereum", blockNumber: times.floor.blockNumber } : null);
    if (floorRead) {
      const chain = floorRead.chain === "base" ? "Base" : "Ethereum";
      const time = times.floor ? ` (${iso(times.floor.blockTimestamp)})` : "";
      const given = confirmedTrue("confirmed.floor") ? "" : `; that block's header is taken as given until it is checked against ${chain}`;
      const at = `${chain} block ${floorRead.blockNumber}${time}${given}`;
      parts.push(floorCovers === "record"
        ? `Recorded after ${at}; this file was kept as is, so the bytes themselves are not dated.`
        : floorCovers === "content"
          ? `Recorded after ${at}, and these committed bytes were finished after that block; an original inside them is not dated by it.`
          : `Recorded after ${at}.`);
      if (!times.floor && floorTimeWithheld) parts.push(`The floor block's time is not used as a bound: ${floorTimeWithheld}.`);
    }
    if (times.ceilingBase) parts.push(`The record existed by Base block ${times.ceilingBase.blockNumber} (${iso(times.ceilingBase.blockTimestamp)}${times.ceilingBase.provisional ? ", provisional until checked against Base" : ""}).`);
    else if (baseTimeWithheld) parts.push(`The record is in a Base block, but its time is not used as a bound: ${baseTimeWithheld}.`);
    if (times.ceilingEthereum) parts.push(`It existed by Ethereum block ${times.ceilingEthereum.blockNumber} (${iso(times.ceilingEthereum.blockTimestamp)})${confirmedTrue("confirmed.ceiling.ethereum") ? "" : givenEth}.`);
    if (member) parts.push(`The file is leaf ${member.index} of ${member.count} in the committed tree.`);
  }
  return { verdict, reasons, claims, member, floorCovers, times, baseTimeWithheld, floorTimeWithheld, reading: parts.join(" ") };
}


/** Build an export object from its parts (producers). Fields are written in the order the spec lists them. */
export function buildExport(parts: Omit<BitGraphExport, "format" | "spec">): BitGraphExport {
  const spec = parts.proof.attribution?.message;
  if (typeof spec !== "string") throw new TypeError("a tree/1 proof pins its spec in attribution.message");
  // A Base floor names its chain; an Ethereum floor leaves it out, so exports made before enclave v10 stay byte for byte what they were.
  let floor = parts.floor;
  if (floor && floor.chain === undefined) {
    let chain: "ethereum" | "base" | undefined;
    try {
      chain = signedFloorOf(parts.proof)?.chain;
    } catch {
      chain = undefined;
    }
    if (chain === "base") floor = { chain: "base", blockNumber: floor.blockNumber, blockHash: floor.blockHash, header: floor.header };
  }
  return { format: EXPORT_FORMAT, spec, proof: parts.proof, tree: parts.tree, floor, ceiling: parts.ceiling, settlement: parts.settlement };
}
