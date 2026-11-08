/**
 * The site's carrier glue for drops: strip BitGraphed files (a file with its proof block after its end) back to the
 * committed bytes, so every check downstream runs on those bytes, and hand the carried proof along with each.
 * Format parsing is lib/carrier.ts, the byte-identical copy of the verify package's.
 */

import { parseCarrier, innerDigestMatches, type CarrierProof } from "./carrier";
import { treeHandoff } from "./fuse-tree";
import { verifyTreeMember, TREE_MEMBER_CATEGORIES, type TreeMemberEvidence } from "@mikeargento/bitgraph-verify";

/** photo.jpg → photo.bitgraph.jpg; a name already in that form keeps it. */
export function carrierFileName(name: string): string {
  if (/\.bitgraph(\.[^.]+)?$/i.test(name)) return name;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}.bitgraph${name.slice(dot)}` : `${name}.bitgraph`;
}
/** The inverse, for a dropped carrier's inner bytes. */
export function innerFileName(name: string): string {
  return name.replace(/\.bitgraph(\.[^.]+)$/i, "$1").replace(/\.bitgraph$/i, "");
}

/**
 * Strip carriers out of a list of dropped files, so every check downstream
 * runs on the committed bytes. The envelope's own hash is recorded nowhere:
 * hashing the outer file would answer "never recorded" about bytes that are.
 * Only files whose last 8 bytes are the magic are read whole; a block that is
 * present but unreadable leaves the file untouched and is reported as such.
 */
export interface DeCarrierNote {
  name: string;
  /** carrier/4: the file is one member of a tree, placed by the evidence inside its block. */
  member?: { index: number; count: number };
  ceiling: "present" | "unfetched" | "none" | "corrupt";
  outer?: Uint8Array;
  /** The carried proof, when the inner bytes hash to its artifact digest: the row needs no lookup. */
  proof?: CarrierProof;
  /** false: the bytes inside do NOT match the carried proof. Stated, and the file goes through as plain bytes. */
  innerMatches?: boolean;
}

/**
 * No real carrier is smaller than this. Its block always holds an attested
 * bitgraph/1 proof of several KB. A file under it cannot be one, so it is not
 * opened at all.
 *
 * ⚠️ THIS IS WHAT A BIG DROP WAITED ON. Every file used to have its last 8
 * bytes read, one file at a time, before hashing could start. Each read is a
 * round trip through the browser's file layer however small, and 55,000
 * small files took 8.6s of it, measured: the spinner that sat on "Reading
 * your folder… 55,000 files" for a large folder (2026-09-28).
 */
const CARRIER_MIN_BYTES = 4096;
/** Tail reads in flight, for the files big enough to check (a folder of photos). */
const TAIL_READS_IN_FLIGHT = 32;

/** carrier/4: what a tree member's block placed it by, checked against the proof before it is believed. */
export interface CarriedMember {
  proof: CarrierProof;
  rootDocumentHex: string;
  evidence: TreeMemberEvidence;
}

export async function deCarrierFiles(files: File[]): Promise<{ files: File[]; notes: DeCarrierNote[]; proofs: Map<File, CarrierProof>; members: Map<File, CarriedMember>; unreadable: Set<File> }> {
  const MAGIC = [0x42, 0x47, 0x50, 0x52, 0x4f, 0x4f, 0x46, 0x01];
  const out = files.slice();
  const unreadable = new Set<File>();
  const notes: DeCarrierNote[] = [];
  const proofs = new Map<File, CarrierProof>();
  const members = new Map<File, CarriedMember>();
  // Which files end in the magic, read in parallel. Only those are read whole.
  const tagged: number[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(TAIL_READS_IN_FLIGHT, out.length) }, async () => {
    while (next < out.length) {
      const i = next++;
      const f = out[i];
      if (f.size < CARRIER_MIN_BYTES) continue;
      try {
        const tail = new Uint8Array(await f.slice(f.size - 8).arrayBuffer());
        if (MAGIC.every((b, j) => tail[j] === b)) tagged.push(i);
      } catch { /* unreadable: the file goes through the normal path untouched */ }
    }
  }));
  // The few that are carriers, in drop order, so the notes read in that order.
  tagged.sort((a, b) => a - b);
  for (const i of tagged) {
    const f = out[i];
    try {
      const whole = new Uint8Array(await f.arrayBuffer());
      const parsed = parseCarrier(whole);
      if (parsed.kind === "carrier") {
        const inner = new File([parsed.inner.slice() as Uint8Array<ArrayBuffer>], innerFileName(f.name), { type: f.type, lastModified: f.lastModified });
        out[i] = inner;
        let matches = innerDigestMatches(parsed.inner, parsed.payload);
        const tree = parsed.payload.tree;
        let member: DeCarrierNote["member"];
        if (matches && tree) {
          // carrier/4: a tree member. Its bytes match its leaf; the leaf must reach the
          // signed root before the row is answered by the carried proof, which then rides
          // with the member's evidence beside it (the proof page's own hand-off shape).
          const r = await verifyTreeMember({ proof: parsed.payload.proof as never, bytes: parsed.inner, member: tree.member, rootDocument: hexBytes(tree.rootDocument) }).catch(() => null);
          matches = r !== null && r.member !== null && (TREE_MEMBER_CATEGORIES as readonly string[]).includes(r.category);
          if (matches && r?.member) {
            member = { index: r.member.index, count: r.member.count };
            members.set(inner, { proof: parsed.payload.proof, rootDocumentHex: tree.rootDocument, evidence: tree.member as TreeMemberEvidence });
          }
        }
        // A matching carrier is its own answer: the carried proof rides with the
        // row, so the drop needs no lookup and can never re-mint what it holds.
        if (matches) proofs.set(inner, tree ? (treeHandoff(parsed.payload.proof as never, tree.rootDocument, tree.member as TreeMemberEvidence) as unknown as CarrierProof) : parsed.payload.proof);
        // The outer bytes ride along only while the block says a part was not fetched.
        notes.push(parsed.payload.ceiling.status === "unfetched"
          ? { name: f.name, ceiling: "unfetched", outer: whole, ...(matches ? { proof: parsed.payload.proof } : {}), innerMatches: matches, ...(member ? { member } : {}) }
          : { name: f.name, ceiling: parsed.payload.ceiling.status, ...(matches ? { proof: parsed.payload.proof } : {}), innerMatches: matches, ...(member ? { member } : {}) });
      } else if (parsed.kind === "corrupt") {
        notes.push({ name: f.name, ceiling: "corrupt" });
        // The safety catch (2026-10-11): a file whose proof block cannot be read is never recorded as new bytes.
        // A damaged BitGraphed file, or one in a format newer than this site, is held back, not re-minted.
        unreadable.add(f);
      }
    } catch { /* unreadable: the file goes through the normal path untouched */ }
  }
  return { files: out, notes, proofs, members, unreadable };
}

function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
