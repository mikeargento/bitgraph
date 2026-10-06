/**
 * The download package's layout and its README (2026-10-01, after an outside
 * review of a real package: "no README, plain-language claim, verification
 * command ... two identically named images ... a recipient can hash the
 * top-level original, compare it with the artifact digest, and mistakenly
 * conclude verification failed").
 *
 *   README.md                     how to read the package, the claim and its limits
 *   proof.json                    the signed proof
 *   committed/<name>              the exact bytes the proof's digest names
 *   original/<name>               the file the committed one was made from, when there is one
 *   bitgraphed-file/<name>        one file carrying the whole proof inside it, when it could be built
 *   ethereum-anchors/             the floor and closing anchors with their block headers
 *   base-ceiling/                 the ceiling in time, and its settlement when attached
 *   base-ceiling/blobs/           the Ethereum blob bytes the settlement pointer names (<versioned hash>.bin)
 *
 * Readers (the drop box, bitgraph-audit) find files by what they are, not by
 * these names, and still read the earlier layout (`new-file/` beside a
 * top-level original).
 */

import { baseTimeIsBound } from "@mikeargento/bitgraph-verify";

export const PKG_COMMITTED_DIR = "committed";
export const PKG_ORIGINAL_DIR = "original";
export const PKG_CARRIER_DIR = "bitgraphed-file";
/** The committed bytes' folder in packages made before 2026-10-01. */
export const PKG_LEGACY_NEW_FILE_DIR = "new-file";
export const PKG_README = "README.md";

/** Folders a package may hold that are evidence or explanation, never a recording of their own. */
export const PKG_KNOWN_DIRS: ReadonlySet<string> = new Set([PKG_CARRIER_DIR, "base-ceiling"]);

export interface ReadmeInput {
  recordName: string;
  epochId: string;
  proofUrl: string;
  /** Paths inside the package, or null when the file was not in hand. */
  committedPath: string | null;
  originalPath: string | null;
  carrierPath: string | null;
  committedSha256Hex: string | null;
  originalSha256Hex: string | null;
  recordedIso: string | null;
  floor: { block: number; iso: string | null } | null;
  ceilingInTime: { block: number; iso: string; txHash: string; reportedStatus: string } | null;
  settlement: { block: number; iso: string; txHash: string } | null;
  /**
   * The blob bytes the settlement pointer names (2026-10-02, outside review: "no .bin files are in
   * the package, and the network prunes blobs after roughly 18 days"): the files put in
   * base-ceiling/blobs/, and the versioned hashes that could not be fetched when the package was built.
   */
  settlementBlobs?: { inPackage: string[]; missing: string[] } | null;
  ceilingInPosition: { anchorCounter: string; block: number | null; iso: string | null } | null;
  pcr0: string | null;
  enclaveTag: string | null;
  writer: string;
  hasAnchorsBefore: boolean;
  hasAnchorsAfter: boolean;
  versions: { verify: string; audit: string; sdk: string };
}

/**
 * The Base stamp as a bound (SPEC 10.4): after a halt Base refills the missed time with blocks
 * stamped in the past, and such a stamp is no "existed by" time for this record.
 */
function baseStampNote(i: ReadmeInput): string | null {
  if (!i.ceilingInTime) return null;
  const r = baseTimeIsBound(Date.parse(i.ceilingInTime.iso) / 1000, {
    floorTimestampSec: i.floor?.iso ? Date.parse(i.floor.iso) / 1000 : null,
    attestedAtMs: i.recordedIso ? Date.parse(i.recordedIso) : null,
  });
  return r.ok ? null : r.reason;
}

const utc = (iso: string | null) => (iso ? `${iso.replace("T", " ").replace(/\.\d+Z$/, "").replace(/Z$/, "")} UTC` : "time not in this package");
const n = (x: number) => x.toLocaleString("en-US");

/**
 * The README is written to read well as PLAIN TEXT, because that is how most
 * people meet it: Quick Look, TextEdit, a terminal, an AI that is handed the
 * folder. So: no tables, no bold markers, no backticks. Headings, short
 * paragraphs, and "name: what it is" lists only. It is still valid Markdown.
 */
export function packageReadme(i: ReadmeInput): string {
  const L: string[] = [];
  const committed = i.committedPath ?? "the committed file (not in this package)";
  const item = (name: string, what: string) => { L.push(`- ${name}`, `  ${what}`, ""); };

  L.push(`# ${i.recordName}: how to read this package`, "");

  L.push("## What this package claims", "");
  const stampNote = baseStampNote(i);
  if (i.floor && i.ceilingInTime && stampNote) {
    L.push(`The exact bytes of ${committed} were finished after Ethereum block ${n(i.floor.block)} (${utc(i.floor.iso)}) and existed by Base block ${n(i.ceilingInTime.block)}. That block's own time is not a bound for this record: ${stampNote}.`, "");
  } else if (i.floor && i.ceilingInTime) {
    L.push(`The exact bytes of ${committed} were finished after Ethereum block ${n(i.floor.block)} (${utc(i.floor.iso)}) and existed by Base block ${n(i.ceilingInTime.block)} (${utc(i.ceilingInTime.iso)}).`, "");
  } else if (i.floor) {
    L.push(`The exact bytes of ${committed} were finished after Ethereum block ${n(i.floor.block)} (${utc(i.floor.iso)}). No ceiling in time is in this package (see the base-ceiling folder).`, "");
  } else {
    L.push(`The exact bytes of ${committed} hold a position in BitGraph's sequence. The floor anchor is not in this package, so the time bound cannot be read from it alone.`, "");
  }
  L.push("- After: the bytes carry a commitment that could not be computed before that Ethereum block's hash existed.");
  L.push("- By: a Merkle root over this proof is inside a transaction in that Base block.");
  if (i.recordedIso) L.push(`- Between the two, the enclave's own clock recorded the commit at ${utc(i.recordedIso)} (inside the AWS Nitro attestation in proof.json).`);
  L.push("", "What it does not claim: when the content was first created, who made it, who owns it, or whether what it shows is true. It dates this exact version of the bytes, nothing earlier.", "");

  // The same file at up to three stages: say which is which before listing the folder.
  if (i.committedPath && (i.originalPath || i.carrierPath)) {
    L.push("## One file, at three stages", "");
    L.push("The files in this package are the same content at different stages. Each stage adds something to the one before. They open the same way and look the same; the difference is in the bytes.", "");
    let stage = 0;
    const st = (title: string, path: string, text: string) => { L.push(`${++stage}. ${title}: ${path}`, `   ${text}`, ""); };
    if (i.originalPath) st("The original", i.originalPath, "The file as it was before BitGraph touched it. Nothing added.");
    st("The committed file", i.committedPath, `${i.originalPath ? "The original" : "The file"} with a 48-byte commitment at the end. The commitment is a one-time code from the position BitGraph opened, and it could not exist before the floor block. This is the file the proof is about: its SHA-256 is the digest in proof.json.${i.originalPath ? " The original's is not." : ""}`);
    if (i.carrierPath) st("The BitGraphed file", i.carrierPath, "The committed file with the proof, the Ethereum anchors and the Base ceiling packed inside it. One file that verifies with nothing else beside it. Its own SHA-256 is not the committed digest and is not supposed to be: the proof block packed at its end is part of its bytes. The verifier strips that block and checks the bytes before it.");
    L.push("Which to use:", "");
    if (i.carrierPath) L.push("- To share or keep one file: the BitGraphed file. The proof travels inside it.");
    L.push("- To check the fingerprint by hand: the committed file, against proof.json.");
    if (i.originalPath) L.push("- To have the file back untouched: the original.");
    L.push("");
  }

  L.push("## What is in this folder", "");
  item("README.md", "This page.");
  item("proof.json", "The signed proof: the position, the commit, the enclave's signature and its AWS Nitro attestation.");
  if (i.committedPath) item(i.committedPath, "The committed bytes. This is the file the proof's digest names. Hash this one.");
  if (i.originalPath) item(i.originalPath, "The original the committed file was made from: the same content, byte for byte, without the 48-byte commitment at the end. Its hash is in the proof as the signed origin, not as the artifact digest.");
  if (i.carrierPath) item(i.carrierPath, "The BitGraphed file: the committed bytes with the proof, the Ethereum anchors and the Base ceiling packed inside one file. It verifies with nothing else beside it.");
  if (i.hasAnchorsBefore || i.hasAnchorsAfter) item("ethereum-anchors/", "The anchor before (the floor) and the anchor after (the closing anchor), each with its Ethereum block header so the block's time reads offline.");
  item("base-ceiling/", "The ceiling in time: the Merkle path, the signed Base transaction, the Base block header and the transaction's inclusion proof. A file there whose name ends in -status.json says in words when something was not available.");
  if (i.settlementBlobs && i.settlementBlobs.inPackage.length) item("base-ceiling/blobs/", `The Ethereum blob data that carries the Base batch (${i.settlementBlobs.inPackage.length} file${i.settlementBlobs.inPackage.length === 1 ? "" : "s"}, each named by its versioned hash). Ethereum nodes keep blob data only about 18 days, so these copies are what lets the settlement be checked later.`);

  if (i.committedSha256Hex || (i.originalSha256Hex && i.originalPath)) {
    L.push("## Which file to hash", "");
    if (i.committedSha256Hex) L.push(`- ${committed}`, `  SHA-256: ${i.committedSha256Hex}`, "  This equals artifact.digestB64 in proof.json (written there in base64).", "");
    if (i.originalSha256Hex && i.originalPath) L.push(`- ${i.originalPath}`, `  SHA-256: ${i.originalSha256Hex}`, "  This equals the signed attribution.message in proof.json. It is not the artifact digest, and it is not supposed to be.", "");
    if (i.carrierPath) L.push(`- ${i.carrierPath}`, "  Its own SHA-256 is not the artifact digest, and it is not supposed to be: the proof is packed inside it. The committed bytes are this file minus the proof block at its end; the verifier strips the block and hashes what is left.", "");
  }

  L.push("## Check it yourself", "");
  L.push("Offline, with Node 20 or later, from inside this folder:", "", `    npx @mikeargento/bitgraph-audit@${i.versions.audit} .`, "");
  L.push("Expected: the committed file matches the proof, the signatures and the attestation hold, the floor and the ceiling verify from the block headers in this folder. Exit code 0.", "");
  if (i.carrierPath) {
    L.push("Or check the single BitGraphed file, one line per claim, each saying what it rests on:", "", `    npx @mikeargento/bitgraph-sdk@${i.versions.sdk} verify "${i.carrierPath}"`, "");
  }
  L.push(`Or drop this folder on ${i.proofUrl.replace(/\/proof\/.*$/, "")} and the page hashes the files in your own browser.`, "", `This record's page: ${i.proofUrl}`, "");

  L.push("## The time evidence, in order", "");
  let step = 0;
  const ev = (title: string, text: string) => { L.push(`${++step}. ${title}`, `   ${text}`, ""); };
  if (i.floor) ev("Floor in time", `Ethereum block ${n(i.floor.block)}, ${utc(i.floor.iso)}. The enclave fixed this block when the position opened and signed it into the proof; its hash is inside the commitment the bytes carry.`);
  if (i.recordedIso) ev("Recorded", `${utc(i.recordedIso)}, the enclave platform's signed clock.`);
  if (i.ceilingInTime) ev("Ceiling in time", `Base block ${n(i.ceilingInTime.block)}, ${utc(i.ceilingInTime.iso)}. Transaction ${i.ceilingInTime.txHash}${stampNote ? `. Not a time bound for this record: ${stampNote}.` : ""}`);
  if (i.ceilingInPosition) ev("Ceiling in position", `The record was committed before anchor #${Number(i.ceilingInPosition.anchorCounter).toLocaleString("en-US")}${i.ceilingInPosition.block ? `, which carries Ethereum block ${n(i.ceilingInPosition.block)} (${utc(i.ceilingInPosition.iso)})` : ""}. This is an order, not a clock time. An anchor is made after the block it carries, so that block's time can be earlier than the recorded time above. Do not read the two Ethereum blocks as a time window; ${stampNote ? "the Base block's own time is withheld here (see above), so the recorded time is the latest time stated" : "the Base block is the upper bound in time"}.`);

  L.push("## What is checked, and what each result rests on", "");
  L.push("These are separate results. A pass on one says nothing about the next.", "");
  const check = (name: string, rests: string, offline: string) => { L.push(`- ${name}`, `  Rests on: ${rests}`, `  Checked offline from this folder: ${offline}`, ""); };
  check("File integrity", "SHA-256 of the committed bytes equals the proof's digest; the commitment in the bytes is the one the signed position record produces.", "yes");
  check("Signatures", "Ed25519 over the position record and the commit.", "yes");
  check("Hardware attestation", "AWS Nitro: ES384 signature and certificate chain to the AWS Nitro Enclaves root (SHA-256 fingerprint 641A0321A3E244EFE456463195D606317ED7CDCC3C1756E09893F3C68F79BB5B), valid at the attestation's own instant; bound to this proof.", "yes");
  check("Which enclave image", `PCR0 ${i.pcr0 ?? "(see proof.json)"}${i.enclaveTag ? `, published by BitGraph as source tag ${i.enclaveTag}` : ""}. Matching a published value shows which image ran; trusting what that image does means reading or rebuilding its source (bitgraph.ing/docs/self-host-tee).`, "the match, yes. The rebuild is yours to do");
  check("Inclusion on Base", `The ceiling transaction's signature, sender ${i.writer}, and its Merkle-Patricia proof against the Base block header in the base-ceiling folder.`, "yes");
  check("Chain confirmation", `That the block headers in this folder are the real chains' blocks. Compare the block hashes with any node or explorer${i.floor ? `: https://etherscan.io/block/${i.floor.block}` : ""}${i.ceilingInTime ? ` and https://basescan.org/block/${i.ceilingInTime.block}` : ""}`, "NO. One lookup each, by you");
  if (i.settlement) {
    const blobs = i.settlementBlobs;
    const where = "The same bytes are kept at https://bitgraph.ing/api/ceilings/blobs/<versioned hash>.bin, and any Ethereum beacon node serves them for about 18 days after the block.";
    const blobText = blobs && blobs.inPackage.length && !blobs.missing.length
      ? ` The blob bytes are in base-ceiling/blobs/. bitgraph-audit checks each one against its KZG commitment, decodes Base's batch from them and finds the ceiling transaction's exact bytes inside. ${where}`
      : blobs && blobs.missing.length
        ? ` ${blobs.missing.length} of the blob files could not be fetched when this package was built (${blobs.missing.join(", ")}). ${where} Put them in base-ceiling/blobs/ and run the audit again.`
        : ` The blob bytes are not in this package. ${where} Put them in base-ceiling/blobs/ and the audit checks them.`;
    check("Settlement on Ethereum", `A bitgraph-settlement/1 pointer is attached in base-ceiling/ceiling.json: Ethereum block ${n(i.settlement.block)} (${utc(i.settlement.iso)}) carries the batch data that holds the Base block, in transaction ${i.settlement.txHash}.${blobText} This shows the ceiling transaction's bytes were on Ethereum by that block; it does not show Base's derivation accepted the batch.`, blobs && blobs.inPackage.length && !blobs.missing.length ? "yes, the pointer and the blob bytes" : "the pointer, yes. The blob bytes, once they are in base-ceiling/blobs/");
  } else if (i.ceilingInTime) {
    check("Settlement on Ethereum", `Not attached. The ceiling file says BitGraph's Base node reported the block "${i.ceilingInTime.reportedStatus}" when it was written; that is a report, and nothing in this folder proves it. The settlement pointer is attached to the ceiling a few minutes after the Base block, once its batch is on Ethereum: download the package again later to get it.`, "no");
  } else {
    check("Settlement on Ethereum", "Not in this package.", "no");
  }

  L.push("## Keep the exact bytes", "");
  L.push("A proof is about exact bytes. Re-saving, re-encoding or sending the file through an app that recompresses it produces different bytes, and those will not match. Keep this folder, or the BitGraphed file, as it is.", "");
  L.push(`Written for: bitgraph-verify ${i.versions.verify}, bitgraph-audit ${i.versions.audit}, bitgraph-sdk ${i.versions.sdk}.`, `Position: ${i.recordName}, epoch ${i.epochId}`, "");
  return L.join("\n");
}
