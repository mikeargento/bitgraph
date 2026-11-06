// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * Two Base writes a day: one opens an epoch, the second closes it with the root of every record bound in it.
 *
 * BitGraph's writer used to send a record's hash to Base seconds after the record was bound. With its roll mode on
 * (server/commit-service/src/ceiling/writer.ts, CEILING_ROLL_ROOT), it holds an epoch's records until the epoch is
 * closed, just before its enclave shuts down, then writes them all under one Merkle root. Inside the epoch
 * the order needs no chain: each BitGraph comes after the one before it, by construction, so the next BitGraph is
 * the ceiling of the one before. The root does a different job: it fixes the finished epoch as a set.
 *
 * The site has to know from when, because a record bound after the switch has no Base write for up to a day and a
 * proof page should not ask for one every few seconds. Proof pages show the recorded time alone under When, so the
 * root gets no row there; the export message and the MCP summary say where the record's hash goes.
 * The writer's switch was turned on at 2026-11-06 07:36:47 UTC, and that moment is the default here.
 * NEXT_PUBLIC_ROLL_ROOT_START overrides it with another ISO time; set to anything unreadable (for example "off") it
 * turns the switch off, and every page behaves as it did before.
 */

const SWITCHED_ON = "2026-11-06T07:36:47Z";
const START = Date.parse(process.env.NEXT_PUBLIC_ROLL_ROOT_START ?? SWITCHED_ON);

/** The moment the writer went to one root per closed epoch, in ms; null while it has not. */
export const ROLL_ROOT_START_MS: number | null = Number.isFinite(START) ? START : null;

/** Whether a record made at `recordedMs` is written under its epoch's root instead of in a write of its own. */
export function rollRootCovers(recordedMs: number | null | undefined): boolean {
  return ROLL_ROOT_START_MS !== null && typeof recordedMs === "number" && recordedMs >= ROLL_ROOT_START_MS;
}
