// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * The moment the new file is actually wanted.
 *
 * ⚠️ THE FUSED BYTES ARE VIRTUAL, AND THAT IS NOT CHANGING. Nothing writes
 * them during a make: the original plus the proof rebuilds them exactly, so
 * keeping a second copy of every file doubles a folder for nothing. This is the
 * one place they are materialised, and only because somebody asked: a BitGraph
 * leaving this machine goes to somebody who may have neither the original nor a
 * tool that rebuilds.
 *
 * ⚠️ A FOLDER, NOT A ZIP. The browser had to hand you an archive; an app can
 * hand you the thing itself.
 *
 * ⚠️ REBUILT BY STREAMING, AND CHECKED. The bytes go out through the
 * placement's own frame, prefix then the original then suffix, hashed as they
 * are written; if the result is not the artifact the proof committed, the
 * package is deleted rather than handed over. A new file that does not match
 * its proof is worse than no new file.
 */

import { createReadStream } from "node:fs";
import { copyFile, mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { fusedNamesFor } from "@mikeargento/bitgraph";
import { bytesToBase64, computeSlotCommitment, getPlacement, type BitGraphProof } from "@mikeargento/bitgraph-verify";
import { describe, type DescribeTarget } from "./inspect.js";
import { pathsFor, ANCHOR_DIR } from "./paths.js";

export interface ExportResult {
  /** The folder that was written. */
  path: string;
  /** What is in it, relative to that folder. */
  files: string[];
  /** The new file's name, when one was rebuilt. */
  fusedName: string | null;
  /** Bytes written, all told. */
  bytes: number;
  /** Why the new file is not in there, when it is not. */
  note: string | null;
}

/**
 * Write everything a stranger needs, into `into`.
 *
 * `filePath` is the original on this machine. `evidencePath` is its BitGraph.
 */
export async function exportBitGraph(root: string, target: DescribeTarget, filePath: string, into: string): Promise<ExportResult> {
  const described = await describe(root, target);
  const evidence = described.evidence;
  const proof = described.proof;
  if (evidence === null) throw new Error("that BitGraph could not be read.");
  if (proof === null) throw new Error("this BitGraph's proof is not in the folder, so there is nothing to package.");

  const name = evidence.file.name || basename(filePath);
  const dir = join(into, `${name} BitGraph`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const written: string[] = [];
  let bytes = 0;
  const record = async (rel: string) => {
    written.push(rel);
    bytes += (await stat(join(dir, rel))).size;
  };

  try {
    // The original, exactly as it is. Everything else is rebuilt from it.
    await copyFile(filePath, join(dir, name));
    await record(name);

    await writeFile(join(dir, "proof.json"), `${JSON.stringify(proof, null, 2)}\n`);
    await record("proof.json");

    // The evidence this file holds: its row, and for a set/2 the inclusion
    // path that is the only thing putting it in the set.
    if (described.evidenceRaw !== null) {
      await writeFile(join(dir, "position.json"), described.evidenceRaw);
      await record("position.json");
    }

    // The committed artifact, whose hash IS the proof's artifact digest.
    if (described.committedB64 !== null) {
      await writeFile(join(dir, "manifest.json"), Buffer.from(described.committedB64, "base64"));
      await record("manifest.json");
    }

    // Whatever anchors the folder holds for this position, and the honesty
    // file when a side is missing.
    const positionDir = pathsFor(root).position(evidence.position.epochId, evidence.position.counter);
    const anchors = await readdir(join(positionDir, ANCHOR_DIR)).catch(() => [] as string[]);
    if (anchors.length > 0) {
      await mkdir(join(dir, ANCHOR_DIR), { recursive: true });
      for (const file of anchors) {
        await copyFile(join(positionDir, ANCHOR_DIR, file), join(dir, ANCHOR_DIR, file));
        await record(`${ANCHOR_DIR}/${file}`);
      }
    }
    const status = await readFile(join(positionDir, "anchors-status.json")).catch(() => null);
    if (status !== null) {
      await writeFile(join(dir, "anchors-status.json"), status);
      await record("anchors-status.json");
    }

    // The new file, rebuilt now.
    const rebuilt = await rebuild(proof, evidence.placement, filePath, join(dir, "new-file"), name, evidence.artifactDigestB64);
    if (rebuilt.name !== null) await record(`new-file/${rebuilt.name}`);

    return { path: dir, files: written, fusedName: rebuilt.name, bytes, note: rebuilt.note };
  } catch (err) {
    /* Half a package is worse than none: somebody would send it. */
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
}

/** Prefix, the original streamed through, suffix. Hashed on the way out. */
async function rebuild(
  proof: BitGraphProof,
  placementId: string,
  filePath: string,
  intoDir: string,
  originalName: string,
  expectedArtifactB64: string,
): Promise<{ name: string | null; note: string | null }> {
  const placement = getPlacement(placementId);
  if (placement === undefined || placement.frame === undefined) {
    return { name: null, note: `this BitGraph's placement (${placementId}) has no recipe this build can rebuild from, so the new file is not in the package. The original and the proof are.` };
  }
  const slot = (proof as { slotAllocation?: unknown }).slotAllocation;
  if (slot === undefined || slot === null) {
    return { name: null, note: "this proof carries no slot record, so the new file cannot be rebuilt. The original and the proof are in the package." };
  }
  const origin = (proof as { attribution?: { message?: unknown } }).attribution?.message;

  const commitment = computeSlotCommitment(slot as Parameters<typeof computeSlotCommitment>[0]);
  const size = (await stat(filePath)).size;
  const originDigest = typeof origin === "string" ? Buffer.from(origin, "base64") : await digestOf(filePath);
  const { prefix, suffix } = placement.frame({ originalSize: size, originDigest: new Uint8Array(originDigest), commitment });

  const { fusedName } = fusedNamesFor(originalName, placementId as Parameters<typeof fusedNamesFor>[1]);
  await mkdir(intoDir, { recursive: true });
  const out = join(intoDir, fusedName);

  const hash = createHash("sha256");
  const handle = await open(out, "w");
  try {
    const put = async (chunk: Uint8Array) => {
      if (chunk.length === 0) return;
      hash.update(chunk);
      await handle.write(chunk);
    };
    await put(prefix);
    for await (const chunk of createReadStream(filePath, { highWaterMark: 1 << 20 })) {
      await put(chunk as Buffer);
    }
    await put(suffix);
  } finally {
    await handle.close();
  }

  /* ⚠️ Checked before it is handed over. A new file that does not hash to the
   * artifact its proof committed is not a new file, it is a liability. */
  const got = bytesToBase64(new Uint8Array(hash.digest()));
  if (got !== expectedArtifactB64) {
    await rm(intoDir, { recursive: true, force: true });
    throw new Error("the rebuilt file does not hash to the artifact this proof committed, so nothing was packaged.");
  }
  return { name: fusedName, note: null };
}

async function digestOf(path: string): Promise<Buffer> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) hash.update(chunk as Buffer);
  return hash.digest();
}
