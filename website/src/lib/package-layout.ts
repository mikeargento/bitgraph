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
 *
 * Readers (the drop box, bitgraph-audit) find files by what they are, not by
 * these names, and still read the earlier layout (`new-file/` beside a
 * top-level original).
 */

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
  ceilingInPosition: { anchorCounter: string; block: number | null; iso: string | null } | null;
  pcr0: string | null;
  enclaveTag: string | null;
  writer: string;
  hasAnchorsBefore: boolean;
  hasAnchorsAfter: boolean;
  versions: { verify: string; audit: string; sdk: string };
}

const utc = (iso: string | null) => (iso ? `${iso.replace("T", " ").replace(/\.\d+Z$/, "").replace(/Z$/, "")} UTC` : "time not in this package");
const n = (x: number) => x.toLocaleString("en-US");

export function packageReadme(i: ReadmeInput): string {
  const L: string[] = [];
  const committed = i.committedPath ? `\`${i.committedPath}\`` : "the committed file (not in this package)";
  L.push(`# ${i.recordName}: how to read this package`, "");
  L.push("## What this package claims", "");
  if (i.floor && i.ceilingInTime) {
    L.push(`The exact bytes of ${committed} were finished **after Ethereum block ${n(i.floor.block)}** (${utc(i.floor.iso)}) and **existed by Base block ${n(i.ceilingInTime.block)}** (${utc(i.ceilingInTime.iso)}).`, "");
  } else if (i.floor) {
    L.push(`The exact bytes of ${committed} were finished **after Ethereum block ${n(i.floor.block)}** (${utc(i.floor.iso)}). No ceiling in time is in this package (see base-ceiling/).`, "");
  } else {
    L.push(`The exact bytes of ${committed} hold a position in BitGraph's sequence. The floor anchor is not in this package, so the time bound cannot be read from it alone.`, "");
  }
  L.push("- The lower bound holds because the bytes carry a commitment that could not be computed before that Ethereum block's hash existed.");
  L.push("- The upper bound holds because a Merkle root over this proof is inside a transaction in that Base block.");
  if (i.recordedIso) L.push(`- Between the two, the enclave's own clock recorded the commit at ${utc(i.recordedIso)} (inside the AWS Nitro attestation in \`proof.json\`).`);
  L.push("", "**What it does not claim:** when the content was first created, who made it, who owns it, or whether what it shows is true. It dates this exact version of the bytes, nothing earlier.", "");

  L.push("## What is in this folder", "");
  L.push("| Path | What it is |", "|---|---|");
  L.push("| `README.md` | This page. |");
  L.push("| `proof.json` | The signed proof: the position, the commit, the enclave's signature and its AWS Nitro attestation. |");
  if (i.committedPath) L.push(`| \`${i.committedPath}\` | **The committed bytes.** This is the file the proof's digest names. Hash this one. |`);
  if (i.originalPath) L.push(`| \`${i.originalPath}\` | The original the committed file was made from: the same content, byte for byte, without the 48-byte commitment at the end. Its hash is in the proof as the signed origin, not as the artifact digest. |`);
  if (i.carrierPath) L.push(`| \`${i.carrierPath}\` | The BitGraphed file: the committed bytes with the proof, the anchors and the ceiling packed inside one file. It verifies with nothing else beside it. |`);
  if (i.hasAnchorsBefore || i.hasAnchorsAfter) L.push("| `ethereum-anchors/` | The anchor before (the floor) and the anchor after (the closing anchor), each with its Ethereum block header so the block's time reads offline. |");
  L.push("| `base-ceiling/` | The ceiling in time: the Merkle path, the signed Base transaction, the Base block header and the transaction's inclusion proof. A `*-status.json` file here says in words when something was not available. |");
  L.push("");

  if (i.committedSha256Hex || i.originalSha256Hex) {
    L.push("## Which file to hash", "");
    if (i.committedSha256Hex) L.push(`- ${committed}: SHA-256 \`${i.committedSha256Hex}\`. This equals \`artifact.digestB64\` in \`proof.json\` (written there in base64).`);
    if (i.originalSha256Hex && i.originalPath) L.push(`- \`${i.originalPath}\`: SHA-256 \`${i.originalSha256Hex}\`. This equals the signed \`attribution.message\` in \`proof.json\`. It is **not** the artifact digest, and it is not supposed to be.`);
    L.push("");
  }

  L.push("## Check it yourself", "");
  L.push("Offline, with Node 20 or later, from inside this folder:", "", "```", `npx @mikeargento/bitgraph-audit@${i.versions.audit} .`, "```", "");
  L.push("Expected: the committed file matches the proof, the signatures and the attestation hold, the floor and the ceiling verify from the block headers in this folder. Exit code 0.", "");
  if (i.carrierPath) {
    L.push("Or check the single BitGraphed file, one line per claim, each saying what it rests on:", "", "```", `npx @mikeargento/bitgraph-sdk@${i.versions.sdk} verify "${i.carrierPath}"`, "```", "");
  }
  L.push(`Or drop this folder on ${i.proofUrl.replace(/\/proof\/.*$/, "")}: the page hashes the files in your own browser. The record's page is ${i.proofUrl}`, "");

  L.push("## The time evidence, in order", "");
  if (i.floor) L.push(`1. **Floor in time.** Ethereum block ${n(i.floor.block)}, ${utc(i.floor.iso)}. The enclave fixed this block when the position opened and signed it into the proof; its hash is inside the commitment the bytes carry.`);
  if (i.recordedIso) L.push(`2. **Recorded.** ${utc(i.recordedIso)}, the enclave platform's signed clock.`);
  if (i.ceilingInTime) L.push(`3. **Ceiling in time.** Base block ${n(i.ceilingInTime.block)}, ${utc(i.ceilingInTime.iso)}, transaction \`${i.ceilingInTime.txHash}\`.`);
  if (i.ceilingInPosition) L.push(`4. **Ceiling in position.** The record was committed before anchor #${Number(i.ceilingInPosition.anchorCounter).toLocaleString("en-US")}${i.ceilingInPosition.block ? `, which carries Ethereum block ${n(i.ceilingInPosition.block)} (${utc(i.ceilingInPosition.iso)})` : ""}. **This is an order, not a clock time.** An anchor is made after the block it carries, so that block's time can be earlier than the recorded time above. Do not read the two Ethereum blocks as a time window; the Base block is the upper bound in time.`);
  L.push("");

  L.push("## What is checked, and what each result rests on", "");
  L.push("These are separate results. A pass on one says nothing about the next.", "");
  L.push("| Result | What establishes it | Checked offline from this folder |", "|---|---|---|");
  L.push("| File integrity | SHA-256 of the committed bytes equals the proof's digest; the commitment in the bytes is the one the signed position record produces | Yes |");
  L.push("| Signatures | Ed25519 over the position record and the commit | Yes |");
  L.push(`| Hardware attestation | AWS Nitro: ES384 signature and certificate chain to the AWS Nitro Enclaves root (SHA-256 fingerprint \`641A0321A3E244EFE456463195D606317ED7CDCC3C1756E09893F3C68F79BB5B\`), valid at the attestation's own instant; bound to this proof | Yes |`);
  L.push(`| Which enclave image | PCR0 \`${i.pcr0 ?? "see proof.json"}\`${i.enclaveTag ? `, published by BitGraph as source tag \`${i.enclaveTag}\`` : ""}. Matching a published value shows which image ran; trusting what that image does means reading or rebuilding its source (bitgraph.ing/docs/self-host-tee) | The match, yes. The rebuild is yours to do |`);
  L.push("| Inclusion on Base | The ceiling transaction's signature, sender " + `\`${i.writer}\`` + ", and its Merkle-Patricia proof against the Base block header in `base-ceiling/` | Yes |");
  L.push(`| Chain confirmation | That the block headers in this folder are the real chains' blocks. Compare the block hashes with any node or explorer${i.floor ? `: https://etherscan.io/block/${i.floor.block}` : ""}${i.ceilingInTime ? ` and https://basescan.org/block/${i.ceilingInTime.block}` : ""} | **No.** One lookup each, by you |`);
  if (i.settlement) {
    L.push(`| Settlement on Ethereum | A \`bitgraph-settlement/1\` pointer is attached in \`base-ceiling/ceiling.json\`: Ethereum block ${n(i.settlement.block)} (${utc(i.settlement.iso)}) carries the batch data that holds the Base block, in transaction \`${i.settlement.txHash}\` | The pointer, yes. The blob bytes are checked by the audit when they are beside the package |`);
  } else if (i.ceilingInTime) {
    L.push(`| Settlement on Ethereum | **Not attached.** The ceiling file says BitGraph's Base node reported the block "${i.ceilingInTime.reportedStatus}" when it was written; that is a report, and nothing in this folder proves it. The settlement pointer is attached to the ceiling a few minutes after the Base block, once its batch is on Ethereum: download the package again later to get it | No |`);
  } else {
    L.push("| Settlement on Ethereum | Not in this package | No |");
  }
  L.push("");

  L.push("## Keep the exact bytes", "");
  L.push("A proof is about exact bytes. Re-saving, re-encoding or sending the file through an app that recompresses it produces different bytes, and those will not match. Keep this folder, or the BitGraphed file, as it is.", "");
  L.push(`Verifier versions this README was written for: @mikeargento/bitgraph-verify ${i.versions.verify}, bitgraph-audit ${i.versions.audit}, bitgraph-sdk ${i.versions.sdk}. Position: ${i.recordName}, epoch \`${i.epochId}\`.`, "");
  return L.join("\n");
}
