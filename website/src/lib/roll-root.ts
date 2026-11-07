// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * When a record's epoch wrote a root of its records to Base, and from when no record is written to Base at all.
 *
 * For a while each epoch had two Base writes: one opened it, the second closed it with the root of every record bound in
 * it. Since the one-write switch (ONE_WRITE_START_MS below) an epoch's genesis is its only Base write.
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

/**
 * From this moment an epoch's only Base write is its genesis: no record is written to Base, under a root or alone, and
 * the epoch ends with a closing BitGraph inside its own line. The switch took effect on the host at the time below.
 * NEXT_PUBLIC_ONE_WRITE_START overrides it with another ISO time.
 */
const ONE_WRITE_SWITCH = "2026-11-07T04:59:53Z";
const ONE_WRITE = Date.parse(process.env.NEXT_PUBLIC_ONE_WRITE_START ?? ONE_WRITE_SWITCH);
export const ONE_WRITE_START_MS: number | null = Number.isFinite(ONE_WRITE) ? ONE_WRITE : null;

/** Whether a record made at `recordedMs` has no Base write of its own to wait for: its epoch's genesis is the only one. */
export function oneWriteCovers(recordedMs: number | null | undefined): boolean {
  return ONE_WRITE_START_MS !== null && typeof recordedMs === "number" && recordedMs >= ONE_WRITE_START_MS;
}

/** Whether a record made at `recordedMs` is written under its epoch's root instead of in a write of its own. */
export function rollRootCovers(recordedMs: number | null | undefined): boolean {
  return ROLL_ROOT_START_MS !== null && typeof recordedMs === "number" && recordedMs >= ROLL_ROOT_START_MS && !oneWriteCovers(recordedMs);
}
