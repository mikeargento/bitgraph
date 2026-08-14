// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * The title abstract: a generated bitgraph-player/1 rule that evaluates
 * one presented thread's CHAIN story against a proof bundle.
 *
 * Division of labor, matching conveyancing exactly:
 *
 *   - The Titles thread checker (thread.ts) answers the KEY story:
 *     every message well-formed, every signature verifying, every hop
 *     obeying give-names-taker / take-signed-by-named-key. Pure and
 *     offline. A message's signature is embedded and covers its own
 *     canonical bytes, so it cannot also cover the file's final digest —
 *     signature validity is therefore checked at the message layer,
 *     never through Player's detached-signature claim.
 *   - Player over the bundle answers the CHAIN story — every file
 *     recorded, in the claimed order: exists(work), before(work, msg0),
 *     exists(msg_i), before(msg_{i-1}, msg_i). That is the title
 *     ABSTRACT: offline, eternal, byte-reproducible, and deliberately a
 *     format 1 rule so any conforming Player ever shipped can evaluate
 *     it.
 *   - CURRENCY ("is the head unconsumed right now") is a live question
 *     for the dedup oracle — derive the head's consumption marker and
 *     look it up. A bundle cannot prove chain-absence, so the abstract
 *     never claims it: the title SEARCH stays a search.
 *
 * A complete title check is therefore: thread clean AND abstract TRUE
 * AND search fresh. Three answers, three tools, no claim overlapping
 * another's ground.
 *
 * First-position-wins between COMPETING threads is adjudicated by
 * evaluating each presentation over a shared bundle and comparing the
 * decided positions — deterministically, on anyone's machine.
 */

import type { Thread } from "./types.js";

export interface TitleRuleOptions {
  /**
   * The evidence floor, passed through to requires.ordering. No default:
   * the floor is the rule author's security policy, here as everywhere.
   */
  ordering: "hash-linked" | "assumption-dependent";
  id?: string;
}

/** Build the title abstract rule for a structurally valid thread. */
export function buildTitleRule(thread: Thread, options: TitleRuleOptions): string {
  const subjectHex = thread.about.slice("sha256:".length);

  const cast: Record<string, unknown> = {
    work: { digest: thread.about, means: "the subject of the title" },
  };
  thread.links.forEach((link, i) => {
    cast[`msg_${i}`] = {
      digest: `sha256:${link.sha256Hex}`,
      means: `possession message ${i}: ${link.pm.claim} by ${link.pm.alg}:${link.pm.publicKey.slice(0, 12)}`,
    };
  });

  const claims: unknown[] = [{ exists: "work" }, { before: ["work", "msg_0"] }];
  thread.links.forEach((_link, i) => {
    claims.push({ exists: `msg_${i}` });
    if (i > 0) claims.push({ before: [`msg_${i - 1}`, `msg_${i}`] });
  });

  const rule = {
    rule: "bitgraph-player/1",
    id: options.id ?? `title-${subjectHex.slice(0, 12)}`,
    cast,
    world: "closed",
    requires: { ordering: options.ordering },
    claim: { all: claims },
    then: { label: "title_abstract_valid" },
  };
  return JSON.stringify(rule, null, 2) + "\n";
}
