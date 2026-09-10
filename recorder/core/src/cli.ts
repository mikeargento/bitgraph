#!/usr/bin/env node
// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * BitGraph Recorder from a shell.
 *
 * The Mac app is a shell around this same core, and this is the other shell:
 * everything the app can do can be done here, which is what makes the app
 * testable and what makes a headless machine usable.
 *
 * ⚠️ ONLY FAILURES SPEAK. `check` prints the name, position and time of what
 * verified and nothing else about it. What failed says which side it failed
 * on. What could not be checked says so and is never counted as a failure.
 */

import { dirname, join, resolve } from "node:path";
import { stat } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { Daemon } from "./daemon.js";
import { checkFolder, walk, type CheckedFile } from "./check.js";
import { makeFiles } from "./make.js";
import { completeLibrary } from "./anchors.js";
import { FolderIndex } from "./index-store.js";
import { ledger } from "./library.js";
import { INDEX_FILE } from "./paths.js";
import { loadSettings, saveSettings, suggestedFolder, SUGGESTED_FOLDER_NAME, DEFAULT_BASE_URL } from "./settings.js";
import { watchFolder, type WatchEvent } from "./watch.js";
import { supportDir } from "./app-paths.js";

const USAGE = `BitGraph Recorder

  bitgraph-recorder make <file-or-folder>...   Make a BitGraph. One file is fused on its own;
                                               two or more become one set at one position.
  bitgraph-recorder check <folder>             Check every file in a folder against the
                                               BitGraphs beside it. Nothing is sent.
  bitgraph-recorder watch <folder>...          Watch folders and record what lands in them.
  bitgraph-recorder anchors <folder>           Fetch the Ethereum anchors this folder is missing.
  bitgraph-recorder setup <where> [name]        Choose where your BitGraph folder goes.
                                             Nothing records until this is done.
  bitgraph-recorder folders                    List the folders the app syncs.
  bitgraph-recorder folders add <folder>       Add one to that list.
  bitgraph-recorder folders remove <folder>    Take one off it. Nothing in the folder changes.
  bitgraph-recorder status                     What the app knows about each folder.
  bitgraph-recorder daemon                     Speak the app protocol on stdin and stdout.

Options
  --base-url <url>     Where slots are allocated and commits are filled (default ${DEFAULT_BASE_URL}).
  --allocate-path <p>  The slot route on that host (default /api/fuse/allocate; a licensee
                       running the commit service uses /allocate-slot).
  --commit-path <p>    The commit route (default /api/fuse/commit; parent-direct /commit).
  --again              Make a BitGraph even if these bytes already have one in this folder.
  --json               Print machine-readable JSON instead of prose.
  --quiet              Print only what has something to say.
  --help               This.

The original is never modified and never moved. The fused bytes are never
written: they are virtual, and the recording's proof rebuilds them.

Exit codes: 0 all good, 1 something failed a check, 2 something could not be
checked, 64 usage.
`;

interface Args {
  command: string;
  positional: string[];
  flags: Map<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  /* `--help` on its own is not a command called "--help". */
  const leadingFlag = argv[0]?.startsWith("--") === true;
  const [command, rest] = leadingFlag ? ["", argv] : [argv[0] ?? "", argv.slice(1)];
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  const valued = new Set(["base-url", "allocate-path", "commit-path"]);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (valued.has(key) && next !== undefined && !next.startsWith("--")) {
        flags.set(key, next);
        i++;
      } else flags.set(key, true);
    } else positional.push(a);
  }
  return { command, positional, flags };
}

async function main(argv: string[]): Promise<number> {
  const { command, positional, flags } = parseArgs(argv);
  if (flags.has("help") || command === "" || command === "help") {
    process.stdout.write(USAGE);
    return command === "" || command === "help" ? 0 : 64;
  }
  const json = flags.has("json");
  const baseUrlFlag = flags.get("base-url");
  const settings = await loadSettings();
  const baseUrl = typeof baseUrlFlag === "string" ? baseUrlFlag : settings.baseUrl;
  const str = (k: string, fallback: string): string => {
    const v = flags.get(k);
    return typeof v === "string" ? v : fallback;
  };
  const transport = { baseUrl, allocatePath: str("allocate-path", settings.allocatePath), commitPath: str("commit-path", settings.commitPath) };

  switch (command) {
    case "setup":
      return cmdSetup(positional);
    case "make": {
      const gate = requireSetUp(settings);
      if (gate !== null) return gate;
      return cmdMake(positional, { transport, again: flags.has("again"), json, library: settings.library });
    }
    case "check":
      return cmdCheck(positional, { json, quiet: flags.has("quiet"), library: settings.library, alsoKnownEnclaves: settings.alsoKnownEnclaves });
    case "watch": {
      const gate = requireSetUp(settings);
      if (gate !== null) return gate;
      return cmdWatch(positional, { transport, json, library: settings.library });
    }
    case "anchors":
      return cmdAnchors(positional, { baseUrl, json, library: settings.library });
    case "folders":
      return cmdFolders(positional, json);
    case "status":
      return cmdStatus(json, baseUrl);
    case "daemon": {
      const daemon = await Daemon.start({
        ...(typeof baseUrlFlag === "string" ? { baseUrl: baseUrlFlag } : {}),
        ...(typeof flags.get("allocate-path") === "string" ? { allocatePath: flags.get("allocate-path") as string } : {}),
        ...(typeof flags.get("commit-path") === "string" ? { commitPath: flags.get("commit-path") as string } : {}),
      });
      daemon.listen();
      await new Promise(() => {});
      return 0;
    }
    default:
      process.stderr.write(USAGE);
      return 64;
  }
}

// ── setup ───────────────────────────────────────────────────────────────────

/**
 * ⚠️ WHERE IT GOES IS ASKED, NOT ASSUMED, HERE TOO. A folder appearing in
 * somebody's home directory because a command assumed it is the thing this
 * exists to avoid.
 */
async function cmdSetup(args: string[]): Promise<number> {
  const where = args[0];
  if (where === undefined) {
    const settings = await loadSettings();
    if (settings.folder !== "") {
      process.stdout.write(`Your BitGraph folder is ${settings.folder}\nRecordings go in ${settings.library}\n`);
      return 0;
    }
    process.stderr.write(`Not set up yet.\n\n  bitgraph-recorder setup <where> [name]\n\nSuggested: bitgraph-recorder setup "${dirname(suggestedFolder())}"\n`);
    return 64;
  }
  const settings = await loadSettings();
  const name = (args[1] ?? SUGGESTED_FOLDER_NAME).trim();
  if (name === "" || name === "." || name === ".." || /[/\\:\x00-\x1f]/.test(name)) {
    process.stderr.write(`"${name}" is not a folder name. Use a plain name, with no slashes.\n`);
    return 64;
  }
  const folder = join(resolve(where), name);
  const library = join(folder, "Recordings");
  const adopted = existsSync(library);
  mkdirSync(library, { recursive: true });
  settings.folder = folder;
  settings.library = library;
  await saveSettings(settings);
  process.stdout.write(`${adopted ? "Continuing" : "Created"} ${folder}\nRecordings go in ${library}\n`);
  return 0;
}

/** Nothing records before somebody has said where it goes. */
function requireSetUp(settings: { folder: string }): number | null {
  if (settings.folder !== "") return null;
  process.stderr.write("Not set up yet: choose where your BitGraph folder goes.\n\n  bitgraph-recorder setup <where> [name]\n");
  return 64;
}

// ── make ────────────────────────────────────────────────────────────────────

async function cmdMake(args: string[], opts: { transport: { baseUrl: string; allocatePath: string; commitPath: string }; again: boolean; json: boolean; library: string }): Promise<number> {
  if (args.length === 0) {
    process.stderr.write("make needs at least one file or folder.\n");
    return 64;
  }
  /* A folder on the command line means everything in it: the same drop the app
   * makes when you point it at an export. The folder each file belongs to is
   * where its BitGraphs go. */
  const { root, files } = await expand(args);
  if (files.length === 0) {
    process.stderr.write("nothing to record.\n");
    return 64;
  }

  let lastPhase = "";
  const { made, skipped } = await makeFiles(root, files, {
    transport: opts.transport,
    again: opts.again,
    /* ⚠️ Recordings go in the LIBRARY. Without this they land beside the
     * folder they came from, which is the shape this app stopped having. */
    bundle: { library: opts.library, source: files.length === 1 ? (files[0]!.split("/").pop() ?? "file") : (root.split("/").pop() ?? "drop") },
    onProgress: (p) => {
      if (opts.json || !process.stderr.isTTY) return;
      if (p.phase !== lastPhase) {
        lastPhase = p.phase;
        process.stderr.write(`\n${p.phase} `);
      }
      process.stderr.write(`\r${p.phase} ${p.done}/${p.total}   `);
    },
  });
  if (!opts.json && process.stderr.isTTY) process.stderr.write("\n");

  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ made, skipped }, replacer, 2)}\n`);
    return 0;
  }
  for (const s of skipped) {
    process.stdout.write(`${s.name}: already recorded at ${s.positions.map((p) => p.counter).join(", ")}${s.attached ? ", its BitGraph is now beside it" : ""}\n`);
  }
  if (made === null) {
    process.stdout.write(skipped.length > 0 ? "Nothing new to record.\n" : "Nothing to record.\n");
    return 0;
  }
  const what = made.kind === "solo" ? "1 file" : `${made.files.length} files, one set`;
  process.stdout.write(`Made: ${what} at position ${made.position.counter} in epoch ${made.position.epochId.slice(0, 12)}…\n`);
  if (made.bundlePath !== undefined) {
    process.stdout.write(`  ${made.bundlePath}\n`);
    process.stdout.write(`  the files went in as ${made.bundleHow === "linked" ? "hard links, so this cost no disk" : "copies (a different volume)"}\n`);
  }
  for (const f of made.files.slice(0, 6)) process.stdout.write(`    ${f.name}\n`);
  if (made.files.length > 6) process.stdout.write(`    … and ${(made.files.length - 6).toLocaleString()} more\n`);
  return 0;
}

// ── check ───────────────────────────────────────────────────────────────────

async function cmdCheck(args: string[], opts: { json: boolean; quiet: boolean; library: string; alsoKnownEnclaves: Array<{ pcr0: string; label: string }> }): Promise<number> {
  const root = resolve(args[0] ?? ".");
  /* ⚠️ The library is where recordings are. Checking a folder without it can
   * only ever say "no BitGraph for these bytes", which is the worst thing this
   * command can say about files that are perfectly well recorded. */
  const report = await checkFolder(root, { library: opts.library, alsoKnownEnclaves: opts.alsoKnownEnclaves });
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report, replacer, 2)}\n`);
  } else {
    const c = report.counts;
    /* ⚠️ A count is only printed for what was actually counted. */
    if (report.partial) process.stdout.write("This check stopped early. The numbers below are of what it reached, not of the folder.\n\n");
    for (const f of report.speaking) process.stdout.write(`${line(f)}\n`);
    if (report.speaking.length > 0) process.stdout.write("\n");
    process.stdout.write(
      `${c.verified} verified · ${c.failed} failed · ${c.undetermined} could not be checked · ${c.unrecorded} not recorded` +
        ` · ${report.positions} position${report.positions === 1 ? "" : "s"}\n`,
    );
  }
  if (report.counts.failed > 0) return 1;
  if (report.counts.undetermined > 0) return 2;
  return 0;
}

function line(f: CheckedFile): string {
  switch (f.status) {
    case "failed":
      return `FAILED  ${f.rel}  (${f.failedOn}) ${f.reason ?? ""}`;
    case "undetermined":
      return `?       ${f.rel}  ${f.reason ?? "could not be checked."}`;
    case "unrecorded":
      return `-       ${f.rel}  ${f.reason ?? "no BitGraph for these bytes."}`;
    default:
      return `ok      ${f.rel}`;
  }
}

// ── watch ───────────────────────────────────────────────────────────────────

async function cmdWatch(args: string[], opts: { transport: { baseUrl: string; allocatePath: string; commitPath: string }; json: boolean; library: string }): Promise<number> {
  if (args.length === 0) {
    process.stderr.write("watch needs at least one folder.\n");
    return 64;
  }
  const roots = args.map((a) => resolve(a));
  const say = (e: WatchEvent): void => {
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(e, replacer)}\n`);
      return;
    }
    switch (e.kind) {
      case "watching":
        process.stdout.write(`Watching ${e.root}\n`);
        break;
      case "making":
        if (e.progress !== undefined) process.stderr.write(`\r${e.progress.phase} ${e.progress.done}/${e.progress.total}   `);
        break;
      case "made":
        process.stdout.write(`\rMade ${e.result.files.length} file${e.result.files.length === 1 ? "" : "s"} at position ${e.result.position.counter}\n`);
        break;
      case "skipped":
        process.stdout.write(`\r${e.files.length} already recorded\n`);
        break;
      case "trouble":
        process.stderr.write(`\n${e.reason}\n`);
        break;
      default:
        break;
    }
  };
  const watchers = roots.map((root) => watchFolder(root, { transport: opts.transport, library: opts.library, onEvent: say }));
  for (const w of watchers) void w.sweep();
  process.on("SIGINT", () => {
    for (const w of watchers) w.close();
    process.stdout.write("\nStopped watching. Nothing in the folders was changed.\n");
    process.exit(0);
  });
  await new Promise(() => {});
  return 0;
}

// ── anchors ─────────────────────────────────────────────────────────────────

async function cmdAnchors(args: string[], opts: { baseUrl: string; json: boolean; library: string }): Promise<number> {
  const root = resolve(args[0] ?? ".");
  const index = await FolderIndex.open(join(opts.library, INDEX_FILE));
  const pass = await completeLibrary(opts.library, index.rows, { baseUrl: opts.baseUrl });
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(pass, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(`${pass.positions} position${pass.positions === 1 ? "" : "s"} looked at, ${pass.landed} anchor${pass.landed === 1 ? "" : "s"} arrived.\n`);
  for (const [state, n] of Object.entries(pass.open)) {
    process.stdout.write(`  ${n} still open: ${state}\n`);
  }
  return 0;
}

// ── folders and status ──────────────────────────────────────────────────────

async function cmdFolders(args: string[], json: boolean): Promise<number> {
  const settings = await loadSettings();
  const [action, target] = args;
  if (action === "add" && target !== undefined) {
    const path = resolve(target);
    if (!settings.folders.some((f) => f.path === path)) settings.folders.push({ path, addedAt: new Date().toISOString() });
    await saveSettings(settings);
  } else if (action === "remove" && target !== undefined) {
    const path = resolve(target);
    settings.folders = settings.folders.filter((f) => f.path !== path);
    await saveSettings(settings);
  } else if (action !== undefined) {
    process.stderr.write("folders takes nothing, or `add <folder>` or `remove <folder>`.\n");
    return 64;
  }
  if (json) {
    process.stdout.write(`${JSON.stringify(settings.folders, null, 2)}\n`);
    return 0;
  }
  if (settings.folders.length === 0) process.stdout.write("No folders yet. `bitgraph-recorder folders add <folder>`\n");
  for (const f of settings.folders) process.stdout.write(`${f.paused === true ? "paused  " : "        "}${f.path}\n`);
  return 0;
}

async function cmdStatus(json: boolean, baseUrl: string): Promise<number> {
  const settings = await loadSettings();
  if (settings.library === "") {
    if (json) process.stdout.write(`${JSON.stringify({ baseUrl, library: "", setUp: false }, null, 2)}\n`);
    else process.stdout.write("Not set up yet: choose where your BitGraph folder goes.\n\n  bitgraph-recorder setup <where> [name]\n");
    return 0;
  }
  /* ⚠️ One library, so one index. A folder can only say what came OUT of it. */
  const index = await FolderIndex.open(join(settings.library, INDEX_FILE));
  const rows = settings.folders.map((f) => {
    const from = index.fromFolder(f.path);
    return { path: f.path, paused: f.paused === true, recorded: from.files, positions: from.recordings, damagedIndexLines: index.damagedLines };
  });
  /* Recordings are counted where they are; files are what the index counted. */
  const recordings = (await ledger(settings.library)).total;
  if (json) {
    process.stdout.write(`${JSON.stringify({ baseUrl, library: settings.library, supportDir: supportDir(), folders: rows, recordings, recorded: index.fileCount }, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(`Recording to ${baseUrl}\nRecordings in ${settings.library}\nState in ${supportDir()}\n\n`);
  process.stdout.write(`${recordings.toLocaleString()} recording${recordings === 1 ? "" : "s"}${index.fileCount > 0 ? `, ${index.fileCount.toLocaleString()} file${index.fileCount === 1 ? "" : "s"}` : ""}\n\n`);
  for (const r of rows) {
    process.stdout.write(`${r.path}\n  ${r.recorded} recorded in ${r.positions} recording${r.positions === 1 ? "" : "s"}${r.paused ? "  (paused)" : ""}\n`);
    if (r.damagedIndexLines > 0) process.stdout.write(`  ${r.damagedIndexLines} unreadable index line${r.damagedIndexLines === 1 ? "" : "s"}; the BitGraphs themselves are unaffected.\n`);
  }
  if (rows.length === 0) process.stdout.write("No folders synced. Drops still record; syncing is for folders that fill themselves.\n");
  return 0;
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** Files named directly, plus everything inside any folder named. */
async function expand(args: string[]): Promise<{ root: string; files: string[] }> {
  const files: string[] = [];
  let root: string | null = null;
  for (const a of args) {
    const p = resolve(a);
    const s = await stat(p);
    if (s.isDirectory()) {
      root ??= p;
      files.push(...(await walk(p, { excluding: [(await loadSettings()).folder] })));
    } else {
      root ??= resolve(p, "..");
      files.push(p);
    }
  }
  return { root: root ?? process.cwd(), files };
}

/** Uint8Array and friends never reach a JSON line as an object of numbers. */
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  return value;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
