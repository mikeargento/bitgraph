// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * What the app remembers between launches: which folders it watches, and where
 * it commits.
 *
 * ⚠️ NO LOGIN, EVER. Standing ruling. There is no account here, no token, no
 * identity, and nothing in this file identifies the person using it. A folder
 * path and a base URL is the whole of it.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeJsonAtomic } from "./evidence.js";
import { settingsPath, formerSettingsPath } from "./app-paths.js";
import { defaultHome, recordingsIn, FOLDER_NAME } from "./bundle.js";

export const SETTINGS_VERSION = "bitgraph-folder-settings/1";

/** The one host the app speaks to. */
export const DEFAULT_BASE_URL = "https://bitgraph.ing";

/** What setup offers, when nobody has chosen: a place, and a name. */
export function suggestedFolder(path = settingsPath()): string {
  return defaultFolderFor(path);
}

/** The name the setup field is filled in with. */
export const SUGGESTED_FOLDER_NAME = FOLDER_NAME;

/** How many drop-only folders stay in the anchor rotation. */
export const MAX_RECORDED = 25;

export interface WatchedFolder {
  path: string;
  /** Watching can be paused without forgetting the folder. */
  paused?: boolean;
  /** When this folder was added. This machine's clock. */
  addedAt?: string;
}

export interface Settings {
  version: typeof SETTINGS_VERSION;
  folders: WatchedFolder[];
  /**
   * Folders this app has recorded into but is not watching.
   *
   * ⚠️ AN UPPER BOUND IS DEFERRED, NEVER LOST, AND SOMETHING HAS TO GO BACK
   * FOR IT. The anchor pass used to walk the watched list alone, so a folder
   * somebody dropped on and never added got its floor and nothing else: the
   * Ethereum window on every one of those BitGraphs stayed open forever, with
   * the app right there and able to close it. Bounded and oldest-first.
   */
  recorded: string[];
  /**
   * The BitGraph folder: where everything this app makes lives.
   *
   * ⚠️ CHOSEN AT SETUP, NEVER ASSUMED. Empty means nobody has chosen yet and
   * the app has not been set up; it records nothing until somebody says where.
   *
   * ⚠️ A DROP LEAVES NOTHING WHERE THE FILES CAME FROM. Your folders stay
   * exactly as they were; the recording is a folder of its own in here, and on
   * the same volume its files are hard links, so it costs no bytes.
   */
  folder: string;
  /** `<folder>/Recordings`. Derived, never stored: one place decides. */
  library: string;
  /** Where slots are allocated and commits are filled. One host. */
  baseUrl: string;
  /**
   * The two routes on that host.
   *
   * Defaults are the site's. A licensee running the commit service themselves
   * talks to the parent directly, where they are `/allocate-slot` and
   * `/commit`; the test harness does the same. Two calls, and neither one
   * carries a byte of any file.
   */
  allocatePath: string;
  commitPath: string;
  /** Seconds between anchor passes when something is still open. */
  anchorIntervalSeconds: number;
  /**
   * Enclave measurements to trust beyond the ones this build ships.
   *
   * ⚠️ Empty by default, and adding one is a trust decision. A proof from an
   * enclave the build does not know reads as undetermined, never as invalid
   * and never as verified.
   */
  alsoKnownEnclaves: Array<{ pcr0: string; label: string }>;
}

export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    folders: [],
    /* ⚠️ Empty until setup. Not a default that quietly becomes real. */
    folder: "",
    library: "",
    recorded: [],
    baseUrl: DEFAULT_BASE_URL,
    allocatePath: "/api/fuse/allocate",
    commitPath: "/api/fuse/commit",
    /* Anchors land every ~12 s while the enclave is busy and up to an hour
     * when it is not, so a minute is often enough and costs almost nothing.
     * The pass backs off on its own when everything is settled. */
    anchorIntervalSeconds: 60,
    alsoKnownEnclaves: [],
  };
}

/**
 * ⚠️ AN EXPLICIT SETTINGS PATH MEANS AN ISOLATED INSTALL, LIBRARY AND ALL.
 *
 * Twice now a test handed the daemon a temporary settings file and it recorded
 * into the REAL library anyway, because the library's default is global while
 * the settings path was not. Isolation that depends on remembering to set an
 * environment variable is isolation that will fail again. So: told where the
 * settings live, recordings live beside them unless the settings themselves
 * say otherwise.
 */
function defaultFolderFor(path: string): string {
  return path === settingsPath() ? defaultHome() : join(dirname(path), FOLDER_NAME);
}

/**
 * The chosen folder, and Recordings inside it.
 *
 * ⚠️ Carries an older settings file forward: `library` used to be stored
 * directly, so a file with one and no `folder` keeps working, with the folder
 * read back as its parent.
 */
function folderAndLibrary(s: Partial<Settings>, path: string): { folder: string; library: string } {
  if (typeof s.folder === "string" && s.folder !== "") return { folder: s.folder, library: recordingsIn(s.folder) };
  if (typeof s.library === "string" && s.library !== "") return { folder: dirname(s.library), library: s.library };
  void path;
  return { folder: "", library: "" };
}

export async function loadSettings(path = settingsPath()): Promise<Settings> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    /* ⚠️ The app was called something else for a day. Somebody who synced
     * folders then should not open it after the rename and find it watching
     * nothing. Read once; the next save writes under the current name.
     *
     * ⚠️ ONLY WHEN NOBODY NAMED A FILE. A caller that passes a path means that
     * path: falling back to the app's own location made a test daemon, handed
     * a temp settings file, load the REAL install's folders instead. A test
     * that reaches into somebody's actual folders is one keystroke from
     * recording them. */
    const former = path === settingsPath() ? formerSettingsPath() : null;
    if (former !== null) {
      try {
        text = await readFile(former, "utf8");
      } catch {
        return defaultSettings();
      }
    } else {
      return defaultSettings();
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* ⚠️ A settings file that will not parse is not a reason to forget which
     * folders someone was watching. It is left exactly where it is, and the
     * defaults are used for this run so the app still starts and can say so. */
    return defaultSettings();
  }
  const d = defaultSettings();
  if (parsed === null || typeof parsed !== "object") return d;
  const s = parsed as Partial<Settings>;
  return {
    version: SETTINGS_VERSION,
    folders: Array.isArray(s.folders) ? s.folders.filter((f) => typeof f?.path === "string") : d.folders,
    ...folderAndLibrary(s, path),
    recorded: Array.isArray(s.recorded) ? s.recorded.filter((p): p is string => typeof p === "string").slice(-MAX_RECORDED) : d.recorded,
    baseUrl: typeof s.baseUrl === "string" && s.baseUrl !== "" ? s.baseUrl : d.baseUrl,
    allocatePath: typeof s.allocatePath === "string" && s.allocatePath !== "" ? s.allocatePath : d.allocatePath,
    commitPath: typeof s.commitPath === "string" && s.commitPath !== "" ? s.commitPath : d.commitPath,
    anchorIntervalSeconds: typeof s.anchorIntervalSeconds === "number" && s.anchorIntervalSeconds >= 5 ? s.anchorIntervalSeconds : d.anchorIntervalSeconds,
    alsoKnownEnclaves: Array.isArray(s.alsoKnownEnclaves)
      ? s.alsoKnownEnclaves.filter((m) => typeof m?.pcr0 === "string" && typeof m?.label === "string")
      : d.alsoKnownEnclaves,
  };
}

export async function saveSettings(settings: Settings, path = settingsPath()): Promise<void> {
  await writeJsonAtomic(path, settings);
}
