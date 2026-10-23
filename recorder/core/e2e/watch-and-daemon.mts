// The watcher, the daemon protocol and the CLI, end to end against the
// unmodified enclave. Run: node --import tsx/esm e2e/watch-and-daemon.mts
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startStack } from "../../../server/commit-service/local-enclave/lib.mts";
import { watchFolder } from "../src/watch.js";
import { Daemon } from "../src/daemon.js";
import { walk } from "../src/check.js";
import { checkFolder } from "../src/check.js";
import { readEvidence } from "../src/evidence.js";
import { verifyFuseMember, bytesToBase64 } from "@mikeargento/bitgraph-verify";
import { readFileSync } from "node:fs";
import { pathsFor } from "../src/paths.js";
import { makeFiles } from "../src/make.js";

let pass = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (!cond) { console.error("FAIL", name, typeof detail === "string" ? detail : JSON.stringify(detail ?? "").slice(0, 400)); process.exitCode = 1; }
  else { pass++; console.log("ok  ", name); }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function jpeg(bytes: number, seed: number): Uint8Array {
  const b = new Uint8Array(bytes);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  for (let i = 4; i < bytes; i++) b[i] = (i * 31 + seed) & 0xff;
  return b;
}

const library = mkdtempSync(join(tmpdir(), "bg-wdlib-"));
const stack = await startStack({ quiet: true, anchor: true, parentEnv: { FUSE_ENABLED: "true" } });
const transport = { baseUrl: stack.parentUrl, allocatePath: "/allocate-slot", commitPath: "/commit", recoveryAttempts: 1, recoveryDelayMs: 1 };
let harness: Array<{ pcr0: string; label: string }> = [];
const opts = () => ({ alsoKnownEnclaves: harness, library });

try {
  // ── the watcher records what lands in a folder ───────────────────────────
  {
    const root = mkdtempSync(join(tmpdir(), "bitgraph-watch-"));
    const events: string[] = [];
    const w = watchFolder(root, { transport, library, quietMs: 250, stableMs: 150, onEvent: (e) => events.push(e.kind) });

    // an "export" of four photos, arriving over a moment as a real one does
    for (let i = 0; i < 4; i++) {
      writeFileSync(join(root, `EXPORT_${i}.JPG`), jpeg(1024 + i, i));
      await sleep(40);
    }
    await waitFor(() => events.includes("made"), 30_000);
    await sleep(300);

    ok("watch: it made something without being asked", events.includes("made"));

    /* ⚠️ A SYNCED FOLDER IS AN AUTOMATIC DROP. What lands in it becomes a
     * recording in the LIBRARY, and the folder itself is left exactly as it
     * was: no BitGraphs/, no evidence, nothing. */
    ok("watch: nothing was written into the folder it watched",
      !existsSync(join(root, "BitGraphs")), JSON.stringify(readdirSync(root)));

    const day = readdirSync(library).filter((d) => /^\d{4}-/.test(d))[0]!;
    const bundles = readdirSync(join(library, day));
    ok("watch: one recording folder appeared in the library", bundles.length === 1, JSON.stringify(bundles));
    const bundle = join(library, day, bundles[0]!);
    ok("watch: it holds all four files and the proof",
      [0, 1, 2, 3].every((i) => existsSync(join(bundle, `EXPORT_${i}.JPG`))) && existsSync(join(bundle, "proof.json")),
      JSON.stringify(readdirSync(bundle)));
    ok("watch: hard linked, so syncing cost no bytes",
      statSync(join(bundle, "EXPORT_0.JPG")).ino === statSync(join(root, "EXPORT_0.JPG")).ino);

    const proof0 = JSON.parse(readFileSync(join(bundle, "proof.json"), "utf8")) as { environment?: { measurement?: string } };
    harness = [{ pcr0: proof0.environment!.measurement!, label: "local harness enclave (fake PCR0)" }];

    /* The reader: checking the folder they came from finds them in the
     * library, which is what "check this folder" means now. */
    const report = await checkFolder(root, opts());
    ok("watch: everything it made verifies, read out of the library", report.counts.verified === 4, JSON.stringify(report.speaking).slice(0, 300));

    // a second wave is a second recording
    const before = readdirSync(join(library, day)).length;
    writeFileSync(join(root, "LATER.JPG"), jpeg(999, 42));
    await waitFor(() => readdirSync(join(library, day)).length > before, 30_000);
    ok("watch: a later arrival is its own recording", readdirSync(join(library, day)).length === before + 1);
    const after = await checkFolder(root, opts());
    ok("watch: and it verifies too", after.counts.verified === 5, JSON.stringify(after.speaking).slice(0, 300));

    // a sweep over a settled folder re-hashes nothing and mints nothing
    const bundlesBefore = readdirSync(join(library, day)).length;
    await w.sweep();
    await sleep(300);
    ok("watch: a sweep over a settled folder mints nothing", readdirSync(join(library, day)).length === bundlesBefore);
    w.close();
  }

  // ── a half-written file is left alone until it stops moving ──────────────
  {
    const root = mkdtempSync(join(tmpdir(), "bitgraph-partial-"));
    const w = watchFolder(root, { transport, library, quietMs: 200, stableMs: 400 });
    const path = join(root, "BIG.JPG");
    // write it in pieces, the way an export does
    const { openSync, writeSync, closeSync } = await import("node:fs");
    const fd = openSync(path, "w");
    for (let i = 0; i < 6; i++) {
      writeSync(fd, Buffer.from(i === 0 ? jpeg(4096, 5) : jpeg(4096, 5 + i)));
      await sleep(120);
    }
    closeSync(fd);
    await waitFor(async () => (await checkFolder(root, opts())).counts.verified === 1, 30_000);
    const report = await checkFolder(root, opts());
    ok("partial: the finished file is what got recorded", report.counts.verified === 1 && report.counts.unrecorded === 0, JSON.stringify(report.counts));
    w.close();
  }

  // ── a copy of a recorded file mints nothing ─────────────────────────────
  {
    const root = mkdtempSync(join(tmpdir(), "bitgraph-copy-"));
    const a = join(root, "one.JPG");
    writeFileSync(a, jpeg(600, 77));
    const mk = (files: string[]) => makeFiles(root, files, { transport, bundle: { library, source: "copy" } });
    const first = await mk([a]);
    writeFileSync(join(root, "copy.JPG"), readFileSync(a));
    const second = await mk([join(root, "copy.JPG")]);
    ok("copy: nothing was minted for identical bytes", second.made === null && second.skipped.length === 1);
    ok("copy: and it says which recording already holds them",
      second.skipped[0]!.positions[0]?.counter === first.made!.position.counter);
    /* ⚠️ Both paths hold the same bytes, so both are answered by the one
     * recording. A copy is not a second BitGraph. */
    const report = await checkFolder(root, opts());
    ok("copy: both verify against the one recording", report.counts.verified === 2, JSON.stringify(report.counts));
  }

  // ── the streamed member check agrees with the published verifier ─────────
  {
    const root = mkdtempSync(join(tmpdir(), "bitgraph-parity-"));
    const files = [0, 1, 2].map((i) => {
      const p = join(root, `P_${i}.JPG`);
      writeFileSync(p, jpeg(2000 + i * 13, 100 + i));
      return p;
    });
    const { made } = await makeFiles(root, files, { transport, bundle: { library, source: "parity" } });
    const dir = made!.bundlePath!;
    const manifest = new Uint8Array(readFileSync(join(dir, "manifest.json")));
    const proof = JSON.parse(readFileSync(join(dir, "proof.json"), "utf8"));

    let agreed = 0;
    for (const f of files) {
      const r = await verifyFuseMember({ proof, bytes: new Uint8Array(readFileSync(f)), manifest });
      if (r.category === "SET_MEMBER_FROM_ORIGIN" || r.category === "SET_MEMBER_DIRECT") agreed++;
      else console.error("  verifier said", r.category, r.reason);
    }
    ok("parity: the published verifier accepts every member the streamed path accepted", agreed === 3, String(agreed));

    const streamed = await checkFolder(root, opts());
    ok("parity: and the streamed check accepted all three", streamed.counts.verified === 3, JSON.stringify(streamed.speaking).slice(0, 300));

    const stranger = join(root, "STRANGER.JPG");
    writeFileSync(stranger, jpeg(1234, 250));
    const r = await verifyFuseMember({ proof, bytes: new Uint8Array(readFileSync(stranger)), manifest });
    ok("parity: the verifier refuses a non-member", r.category === "SET_NOT_MEMBER" || r.category === "NO_MATCH", r.category);
    const after = await checkFolder(root, opts());
    ok("parity: and the folder calls it unrecorded, not failed", after.counts.unrecorded === 1 && after.counts.failed === 0, JSON.stringify(after.counts));
  }

  // ── the daemon protocol ─────────────────────────────────────────────────
  {
    const home = mkdtempSync(join(tmpdir(), "bitgraph-home-"));
    const root = mkdtempSync(join(tmpdir(), "bitgraph-daemon-"));
    const lines: string[] = [];
    const daemon = await Daemon.start({ baseUrl: stack.parentUrl, allocatePath: "/allocate-slot", commitPath: "/commit", settingsPath: join(home, "settings.json"), write: (l) => lines.push(l) });
await daemon.handle({ op: "setup", at: library, name: "BitGraph" });
    ok("daemon: it says it is ready and where its state lives", lines.some((l) => l.includes('"ready"')));

    writeFileSync(join(root, "D_1.JPG"), jpeg(700, 3));
    const watched = await daemon.handle({ id: 1, op: "watch", root });
    ok("daemon: it takes a folder", (watched as { path: string }).path === root);

    await waitFor(() => lines.some((l) => l.includes('"made"')) || lines.some((l) => l.includes('"trouble"')), 30_000)
;
    if (lines.some((l) => l.includes('"trouble"'))) console.error("  trouble:", lines.find((l) => l.includes('"trouble"'))?.slice(0, 300));
    ok("daemon: it reports what it made as an event", lines.some((l) => l.includes('"made"')));

    const status = (await daemon.handle({ id: 2, op: "status" })) as { folders: Array<{ recorded: number | null; watching: boolean }> };
    ok("daemon: status names the folder it is watching", status.folders.length === 1 && status.folders[0]!.watching);
    ok("daemon: and what came out of THAT folder, not what the library holds",
      status.folders[0]!.recorded === 1, JSON.stringify(status.folders[0]));

    const checked = (await daemon.handle({ id: 3, op: "check", root })) as { counts: { verified: number } };
    ok("daemon: it checks on request", checked.counts.verified === 0 || checked.counts.verified === 1);
    ok("daemon: and says how far the check is as it goes",
      lines.some((l) => l.includes('"checking"') && /"total":1/.test(l)), lines.filter((l) => l.includes('"checking"')).slice(0, 2).join(" "));

    /* The ledger: a spine of days with counts, and a day drilled out. */
    const spine = (await daemon.handle({ id: 30, op: "ledger" })) as { days: Array<{ day: string; count: number }>; total: number };
    /* ⚠️ LOCAL, like the core (bundle.ts names the day folder from the local
     * clock, because the calendar is the person's). UTC here failed every run
     * between 20:00 and midnight Eastern: today was already tomorrow. */
    const now = new Date();
    const two = (n: number) => String(n).padStart(2, "0");
    const today = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
    ok("daemon: the ledger's spine has today, with a count and nothing opened",
      spine.total >= 1 && spine.days.some((d) => d.day === today && d.count >= 1), JSON.stringify(spine).slice(0, 300));
    type Drilled = { day: string; recordings: Array<{ name: string; files: number; from?: string }> };
    const oneDay = (await daemon.handle({ id: 31, op: "recordings", day: today })) as Drilled;
    const noDay = (await daemon.handle({ id: 32, op: "recordings", day: "1999-01-01" })) as Drilled;
    ok("daemon: a day drills out to its recordings, each remembering where it came from",
      oneDay.recordings.some((r) => r.name === "BitGraph (D_1.JPG)" && r.files === 1 && r.from === root) && noDay.recordings.length === 0,
      JSON.stringify(oneDay).slice(0, 300));
    let dayless = false;
    try { await daemon.handle({ id: 33, op: "recordings" }); } catch { dayless = true; }
    ok("daemon: recordings without a day is refused, not answered with everything", dayless);

    /* ⚠️ The BitGraph folder is never synced, dropped, or walked into. */
    const st = (await daemon.handle({ id: 34, op: "status" })) as { folder: string; library: string };
    let syncRefused = false;
    try { await daemon.handle({ id: 35, op: "watch", root: st.library }); } catch (e) { syncRefused = /your BitGraph folder/.test(String(e)); }
    let dropRefused = false;
    try { await daemon.handle({ id: 36, op: "drop", paths: [st.folder] }); } catch (e) { dropRefused = /inside your BitGraph folder/.test(String(e)); }
    ok("daemon: syncing or dropping the BitGraph folder is refused, and says why", syncRefused && dropRefused);
    /* Its parent CAN be synced; the sweep walks around the BitGraph folder.
     * The parent here is the test's whole scratch home, so whatever else sits
     * in it may be recorded too: the claim is only that NOTHING inside the
     * BitGraph folder is, and that the file beside it is. */
    const parent = dirname(st.folder);
    const inside = (p: string) => p === st.folder || p.startsWith(st.folder + "/");
    const walked = await walk(parent, { excluding: [st.folder] });
    ok("walk: told to exclude the BitGraph folder, it never enters it",
      walked.length > 0 && walked.every((p) => !inside(p)), walked.filter(inside).slice(0, 5).join(", "));
    writeFileSync(join(parent, "beside-it.txt"), "a file that sits next to the BitGraph folder\n");
    const madeBefore = lines.filter((l) => l.includes('"made"')).length;
    await daemon.handle({ id: 37, op: "watch", root: parent });
    await waitFor(() => lines.filter((l) => l.includes('"made"')).length > madeBefore, 30_000);
    await daemon.handle({ id: 38, op: "unwatch", root: parent });
    const madePaths = lines.filter((l) => l.includes('"made"')).slice(madeBefore)
      .flatMap((l) => {
        /* The daemon writes {"event": {...}}. */
        try {
          const parsed = JSON.parse(l) as { event?: { result?: { files?: Array<{ path: string }> } } };
          return (parsed.event?.result?.files ?? []).map((f) => f.path);
        } catch { return []; }
      });
    ok("daemon: syncing the folder ABOVE it records what sits beside it and nothing from inside it",
      madePaths.some((p) => p.endsWith("/beside-it.txt")) && madePaths.every((p) => !inside(p)),
      JSON.stringify({ inside: madePaths.filter(inside).slice(0, 5), made: madePaths.length }));

    /* The BitGraph folder moved: status says so, and pointing at it again adopts it whole. */
    const before = (await daemon.handle({ id: 40, op: "status" })) as { folder: string; folderMissing: boolean; recordings: number };
    const movedTo = join(dirname(before.folder), "BitGraph moved");
    renameSync(before.folder, movedTo);
    const gone = (await daemon.handle({ id: 41, op: "status" })) as { folderMissing: boolean };
    const again = (await daemon.handle({ id: 42, op: "setup", at: dirname(movedTo), name: "BitGraph moved" })) as { adopted: boolean; folder: string };
    const found = (await daemon.handle({ id: 43, op: "status" })) as { folder: string; folderMissing: boolean; recordings: number };
    ok("daemon: a moved BitGraph folder is reported missing, and pointing at it again adopts it whole",
      !before.folderMissing && gone.folderMissing && again.adopted && !found.folderMissing && found.folder === movedTo && found.recordings === before.recordings && before.recordings >= 1,
      JSON.stringify({ before, gone, again, found }));
    /* Setup handed the BitGraph folder ITSELF as the place adopts it, never nests a new one inside it (Mike, 2026-09-10). */
    const nested = (await daemon.handle({ id: 44, op: "setup", at: movedTo, name: "BitGraph" })) as { adopted: boolean; folder: string };
    const still = (await daemon.handle({ id: 45, op: "status" })) as { folder: string; recordings: number };
    ok("daemon: choosing an existing BitGraph folder as the place adopts it rather than nesting",
      nested.adopted && nested.folder === movedTo && still.folder === movedTo && still.recordings === before.recordings && !existsSync(join(movedTo, "BitGraph")),
      JSON.stringify({ nested, still }));

    await daemon.handle({ id: 4, op: "unwatch", root });
    const after = (await daemon.handle({ id: 5, op: "status" })) as { folders: unknown[] };
    /* ⚠️ Forgetting a folder is the app losing interest in it. The folder is
     * untouched, and so is every recording ever made from it. */
    ok("daemon: forgetting a folder leaves the folder alone",
      after.folders.length === 0 && existsSync(join(root, "D_1.JPG")) && !existsSync(join(root, "BitGraphs")));

    let refused = false;
    try { await daemon.handle({ id: 6, op: "nonsense" }); } catch { refused = true; }
    ok("daemon: an unknown request is refused, not guessed at", refused);
    await daemon.stop();
  }

  // ── the CLI ─────────────────────────────────────────────────────────────
  {
    const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
    const okc_setup = (r: { status: number | null; stderr: string }) =>
      ok("cli: it refuses to record before setup, and says how", r.status === 64 && /setup <where>/.test(r.stderr), r.stderr);
    const root = mkdtempSync(join(tmpdir(), "bitgraph-cli-"));
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "C_1.JPG"), jpeg(400, 61));
    writeFileSync(join(root, "sub", "C_2.JPG"), jpeg(400, 62));

    const home = mkdtempSync(join(tmpdir(), "bitgraph-clihome-"));
    const env = { ...process.env, BITGRAPH_RECORDER_HOME: home };
    /* ⚠️ Nothing records before somebody has said where it goes. */
    const notYet = spawnSync(process.execPath, [cli, "make", root], { encoding: "utf8", env });
    okc_setup(notYet);

    const setUp = spawnSync(process.execPath, [cli, "setup", home, "BitGraph"], { encoding: "utf8", env });
    ok("cli: setup makes the folder and says so", setUp.status === 0 && /Recordings go in/.test(setUp.stdout), setUp.stdout + setUp.stderr);

        const cliNet = ["--base-url", stack.parentUrl, "--allocate-path", "/allocate-slot", "--commit-path", "/commit"];
    const made = spawnSync(process.execPath, [cli, "make", root, ...cliNet], { encoding: "utf8", env });
    ok("cli: make exits 0", made.status === 0, made.stderr + made.stdout);
    ok("cli: it says where the recording went", /BitGraph \(/.test(made.stdout) && /hard links/.test(made.stdout), made.stdout);
    ok("cli: a folder argument means everything inside it", /2 files, one set/.test(made.stdout), made.stdout);

    const checked = spawnSync(process.execPath, [cli, "check", root], { encoding: "utf8", env });
    /* Exit 2 is right here: the harness enclave is not one this build knows,
     * and "could not be placed" is not "failed". */
    ok("cli: check exits 2 for an enclave it does not know", checked.status === 2, `${checked.status} ${checked.stdout}`);
    ok("cli: and says so in the summary line", /could not be checked/.test(checked.stdout), checked.stdout);

    const usage = spawnSync(process.execPath, [cli, "wat"], { encoding: "utf8", env });
    ok("cli: an unknown command exits 64 with usage", usage.status === 64 && /bitgraph-recorder make/.test(usage.stderr));

    const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8", env });
    ok("cli: --help names every command it has", ["make", "check", "watch", "anchors", "folders", "status", "daemon"].every((c) => help.stdout.includes(`bitgraph-recorder ${c}`)));
  }
} finally {
  stack.stop();
}

/* The harness enclave signs under a deliberately fake PCR0, which the build
 * rightly does not know. Reading it out of a proof the harness just made is
 * what a licensee naming their own enclave would do by hand. */
async function harnessFrom(root: string, e: { proof: { kind: string } }): Promise<Array<{ pcr0: string; label: string }>> {
  const ev = e as unknown as { proof: { kind: string; proof?: { environment?: { measurement?: string } }; proofFile?: string }; position: { epochId: string; counter: string } };
  let measurement: string | undefined;
  if (ev.proof.kind === "inline") measurement = ev.proof.proof?.environment?.measurement;
  else {
    const dir = pathsFor(root).position(ev.position.epochId, ev.position.counter);
    const proof = JSON.parse(readFileSync(join(dir, "proof.json"), "utf8")) as { environment?: { measurement?: string } };
    measurement = proof.environment?.measurement;
  }
  if (measurement === undefined) throw new Error("could not read the harness measurement out of a proof");
  return [{ pcr0: measurement, label: "local harness enclave (fake PCR0)" }];
}

async function waitFor(cond: () => boolean | Promise<boolean>, ms: number): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await cond()) return;
    await sleep(120);
  }
  throw new Error("timed out waiting");
}

console.log(`\n${pass} checks passed${process.exitCode ? ", WITH FAILURES" : ""}`);
void bytesToBase64;
