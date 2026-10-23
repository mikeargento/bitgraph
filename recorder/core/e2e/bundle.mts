import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, statSync, existsSync, readFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkFolder } from "../src/check.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStack } from "../../../server/commit-service/local-enclave/lib.mts";
import { Daemon } from "../src/daemon.js";

let pass = 0;
const ok = (n: string, c: boolean, d?: unknown) => { if (!c) { console.error("FAIL", n, JSON.stringify(d ?? "").slice(0,300)); process.exitCode = 1; } else { pass++; console.log("ok  ", n); } };
function jpeg(b: number, s: number) { const a = new Uint8Array(b); a.set([0xff,0xd8,0xff,0xe0]); for (let i=4;i<b;i++) a[i]=(i*31+s)&0xff; return a; }

const stack = await startStack({ quiet: true, anchor: true, parentEnv: { FUSE_ENABLED: "true" } });
const home = mkdtempSync(join(tmpdir(), "bg-h-"));
const library = mkdtempSync(join(tmpdir(), "bg-lib-"));
writeFileSync(join(home, "settings.json"), JSON.stringify({
  version: "bitgraph-folder-settings/1", folders: [], recorded: [], folder: library, library: join(library, "Recordings"),
  baseUrl: stack.parentUrl, allocatePath: "/allocate-slot", commitPath: "/commit",
  anchorIntervalSeconds: 3600, alsoKnownEnclaves: [],
}));
const daemon = await Daemon.start({ settingsPath: join(home, "settings.json"), write: () => {} });

try {
  // ── one file ────────────────────────────────────────────────────────────
  const shoot = mkdtempSync(join(tmpdir(), "bg-shoot-"));
  const one = join(shoot, "IMG_4021.png");
  writeFileSync(one, jpeg(2000, 5));
  const before = readdirSync(shoot);

  const r = await daemon.handle({ id: 1, op: "drop", paths: [one] }) as any;
  ok("a lone file records on landing", r.action === "made", r.action);
  ok("⚠️ nothing was written where it came from", JSON.stringify(readdirSync(shoot)) === JSON.stringify(before), JSON.stringify(readdirSync(shoot)));

  const recordings = join(library, "Recordings");
  const day = readdirSync(recordings).filter((d) => /^\d{4}-/.test(d))[0]!;
  const bundles = readdirSync(join(recordings, day));
  ok("a recording folder appeared in the library", bundles.length === 1, JSON.stringify(bundles));
  ok("named the way Folder named them", bundles[0] === "BitGraph (IMG_4021.png)", bundles[0]);

  const dir = join(recordings, day, bundles[0]!);
  const inside = readdirSync(dir).sort();
  ok("it holds the file and the proof", inside.includes("IMG_4021.png") && inside.includes("proof.json"), JSON.stringify(inside));
  const proof = JSON.parse(readFileSync(join(dir, "proof.json"), "utf8"));
  ok("and proof.json IS bitgraph/1", proof.version === "bitgraph/1", proof.version);

  // ⚠️ a hard link: same bytes, two names, no second copy
  const a = statSync(one), b = statSync(join(dir, "IMG_4021.png"));
  ok("the file went in as a hard link, costing no bytes", a.ino === b.ino && b.nlink >= 2, `ino ${a.ino}/${b.ino} nlink ${b.nlink}`);
  ok("and the original is exactly where it was", existsSync(one) && statSync(one).size === 2000);

  // ── a batch ─────────────────────────────────────────────────────────────
  const roll = mkdtempSync(join(tmpdir(), "bg-Photos 2026-"));
  mkdirSync(join(roll, "raw"));
  for (let i = 0; i < 5; i++) writeFileSync(join(roll, `P_${i}.png`), jpeg(900 + i, 40 + i));
  writeFileSync(join(roll, "raw", "P_RAW.png"), jpeg(1200, 99));
  const listed = await daemon.handle({ id: 2, op: "drop", paths: [roll] }) as any;
  ok("a batch waits", listed.action === "ready" && listed.look.total === 6, listed.action);
  const madeSet = await daemon.handle({ id: 3, op: "commitDrop", token: listed.token }) as any;
  ok("and becomes ONE recording", madeSet.made.kind === "set" && madeSet.made.files.length === 6);

  const setDir = madeSet.made.bundlePath as string;
  const setInside = readdirSync(setDir).sort();
  ok("the recording holds the whole drop, tree and all",
    setInside.includes("proof.json") && setInside.includes("manifest.json") && setInside.includes("members.jsonl") && setInside.includes("raw"),
    JSON.stringify(setInside));
  ok("with every file in it", readdirSync(setDir).filter((n) => n.endsWith(".png")).length === 5 && existsSync(join(setDir, "raw", "P_RAW.png")));
  ok("hard linked, so the drop cost no bytes", statSync(join(setDir, "P_0.png")).ino === statSync(join(roll, "P_0.png")).ino);
  ok("named for the folder it came from", setDir.includes("files)") && /BitGraph \(bg-Photos 2026-/.test(setDir), setDir);

  // ── anchors are read from the recording, and its own files are not "unrecorded" ─
  /* ⚠️ THE READ PATH, which no suite covered: the anchor pass writes into the
   * recording's ethereum-anchors/, and the check used to look in the old
   * positions/ place, so a page said "anchors on the way" for ever over
   * anchors sitting right there (Mike, 2026-09-09). A real mainnet anchor and
   * its header, from the unit fixtures, stand in for what the pass writes. */
  const fixtures = fileURLToPath(new URL("../src/__tests__/fixtures/", import.meta.url));
  mkdirSync(join(setDir, "ethereum-anchors"), { recursive: true });
  for (const side of ["before", "after"]) {
    copyFileSync(join(fixtures, "anchor.json"), join(setDir, "ethereum-anchors", `anchor-${side}.json`));
    copyFileSync(join(fixtures, "witness.json"), join(setDir, "ethereum-anchors", `anchor-${side}-witness.json`));
  }
  const setProof = JSON.parse(readFileSync(join(setDir, "proof.json"), "utf8")) as { environment: { measurement: string } };
  const harness = [{ pcr0: setProof.environment.measurement, label: "local harness enclave (fake PCR0)" }];
  const checkedRecording = await checkFolder(setDir, { everyRow: true, alsoKnownEnclaves: harness });
  const first = checkedRecording.files?.find((f: any) => f.rel === "P_0.png") ?? checkedRecording.speaking.find((f: any) => f.rel === "P_0.png");
  const sides = (first?.bounds ?? []) as Array<{ side: string; state: string; blockNumber?: number; blockTime?: string }>;
  ok("a recording's anchors are read from the recording itself, both sides, header checked",
    sides.length === 2 && sides.every((b) => b.state === "anchored" && b.blockNumber === 25735831 && typeof b.blockTime === "string"),
    JSON.stringify(sides));
  ok("and a recording's own files are never counted as unrecorded",
    checkedRecording.counts.verified === 6 && checkedRecording.counts.unrecorded === 0, JSON.stringify(checkedRecording.counts));

  // ── an export carries the recording's anchors ───────────────────────────
  /* ⚠️ THE EXPORT READ THE OLD PLACE TOO: a recording's package shipped with
   * no ethereum-anchors/ although the folder held them (Mike, 2026-09-10).
   * Same fixtures, dropped into the lone recording, then exported. */
  mkdirSync(join(dir, "ethereum-anchors"), { recursive: true });
  copyFileSync(join(fixtures, "anchor.json"), join(dir, "ethereum-anchors", "anchor-before.json"));
  copyFileSync(join(fixtures, "witness.json"), join(dir, "ethereum-anchors", "anchor-before-witness.json"));
  const into = mkdtempSync(join(tmpdir(), "bg-export-"));
  const exported = await daemon.handle({ id: 5, op: "export", root: library, evidence: join(dir, "proof.json"), file: one, into }) as any;
  const shipped: string[] = exported.files ?? [];
  ok("an export of a recording carries the recording's anchors",
    shipped.includes("ethereum-anchors/anchor-before.json") && shipped.includes("ethereum-anchors/anchor-before-witness.json"), JSON.stringify(shipped));
  ok("and the package on disk holds them", existsSync(join(exported.path, "ethereum-anchors", "anchor-before.json")), exported.path);

  // ── dedup is library-wide ───────────────────────────────────────────────
  const again = await daemon.handle({ id: 4, op: "drop", paths: [one] }) as any;
  ok("dropping it again opens the recording it already has", again.action === "open", again.action);
  ok("and points at the proof inside that recording", String(again.opened.evidencePath).endsWith("proof.json"), again.opened?.evidencePath);
} finally {
  await daemon.stop();
  stack.stop();
}
console.log(`\n${pass} checks passed${process.exitCode ? ", WITH FAILURES" : ""}`);
