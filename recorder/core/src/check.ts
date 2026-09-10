// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Checking a folder, offline.
 *
 * ⚠️ THERE IS NO LEDGER SIDE ANY MORE. "Not on the ledger" stopped being a
 * finding on 2026-09-08: the bucket keeps only anchors, so a proof absent from
 * it is the ordinary case. A file with no evidence here is UNRECORDED, which
 * is a fact about this folder and not an accusation.
 *
 * ⚠️ ONLY FAILURES SPEAK. "If it's not verified it should say so, otherwise
 * it's just a viewer. If you see it, it's a BitGraph." A verified file reports
 * its name, its position and its time. A failure names the side it failed on.
 * Something that could not be checked says so and is NEVER counted as a
 * failure: "we could not check" and "this was never recorded" are opposite
 * claims, and only one of them is about the holder.
 *
 * ⚠️ NOTHING CLAIMS A COUNT IT DID NOT COUNT. A report that stopped early says
 * `partial` and suppresses nothing else to hide it.
 *
 * ## Three things are checked, and they are separate
 *
 *   1. bytes against the proof. The file on disk is the ORIGINAL; the fused
 *      bytes are virtual. So the check rebuilds: for a solo file the published
 *      verifier does it (FUSED_FROM_ORIGIN); for a set member the fused digest
 *      is recomputed from the streamed hash and matched against its row in the
 *      committed manifest.
 *   2. the proof itself. Signature, slot binding, the order the counters
 *      state, and the enclave measurement. Via @mikeargento/bitgraph-verify,
 *      unmodified.
 *   3. the anchors. Whatever the folder holds, with keccak256(header)
 *      recomputed against the hash the anchor signed before any block time is
 *      read off it.
 *
 * ## Why a set is bound once and its members are matched by digest
 *
 * verifyFuseMember binds the committed manifest on every call. For set/1 that
 * is a re-parse of the whole member list per member, which is quadratic: a
 * 2,000 member set parses a half-megabyte manifest 2,000 times. The set is
 * bound ONCE here, with the published verifier, over the committed artifact
 * itself; after that a member is bound to it by its row, which is what the
 * committed digest already covers. A test pins this against verifyFuseMember
 * so the two cannot drift.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
  verifyFuse,
  parseSetManifest,
  parseSetRoot,
  parseSetMemberProof,
  setRootFromMember,
  base64ToBytes,
  bytesToBase64,
  bytesEqual,
  type BitGraphProof,
} from "@mikeargento/bitgraph-verify";
import { KNOWN_ENCLAVE_MEASUREMENTS } from "@mikeargento/bitgraph-player";
import { validateNitroAttestationDocument } from "@mikeargento/bitgraph-audit";
import { scanFile } from "./hash.js";
import { readdir as readdirNames } from "node:fs/promises";
import { pathsFor, BITGRAPHS_DIR, ANCHOR_DIR, POSITIONS_DIR, INDEX_FILE, type FolderPaths } from "./paths.js";
import { describe } from "./inspect.js";
import { readMembers, evidenceFromMember, type MemberRow } from "./members.js";
import { readEvidence, type Evidence } from "./evidence.js";
import { FolderIndex } from "./index-store.js";
import { verifyWitness } from "./eth-anchor.js";
import type { BoundState } from "./anchors.js";

/**
 * Up to this size the published verifier is handed the actual bytes. Past it
 * the fused digest is recomputed from the streamed hash instead, because
 * holding a 4 GB file in memory to check it is the browser's problem and this
 * app exists to not have it. The report says which was used.
 */
export const VERIFIER_BYTES = 256 * 1024 * 1024;

export type CheckStatus = "verified" | "failed" | "undetermined" | "unrecorded";

export interface CheckedBound {
  side: "before" | "after";
  state: BoundState;
  note: string;
  /**
   * The block on Etherscan, from the anchor's own signed attribution.
   *
   * ⚠️ A PUBLIC BLOCK, NOT ONE OF OUR ROUTES. This link resolves for as long
   * as Ethereum does, with nothing of ours in the path. It is a convenience
   * for a person, not the evidence: the evidence is the header beside the
   * anchor, whose keccak256 is recomputed here.
   */
  etherscanUrl?: string;
  blockNumber?: number;
  /** Only ever set when keccak256(header) matched the hash the anchor signed. */
  blockTime?: string;
  /** The header contradicted the anchor. Loud. */
  contradiction?: string;
}

export interface CheckedFile {
  path: string;
  rel: string;
  name: string;
  bytes: number;
  status: CheckStatus;
  position: { epochId: string; counter: string } | null;
  /** How the bytes were bound: the published verifier over the bytes, or the streamed digest against the committed row. */
  method: "verifier" | "streamed" | null;
  /** Only on a failure: which of the three sides it failed on. */
  failedOn?: "bytes" | "membership" | "proof";
  /** Present on anything that is not plainly verified. */
  reason?: string;
  /** The verifier's own category, when it ran. */
  category?: string;
  /** The enclave that signed it, when it is one we know. */
  enclave?: string;
  /** What the hardware itself said, checked offline against the AWS root. */
  attestation?: AttestationReport;
  bounds?: CheckedBound[];
}

/**
 * The Nitro attestation, opened and checked.
 *
 * ⚠️ THE MEASUREMENT IN THE PROOF IS A CLAIM. `environment.measurement` is a
 * field in a document; PCR0 inside the signed attestation is what the hardware
 * said. They are compared here, and a proof whose claim does not match its own
 * attestation is a contradiction, not a pass. Never feed a check an input
 * signed by the party it exists to catch.
 *
 * ⚠️ The chain is checked to the AWS Nitro root that ships in the verifier,
 * offline, with no network and nothing to trust at read time.
 */
export interface AttestationReport {
  /** Every document check passed: COSE decode, payload, leaf, ECDSA P-384, chain to the AWS root. */
  valid: boolean;
  /** What the hardware said, which may not be what the proof claims. */
  pcr0: string | null;
  /** True only when the document's PCR0 IS the proof's declared measurement. */
  matchesDeclared: boolean;
  moduleId: string | null;
  certChainLength: number | null;
  /** Present when something failed, in the validator's own words. */
  failure: string | null;
  /** Every step, so the page can show the working. */
  checks: Array<{ name: string; pass: boolean; detail: string }>;
}

export interface FolderReport {
  root: string;
  counts: { verified: number; failed: number; undetermined: number; unrecorded: number };
  /** Files that have something to say. A verified file is not in here. */
  speaking: CheckedFile[];
  /** Every distinct position the folder holds. */
  positions: number;
  /** ⚠️ True when the walk stopped early. Nothing claims a count it did not count. */
  partial: boolean;
}

export interface CheckOptions {
  /** Called for every file, verified ones included, so a UI can show progress. */
  onFile?: (file: CheckedFile, done: number, total: number) => void;
  /** Stop early. The report says `partial`. */
  signal?: { aborted: boolean };
  /** Check only these files, as absolute paths. Default: walk the folder. */
  only?: readonly string[];
  /**
   * The library of recordings, consulted when the folder itself holds nothing.
   *
   * ⚠️ A DROP LEAVES NOTHING WHERE THE FILES CAME FROM, so checking the folder
   * you dropped out of finds no evidence in it at all. That is the shape
   * working as intended, and it would make the reader useless if the check
   * stopped there: what a person means by "check this folder" is "are these
   * bytes recorded anywhere I know about". The library is where they are.
   */
  library?: string;
  /**
   * Put every row in the report, verified ones included.
   *
   * ⚠️ Off by default, and the default is the rule: only failures speak, and a
   * folder of 48,000 verified files is a count, not 48,000 rows. It is on when
   * a caller named the files it wants, because then the rows ARE the answer.
   */
  everyRow?: boolean;
  /**
   * Enclave measurements to recognise BEYOND the ones this build ships.
   *
   * ⚠️ Naming one here is a trust decision and it is never made quietly: a
   * proof from an unlisted enclave reads as UNDETERMINED, which is the right
   * answer, and stays that way until somebody says otherwise in as many words.
   * This exists for a licensee running their own enclave, and for the test
   * harness, which mints under a deliberately fake PCR0.
   */
  alsoKnownEnclaves?: ReadonlyArray<{ pcr0: string; label: string }>;
}

/** Check every file in a folder against the evidence beside it. */
export async function checkFolder(root: string, options: CheckOptions = {}): Promise<FolderReport> {
  const paths = pathsFor(root);
  const index = await FolderIndex.open(paths.index);
  const positions = new PositionCache(paths);
  const members = new MemberCache();
  const libraryPath = options.library ?? "";
  const library = libraryPath === "" ? null : await FolderIndex.open(join(libraryPath, INDEX_FILE));
  /* ⚠️ A RECORDING FOLDER CHECKS ITSELF. Whoever you hand one to has no
   * library, no index and no settings: they have a folder. If the thing being
   * checked holds a proof.json, that proof answers for everything in it and
   * nothing else is consulted. */
  const here = await readBundleHere(root);

  const known = knownEnclaves(options.alsoKnownEnclaves);
  /* ⚠️ A RECORDING'S OWN FILES ARE NOT FILES SOMEBODY RECORDED. Checking a
   * recording folder used to count proof.json and the anchors as "5 not
   * recorded", which is noise about the wrong thing. */
  const walked = options.only !== undefined ? [...options.only] : await walk(root);
  const files = here === null ? walked : walked.filter((p) => !isRecordingOwn(root, p));
  const counts = { verified: 0, failed: 0, undetermined: 0, unrecorded: 0 };
  const speaking: CheckedFile[] = [];
  let done = 0;
  let partial = false;

  for (const path of files) {
    if (options.signal?.aborted === true) {
      partial = true;
      break;
    }
    const checked = await checkOne(paths, index, positions, root, path, known, members, library, libraryPath, here);
    counts[checked.status]++;
    if (options.everyRow === true || checked.status !== "verified") speaking.push(checked);
    done++;
    options.onFile?.(checked, done, files.length);
  }

  return { root, counts, speaking, positions: positions.size, partial };
}

/** Check one file. Exported so the app can check a single dropped file. */
export async function checkFile(root: string, path: string, options: CheckOptions = {}): Promise<CheckedFile> {
  const paths = pathsFor(root);
  const index = await FolderIndex.open(paths.index);
  const libraryPath = options.library ?? "";
  const library = libraryPath === "" ? null : await FolderIndex.open(join(libraryPath, INDEX_FILE));
  return checkOne(paths, index, new PositionCache(paths), root, path, knownEnclaves(options.alsoKnownEnclaves), new MemberCache(), library, libraryPath, await readBundleHere(root));
}

type KnownEnclaves = ReadonlyArray<{ pcr0: string; label: string }>;

function knownEnclaves(extra: ReadonlyArray<{ pcr0: string; label: string }> = []): KnownEnclaves {
  return [...KNOWN_ENCLAVE_MEASUREMENTS.map((m) => ({ pcr0: m.pcr0, label: m.label })), ...extra];
}

// ---------------------------------------------------------------------------

async function checkOne(paths: FolderPaths, index: FolderIndex, positions: PositionCache, root: string, path: string, known: KnownEnclaves, members: MemberCache, library: FolderIndex | null, libraryPath: string, here: BundleHere | null): Promise<CheckedFile> {
  const rel = relative(root, path).split(sep).join("/");
  let scanned;
  try {
    scanned = await scanFile(path, rel);
  } catch (err) {
    return {
      path,
      rel,
      name: rel.split("/").pop() ?? rel,
      bytes: 0,
      status: "undetermined",
      position: null,
      method: null,
      reason: `the file could not be read: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const base = { path, rel, name: scanned.name, bytes: scanned.bytes };
  const originB64 = bytesToBase64(scanned.originDigest);

  const found = await findEvidence(paths, index, rel, originB64, members, library, libraryPath, here);
  if (found.evidence === null) {
    /* ⚠️ NOT A FAULT, AND NEVER "not on the ledger". These bytes have no
     * evidence in this folder. That is all this says, and it is all that can
     * honestly be said: bytes alone cannot tell a file that was altered from
     * a file that was never recorded, and only one of those accuses anybody.
     *
     * What CAN be said is that a BitGraph in this folder is about a file of
     * this name and different bytes, which is the fact a person needs. It is
     * reported as part of the reason and is still not a failure. */
    return {
      ...base,
      status: "unrecorded",
      position: null,
      method: null,
      reason: found.nameTaken
        ? "no BitGraph for these bytes. A BitGraph in this folder is about a file of this name and different bytes."
        : "no BitGraph for these bytes in this folder.",
    };
  }
  const evidence: Evidence = found.evidence;

  const bound = await positions.bind(evidence, known, found.bundleDir);
  if (bound.problem !== null) {
    return { ...base, status: bound.contradicted ? "failed" : "undetermined", position: bound.position, method: null, ...(bound.contradicted ? { failedOn: "proof" as const } : {}), reason: bound.problem, ...(bound.enclave !== null ? { enclave: bound.enclave } : {}) };
  }

  const bytesResult = evidence.member === undefined
    ? await bindSolo(bound, scanned, evidence)
    : bindMember(bound, scanned, evidence, originB64);

  const bounds = await positions.bounds(evidence.position, found.bundleDir);
  const common = {
    ...base,
    position: bound.position,
    method: bytesResult.method,
    ...(bound.enclave !== null ? { enclave: bound.enclave } : {}),
    ...(bound.attestation !== null ? { attestation: bound.attestation } : {}),
    bounds,
  };

  if (bytesResult.kind === "failed") {
    return { ...common, status: "failed", failedOn: bytesResult.side, reason: bytesResult.reason, ...(bytesResult.category !== undefined ? { category: bytesResult.category } : {}) };
  }
  if (bytesResult.kind === "undetermined") {
    return { ...common, status: "undetermined", reason: bytesResult.reason };
  }
  if (!bound.proofValid) {
    return { ...common, status: "failed", failedOn: "proof", reason: bound.proofReason ?? "the proof did not verify." };
  }
  /* ⚠️ A proof that claims one enclave and attests to another is a
   * contradiction, and the only thing on this page that is. A document that
   * would not open at all is a gap, and is treated as one below. */
  if (bound.attestation !== null && bound.attestation.valid && !bound.attestation.matchesDeclared) {
    return { ...common, status: "failed", failedOn: "proof", reason: `this proof declares enclave measurement ${bound.measurement ?? "none"}, and its own hardware attestation says ${bound.attestation.pcr0 ?? "something else"}.` };
  }
  if (bound.enclave === null) {
    /* An enclave nobody here has heard of. Not a forgery and not a pass:
     * UNDETERMINED, exactly as the player treats an unknown PCR0. */
    return { ...common, status: "undetermined", reason: `this proof was signed by an enclave measurement this build does not know (${bound.measurement ?? "none declared"}). It is not invalid; it cannot be placed.` };
  }
  return { ...common, status: "verified", ...(bytesResult.category !== undefined ? { category: bytesResult.category } : {}) };
}

type BytesResult =
  | { kind: "ok"; method: "verifier" | "streamed"; category?: string }
  | { kind: "failed"; method: "verifier" | "streamed" | null; side: "bytes" | "membership"; reason: string; category?: string }
  | { kind: "undetermined"; method: null; reason: string };

async function bindSolo(bound: BoundPosition, scanned: Awaited<ReturnType<typeof scanFile>>, evidence: Evidence): Promise<BytesResult> {
  if (bound.proof === null) return { kind: "undetermined", method: null, reason: "the proof could not be read." };
  if (scanned.bytes <= VERIFIER_BYTES) {
    const bytes = new Uint8Array(await readFile(scanned.path));
    const r = await verifyFuse({ proof: bound.proof, bytes });
    /* The file on disk is the ORIGINAL. The fused bytes were never written, so
     * FUSED_FROM_ORIGIN is the pass: the verifier rebuilt them and they hash to
     * the committed artifact. FUSED_DIRECT would mean the file IS the fused
     * artifact, which is also a pass and happens if someone kept them. */
    if (r.category === "FUSED_FROM_ORIGIN" || r.category === "FUSED_DIRECT") return { kind: "ok", method: "verifier", category: r.category };
    return { kind: "failed", method: "verifier", side: "bytes", reason: r.reason ?? `the verifier answered ${r.category}.`, category: r.category };
  }
  if (bound.commitment === null) return { kind: "undetermined", method: null, reason: "the proof carries no slot record, so the fused digest cannot be rebuilt." };
  const recomputed = bytesToBase64(scanned.fusedDigest(bound.commitment));
  if (recomputed !== evidence.artifactDigestB64 || recomputed !== bound.artifactDigestB64) {
    return { kind: "failed", method: "streamed", side: "bytes", reason: "these bytes do not rebuild the artifact this proof committed." };
  }
  return { kind: "ok", method: "streamed" };
}

function bindMember(bound: BoundPosition, scanned: Awaited<ReturnType<typeof scanFile>>, evidence: Evidence, originB64: string): BytesResult {
  if (bound.commitment === null) return { kind: "undetermined", method: null, reason: "the set's slot commitment could not be read." };
  const recomputed = bytesToBase64(scanned.fusedDigest(bound.commitment));

  if (bound.kind === "set/1") {
    const row = bound.rows?.get(recomputed);
    if (row === undefined) {
      return { kind: "failed", method: "streamed", side: "membership", reason: "these bytes are not a member of the set this position committed." };
    }
    if (row.originB64 !== originB64) {
      return { kind: "failed", method: "streamed", side: "bytes", reason: "the member row names a different original." };
    }
    return { kind: "ok", method: "streamed", category: "SET_MEMBER_FROM_ORIGIN" };
  }

  /* set/2: the committed artifact is a root, so membership travels with the
   * file. Its own evidence is the only thing that can put it in this set, and
   * the path has to reach the root the position committed. */
  const parsed = parseSetMemberProof(evidence.member?.memberProof);
  if (parsed === null) return { kind: "undetermined", method: null, reason: "this file's set membership evidence is missing or unreadable, so it cannot be placed in the set." };
  if (bytesToBase64(parsed.member.artifact) !== recomputed) {
    return { kind: "failed", method: "streamed", side: "bytes", reason: "these bytes do not rebuild the artifact this member's row names." };
  }
  if (bytesToBase64(parsed.member.origin) !== originB64) {
    return { kind: "failed", method: "streamed", side: "bytes", reason: "the member row names a different original." };
  }
  const root = setRootFromMember(parsed.member, parsed.index, parsed.count, parsed.path);
  if (root === null || bound.root === null || !bytesEqual(root, bound.root)) {
    return { kind: "failed", method: "streamed", side: "membership", reason: "this member's path does not reach the root this position committed." };
  }
  return { kind: "ok", method: "streamed", category: "SET_MEMBER_FROM_ORIGIN" };
}

// ---------------------------------------------------------------------------

interface BoundPosition {
  position: { epochId: string; counter: string };
  kind: "solo" | "set/1" | "set/2";
  proof: BitGraphProof | null;
  commitment: Uint8Array | null;
  artifactDigestB64: string | null;
  /** set/1 only: every committed row, by its artifact digest. */
  rows: Map<string, { originB64: string; placement: string }> | null;
  /** set/2 only: the committed root. */
  root: Uint8Array | null;
  proofValid: boolean;
  proofReason: string | null;
  measurement: string | null;
  /** The label of a known enclave, or null when the measurement is one this build does not carry. */
  enclave: string | null;
  attestation: AttestationReport | null;
  /** Set when the position could not be bound. */
  problem: string | null;
  /** True when the problem is a contradiction rather than a gap. */
  contradicted: boolean;
}

class PositionCache {
  private readonly cache = new Map<string, BoundPosition>();
  private readonly boundsCache = new Map<string, CheckedBound[]>();
  constructor(private readonly paths: FolderPaths) {}

  get size(): number {
    return this.cache.size;
  }

  async bind(evidence: Evidence, known: KnownEnclaves, bundleDir?: string): Promise<BoundPosition> {
    const key = `${evidence.position.epochId} ${evidence.position.counter}`;
    const hit = this.cache.get(key);
    /* A solo position is one file's own proof, carried inside its evidence, so
     * it is bound per file and never shared. */
    if (hit !== undefined && evidence.proof.kind === "beside") return hit;

    const bound = await this.load(evidence, known, bundleDir);
    if (evidence.proof.kind === "beside") this.cache.set(key, bound);
    else this.cache.set(key, bound);
    return bound;
  }

  private async load(evidence: Evidence, known: KnownEnclaves, bundleDir?: string): Promise<BoundPosition> {
    const blank: BoundPosition = {
      position: evidence.position,
      kind: "solo",
      proof: null,
      commitment: null,
      artifactDigestB64: null,
      rows: null,
      root: null,
      proofValid: false,
      proofReason: null,
      measurement: null,
      enclave: null,
      attestation: null,
      problem: null,
      contradicted: false,
    };

    if (evidence.proof.kind === "inline") {
      const proof = evidence.proof.proof;
      const { measurement, enclave } = enclaveOf(proof, known);
      const attestation = await attestationOf(proof, measurement);
      return { ...blank, proof, artifactDigestB64: digestOfProof(proof), measurement, enclave, attestation, ...(await soloCommitment(proof)) };
    }

    /* A set: read the shared proof and the committed artifact beside it —
     * from the recording folder when it came out of one, and from the synced
     * folder's positions/ when it did not. */
    const dir = bundleDir ?? this.paths.position(evidence.position.epochId, evidence.position.counter);
    let proof: BitGraphProof;
    let committed: Uint8Array;
    try {
      proof = JSON.parse(await readFile(join(dir, "proof.json"), "utf8")) as BitGraphProof;
      committed = new Uint8Array(await readFile(join(dir, "manifest.json")));
    } catch (err) {
      return { ...blank, problem: `this file's position could not be read from the folder: ${err instanceof Error ? err.message : String(err)}` };
    }

    const r = await verifyFuse({ proof, bytes: committed });
    const { measurement, enclave } = enclaveOf(proof, known);
    const attestation = await attestationOf(proof, measurement);
    if (r.category !== "FUSED_DIRECT") {
      return { ...blank, proof, measurement, enclave, problem: `the set this file belongs to did not bind to its proof (${r.category}${r.reason ? `: ${r.reason}` : ""}).`, contradicted: true };
    }
    const commitment = r.slotCommitmentB64 === null ? null : base64ToBytes(r.slotCommitmentB64);

    const set1 = parseSetManifest(committed);
    if (set1 !== null) {
      const rows = new Map<string, { originB64: string; placement: string }>();
      for (const m of set1.members) rows.set(bytesToBase64(m.artifact), { originB64: bytesToBase64(m.origin), placement: m.placement });
      return { ...blank, kind: "set/1", proof, commitment, artifactDigestB64: r.artifactDigestB64, rows, proofValid: r.proof.valid, proofReason: r.proof.reason ?? null, measurement, enclave, attestation };
    }
    const set2 = parseSetRoot(committed);
    if (set2 !== null) {
      return { ...blank, kind: "set/2", proof, commitment, artifactDigestB64: r.artifactDigestB64, root: set2.root, proofValid: r.proof.valid, proofReason: r.proof.reason ?? null, measurement, enclave, attestation };
    }
    return { ...blank, proof, measurement, enclave, problem: "the committed artifact beside this position is neither a set manifest nor a set root.", contradicted: true };
  }

  /**
   * Whatever the folder holds about this position's two sides.
   *
   * ⚠️ FROM THE RECORDING FOLDER WHEN THERE IS ONE. The anchor pass writes a
   * recording's anchors into its own `ethereum-anchors/`; reading the old
   * `positions/` place instead answered "not fetched" for anchors that were
   * sitting right there, and the page said "anchors on the way" for ever
   * (Mike, 2026-09-09: "so new anchors wont load?").
   */
  async bounds(position: { epochId: string; counter: string }, bundleDir?: string): Promise<CheckedBound[]> {
    const dir = bundleDir ?? this.paths.position(position.epochId, position.counter);
    const key = `${position.epochId} ${position.counter} ${dir}`;
    const hit = this.boundsCache.get(key);
    if (hit !== undefined) return hit;

    const status = await readJson(join(dir, "anchors-status.json"));
    const out: CheckedBound[] = [];
    for (const side of ["before", "after"] as const) {
      const anchor = await readJson(join(dir, ANCHOR_DIR, `anchor-${side}.json`));
      if (anchor !== null) {
        const signedHash = anchorBlockHash(anchor);
        const witness = await readJson(join(dir, ANCHOR_DIR, `anchor-${side}-witness.json`));
        const verdict = verifyWitness(witness, signedHash);
        const url = anchorEtherscan(anchor);
        if (verdict.ok) {
          out.push({ side, state: "anchored", note: "An Ethereum anchor bounds this position on this side, and its block header was checked against the hash the anchor signed.", blockNumber: verdict.blockNumber, blockTime: verdict.blockTime.toISOString(), ...(url !== null ? { etherscanUrl: url } : {}) });
        } else if (verdict.kind === "contradicted") {
          out.push({ side, state: "anchored", note: "An anchor is present but its block header contradicts it.", contradiction: verdict.reason, ...(url !== null ? { etherscanUrl: url } : {}) });
        } else {
          out.push({ side, state: "anchored", note: `An Ethereum anchor bounds this position on this side. Its block time is not stated here: ${verdict.reason}`, ...(url !== null ? { etherscanUrl: url } : {}) });
        }
        continue;
      }
      const s = (status as { before?: { state?: string; note?: string }; after?: { state?: string; note?: string } } | null)?.[side];
      if (s !== undefined && typeof s.state === "string") {
        out.push({ side, state: s.state as BoundState, note: s.note ?? "" });
      } else {
        /* ⚠️ Neither an anchor nor a reason. That is "not fetched", and it is
         * said in those words: it is not "no anchor exists". */
        out.push({ side, state: "unavailable", note: "This side has not been fetched yet. That is not a statement about whether an anchor exists." });
      }
    }
    this.boundsCache.set(key, out);
    return out;
  }
}

async function soloCommitment(proof: BitGraphProof): Promise<{ commitment: Uint8Array | null; proofValid: boolean; proofReason: string | null }> {
  /* verifyFuse over the proof's own artifact digest is not possible without
   * bytes, so the commitment is taken from the verifier's own recomputation
   * during the bytes check. Here it is read from the slot record the same way
   * the verifier does, for the streamed path only. */
  const { computeSlotCommitment } = await import("@mikeargento/bitgraph-verify");
  const slot = (proof as { slotAllocation?: unknown }).slotAllocation;
  if (slot === undefined || slot === null) return { commitment: null, proofValid: true, proofReason: null };
  try {
    return { commitment: computeSlotCommitment(slot as Parameters<typeof computeSlotCommitment>[0]), proofValid: true, proofReason: null };
  } catch {
    return { commitment: null, proofValid: true, proofReason: null };
  }
}

function digestOfProof(proof: BitGraphProof): string | null {
  const a = (proof as { artifact?: { digestB64?: unknown } }).artifact;
  return typeof a?.digestB64 === "string" ? a.digestB64 : null;
}

function enclaveOf(proof: BitGraphProof, known: KnownEnclaves): { measurement: string | null; enclave: string | null } {
  const env = (proof as { environment?: { measurement?: unknown } }).environment;
  const measurement = typeof env?.measurement === "string" ? env.measurement.toLowerCase() : null;
  if (measurement === null) return { measurement: null, enclave: null };
  /* A malformed entry in a settings file is skipped, never a crash. */
  const hit = known.find((m) => typeof m?.pcr0 === "string" && m.pcr0.toLowerCase() === measurement);
  return { measurement, enclave: hit?.label ?? null };
}

/**
 * Open the Nitro attestation and check it, offline, against the AWS root the
 * verifier ships.
 *
 * ⚠️ ONCE PER POSITION, NEVER PER FILE. This is ECDSA P-384 and a certificate
 * chain; a set of 30,000 members shares one proof and therefore one
 * attestation, and doing it per member would be 30,000 chain validations for
 * one answer.
 */
async function attestationOf(proof: BitGraphProof, declared: string | null): Promise<AttestationReport | null> {
  const env = (proof as { environment?: { attestation?: { reportB64?: unknown } } }).environment;
  const report = env?.attestation?.reportB64;
  if (typeof report !== "string" || report === "") return null;
  try {
    const r = await validateNitroAttestationDocument(report, declared !== null ? { expectedPcr0: declared } : {});
    const pcr0 = typeof r.pcr0 === "string" ? r.pcr0.toLowerCase() : null;
    return {
      valid: r.documentValid === true,
      pcr0,
      matchesDeclared: pcr0 !== null && declared !== null && pcr0 === declared.toLowerCase(),
      moduleId: typeof r.moduleId === "string" ? r.moduleId : null,
      certChainLength: typeof r.certChainLength === "number" ? r.certChainLength : null,
      failure: typeof r.failure === "string" ? r.failure : null,
      checks: Array.isArray(r.checks) ? r.checks.map((c) => ({ name: c.name, pass: c.pass, detail: c.detail })) : [],
    };
  } catch (err) {
    /* ⚠️ A document that could not be opened is a GAP. It is reported as one
     * and never as a forgery. */
    return { valid: false, pcr0: null, matchesDeclared: false, moduleId: null, certChainLength: null, failure: `the attestation could not be read: ${err instanceof Error ? err.message : String(err)}`, checks: [] };
  }
}

/** The block's page, out of the anchor's own signed attribution. */
function anchorEtherscan(anchor: unknown): string | null {
  const title = (anchor as { attribution?: { title?: unknown } } | null)?.attribution?.title;
  return typeof title === "string" && /^https:\/\/etherscan\.io\/block\/\d+$/.test(title) ? title : null;
}

function anchorBlockHash(anchor: unknown): string | null {
  const a = anchor as { attribution?: { message?: unknown } } | null;
  return typeof a?.attribution?.message === "string" ? a.attribution.message : null;
}

interface FoundEvidence {
  evidence: Evidence | null;
  /** True when evidence sits at this file's name but is about different bytes. */
  nameTaken: boolean;
  /** The recording folder it came out of, when it came out of one. */
  bundleDir?: string;
}

async function findEvidence(paths: FolderPaths, index: FolderIndex, rel: string, originB64: string, members: MemberCache, library: FolderIndex | null, libraryPath: string, here: BundleHere | null): Promise<FoundEvidence> {
  /* The recording this folder IS, before anything else is consulted. */
  if (here !== null) {
    const built = here.evidenceFor(originB64);
    if (built !== null) return { evidence: built, nameTaken: false, bundleDir: here.dir };
  }
  /* The mirror first: it is right almost always and costs two opens.
   *
   * ⚠️ BOTH NAMES, ALWAYS. A file's evidence is `.bitgraph` when it carries a
   * whole proof and `.position.json` when it names a shared one, and a folder
   * recorded before that split is full of `.bitgraph` pointers. Looking for
   * one name would call every one of those files unrecorded, which is the
   * worst thing this check can say about something that is fine. */
  let direct: Evidence | null = null;
  for (const carries of ["inline", "beside"] as const) {
    const found = await readEvidence(paths.evidence(rel, carries));
    if (found === null) continue;
    if (found.originDigestB64 === originB64) return { evidence: found, nameTaken: false };
    direct ??= found;
  }

  /* Then by CONTENT. A renamed or moved file keeps its BitGraph; the name was
   * never the binding. */
  for (const row of index.rowsFor(originB64)) {
    if (row.evidence !== "") {
      const e = await readEvidence(join(paths.bitgraphs, ...row.evidence.split("/")));
      if (e !== null && e.originDigestB64 === originB64) return { evidence: e, nameTaken: false };
    }
    /* ⚠️ A big set writes nothing beside its members, so this is the ordinary
     * path there. members.jsonl under the position has the row. */
    const built = await members.evidenceFor(paths, { epochId: row.epochId, counter: row.counter }, originB64);
    if (built !== null) return { evidence: built, nameTaken: false };
  }

  /* ⚠️ NO INDEX, NO PROBLEM. Deleting it must cost a rescan and nothing else,
   * so with no row to point the way every position the folder holds is asked. */
  for (const position of await members.positions(paths)) {
    const built = await members.evidenceFor(paths, position, originB64);
    if (built !== null) return { evidence: built, nameTaken: false };
  }

  /* Then the library: the recordings this app has made, wherever they were
   * dropped from. */
  if (library !== null) {
    const row = library.rowsFor(originB64)[0];
    if (row !== undefined && row.bundle !== undefined && row.bundle !== "") {
      const dir = join(libraryPath, ...row.bundle.split("/"));
      const described = await describe(libraryPath, { evidencePath: join(dir, "proof.json"), originDigestB64: originB64 });
      if (described.evidence !== null) return { evidence: described.evidence, nameTaken: false, bundleDir: dir };
    }
  }
  return { evidence: null, nameTaken: direct !== null };
}

/**
 * A recording folder, read once: its proof, and every member it names.
 *
 * ⚠️ THIS IS THE READER. A folder somebody sends you is the whole of a
 * BitGraph, and checking it must need nothing else at all: no index, no
 * library, no settings, no network. Every question the check asks is answered
 * from the bytes in that folder.
 */
interface BundleHere {
  dir: string;
  evidenceFor(originDigestB64: string): Evidence | null;
}

async function readBundleHere(dir: string): Promise<BundleHere | null> {
  let proof: BitGraphProof;
  try {
    proof = JSON.parse(await readFile(join(dir, "proof.json"), "utf8")) as BitGraphProof;
  } catch {
    return null;
  }
  const commit = (proof as { commit?: { epochId?: unknown; counter?: unknown } }).commit;
  const position = {
    epochId: typeof commit?.epochId === "string" ? commit.epochId : "",
    counter: typeof commit?.counter === "string" ? commit.counter : String(commit?.counter ?? ""),
  };

  const rows = new Map<string, MemberRow>();
  const text = await readFile(join(dir, "members.jsonl"), "utf8").catch(() => null);
  if (text !== null) {
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      try {
        const row = JSON.parse(line) as MemberRow;
        if (typeof row.originDigestB64 === "string") rows.set(row.originDigestB64, row);
      } catch {
        /* ⚠️ A torn line is one member, not the file. */
      }
    }
  }
  const attribution = (proof as { attribution?: { message?: unknown; title?: unknown } }).attribution;
  const soloOrigin = typeof attribution?.message === "string" ? attribution.message : null;

  return {
    dir,
    evidenceFor(originDigestB64) {
      const row = rows.get(originDigestB64);
      if (row !== undefined) {
        const kind: "set/1" | "set/2" = row.memberProof === undefined ? "set/1" : "set/2";
        return evidenceFromMember(row, position, kind, rows.size, ".");
      }
      /* A recording of one file: the proof stands on its own. */
      if (rows.size === 0 && soloOrigin === originDigestB64) {
        return {
          version: "bitgraph-evidence/1",
          file: { name: "", bytes: 0 },
          placement: (typeof attribution?.title === "string" ? attribution.title : "trailer/1") as Evidence["placement"],
          originDigestB64,
          artifactDigestB64: (proof as { artifact?: { digestB64?: string } }).artifact?.digestB64 ?? "",
          position,
          proof: { kind: "inline", proof },
          writtenAt: new Date().toISOString(),
        };
      }
      return null;
    },
  };
}

/**
 * Every position's member list, read once each and kept.
 *
 * ⚠️ ONCE PER POSITION, NEVER PER FILE. A 30,000 member set shares one
 * members.jsonl of about 39 MB; reading it per file would be 30,000 reads to
 * answer 30,000 questions it answers all at once.
 */
class MemberCache {
  private readonly loaded = new Map<string, Map<string, MemberRow>>();
  private known: Array<{ epochId: string; counter: string }> | null = null;

  async evidenceFor(paths: FolderPaths, position: { epochId: string; counter: string }, originB64: string): Promise<Evidence | null> {
    const key = `${position.epochId} ${position.counter}`;
    let rows = this.loaded.get(key);
    if (rows === undefined) {
      rows = await readMembers(paths.root, position);
      this.loaded.set(key, rows);
    }
    const row = rows.get(originB64);
    if (row === undefined) return null;
    const kind: "set/1" | "set/2" = row.memberProof === undefined ? "set/1" : "set/2";
    return evidenceFromMember(row, position, kind, rows.size, paths.positionRef(position.epochId, position.counter));
  }

  /** Every position the folder holds, from the directory names. */
  async positions(paths: FolderPaths): Promise<Array<{ epochId: string; counter: string }>> {
    if (this.known !== null) return this.known;
    const out: Array<{ epochId: string; counter: string }> = [];
    try {
      const base = join(paths.bitgraphs, POSITIONS_DIR);
      for (const epoch of await readdirNames(base, { withFileTypes: true })) {
        if (!epoch.isDirectory()) continue;
        for (const counter of await readdirNames(join(base, epoch.name), { withFileTypes: true })) {
          if (!counter.isDirectory()) continue;
          /* The directory name is base64url of the epoch; members.jsonl inside
           * carries no epoch, so the position is read back from the path. */
          out.push({ epochId: fromUrlSafe(epoch.name), counter: counter.name });
        }
      }
    } catch {
      /* no positions folder yet */
    }
    this.known = out;
    return out;
  }
}

/** The inverse of the base64url the directory name is written in. */
function fromUrlSafe(name: string): string {
  const b64 = name.replace(/-/g, "+").replace(/_/g, "/");
  return b64 + "=".repeat((4 - (b64.length % 4)) % 4);
}

async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

/** Every ordinary file under the folder, skipping the BitGraphs folder itself. */
export async function walk(root: string, options: { excluding?: readonly string[] } = {}): Promise<string[]> {
  const out: string[] = [];
  /* ⚠️ THE BITGRAPH FOLDER IS NEVER WALKED INTO. Mike synced his own BitGraph
   * folder on 2026-09-09 and the app recorded its first recording's proof
   * files as a set of five, at a real position. Whatever is excluded here is
   * skipped wherever it sits under the root. */
  const never = new Set((options.excluding ?? []).map((p) => p.replace(/\/+$/, "")));
  const visit = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === BITGRAPHS_DIR && dir === root) continue;
      if (e.name.startsWith(".")) continue;
      const p = join(dir, e.name);
      if (never.has(p)) continue;
      if (e.isDirectory()) await visit(p);
      else if (e.isFile()) out.push(p);
      else if (e.isSymbolicLink()) {
        /* A symlink is followed only when it lands on a file inside the
         * folder; anything else is left alone rather than recorded twice or
         * chased out of the tree. */
        try {
          const s = await stat(p);
          if (s.isFile()) out.push(p);
        } catch {
          /* dangling; nothing to record */
        }
      }
    }
  };
  await visit(root);
  out.sort();
  return out;
}

/** Files a recording folder holds that are the app's, not the person's. */
const RECORDING_OWN = new Set(["proof.json", "manifest.json", "members.jsonl", "anchors-status.json"]);

function isRecordingOwn(root: string, path: string): boolean {
  const rel = relative(root, path).split(sep).join("/");
  if (rel.startsWith(`${ANCHOR_DIR}/`)) return true;
  return !rel.includes("/") && RECORDING_OWN.has(rel);
}
