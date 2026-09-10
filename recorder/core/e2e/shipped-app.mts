// The BUILT APP, end to end.
//
// ⚠️ INSPECTING THE SOURCE TREE IS NOT INSPECTING THE BUILD. This launches the
// assembled BitGraph Recorder.app, with its own bundled runtime and its own
// copy of the core, points it at a folder through the settings file a real
// install would have, drops files in, and looks at what appeared on disk.
//
// Run: node --import tsx/esm e2e/shipped-app.mts   (build.sh must have run)
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startStack } from "../../../server/commit-service/local-enclave/lib.mts";
import { checkFolder } from "../src/check.js";

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

const app = fileURLToPath(new URL("../../mac/build/BitGraph Recorder.app", import.meta.url));
const binary = join(app, "Contents", "MacOS", "BitGraphRecorder");
if (!existsSync(binary)) {
  console.error(`no built app at ${app}. Run folder/mac/build.sh first.`);
  process.exit(1);
}

const stack = await startStack({ quiet: true, anchor: true, parentEnv: { FUSE_ENABLED: "true" } });
const home = mkdtempSync(join(tmpdir(), "bitgraph-apphome-"));
const watched = mkdtempSync(join(tmpdir(), "bitgraph-appwatch-"));

/* The settings a real install writes when somebody adds a folder, except
 * pointed at the harness instead of the site so nothing is minted anywhere
 * real. */
mkdirSync(home, { recursive: true });
writeFileSync(join(home, "settings.json"), JSON.stringify({
  version: "bitgraph-folder-settings/1",
  /* ⚠️ Set up: the app records nothing until somebody has said where. */
  folder: join(home, "BitGraph"),
  library: join(home, "BitGraph", "Recordings"),
  folders: [{ path: watched, addedAt: new Date().toISOString() }],
  baseUrl: stack.parentUrl,
  allocatePath: "/allocate-slot",
  commitPath: "/commit",
  anchorIntervalSeconds: 5,
  alsoKnownEnclaves: [],
}, null, 2));

const child = spawn(binary, [], { env: { ...process.env, BITGRAPH_RECORDER_HOME: home }, stdio: "ignore" });
try {
  await sleep(3000);
  ok("the app is running", child.exitCode === null && child.signalCode === null);

  // An export lands in the folder it was pointed at.
  mkdirSync(join(watched, "raw"), { recursive: true });
  for (let i = 0; i < 3; i++) writeFileSync(join(watched, `SHIP_${i}.JPG`), jpeg(1500 + i, 90 + i));
  writeFileSync(join(watched, "raw", "SHIP_RAW.JPG"), jpeg(2200, 99));

  /* ⚠️ A synced folder is an automatic drop: what lands in it becomes a
   * recording in the LIBRARY, and the folder itself is left alone. */
  const library = join(home, "BitGraph", "Recordings");
  const recordings = () => readdirSync(library).filter((d) => /^\d{4}-/.test(d)).flatMap((d) => readdirSync(join(library, d)).map((b) => join(library, d, b)));
  await waitFor(() => existsSync(library) && recordings().length > 0, 60_000);
  await sleep(1500);

  const dir = recordings()[0]!;
  ok("it recorded what landed in the folder, without being asked", existsSync(join(dir, "proof.json")));
  ok("all four went into one recording",
    [0, 1, 2].every((i) => existsSync(join(dir, `SHIP_${i}.JPG`))) && existsSync(join(dir, "raw", "SHIP_RAW.JPG")),
    JSON.stringify(readdirSync(dir)));
  ok("the tree came with them", existsSync(join(dir, "raw")));
  ok("⚠️ nothing was written where they came from", !existsSync(join(watched, "BitGraphs")), JSON.stringify(readdirSync(watched)));
  ok("the originals are untouched", readFileSync(join(watched, "SHIP_0.JPG")).length === 1500);
  ok("no fused bytes anywhere", !existsSync(join(dir, "SHIP_0.fused.JPG")));
  ok("they went in as hard links, so syncing cost no disk",
    statSync(join(dir, "SHIP_0.JPG")).ino === statSync(join(watched, "SHIP_0.JPG")).ino);

  const proof = JSON.parse(readFileSync(join(dir, "proof.json"), "utf8")) as { version: string; environment?: { measurement?: string } };
  ok("and proof.json IS bitgraph/1", proof.version === "bitgraph/1", proof.version);
  const harness = [{ pcr0: proof.environment!.measurement!, label: "local harness enclave (fake PCR0)" }];

  /* ⚠️ The recording checks itself, which is what somebody you hand it to has. */
  const report = await checkFolder(dir, { alsoKnownEnclaves: harness });
  ok("everything the shipped app made verifies, from the recording alone",
    report.counts.verified === 4 && report.counts.failed === 0, JSON.stringify(report.counts));

  ok("the app kept its own state out of the folder it watched",
    !existsSync(join(watched, "settings.json")) && existsSync(join(home, "settings.json")));

  // ⚠️ A watcher that stops when nobody is looking is not a watcher: nothing
  // in this run ever opened the menu.
  const before = recordings().length;
  writeFileSync(join(watched, "AFTER.JPG"), jpeg(800, 123));
  await waitFor(() => recordings().length > before, 60_000);
  ok("it kept watching with its menu never once opened", recordings().length === before + 1);

  // ── the window's own gesture, through the BUNDLED core ───────────────────
  //
  // ⚠️ The core inside the app, not the one in the tree. The window speaks to
  // it over a pipe, and everything the box does is one of these lines.
  {
    const dropDir = mkdtempSync(join(tmpdir(), "bitgraph-appdrop-"));
    writeFileSync(join(dropDir, "DROP_1.JPG"), jpeg(1100, 201));
    const node = join(app, "Contents", "Resources", "node");
    const core = join(app, "Contents", "Resources", "core", "dist", "cli.js");
    const daemon = spawn(node, [core, "daemon", "--base-url", stack.parentUrl, "--allocate-path", "/allocate-slot", "--commit-path", "/commit"], {
      env: { ...process.env, BITGRAPH_RECORDER_HOME: mkdtempSync(join(tmpdir(), "bitgraph-drophome-")) },
      stdio: ["pipe", "pipe", "ignore"],
    });
    const replies = new Map<number, (v: any) => void>();
    let buffer = "";
    daemon.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let at: number;
      while ((at = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (line.trim() === "") continue;
        try {
          const msg = JSON.parse(line) as { id?: number };
          if (msg.id !== undefined) replies.get(msg.id)?.(msg);
        } catch { /* an event, or a partial line */ }
      }
    });
    let nextId = 1;
    const ask = (op: string, fields: Record<string, unknown> = {}): Promise<any> =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        replies.set(id, (msg) => (msg.ok ? resolve(msg.result) : reject(new Error(String(msg.error)))));
        daemon.stdin.write(`${JSON.stringify({ id, op, ...fields })}\n`);
        setTimeout(() => reject(new Error(`no answer to ${op}`)), 60_000);
      });

    try {
      /* ⚠️ A fresh install records nothing until somebody says where. */
      const dropHome = mkdtempSync(join(tmpdir(), "bg-drophome-"));
      const setUp = await ask("setup", { at: dropHome, name: "BitGraph" });
      ok("the shipped core sets up where it is told", String(setUp.folder).endsWith("/BitGraph"), JSON.stringify(setUp));

      const first = await ask("drop", { paths: [join(dropDir, "DROP_1.JPG")] });
      ok("the shipped core records a lone dropped file on landing", first.action === "made", first.action);
      const again = await ask("drop", { paths: [join(dropDir, "DROP_1.JPG")] });
      ok("and opens it the second time instead of minting again", again.action === "open", again.action);

      writeFileSync(join(dropDir, "DROP_2.JPG"), jpeg(1200, 202));
      writeFileSync(join(dropDir, "DROP_3.JPG"), jpeg(1300, 203));
      const listed = await ask("drop", { paths: [join(dropDir, "DROP_2.JPG"), join(dropDir, "DROP_3.JPG")] });
      ok("a batch is listed and waits", listed.action === "ready" && listed.look.files.length === 2, listed.action);
      const made = await ask("commitDrop", { token: listed.token });
      ok("and commits as one BitGraph", made.made?.files?.length === 2 && made.made.kind === "set");

      /* ⚠️ A recording holds every member's row, so naming WHICH member is the
       * caller's job. The app always has the digest. */
      const described = await ask("describe", {
        root: listed.root,
        evidence: made.made.files[0].evidencePath,
        origin: made.made.files[0].originDigestB64,
      });
      ok("the page's data comes back off the disk", typeof described.proof?.artifact?.digestB64 === "string");
      ok("with the member's place in the set", described.evidence?.member?.count === 2, JSON.stringify(described.evidence?.member));
    } finally {
      daemon.kill();
    }
  }
} finally {
  child.kill();
  stack.stop();
}

async function waitFor(cond: () => boolean, ms: number): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (cond()) return;
    await sleep(200);
  }
  throw new Error("timed out waiting");
}

console.log(`\n${pass} checks passed${process.exitCode ? ", WITH FAILURES" : ""}`);
