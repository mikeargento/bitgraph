// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * Build a block's transaction trie and the inclusion proof for one
 * transaction. The result is only ever used after its root has been compared
 * with the block header's transactionsRoot, so a construction bug shows up
 * as a refusal to write the proof, never as a wrong proof.
 */

import { keccak256, rlpEncode, txTrieKey, type RlpItem } from "./ceiling-evm.js";

type Node =
  | { kind: "leaf"; path: number[]; value: Uint8Array }
  | { kind: "ext"; path: number[]; child: Node }
  | { kind: "branch"; children: (Node | null)[]; value: Uint8Array };

interface Entry { key: number[]; value: Uint8Array }

function nibbles(bytes: Uint8Array): number[] {
  const out: number[] = [];
  for (const b of bytes) out.push(b >> 4, b & 0x0f);
  return out;
}

function hexPrefix(nib: number[], leaf: boolean): Uint8Array {
  const odd = nib.length % 2 === 1;
  const flag = (leaf ? 2 : 0) + (odd ? 1 : 0);
  const all = odd ? [flag, ...nib] : [flag, 0, ...nib];
  const out = new Uint8Array(all.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = (all[2 * i]! << 4) | all[2 * i + 1]!;
  return out;
}

function buildNode(entries: Entry[], depth: number): Node {
  if (entries.length === 1) {
    const e = entries[0]!;
    return { kind: "leaf", path: e.key.slice(depth), value: e.value };
  }
  let common = 0;
  const first = entries[0]!.key;
  outer: while (true) {
    const n = first[depth + common];
    if (n === undefined) break;
    for (const e of entries) if (e.key[depth + common] !== n) break outer;
    common++;
  }
  if (common > 0) {
    return { kind: "ext", path: first.slice(depth, depth + common), child: buildNode(entries, depth + common) };
  }
  const groups: Entry[][] = Array.from({ length: 16 }, () => []);
  let value: Uint8Array = new Uint8Array(0);
  for (const e of entries) {
    if (e.key.length === depth) value = e.value;
    else groups[e.key[depth]!]!.push(e);
  }
  return { kind: "branch", children: groups.map((g) => (g.length ? buildNode(g, depth + 1) : null)), value };
}

class Encoder {
  private readonly memo = new Map<Node, Uint8Array>();
  rlp(node: Node): Uint8Array {
    const known = this.memo.get(node);
    if (known) return known;
    const enc = rlpEncode(this.item(node));
    this.memo.set(node, enc);
    return enc;
  }
  item(node: Node): RlpItem {
    switch (node.kind) {
      case "leaf": return [hexPrefix(node.path, true), node.value];
      case "ext": return [hexPrefix(node.path, false), this.ref(node.child)];
      case "branch": return [...node.children.map((c) => (c ? this.ref(c) : new Uint8Array(0))), node.value];
    }
  }
  /** A child as its parent holds it: inline when its RLP is under 32 bytes, else its hash. */
  ref(node: Node): RlpItem {
    const enc = this.rlp(node);
    return enc.length < 32 ? this.item(node) : keccak256(enc);
  }
}

/**
 * The trie root over `values` keyed by rlp(index), and the proof for `index`:
 * the root node, then every node on the path its parent references by hash.
 */
export function txTrieProof(values: readonly Uint8Array[], index: number): { root: Uint8Array; proof: Uint8Array[] } {
  if (values.length === 0) throw new TypeError("an empty block has no transaction to prove");
  if (index < 0 || index >= values.length) throw new RangeError("transaction index out of range");
  const entries: Entry[] = values.map((v, i) => ({ key: nibbles(txTrieKey(i)), value: v }));
  const root = buildNode(entries, 0);
  const enc = new Encoder();
  const target = nibbles(txTrieKey(index));
  const proof: Uint8Array[] = [enc.rlp(root)];
  let node: Node = root;
  let depth = 0;
  while (node.kind !== "leaf") {
    let next: Node | null;
    if (node.kind === "ext") {
      depth += node.path.length;
      next = node.child;
    } else {
      if (depth === target.length) break;
      next = node.children[target[depth]!] ?? null;
      depth += 1;
    }
    if (!next) throw new Error("target not in trie");
    const r = enc.rlp(next);
    if (r.length >= 32) proof.push(r);
    node = next;
  }
  return { root: keccak256(proof[0]!), proof };
}
