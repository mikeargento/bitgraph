// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * A set's members, read from the one file that always holds them.
 *
 * ⚠️ `members.jsonl` IS THE MEMBERSHIP. It goes down durably under the
 * position before anything else is written, and it carries every member's row
 * and, for a set/2, the inclusion path that is the only thing putting that
 * file inside the set. The `.position.json` files beside the files are a
 * FAN-OUT from it, and above a few thousand members they are not written at
 * all: 30,000 of them measured at 2.3 seconds and 71 MB, for a folder nobody
 * opens in Finder.
 *
 * So a member's own evidence is built here when it is wanted, from the file
 * that has it. Same doctrine as the fused bytes: the durable state is what
 * cannot be recomputed, and everything else is materialised on demand.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import type { Evidence } from "./evidence.js";
import { pathsFor } from "./paths.js";

export interface MemberRow {
  name: string;
  rel: string;
  bytes: number;
  placement: string;
  originDigestB64: string;
  artifactDigestB64: string;
  manifestIndex: number;
  memberProof?: unknown;
}

/**
 * Every member of one position, by the digest of its original.
 *
 * ⚠️ READ ONCE PER POSITION, NEVER PER FILE. A folder of 30,000 members shares
 * one of these; reading it per file would be 30,000 reads of a 39 MB file to
 * answer 30,000 questions it could answer all at once.
 */
export async function readMembers(root: string, position: { epochId: string; counter: string }): Promise<Map<string, MemberRow>> {
  const path = join(pathsFor(root).position(position.epochId, position.counter), "members.jsonl");
  const out = new Map<string, MemberRow>();
  try {
    const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of lines) {
      if (line.trim() === "") continue;
      try {
        const row = JSON.parse(line) as MemberRow;
        if (typeof row.originDigestB64 === "string") out.set(row.originDigestB64, row);
      } catch {
        /* ⚠️ A torn line is one member, not the file. The rest stand, and a
         * member that is missing reads as unplaceable rather than as absent. */
      }
    }
  } catch {
    return out;
  }
  return out;
}

/** One member's evidence, exactly as the fan-out would have written it. */
export function evidenceFromMember(
  row: MemberRow,
  position: { epochId: string; counter: string },
  set: "set/1" | "set/2",
  count: number,
  ref: string,
): Evidence {
  return {
    version: "bitgraph-evidence/1",
    file: { name: row.name, bytes: row.bytes },
    placement: row.placement as Evidence["placement"],
    originDigestB64: row.originDigestB64,
    artifactDigestB64: row.artifactDigestB64,
    position: { ...position },
    set,
    member: {
      index: row.manifestIndex,
      count,
      ...(row.memberProof !== undefined ? { memberProof: row.memberProof as never } : {}),
    },
    proof: { kind: "beside", proof: `${ref}/proof.json`, manifest: `${ref}/manifest.json` },
    /* ⚠️ Built now, from a file written then. The timestamp says which. */
    writtenAt: new Date().toISOString(),
  };
}
