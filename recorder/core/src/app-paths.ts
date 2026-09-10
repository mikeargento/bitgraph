// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * Where the app keeps its own state, as distinct from a folder's evidence.
 *
 * ⚠️ NOTHING HERE IS EVIDENCE. Everything a BitGraph rests on lives in the
 * watched folder, beside the files, and this directory can be deleted without
 * losing a single proof. What it holds is: which folders are being watched,
 * and proofs that were minted and could not be written where they belonged.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export const APP_NAME = "BitGraph Recorder";

/**
 * The name this app was called for a day.
 *
 * ⚠️ Kept so somebody who synced folders under the old name does not open a
 * renamed app and find it watching nothing. Read once, never written.
 */
const FORMER_APP_NAME = "BitGraph Folder";

/** ~/Library/Application Support/BitGraph Recorder */
export function supportDir(): string {
  const override = process.env["BITGRAPH_RECORDER_HOME"];
  if (override !== undefined && override !== "") return override;
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", APP_NAME);
  return join(homedir(), ".bitgraph-recorder");
}

/** The list of synced folders and their settings. */
export function settingsPath(): string {
  return join(supportDir(), "settings.json");
}

/** Where the same file sat under the app's former name, or null. */
export function formerSettingsPath(): string | null {
  if (process.env["BITGRAPH_RECORDER_HOME"] !== undefined) return null;
  if (process.platform !== "darwin") return null;
  return join(homedir(), "Library", "Application Support", FORMER_APP_NAME, "settings.json");
}

/**
 * Proofs that were made and could not be written beside their file.
 *
 * ⚠️ This directory being non-empty is a fault that has not been cleared. It
 * is not a cache and nothing here may be deleted to save space.
 */
export function rescueDir(): string {
  return join(supportDir(), "rescue");
}

/** A running log, for reading after the fact. Never a substitute for saying something out loud. */
export function logPath(): string {
  return join(supportDir(), "folder.log");
}
