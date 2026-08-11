// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Rule scaffolding: from a list of (filename, digest) pairs to a rule
 * skeleton the author edits into a real rule.
 *
 * The skeleton is deliberately NOT a parseable rule: `requires.ordering`
 * is emitted as a placeholder the author must replace. The trust floor is
 * the rule's own security policy and has no default (SPEC section 2);
 * scaffolding must not choose it either, or every scaffolded rule would
 * silently carry the tool's policy instead of the author's.
 *
 * Everything else parses as written once the floor is chosen: cast roles
 * in input order, each digest in the sha256:<hex> spelling, and an
 * all-roles-exist claim as a working starting point.
 *
 * Deterministic: same entries in the same order produce identical bytes.
 * The generated id is derived from the digests alone.
 */

import { createHash } from "node:crypto";

export const ORDERING_PLACEHOLDER = "CHOOSE: hash-linked | assumption-dependent";

export interface ScaffoldEntry {
  /** Filename (any path form; only the basename shapes the role name). */
  name: string;
  /** Lowercase hex SHA-256 of the file bytes. */
  sha256Hex: string;
}

/**
 * Derive a cast role name from a filename: basename, final extension
 * dropped, characters outside [A-Za-z0-9_.-] folded to "-", runs
 * collapsed, edges trimmed. Grammar guards from SPEC section 2: never
 * empty ("file"), never pure-integer ("file-<digits>").
 *
 * Only "/" separates here. Backslash is an ordinary filename character
 * on POSIX, and splitting on it fabricated wrong names for legal files;
 * platform-correct basename extraction is the CLI's job (node:path),
 * while this function stays byte-deterministic across platforms.
 */
export function roleNameForFile(name: string): string {
  const base = name.split("/").pop() as string;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  let role = stem
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  if (role.length === 0) role = "file";
  if (/^[0-9]+$/.test(role)) role = `file-${role}`;
  return role;
}

/**
 * Build the skeleton text. Roles keep input order; name collisions get
 * "-2", "-3", … suffixes in input order. Serialization matches the house
 * style: two-space indent, one trailing newline.
 */
export function scaffoldRule(entries: readonly ScaffoldEntry[]): string {
  if (entries.length === 0) {
    throw new Error("scaffoldRule requires at least one entry");
  }
  for (const entry of entries) {
    if (!/^[0-9a-f]{64}$/.test(entry.sha256Hex)) {
      throw new Error(
        `scaffoldRule: sha256Hex for "${entry.name}" must be 64 lowercase hex characters`
      );
    }
  }

  // Deterministic id from the digests alone, order-independent.
  const idHash = createHash("sha256")
    .update([...entries.map((e) => e.sha256Hex)].sort().join("\n"))
    .digest("hex");
  const id = `rule-${idHash.slice(0, 12)}`;

  // A collision suffix must never equal another entry's NATURAL name:
  // with photo.jpg, photo.png, photo-2.jpg, giving photo.png the role
  // "photo-2" silently binds the wrong digest for an author who edits
  // the claim by role name. Suffix candidates skip every base name;
  // each base is still available to its own entry unsuffixed.
  const bases = entries.map((entry) => roleNameForFile(entry.name));
  const reserved = new Set(bases);
  const taken = new Set<string>();
  const roles: string[] = [];
  for (const base of bases) {
    let role = base;
    for (let n = 2; taken.has(role) || (role !== base && reserved.has(role)); n++) {
      role = `${base}-${n}`;
    }
    taken.add(role);
    roles.push(role);
  }

  // Null prototype for the same reason parseRule uses one: a file named
  // "__proto__.jpg" must become an ordinary own key.
  const cast: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  entries.forEach((entry, i) => {
    const item: Record<string, unknown> = { digest: `sha256:${entry.sha256Hex}` };
    // Omitted when degenerate ("photos/", ""): an empty means would ship
    // a vacuous declared assertion into every verdict this rule produces.
    const meansBase = entry.name.split("/").pop() as string;
    if (meansBase.length > 0) item["means"] = meansBase;
    cast[roles[i] as string] = item;
  });

  const skeleton = {
    rule: "bitgraph-player/1",
    id,
    cast,
    world: "closed",
    requires: { ordering: ORDERING_PLACEHOLDER },
    claim: { all: roles.map((role) => ({ exists: role })) },
  };
  return JSON.stringify(skeleton, null, 2) + "\n";
}
