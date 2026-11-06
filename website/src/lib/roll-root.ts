// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * One Base write per closed epoch.
 *
 * BitGraph's writer used to send a record's hash to Base seconds after the record was bound. With its roll mode on
 * (server/commit-service/src/ceiling/writer.ts, CEILING_ROLL_ROOT), it holds an epoch's records until the epoch is
 * over and the next one's genesis transaction is mined, then writes them all under one Merkle root. Inside the epoch
 * the order needs no chain: each BitGraph comes after the one before it, by construction.
 *
 * The site has to know from when, because a record bound after the switch has no Base write for up to a day and the
 * pages should say so instead of asking for one every few seconds. NEXT_PUBLIC_ROLL_ROOT_START holds that moment as
 * an ISO time, set when the writer's switch is turned on. Unset (or unreadable) means the switch is off, and every
 * page behaves as it did.
 */

const START = Date.parse(process.env.NEXT_PUBLIC_ROLL_ROOT_START ?? "");

/** The moment the writer went to one write per epoch, in ms; null while it has not. */
export const ROLL_ROOT_START_MS: number | null = Number.isFinite(START) ? START : null;

/** Whether a record made at `recordedMs` waits for its epoch's root instead of a write of its own. */
export function rollRootCovers(recordedMs: number | null | undefined): boolean {
  return ROLL_ROOT_START_MS !== null && typeof recordedMs === "number" && recordedMs >= ROLL_ROOT_START_MS;
}

/** What stands in the Base write's place until the epoch closes. */
export const ROLL_ROOT_WAIT = "With its epoch’s root, when the next epoch opens";
