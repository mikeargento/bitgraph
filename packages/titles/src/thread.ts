// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Custody thread reconstruction: STRUCTURE, never ORDER.
 *
 * A thread is: one "held" origin, then give/take pairs. Two gates guard
 * every extension, and neither is secrecy:
 *
 *   - a give must be SIGNED by the current holder key (the origin signer
 *     until a take, then the most recent taker), and names the next key;
 *   - the following take must be SIGNED by exactly the key the give
 *     named, and must reply (`re`) to that give's file digest.
 *
 * So showing a thread is safe: possession of its bytes never confers the
 * ability to extend it — extension always requires the current holder's
 * signature. The salted digest of the head is a privacy curtain and the
 * capability to REPLY; the signature chain is the wall.
 *
 * What this module deliberately does not do: decide between competing
 * threads. Two takes replying to one give are both structurally valid;
 * which one WINS is a fact about causal positions, adjudicated
 * first-position-wins by a Player rule over a proof bundle (see
 * titlerule.ts). Structure here, order there, and the two never blur.
 */

import { keyObjectFor } from "@mikeargento/bitgraph-player";
import { checkPm, parsePm, sha256HexOf } from "./pm.js";
import type { Pm, PmKeyRef, Thread, ThreadLink } from "./types.js";

function sameKey(a: PmKeyRef, b: { alg: string; publicKey: string }): boolean {
  return a.alg === b.alg && a.publicKey === b.publicKey;
}

export class ThreadError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`invalid thread: ${issues.join("; ")}`);
    this.name = "ThreadError";
    this.issues = issues;
  }
}

/**
 * Reconstruct and validate one thread from message file bytes, in any
 * order. Subject bytes are optional; with them, every link's possession
 * hash is verified rather than merely well-formed.
 *
 * Every message must belong to the same subject, every signature must
 * verify, and the give/take discipline must hold link by link. Branches
 * (two replies to one predecessor) are a structural error HERE because a
 * single presented thread must be linear; competing threads are separate
 * presentations racing at the adjudication layer.
 */
export function buildThread(messageFiles: Uint8Array[], subjectBytes?: Uint8Array): Thread {
  const issues: string[] = [];
  if (messageFiles.length === 0) throw new ThreadError(["a thread needs at least its origin message"]);

  interface Node {
    sha256Hex: string;
    pm: Pm;
  }
  const nodes: Node[] = [];
  const byHex = new Map<string, Node>();
  for (const bytes of messageFiles) {
    const pm = parsePm(bytes);
    const sha256Hex = sha256HexOf(bytes);
    if (byHex.has(sha256Hex)) continue; // byte-identical duplicate
    const node = { sha256Hex, pm };
    nodes.push(node);
    byHex.set(sha256Hex, node);

    const check = checkPm(pm, subjectBytes);
    if (!check.signature) issues.push(`message ${sha256Hex.slice(0, 12)}…: signature does not verify`);
    if (check.possession === "refuted") {
      issues.push(`message ${sha256Hex.slice(0, 12)}…: possession hash refuted by the supplied subject bytes`);
    }
  }

  const about = (nodes[0] as Node).pm.about;
  for (const node of nodes) {
    if (node.pm.about !== about) {
      issues.push(`message ${node.sha256Hex.slice(0, 12)}…: about "${node.pm.about}" differs from the thread subject "${about}"`);
    }
  }

  // Exactly one origin.
  const origins = nodes.filter((n) => n.pm.claim === "held");
  if (origins.length !== 1) {
    issues.push(`a thread has exactly one "held" origin; found ${origins.length}`);
    throw new ThreadError(issues);
  }
  const origin = origins[0] as Node;

  // Reply graph: predecessor digest -> replies among the presented set.
  const replies = new Map<string, Node[]>();
  for (const node of nodes) {
    if (node.pm.re === undefined) continue;
    const predHex = node.pm.re.slice("sha256:".length);
    const list = replies.get(predHex) ?? [];
    list.push(node);
    replies.set(predHex, list);
  }

  // Walk from the origin. Holder starts as the origin signer.
  const links: ThreadLink[] = [{ sha256Hex: origin.sha256Hex, pm: origin.pm }];
  let holderKey: PmKeyRef = { alg: origin.pm.alg, publicKey: origin.pm.publicKey };
  let cursor: Node = origin;
  const visited = new Set<string>([origin.sha256Hex]);

  for (;;) {
    const next = replies.get(cursor.sha256Hex) ?? [];
    const following = next.filter((n) => n.pm.claim === "give" || n.pm.claim === "take");
    if (following.length === 0) break;
    if (following.length > 1) {
      issues.push(
        `message ${cursor.sha256Hex.slice(0, 12)}… has ${following.length} replies in this presentation; ` +
          `a presented thread must be linear — competing replies race at the adjudication layer, not here`
      );
      break;
    }
    const node = following[0] as Node;
    if (visited.has(node.sha256Hex)) {
      issues.push(`message ${node.sha256Hex.slice(0, 12)}… appears twice in the reply walk (cycle)`);
      break;
    }
    visited.add(node.sha256Hex);

    if (node.pm.claim === "give") {
      // A give extends the thread only over the current holder's signature.
      if (!sameKey(holderKey, node.pm)) {
        issues.push(
          `give ${node.sha256Hex.slice(0, 12)}… is not signed by the current holder key; ` +
            `only the holder can offer the subject onward`
        );
        break;
      }
      if (keyObjectFor(node.pm.to as PmKeyRef) === undefined) {
        issues.push(`give ${node.sha256Hex.slice(0, 12)}…: "to" is not decodable key material`);
        break;
      }
    } else {
      // A take must reply to a give and be signed by exactly the named key.
      if (cursor.pm.claim !== "give") {
        issues.push(`take ${node.sha256Hex.slice(0, 12)}… replies to a "${cursor.pm.claim}", not to a give`);
        break;
      }
      const named = cursor.pm.to as PmKeyRef;
      if (!sameKey(named, node.pm)) {
        issues.push(
          `take ${node.sha256Hex.slice(0, 12)}… is signed by a key the give did not name; ` +
            `a conveyance is give-names-taker, take-signed-by-named-key`
        );
        break;
      }
      holderKey = { alg: node.pm.alg, publicKey: node.pm.publicKey };
    }
    links.push({ sha256Hex: node.sha256Hex, pm: node.pm });
    cursor = node;
  }

  // Presented messages that never joined the walk are a signal, not silence.
  for (const node of nodes) {
    if (!visited.has(node.sha256Hex) && node.pm.claim !== "controls-key" && node.pm.claim !== "supersedes") {
      issues.push(`message ${node.sha256Hex.slice(0, 12)}… (${node.pm.claim}) is not connected to the thread walk`);
    }
  }

  return {
    about,
    links,
    head: links[links.length - 1] as ThreadLink,
    holderKey,
    issues,
  };
}
