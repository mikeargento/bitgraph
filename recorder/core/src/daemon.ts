// Copyright (c) Mike Argento. All rights reserved. See LICENSE.

/**
 * The service the app is built around: watchers, the anchor pass, and a line
 * of JSON in each direction.
 *
 * ⚠️ IT SPEAKS OVER A PIPE, NOT A PORT. There is no socket to find, no port to
 * collide with, and nothing on this machine can reach it except the process
 * that launched it. The shell starts it as a child and writes to its stdin;
 * that is the entire attack surface of the connection.
 *
 * ⚠️ IT PARSES NOTHING UNTRUSTED. What arrives here is JSON from the app's own
 * shell. What arrives from the network is a proof, which the published
 * verifier parses. Files are read as bytes to hash and never interpreted.
 *
 * The protocol is deliberately small:
 *
 *   in   {"id":1,"op":"status"}
 *   out  {"id":1,"ok":true,"result":{...}}
 *   out  {"event":{"kind":"made", ...}}       unsolicited, as things happen
 *
 * Every reply carries the id it answers. Events carry none, which is how a
 * reader tells them apart.
 */

import { createInterface } from "node:readline";
import { mkdir, readdir, stat } from "node:fs/promises";
import { explain, isBlocked } from "./blocked.js";
import { checkForUpdate, type UpdateCheck } from "./update.js";
import { completeLibrary, type AnchorPass } from "./anchors.js";
import { checkFolder, type FolderReport } from "./check.js";
import { makeFiles, makeScanned, type MakeResult, type SkippedFile, type MakeProgress } from "./make.js";
import { scanDrop, lookAt, describe, type LookResult, type Described, isWithin } from "./inspect.js";
import { exportBitGraph, type ExportResult } from "./export.js";
import type { ScannedFile } from "./hash.js";
import { FolderIndex } from "./index-store.js";
import { basename, join } from "node:path";
import { INDEX_FILE } from "./paths.js";
import { loadSettings, saveSettings, suggestedFolder, MAX_RECORDED, type Settings, type WatchedFolder } from "./settings.js";
import { FOLDER_NAME, recordingsIn } from "./bundle.js";
import { watchFolder, type FolderWatcher, type WatchEvent } from "./watch.js";
import { supportDir } from "./app-paths.js";
import { ledger, listDay, search, holdsRecordings, type DayCount, type Recording } from "./library.js";

export interface DaemonEvent {
  event: WatchEvent | { kind: "anchors"; root: string; pass: AnchorPass } | { kind: "settings"; settings: Settings } | { kind: "ready"; supportDir: string }
    | { kind: "checking"; root: string; progress: { done: number; total: number } }
    | { kind: "update"; update: UpdateCheck };
}

interface Request {
  id?: number;
  op: string;
  root?: string;
  files?: string[];
  paths?: string[];
  evidence?: string;
  at?: string;
  name?: string;
  origin?: string;
  epochId?: string;
  counter?: string;
  file?: string;
  into?: string;
  token?: string;
  again?: boolean;
  paused?: boolean;
  /** `recordings`: the day to drill out, `2026-09-09`. */
  day?: string;
  /** `search`: what a recording's name should contain. */
  query?: string;
  /** `update`: the app's own version, `0.1.0`. */
  current?: string;
}

/**
 * What a drop is, in one word.
 *
 *   open   these bytes already have a BitGraph here. Open it.
 *   made   one new file, and the drop IS the shutter: it was recorded.
 *   ready  two or more files. What is there is listed and nothing has been
 *          made; only a batch gets asked.
 *   checked  one folder that holds BitGraphs. It was checked, and nothing was
 *          recorded, changed or sent.
 */
export type DropAction = "open" | "made" | "ready" | "checked";

export interface DropAnswer {
  action: DropAction;
  root: string;
  look: LookResult;
  /** "ready" only: hand this back to commitDrop and the files are not read again. */
  token?: string;
  made?: MakeResult | null;
  skipped?: SkippedFile[];
  /** "open" only: the file whose BitGraph to show. */
  opened?: LookResult["files"][number];
  /** "checked" only: what the check said. */
  report?: FolderReport;
}

export interface DaemonOptions {
  /** Where replies and events go. Defaults to stdout. */
  write?: (line: string) => void;
  /** Overrides the settings file's base URL, for tests and for a licensee's own host. */
  baseUrl?: string;
  /** Overrides the two routes on that host: a licensee talking to the parent directly uses /allocate-slot and /commit. */
  allocatePath?: string;
  commitPath?: string;
  /** Where settings live. */
  settingsPath?: string;
}

export class Daemon {
  private readonly watchers = new Map<string, FolderWatcher>();
  /**
   * The one drop waiting to be answered.
   *
   * ⚠️ HELD SO THE FILES ARE READ ONCE. A batch drop is looked at, listed, and
   * only then made, and re-reading 48,000 files to answer the second half of
   * one gesture is the shape of mistake this codebase keeps making. One drop
   * at a time: a new one replaces it, which is also what the surface does.
   */
  private pending: { token: string; root: string; scanned: ScannedFile[] } | null = null;
  private settings: Settings;
  private anchorTimer: NodeJS.Timeout | null = null;
  private readonly write: (line: string) => void;
  private readonly baseUrlOverride: string | undefined;
  private readonly pathOverrides: { allocatePath?: string; commitPath?: string };
  private readonly settingsFile: string | undefined;
  private stopped = false;

  private constructor(settings: Settings, options: DaemonOptions) {
    this.settings = settings;
    this.write = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    this.baseUrlOverride = options.baseUrl;
    this.pathOverrides = {
      ...(options.allocatePath !== undefined ? { allocatePath: options.allocatePath } : {}),
      ...(options.commitPath !== undefined ? { commitPath: options.commitPath } : {}),
    };
    this.settingsFile = options.settingsPath;
  }

  static async start(options: DaemonOptions = {}): Promise<Daemon> {
    const settings = await loadSettings(options.settingsPath);
    const d = new Daemon(settings, options);
    if (settings.folder !== "") for (const folder of settings.folders) if (folder.paused !== true) d.startWatching(folder.path);
    d.scheduleAnchors();
    d.emit({ kind: "ready", supportDir: supportDir() });
    return d;
  }

  get baseUrl(): string {
    return this.baseUrlOverride ?? this.settings.baseUrl;
  }

  private get transport(): { baseUrl: string; allocatePath: string; commitPath: string } {
    return {
      baseUrl: this.baseUrl,
      allocatePath: this.pathOverrides.allocatePath ?? this.settings.allocatePath,
      commitPath: this.pathOverrides.commitPath ?? this.settings.commitPath,
    };
  }

  /** Read requests from a stream until it ends. */
  listen(input: NodeJS.ReadableStream = process.stdin): void {
    const rl = createInterface({ input, crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (line.trim() === "") return;
      void this.handleLine(line);
    });
    rl.on("close", () => void this.stop());
  }

  private async handleLine(line: string): Promise<void> {
    let req: Request;
    try {
      req = JSON.parse(line) as Request;
    } catch {
      this.write(JSON.stringify({ ok: false, error: "that was not a request this app understands." }));
      return;
    }
    try {
      const result = await this.handle(req);
      this.write(JSON.stringify({ id: req.id, ok: true, result }));
    } catch (err) {
      /* ⚠️ The message reaches the person. A failure that only appears in a log
       * is a failure nobody acts on. A block by macOS is said as one, with the
       * flag and the path, so the window can offer the settings pane. */
      const why = explain(err);
      this.write(JSON.stringify({ id: req.id, ok: false, error: why.message, ...(why.blocked ? { blocked: true, path: why.path } : {}) }));
    }
  }

  async handle(req: Request): Promise<unknown> {
    switch (req.op) {
      case "status":
        return this.status();
      case "update":
        return this.update(typeof req.current === "string" ? req.current : "");
      case "settings":
        return this.settings;
      case "ledger":
        return this.ledger();
      case "recordings":
        return this.recordings(typeof req.day === "string" ? req.day : "");
      case "search":
        return this.search(typeof req.query === "string" ? req.query : "");
      case "setup":
        return this.setup(typeof req.at === "string" ? req.at : "", typeof req.name === "string" ? req.name : "");
      case "watch":
        return this.watch(requireRoot(req));
      case "unwatch":
        return this.unwatch(requireRoot(req));
      case "pause":
        return this.pause(requireRoot(req), req.paused !== false);
      case "sweep": {
        const w = this.watchers.get(requireRoot(req));
        if (w === undefined) throw new Error("that folder is not being watched.");
        await w.sweep();
        return { swept: true };
      }
      case "make":
        return this.make(requireRoot(req), req.files ?? [], req.again === true);
      case "drop":
        return this.drop(req.paths ?? [], req.again === true);
      case "commitDrop":
        return this.commitDrop(req.token ?? "", req.again === true, typeof req.name === "string" ? req.name.trim() : "");
      case "describe":
        return this.describe(requireRoot(req), req);
      case "export":
        return this.export(requireRoot(req), req, req.file ?? "", req.into ?? "");
      case "check":
        return this.check(requireRoot(req));
      case "verify":
        return this.verify(requireRoot(req), req.files ?? []);
      case "anchors":
        return this.anchors(requireRoot(req));
      case "quit":
        await this.stop();
        return { stopped: true };
      default:
        throw new Error(`unknown request: ${String(req.op)}`);
    }
  }

  /**
   * Choose where the BitGraph folder lives. Asked once, on first run.
   *
   *   <at>/BitGraph/Recordings/2026-09-09/BitGraph (IMG_4021.png)/
   *
   * ⚠️ An existing BitGraph folder at that location is ADOPTED, never
   * replaced: somebody pointing this at a folder they already have is
   * continuing it, and Mike's own holds 2,566 recordings.
   */
  private async setup(at: string, name: string): Promise<{ folder: string; library: string; adopted: boolean }> {
    if (at === "") throw new Error("setup needs somewhere to put your folder.");
    /* ⚠️ NAMED BY THE PERSON, not by us. "BitGraph" is only what the field is
     * filled in with. A name with a slash in it would be a path, so anything
     * that is not a plain name is refused rather than quietly rewritten. */
    const chosen = (name === "" ? FOLDER_NAME : name).trim();
    if (chosen === "" || chosen === "." || chosen === ".." || /[\/\\:\x00-\x1f]/.test(chosen)) {
      throw new Error(`"${name}" is not a folder name. Use a plain name, with no slashes.`);
    }
    /* ⚠️ A PLACE THAT ALREADY IS A BITGRAPH FOLDER IS THE FOLDER. Setup asks
     * for a place and a name; pick your existing BitGraph folder as the
     * place and the name would have nested a new one inside it
     * (Desktop/BitGraph/BitGraph; Mike, 2026-09-10: "when i picked new
     * folder i picked already existing bitgraph folder"). If the place holds
     * Recordings, or is itself named what the name says, it is adopted. */
    const placeIsFolder = basename(at) === chosen
      || await stat(recordingsIn(at)).then((s) => s.isDirectory()).catch(() => false);
    const folder = placeIsFolder ? at : join(at, chosen);
    const library = recordingsIn(folder);
    const adopted = await stat(library).then((s) => s.isDirectory()).catch(() => false);
    await mkdir(library, { recursive: true });
    this.settings.folder = folder;
    this.settings.library = library;
    await this.persist();
    /* Anything that was waiting on a place to put things can go now. */
    this.scheduleAnchors();
    return { folder, library, adopted };
  }

  /** ⚠️ Nothing is recorded before somebody has said where it goes. */
  private requireSetUp(): void {
    if (this.settings.folder === "" || this.settings.library === "") {
      throw new Error("BitGraph Recorder has not been set up yet: choose where your BitGraph folder goes first.");
    }
  }

  /**
   * The ledger's spine: every day that holds recordings, and how many.
   *
   * ⚠️ Read from the folders themselves, so it is right even with no index.
   */
  private async ledger(): Promise<{ days: DayCount[]; total: number }> {
    if (this.settings.library === "") return { days: [], total: 0 };
    return ledger(this.settings.library);
  }

  /** One day, drilled out: its recordings, and where each came from. */
  private async recordings(day: string): Promise<{ day: string; recordings: Recording[] }> {
    if (day === "") throw new Error("recordings needs a day, 2026-09-09");
    if (this.settings.library === "") return { day, recordings: [] };
    return { day, recordings: await listDay(this.settings.library, day, await this.sources()) };
  }

  /** Recordings found by name, across every day. */
  private async search(query: string): Promise<{ query: string; recordings: Recording[]; truncated: boolean }> {
    if (this.settings.library === "") return { query, recordings: [], truncated: false };
    return search(this.settings.library, query, await this.sources());
  }

  /**
   * Which folder each recording came from. Only the index remembers, and it
   * is a convenience: a recording with no row is listed, from nowhere.
   */
  private async sources(): Promise<Map<string, string>> {
    const sources = new Map<string, string>();
    const index = await FolderIndex.open(join(this.settings.library, INDEX_FILE)).catch(() => null);
    for (const row of index?.rows ?? []) {
      if (row.bundle !== undefined && row.from !== undefined && !sources.has(row.bundle)) sources.set(row.bundle, row.from);
    }
    return sources;
  }

  // ── folders ─────────────────────────────────────────────────────────────

  private async watch(root: string): Promise<WatchedFolder> {
    /* ⚠️ NOT THE BITGRAPH FOLDER, AND NOTHING INSIDE IT. Syncing it would
     * record the recordings, one position per sweep, for ever. */
    if (isWithin(root, this.settings.folder)) {
      throw new Error("That is your BitGraph folder. It holds the recordings; syncing it would record them again. Sync the folder your files land in instead.");
    }
    const existing = this.settings.folders.find((f) => f.path === root);
    const folder: WatchedFolder = existing ?? { path: root, addedAt: new Date().toISOString() };
    if (existing === undefined) this.settings.folders.push(folder);
    delete folder.paused;
    await this.persist();
    this.startWatching(root);
    /* A folder that has been watched before may have gained files while the
     * app was closed. Looking once on the way in is the difference between a
     * watcher and a service. */
    void this.watchers.get(root)?.sweep();
    return folder;
  }

  private async unwatch(root: string): Promise<{ watching: boolean }> {
    this.watchers.get(root)?.close();
    this.watchers.delete(root);
    this.settings.folders = this.settings.folders.filter((f) => f.path !== root);
    await this.persist();
    /* ⚠️ Nothing in the folder is touched. Its BitGraphs stay exactly where
     * they are; this app forgetting a folder is not the folder losing
     * anything. */
    return { watching: false };
  }

  private async pause(root: string, paused: boolean): Promise<{ paused: boolean }> {
    const folder = this.settings.folders.find((f) => f.path === root);
    if (folder === undefined) throw new Error("that folder is not on the list.");
    if (paused) {
      folder.paused = true;
      this.watchers.get(root)?.close();
      this.watchers.delete(root);
    } else {
      delete folder.paused;
      this.startWatching(root);
    }
    await this.persist();
    return { paused };
  }

  private startWatching(root: string): void {
    if (this.watchers.has(root)) return;
    const w = watchFolder(root, {
      transport: this.transport,
      library: this.settings.library,
      excluding: [this.settings.folder],
      onEvent: (e) => this.emit(e),
    });
    this.watchers.set(root, w);
  }

  // ── work ────────────────────────────────────────────────────────────────

  /**
   * Remember a folder this app has recorded into, so something goes back for
   * its anchors even though nobody is watching it.
   *
   * ⚠️ The upper bound lands about twelve seconds after the commit while the
   * enclave is busy, so the first look is scheduled rather than immediate;
   * asking straight away only ever gets "pending".
   */
  private async remember(root: string): Promise<void> {
    const kept = this.settings.recorded.filter((p) => p !== root);
    kept.push(root);
    this.settings.recorded = kept.slice(-MAX_RECORDED);
    await this.persist();
    const soon = setTimeout(() => {
      void this.anchors(root).catch(() => { /* the periodic pass will try again */ });
    }, 15_000);
    soon.unref?.();
  }

  private async make(root: string, files: string[], again: boolean): Promise<{ made: MakeResult | null; skipped: SkippedFile[] }> {
    if (files.length === 0) throw new Error("no files were named.");
    this.requireSetUp();
    const r = await makeFiles(root, files, { transport: this.transport, again });
    if (r.made !== null) { this.emit({ kind: "made", root, result: r.made }); await this.remember(root); }
    if (r.skipped.length > 0) this.emit({ kind: "skipped", root, files: r.skipped });
    return r;
  }

  /**
   * The gesture: read what was dropped, then either open what is already there
   * or make what is not.
   *
   * ⚠️ A LONE NEW FILE IS RECORDED WITHOUT BEING ASKED. The drop is the
   * shutter. A lone file that already has a BitGraph opens it instead, and a
   * batch is listed and waits, because two or more files becoming one
   * permanent position is worth a second of somebody's attention.
   */
  private async drop(paths: string[], again: boolean): Promise<DropAnswer> {
    if (paths.length === 0) throw new Error("nothing was dropped.");
    this.requireSetUp();
    this.pending = null;
    /* One folder of BitGraphs: checked, not recorded. Somebody sent it, or
     * it is a recording of your own; either way nothing in it is new. */
    const only = paths.length === 1 ? paths[0]! : "";
    if (only !== "" && only !== this.settings.folder && (await stat(only).then((s) => s.isDirectory()).catch(() => false)) && (await holdsRecordings(only))) {
      const root = only;
      const report = await this.check(root);
      return { action: "checked", root, look: { root, files: [], total: 0, recorded: 0, truncated: false, duplicates: 0 }, report };
    }
    let where = "";
    const say = throttled((done, total) =>
      this.emit({ kind: "making", root: where, files: total, progress: { phase: "hash", done, total } }));
    const { root, scanned } = await scanDrop(paths, say, (found) => { where = found; }, [this.settings.folder]);
    const look = await lookAt(this.settings.library, scanned, root);

    if (look.files.length === 1) {
      const only = look.files[0]!;
      if (only.position !== null && !again) {
        return { action: "open", root, look, opened: only };
      }
      const { made, skipped } = await makeScanned(root, scanned, {
        transport: this.transport,
        again,
        bundle: { library: this.settings.library, source: sourceName(root, scanned) },
        onProgress: throttledPhase((p) => this.emit({ kind: "making", root, files: 1, progress: p })),
      });
      if (made !== null) { this.emit({ kind: "made", root, result: made }); await this.remember(root); }
      return { action: "made", root, look, made, skipped };
    }

    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.pending = { token, root, scanned };
    return { action: "ready", root, look, token };
  }

  /** Make what a held drop found, without opening a single file again. */
  private async commitDrop(token: string, again: boolean, name = ""): Promise<{ made: MakeResult | null; skipped: SkippedFile[] }> {
    this.requireSetUp();
    const pending = this.pending;
    if (pending === null || pending.token !== token) {
      /* ⚠️ Never silently re-read. A token that is gone means something else
       * was dropped since, and quietly recording the older drop would consume
       * positions nobody asked for. */
      throw new Error("that drop is no longer waiting. Drop the files again.");
    }
    this.pending = null;
    const r = await makeScanned(pending.root, pending.scanned, {
      transport: this.transport,
      again,
      /* ⚠️ A DROP IS A RECORDING, and a recording is one folder in the library.
       * Nothing is written where the files came from. A synced folder is the
       * other thing and still writes beside its files. */
      /* Named by the person when they named it; by where it came from when
       * they did not. */
      bundle: { library: this.settings.library, source: name !== "" ? name : sourceName(pending.root, pending.scanned) },
      onProgress: throttledPhase((p) => this.emit({ kind: "making", root: pending.root, files: pending.scanned.length, progress: p })),
    });
    if (r.made !== null) { this.emit({ kind: "made", root: pending.root, result: r.made }); await this.remember(pending.root); }
    if (r.skipped.length > 0) this.emit({ kind: "skipped", root: pending.root, files: r.skipped });
    return r;
  }

  /**
   * Write the new file, and everything beside it, where somebody asked.
   *
   * ⚠️ This is the ONLY place the fused bytes exist as a file. Everywhere else
   * they are virtual and the proof rebuilds them.
   */
  private async export(root: string, req: Request, file: string, into: string): Promise<ExportResult> {
    if (file === "" || into === "") throw new Error("an export needs a file and somewhere to put the package.");
    if (typeof req.origin === "string" && req.origin !== "" && typeof req.epochId === "string" && typeof req.counter === "string") {
      return exportBitGraph(root, { originDigestB64: req.origin, position: { epochId: req.epochId, counter: req.counter } }, file, into);
    }
    if (typeof req.evidence === "string" && req.evidence !== "") {
      return exportBitGraph(root, { evidencePath: req.evidence, ...(typeof req.origin === "string" && req.origin !== "" ? { originDigestB64: req.origin } : {}) }, file, into);
    }
    throw new Error("an export needs either a BitGraph file or a digest and a position.");
  }

  /**
   * Everything the proof view shows, read from the folder. Nothing is fetched.
   *
   * ⚠️ Either by the evidence file, or by the member's own digest and its
   * position: above a few thousand members nothing is written beside each
   * file, so the digest is the only handle there is.
   */
  private async describe(root: string, req: Request): Promise<Described> {
    if (typeof req.origin === "string" && req.origin !== "" && typeof req.epochId === "string" && typeof req.counter === "string") {
      return describe(root, { originDigestB64: req.origin, position: { epochId: req.epochId, counter: req.counter } });
    }
    if (typeof req.evidence === "string" && req.evidence !== "") {
      return describe(root, { evidencePath: req.evidence, ...(typeof req.origin === "string" && req.origin !== "" ? { originDigestB64: req.origin } : {}) });
    }
    throw new Error("that request needs either a BitGraph file or a digest and a position.");
  }

  private async check(root: string): Promise<FolderReport> {
    /* A check of 2,000 files takes seconds; the window fills a bar with it
     * ("i LOVE that progress indicator ... yes add that", Mike, 2026-09-09).
     * At most a dozen a second, like a make. */
    const say = throttled((done, total) => this.emit({ kind: "checking", root, progress: { done, total } }));
    return checkFolder(root, {
      library: this.settings.library,
      alsoKnownEnclaves: this.settings.alsoKnownEnclaves,
      onFile: (_file, done, total) => say(done, total),
    });
  }

  /** Check just these files. What the proof view asks before it says anything. */
  private async verify(root: string, files: string[]): Promise<FolderReport> {
    if (files.length === 0) throw new Error("no files were named.");
    return checkFolder(root, { only: files, everyRow: true, library: this.settings.library, alsoKnownEnclaves: this.settings.alsoKnownEnclaves });
  }

  /**
   * Go and get what the library's recordings are missing.
   *
   * ⚠️ ONE PLACE, NOT ONE PER FOLDER. Every recording lives in the library, so
   * the pass walks the library once rather than once per folder somebody has
   * ever dropped from.
   */
  private async anchors(_root?: string): Promise<AnchorPass> {
    const index = await FolderIndex.open(join(this.settings.library, INDEX_FILE));
    const pass = await completeLibrary(this.settings.library, index.rows, { baseUrl: this.baseUrl });
    this.emit({ kind: "anchors", root: this.settings.library, pass });
    return pass;
  }

  // ── the update channel ──────────────────────────────────────────────────

  /** The app's version, once it has said. Nothing is checked before it does. */
  private appVersion = "";
  private updateTimer: NodeJS.Timeout | null = null;

  /**
   * Whether a newer app exists. Asked by the app on launch with its own
   * version; after that, once a day, and the answer goes out as an event.
   * A feed that cannot be reached or read is a thrown gap, never "current".
   */
  private async update(current: string): Promise<UpdateCheck> {
    if (current === "") throw new Error("update needs the app's version, 0.1.0");
    const feedUrl = this.settings.updateFeed ?? "";
    if (feedUrl === "") throw new Error("the update check is turned off in settings.");
    const first = this.appVersion === "";
    this.appVersion = current;
    if (first) this.scheduleUpdateCheck();
    return checkForUpdate({ current, feedUrl });
  }

  private scheduleUpdateCheck(): void {
    if (this.stopped) return;
    this.updateTimer = setTimeout(() => {
      void (async () => {
        try {
          const check = await this.update(this.appVersion);
          if (check.available) this.emit({ kind: "update", update: check });
        } catch {
          /* A daily check that fails is not news. The next one will say. */
        }
      })().finally(() => this.scheduleUpdateCheck());
    }, 24 * 60 * 60 * 1000);
    this.updateTimer.unref?.();
  }

  // ── the anchor loop ─────────────────────────────────────────────────────

  private scheduleAnchors(): void {
    if (this.stopped) return;
    this.anchorTimer = setTimeout(() => {
      void this.anchorPass().finally(() => this.scheduleAnchors());
    }, Math.max(5, this.settings.anchorIntervalSeconds) * 1000);
    this.anchorTimer.unref?.();
  }

  /** Every folder worth going back to: the watched ones, and the ones recorded into. */
  private get anchorRotation(): string[] {
    const out = new Set<string>();
    for (const f of this.settings.folders) if (f.paused !== true) out.add(f.path);
    for (const p of this.settings.recorded) out.add(p);
    return [...out];
  }

  private async anchorPass(): Promise<void> {
    if (this.settings.library === "") return;
    {
      const path = this.settings.library;
      if (this.stopped) return;
      try {
        await this.anchors();
      } catch (err) {
        /* ⚠️ Not being able to reach the ledger is a gap, not a verdict, and
         * it is never allowed to look like one. It is reported and the pass
         * carries on to the next folder. */
        this.emit({ kind: "trouble", root: path, reason: isBlocked(err) ? explain(err).message : `anchors could not be fetched: ${err instanceof Error ? err.message : String(err)}`, recoverable: true, severity: isBlocked(err) ? "fault" : "gap" });
      }
    }
  }

  // ── the rest ────────────────────────────────────────────────────────────

  /** Whether a synced folder is still there, asked at most once a minute. */
  private readonly presence = new Map<string, { missing: boolean; at: number }>();
  private readonly blocked = new Map<string, { blocked: boolean; at: number }>();

  /** Whether macOS refuses this app the folder. Cached a minute, like presence. */
  private async isBlocked(path: string): Promise<boolean> {
    if (path === "") return false;
    const seen = this.blocked.get(path);
    const now = Date.now();
    /* Only an ALLOWED answer is kept: once blocked, every status asks again,
     * so the moment the person grants the folder (Mike, 2026-09-09: "ok gave
     * it access, now what") the next tick sees it. Re-asking while blocked
     * prompts nothing: macOS prompts once and then answers from its list. */
    if (seen !== undefined && !seen.blocked && now - seen.at < 60_000) return false;
    const blocked = await readdir(path).then(() => false).catch((err: unknown) => isBlocked(err));
    this.blocked.set(path, { blocked, at: now });
    return blocked;
  }

  private async isMissing(path: string): Promise<boolean> {
    const seen = this.presence.get(path);
    const now = Date.now();
    if (seen !== undefined && now - seen.at < 60_000) return seen.missing;
    const missing = !(await stat(path).then((s) => s.isDirectory()).catch(() => false));
    this.presence.set(path, { missing, at: now });
    return missing;
  }

  private async status(): Promise<unknown> {
    const folders = [];
    for (const folder of this.settings.folders) {
      /* ⚠️ Counted from the LIBRARY, because that is where recordings are.
       * A synced folder holds nothing of its own any more. */
      let index: FolderIndex | null = null;
      try {
        index = await FolderIndex.open(join(this.settings.library, INDEX_FILE));
      } catch {
        index = null;
      }
      /* ⚠️ A folder that is not there is not a FAULT. It was deleted, renamed
       * or unplugged, and every recording ever made from it is untouched in
       * the library. It says so plainly instead of showing a red light with
       * no reason under it.
       *
       * ⚠️ AND IT IS ASKED RARELY. macOS gates the whole of ~/Desktop behind
       * one permission, so a stat on any path inside it is a Desktop access;
       * status runs on a timer, and asking on every tick turned one prompt
       * into a prompt every few seconds. Cached, and re-asked at most once a
       * minute. */
      const missing = await this.isMissing(folder.path);
      folders.push({
        path: folder.path,
        missing,
        paused: folder.paused === true,
        watching: this.watchers.has(folder.path),
        busy: this.watchers.get(folder.path)?.busy === true,
        /* ⚠️ WHAT CAME OUT OF THIS FOLDER, not what the library holds. With
         * one library, every folder was reporting the library's totals, so
         * three synced folders read as three copies of the same number. These
         * come from the index, which is a convenience and not the authority: a
         * check is what says whether any of it is still true. */
        recorded: index?.fromFolder(folder.path).files ?? null,
        positions: index?.fromFolder(folder.path).recordings ?? null,
        indexDamagedLines: index?.damagedLines ?? null,
      });
    }
    const library = this.settings.library === "" ? null : await FolderIndex.open(join(this.settings.library, INDEX_FILE)).catch(() => null);
    /* ⚠️ RECORDINGS ARE COUNTED WHERE THEY ARE, not in the index. Mike's
     * library holds 2,570 the old Folder made and the index knows none of
     * them; a count of 0 beside a calendar listing 2,570 is a lie. Files are
     * the index's number, because only it has counted them. */
    const spine = this.settings.library === "" ? { total: 0 } : await ledger(this.settings.library);
    /* ⚠️ A FOLDER THAT MOVED IS SAID, NOT GUESSED AT. Mike, 2026-09-09: "if
     * you should move it, you may have to point the system at it again so
     * that functionality should be baked in." The window asks where it went;
     * `setup` at the new place adopts it whole. */
    const folderMissing = this.settings.folder !== "" && !(await stat(this.settings.folder).then((s) => s.isDirectory()).catch(() => false));
    /* ⚠️ A FOLDER macOS BLOCKS IS SAID, NOT COUNTED AS EMPTY. `ledger` swallows
     * a refused readdir and answers 0, which read as "Nothing recorded yet"
     * over six recordings (Mike, 2026-09-09). Probed at most once a minute,
     * like presence: the probe IS a Desktop access. */
    const folderBlocked = folderMissing ? false : await this.isBlocked(this.settings.library);
    return {
      baseUrl: this.baseUrl,
      supportDir: supportDir(),
      /* Where the recordings are, and how many. The folders below only say
       * what came out of each of them. */
      /* Empty until setup. The window shows the setup step on that. */
      folder: this.settings.folder,
      library: this.settings.library,
      suggested: suggestedFolder(this.settingsFile),
      recordings: spine.total,
      recorded: library?.fileCount ?? 0,
      folderMissing,
      folderBlocked,
      folders,
    };
  }

  private async persist(): Promise<void> {
    await saveSettings(this.settings, this.settingsFile);
    this.emit({ kind: "settings", settings: this.settings });
  }

  emit(event: DaemonEvent["event"]): void {
    this.write(JSON.stringify({ event }));
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.anchorTimer !== null) clearTimeout(this.anchorTimer);
    if (this.updateTimer !== null) clearTimeout(this.updateTimer);
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
  }
}

/**
 * Lets a progress hook speak at most a dozen times a second.
 *
 * ⚠️ ONE EVENT PER FILE IS ONE REDRAW PER FILE. A 30,000 file drop emitted
 * 30,001 lines and 5.1 MB of them, every one crossing the pipe and moving
 * published state on the main thread, so the surface spent its time drawing a
 * counter instead of showing the work. The final call always gets through, so
 * the number somebody is left looking at is the true one.
 */
function throttled(fn: (done: number, total: number) => void, everyMs = 80): (done: number, total: number) => void {
  let last = 0;
  return (done, total) => {
    const now = Date.now();
    if (done >= total || now - last >= everyMs) {
      last = now;
      fn(done, total);
    }
  };
}

/** The same gate over a phase-carrying progress object. A phase CHANGE always
 *  speaks: it is the thing that says what is happening, not how far along. */
function throttledPhase(fn: (p: MakeProgress) => void, everyMs = 80): (p: MakeProgress) => void {
  let last = 0;
  let phase = "";
  return (p) => {
    const now = Date.now();
    if (p.phase !== phase || p.done >= p.total || now - last >= everyMs) {
      last = now;
      phase = p.phase;
      fn(p);
    }
  };
}

/** What to call the recording: the file, or the folder it came out of. */
function sourceName(root: string, scanned: ReadonlyArray<{ rel: string }>): string {
  if (scanned.length === 1) return scanned[0]!.rel.split("/").pop() ?? "file";
  const name = root.split("/").filter(Boolean).pop();
  return name === undefined || name === "" ? "drop" : name;
}

function requireRoot(req: Request): string {
  if (typeof req.root !== "string" || req.root === "") throw new Error("that request needs a folder.");
  return req.root;
}
