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
 *     "floor":      { "blockNumber", "blockHash", "header" } | null,
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
 *   floor            the committed bytes were finished after Ethereum block N  (needs N canonical)
 *   ceiling.base     the record existed by Base block B, at B's time          (needs B canonical on Base; provisional until then)
 *   ceiling.ethereum the record existed by Ethereum block H                   (needs H canonical; Base's honesty not needed)
 */

import { sha256 } from "@noble/hashes/sha256";
import { verifyProofIntegrity, createVerificationContext } from "./verifier.js";
import { computeSignedBodyHash } from "./proof-hash.js";
import { verifyNitroAttestation } from "./nitro.js";
import { verifyCeiling, type CeilingSidecar } from "./ceiling.js";
import { decodeHeader, hexToBytes as evmHex } from "./ceiling-evm.js";
import { base64ToBytes, bytesEqual, hexToBytes } from "./fuse.js";
import { verifyOutputRootSettlement, type OutputRootSettlement } from "./output-root.js";
import { MerkleTree } from "./fuse-merkle.js";
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
  floor: { blockNumber: number; blockHash: string; header: string } | null;
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
  lookups?: ExportLookups;
  pins?: {
    /** PCR0 values the verifier accepts. Without a list, PCR0 is reported, not judged. */
    pcr0?: string[];
    ceilingWriter?: string;
    baseChainId?: number;
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
  /** What the floor covers for the file in hand: "committed-bytes" (placements 0x01-0x03), "none" (as is), or null when no file was matched. */
  floorCovers: TreeVerifyResult["floorCovers"];
  /** The three time claims, as established. Null fields were not established. */
  times: {
    floor: { blockNumber: number; blockHash: string; blockTimestamp: number } | null;
    ceilingBase: { chainId: number; blockNumber: number; blockHash: string; blockTimestamp: number; provisional: boolean } | null;
    ceilingEthereum: { chainId: number; blockNumber: number; blockHash: string; blockTimestamp: number } | null;
  };
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

  const exp = parseExport(input);
  if (exp === null) {
    add("format", "This is a bitgraph-export/1 file", "UNDETERMINED", "", "not a bitgraph-export/1 document");
    return finish(claims, null, times, member);
  }
  add("format", "This is a bitgraph-export/1 file", "TRUE", "its structure", "format, proof and tree present");
  const proof = exp.proof;

  // 1. The proof, and the attestation bound to it.
  const integrity = await verifyProofIntegrity({ proof, context: createVerificationContext() });
  add("proof.signature", "The proof is signed and its position record is bound to it", integrity.valid ? "TRUE" : "FALSE", "Ed25519",
    integrity.valid ? "the enclave's signature over the canonical signed body verifies, and the position record's checks pass" : `the proof does not verify: ${integrity.reason ?? "unspecified"}`);
  const att = proof.environment?.attestation;
  if (att && att.format === "aws-nitro" && typeof att.reportB64 === "string") {
    const n = verifyNitroAttestation(att.reportB64, { expectedPcr0: proof.environment.measurement, expectedUserDataB64: computeSignedBodyHash(proof), ...(opts.pins?.rootDer ? { rootDer: opts.pins.rootDer } : {}) });
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
    add("attestation.pcr0", "The attested image is the one the proof names", r(pcr0), "PCR0 inside the signed document", pcr0?.detail ?? "not reached");
    add("attestation.binding", "The attestation is bound to this proof (user_data = SHA-256 of the signed body)", r(bound), "user_data inside the signed document", bound?.detail ?? "not reached");
    const measured = n.doc?.pcrs[0] ?? proof.environment.measurement;
    if (opts.pins?.pcr0 && opts.pins.pcr0.length > 0) {
      const ok = opts.pins.pcr0.map((x) => x.toLowerCase()).includes(measured.toLowerCase());
      add("attestation.pins", "The image is one the verifier accepts", ok ? "TRUE" : "FALSE", "the verifier's own allowlist", ok ? `PCR0 ${measured.slice(0, 16)}… is on the list` : `PCR0 ${measured.slice(0, 16)}… is not on the list`);
    } else {
      add("attestation.pins", "The image is one the verifier accepts", "UNDETERMINED", "", `no allowlist given: PCR0 is ${measured}; compare it with the published measurements, and rebuild it from source to check`);
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
    if (lc.ok && opts.bytes !== undefined && leavesBytes !== null && rootDoc !== null) {
      const leaves = decodeTreeLeaves(leavesBytes)!;
      const d = sha256(opts.bytes);
      const k = leaves.findIndex((l) => bytesEqual(l.artifact, d) || bytesEqual(l.origin, d));
      if (k >= 0) {
        const t = new MerkleTree(leaves.map(treeLeafHash));
        memberEvidence = buildTreeMemberEvidence(leaves[k]!, k, leaves.length, t.path(k));
        ownerList.found = true;
      }
    }
  }
  const tr = await verifyTreeMember({
    proof,
    ...(opts.bytes !== undefined ? { bytes: opts.bytes } : {}),
    ...(memberEvidence !== undefined ? { member: memberEvidence } : {}),
    rootDocument: rootDoc,
    extraSpecHashes: extra,
    proofAlreadyVerified: integrity.valid,
  });
  const specOk = tr.category !== "UNKNOWN_SPEC" && tr.category !== "INVALID_TREE_MARKER" && tr.category !== "NOT_TREE";
  add("spec.pin", "The proof pins a spec this verifier knows", tr.category === "NOT_TREE" ? "FALSE" : specOk ? "TRUE" : "FALSE", "the signed attribution.message",
    (specOk ? `SPEC.md SHA-256 ${tr.specHashB64}` : tr.reason) + (exp.spec !== proof.attribution?.message ? `; note: the export's unsigned "spec" label (${String(exp.spec)}) differs, and only the signed value counts` : ""));
  const rootOk = tr.tree !== null;
  add("tree.root", "The root document is the signed one and carries this position's commitment", rootOk ? "TRUE" : specOk ? "FALSE" : "UNDETERMINED", "SHA-256 over the signed position record, its nonce and the signed floor block hash",
    rootOk ? `a tree of ${tr.tree!.count} leaves, root ${tr.tree!.rootHex.slice(0, 16)}…` : tr.reason);
  member = tr.member;
  if (memberEvidence === undefined) {
    const why = ownerList === null
      ? "the export carries no member evidence"
      : !ownerList.ok
        ? "the owner's list did not verify, so no member can be read from it"
        : opts.bytes === undefined
          ? "no file in hand to look up in the owner's list"
          : "the file in hand is not in the owner's list";
    add("tree.member", "The file's leaf is in the committed tree", "NOT_CARRIED", "", why);
  } else {
    const pathOk = tr.member !== null;
    add("tree.member", "The file's leaf is in the committed tree", pathOk ? "TRUE" : rootOk ? "FALSE" : "UNDETERMINED", "SHA-256 (RFC 9162 path)",
      pathOk ? `leaf ${tr.member!.index} of ${tr.member!.count}; a path proves this leaf only, not the order of the others` : tr.reason);
  }
  if (opts.bytes === undefined) {
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
      add("bytes.floor", "What the floor covers for this file", "TRUE", "",
        tr.floorCovers === "none" ? "recorded as is: the file existed by the commit; nothing bounds it from below" : "the committed bytes were finished after the floor block; the original inside them has no floor of its own");
    }
  }

  // 3. The floor: the header hashes to the SIGNED slotAnchor block hash.
  const slotAnchor = proof.commit?.slotAnchor;
  if (!exp.floor) {
    add("floor.header", "The floor block's header is the one the proof signs", "NOT_CARRIED", "", "no floor header in the export");
  } else if (!slotAnchor) {
    add("floor.header", "The floor block's header is the one the proof signs", "FALSE", "", "the proof signs no floor block (commit.slotAnchor)");
  } else {
    try {
      const h = decodeHeader(evmHex(exp.floor.header));
      const ok = h.hash === slotAnchor.blockHash.toLowerCase() && h.number === slotAnchor.blockNumber && exp.floor.blockHash.toLowerCase() === h.hash && exp.floor.blockNumber === h.number;
      add("floor.header", "The floor block's header is the one the proof signs", ok ? "TRUE" : "FALSE", `Ethereum block ${h.number}, header as given`,
        ok ? `keccak-256 of the header equals the signed block hash; its time is ${iso(h.timestamp)}` : "the header does not hash to the signed floor block");
      if (ok) times.floor = { blockNumber: h.number, blockHash: h.hash, blockTimestamp: h.timestamp };
    } catch (e) {
      add("floor.header", "The floor block's header is the one the proof signs", "FALSE", "", `floor header: ${(e as Error).message}`);
    }
  }

  // 4. The ceiling on Base: the record is under a root in a Base transaction in block B.
  const writer = opts.pins?.ceilingWriter ?? "0xf3972408D853c975F86351C311f4310220bbF2a3";
  const baseChainId = opts.pins?.baseChainId ?? 8453;
  let ceilingB: { blockNumber: number; blockHash: string } | null = null;
  const c = exp.ceiling;
  if (!c || (c as { status?: string }).status === "pending" || !(c as CeilingSidecar).anchor) {
    add("ceiling.base", "The record is in a Base block", "NOT_CARRIED", "", c ? "ceiling pending: the Base write had not landed when this export was made" : "no ceiling in the export");
  } else {
    let r: Awaited<ReturnType<typeof verifyCeiling>>;
    try {
      r = await verifyCeiling(proof, c as CeilingSidecar, { writerAddress: writer, chainId: baseChainId, proofAlreadyVerified: integrity.valid });
    } catch (e) {
      r = { ok: false, reason: `the ceiling is malformed (${(e as Error).message})`, checks: [], headerCheckedAgainstChain: false };
    }
    if (r.ok && r.window) {
      ceilingB = { blockNumber: r.window.ceiling.blockNumber, blockHash: r.window.ceiling.blockHash };
      times.ceilingBase = { ...r.window.ceiling, provisional: true };
      add("ceiling.base", "The record is in a Base block", "TRUE", `SHA-256 path, the BGC1 payload, secp256k1, Merkle-Patricia; Base block ${r.window.ceiling.blockNumber}, header as given`,
        `under the root in transaction ${(c as CeilingSidecar).anchor!.txIndex} of Base block ${r.window.ceiling.blockNumber}; its time ${iso(r.window.ceiling.blockTimestamp)} is provisional until the block is checked against Base`);
    } else {
      add("ceiling.base", "The record is in a Base block", "FALSE", "", r.reason ?? "the ceiling does not verify");
    }
  }

  // 5. The settlement: the Base transaction existed by Ethereum block H.
  const s = exp.settlement;
  if (!s || (s as { status?: string }).status === "pending") {
    add("ceiling.ethereum", "The record existed by an Ethereum block", "NOT_CARRIED", "", s ? "settlement pending: Base's claim for this block had not reached Ethereum when this export was made" : "no settlement in the export");
  } else {
    const so = s as OutputRootSettlement;
    let r: ReturnType<typeof verifyOutputRootSettlement>;
    try {
      r = verifyOutputRootSettlement(so);
    } catch (e) {
      r = { ok: false, reason: `the settlement is malformed (${(e as Error).message})`, checks: [] };
    }
    const linked = ceilingB !== null && so.base?.blockNumber === ceilingB.blockNumber && typeof so.base?.blockHash === "string" && so.base.blockHash.toLowerCase() === ceilingB.blockHash.toLowerCase();
    if (r.ok && linked) {
      times.ceilingEthereum = r.existedBy!;
      add("ceiling.ethereum", "The record existed by an Ethereum block", "TRUE", `keccak-256 output root, EIP-2935 storage proof, Merkle-Patricia; Ethereum block ${r.existedBy!.blockNumber}, header as given`,
        `Base's output root for block ${so.outputRoot.blockNumber} commits to the ceiling's Base block and is carried by transaction ${so.ethereum.txIndex} of Ethereum block ${r.existedBy!.blockNumber} (${iso(r.existedBy!.blockTimestamp)}); this holds whatever Base's claim turns out to be`);
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
  await confirm("confirmed.floor", "The floor block is Ethereum's own", "ethereum", times.floor);
  await confirm("confirmed.ceiling.base", "The ceiling block is Base's own (makes its time final)", "base", ceilingB);
  await confirm("confirmed.ceiling.ethereum", "The settlement block is Ethereum's own", "ethereum", times.ceilingEthereum);
  const baseConfirmed = claims.find((x) => x.id === "confirmed.ceiling.base")?.result === "TRUE";
  if (times.ceilingBase) times.ceilingBase.provisional = !baseConfirmed;

  return finish(claims, exp, times, member, tr.floorCovers);
}

function finish(claims: ExportClaim[], exp: BitGraphExport | null, times: ExportVerifyResult["times"], member: TreeVerifyResult["member"], floorCovers: TreeVerifyResult["floorCovers"] = null): ExportVerifyResult {
  const offline = claims.filter((c) => c.level === "offline");
  const reasons = claims.filter((c) => c.result === "FALSE" || c.result === "UNDETERMINED").map((c) => `${c.id}: ${c.detail}`);
  const verdict = offline.some((c) => c.result === "FALSE") ? "FALSE" : exp === null || offline.some((c) => c.result === "UNDETERMINED" && c.id !== "attestation.pins") ? "UNDETERMINED" : "TRUE";
  const parts: string[] = [];
  if (verdict === "FALSE") parts.push("Something in this export contradicts the proof; see the failed claims.");
  else if (exp === null) parts.push("This is not a bitgraph-export/1 file.");
  else {
    if (times.floor && floorCovers === "none") parts.push(`The tree was committed after Ethereum block ${times.floor.blockNumber} (${iso(times.floor.blockTimestamp)}); this file was recorded as is, so nothing bounds the file itself from below.`);
    else if (times.floor) parts.push(`The committed bytes were finished after Ethereum block ${times.floor.blockNumber} (${iso(times.floor.blockTimestamp)}); an original inside them has no floor of its own.`);
    if (times.ceilingBase) parts.push(`The record existed by Base block ${times.ceilingBase.blockNumber} (${iso(times.ceilingBase.blockTimestamp)}${times.ceilingBase.provisional ? ", provisional until checked against Base" : ""}).`);
    if (times.ceilingEthereum) parts.push(`It existed by Ethereum block ${times.ceilingEthereum.blockNumber} (${iso(times.ceilingEthereum.blockTimestamp)}).`);
    if (member) parts.push(`The file is leaf ${member.index} of ${member.count} in the committed tree.`);
  }
  return { verdict, reasons, claims, member, floorCovers, times, reading: parts.join(" ") };
}

/** Build an export object from its parts (producers). Fields are written in the order the spec lists them. */
export function buildExport(parts: Omit<BitGraphExport, "format" | "spec">): BitGraphExport {
  const spec = parts.proof.attribution?.message;
  if (typeof spec !== "string") throw new TypeError("a tree/1 proof pins its spec in attribution.message");
  return { format: EXPORT_FORMAT, spec, proof: parts.proof, tree: parts.tree, floor: parts.floor, ceiling: parts.ceiling, settlement: parts.settlement };
}
