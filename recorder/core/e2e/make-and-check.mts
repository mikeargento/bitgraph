// BitGraph Recorder end to end against the UNMODIFIED enclave through the real
// parent. Nothing here touches production; nothing is minted on the live
// ledger. Run: node --import tsx/esm e2e/make-and-check.mts
//
// ⚠️ ONE SHAPE. A recording is a folder in the library: the files, the proof,
// the anchors. Nothing is ever written where the files came from.
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync, renameSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStack } from "../../../server/commit-service/local-enclave/lib.mts";
import { makeFiles } from "../src/make.js";
import { checkFolder, checkFile, walk } from "../src/check.js";
import { FolderIndex } from "../src/index-store.js";
import { INDEX_FILE } from "../src/paths.js";

let pass = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (!cond) { console.error("FAIL", name, typeof detail === "string" ? detail : JSON.stringify(detail ?? "").slice(0, 400)); process.exitCode = 1; }
  else { pass++; console.log("ok  ", name); }
};

/** A JPEG-looking file: placementForBytes gives it trailer/1. */
function jpeg(bytes: number, seed: number): Uint8Array {
  const b = new Uint8Array(bytes);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  for (let i = 4; i < bytes; i++) b[i] = (i * 31 + seed) & 0xff;
  return b;
}
const text = (s: string) => new TextEncoder().encode(s);

const stack = await startStack({ quiet: true, anchor: true, parentEnv: { FUSE_ENABLED: "true" } });
const transport = { baseUrl: stack.parentUrl, allocatePath: "/allocate-slot", commitPath: "/commit", recoveryAttempts: 1, recoveryDelayMs: 1 };
const library = mkdtempSync(join(tmpdir(), "bg-library-"));
let harness: Array<{ pcr0: string; label: string }> = [];
const opts = () => ({ alsoKnownEnclaves: harness, library });
const make = (root: string, files: string[], extra: Record<string, unknown> = {}) =>
  makeFiles(root, files, { transport, bundle: { library, source: root.split("/").pop() ?? "drop" }, ...extra });

/** Every recording folder in the library, newest day first. */
const recordings = (): string[] =>
  readdirSync(library).filter((d) => /^\d{4}-/.test(d)).flatMap((d) => readdirSync(join(library, d)).map((b) => join(library, d, b)));

try {
  // ── 1. a lone file becomes a recording ──────────────────────────────────
  {
    const shoot = mkdtempSync(join(tmpdir(), "bitgraph-solo-"));
    const photo = join(shoot, "IMG_4021.JPG");
    writeFileSync(photo, jpeg(4096, 7));
    const before = readdirSync(shoot);

    const { made, skipped } = await make(shoot, [photo]);
    ok("solo: something was made", made !== null);
    ok("solo: nothing skipped", skipped.length === 0);
    ok("solo: it was fused on its own, not as a set", made?.kind === "solo" && made.set === null);
    ok("solo: the original is untouched", readFileSync(photo).length === 4096);
    /* ⚠️ The whole point of the shape: the folder you dropped from is left
     * exactly as it was. */
    ok("solo: NOTHING was written where it came from", JSON.stringify(readdirSync(shoot)) === JSON.stringify(before), JSON.stringify(readdirSync(shoot)));

    const dir = made!.bundlePath!;
    ok("solo: a recording folder appeared", existsSync(dir) && dir.endsWith("BitGraph (IMG_4021.JPG)"), dir);
    ok("solo: it holds the file and the proof", existsSync(join(dir, "IMG_4021.JPG")) && existsSync(join(dir, "proof.json")));
    const proof = JSON.parse(readFileSync(join(dir, "proof.json"), "utf8")) as { version: string; environment: { measurement: string } };
    ok("solo: and proof.json IS bitgraph/1", proof.version === "bitgraph/1", proof.version);
    harness = [{ pcr0: proof.environment.measurement, label: "local harness enclave (fake PCR0)" }];

    /* A hard link: one copy of the bytes, two names, so recording cost nothing. */
    ok("solo: the file went in as a hard link", statSync(photo).ino === statSync(join(dir, "IMG_4021.JPG")).ino);
    ok("solo: the fused bytes were NOT written", !existsSync(join(dir, "IMG_4021.fused.JPG")) && !existsSync(join(shoot, "IMG_4021.fused.JPG")));

    const unknown = await checkFolder(shoot, { library });
    ok("solo: an enclave this build does not know is UNDETERMINED, never verified",
      unknown.counts.undetermined === 1 && unknown.counts.verified === 0 && unknown.counts.failed === 0, JSON.stringify(unknown.counts));
    ok("solo: and it says so without calling it invalid", /not invalid/.test(unknown.speaking[0]?.reason ?? ""), unknown.speaking[0]?.reason);

    const report = await checkFolder(shoot, opts());
    ok("solo: it verifies, read out of the library", report.counts.verified === 1 && report.counts.failed === 0, JSON.stringify(report.speaking));
    ok("solo: nothing speaks", report.speaking.length === 0);
    ok("solo: the check used the published verifier", (await checkFile(shoot, photo, opts())).method === "verifier");
    /* The recording folder checks too: it holds the files and the proof. */
    const inPlace = await checkFolder(dir, opts());
    ok("solo: and the recording folder checks on its own", inPlace.counts.verified === 1, JSON.stringify(inPlace.counts));
  }

  // ── 2. a batch is ONE recording at ONE position ─────────────────────────
  {
    const roll = mkdtempSync(join(tmpdir(), "bitgraph-set-"));
    mkdirSync(join(roll, "raw"));
    const names = ["a.JPG", "b.JPG", "raw/c.JPG", "notes.txt", "d.JPG"];
    const paths = names.map((n) => join(roll, ...n.split("/")));
    paths.forEach((p, i) => writeFileSync(p, names[i]!.endsWith(".txt") ? text(`note ${i}\n`) : jpeg(2048 + i * 64, i)));

    const { made } = await make(roll, paths);
    ok("set: one set was made", made?.kind === "set" && made.set === "set/1");
    ok("set: every file is a member", made?.files.length === 5);

    const dir = made!.bundlePath!;
    ok("set: the recording is named for the folder it came from", dir.includes("5 files)"), dir);
    ok("set: it holds the proof and the committed manifest", existsSync(join(dir, "proof.json")) && existsSync(join(dir, "manifest.json")));
    ok("set: and every member's row", existsSync(join(dir, "members.jsonl")));
    ok("set: the tree came with it", existsSync(join(dir, "raw", "c.JPG")));
    ok("set: nothing was written where they came from", !existsSync(join(roll, "BitGraphs")));

    const report = await checkFolder(roll, opts());
    ok("set: all five verify", report.counts.verified === 5, JSON.stringify(report.speaking).slice(0, 400));

    const rows = readFileSync(join(dir, "members.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { rel: string; placement: string });
    const byRel = new Map(rows.map((r) => [r.rel, r.placement]));
    ok("set: text took container/2, photos took trailer/1",
      byRel.get("notes.txt") === "container/2" && byRel.get("a.JPG") === "trailer/1", JSON.stringify([...byRel]));
  }

  // ── 3. what an altered file says ────────────────────────────────────────
  {
    const shoot = mkdtempSync(join(tmpdir(), "bitgraph-tamper-"));
    const a = join(shoot, "one.JPG");
    const b = join(shoot, "two.JPG");
    writeFileSync(a, jpeg(1024, 1));
    writeFileSync(b, jpeg(1024, 2));
    await make(shoot, [a, b]);

    /* ⚠️ Editing in place. The recording's copy is the SAME BYTES (a hard
     * link), so both change together, which is exactly right: a recording is
     * of bytes, and these bytes are not those bytes any more. */
    const flipped = new Uint8Array(readFileSync(a));
    flipped[600] = flipped[600]! ^ 0xff;
    writeFileSync(a, flipped);

    const report = await checkFolder(shoot, opts());
    /* Bytes alone cannot tell an altered file from one that was never
     * recorded, and only one of those accuses anybody. */
    ok("tamper: the altered file has no BitGraph for its bytes", report.counts.unrecorded === 1, JSON.stringify(report.counts));
    ok("tamper: it is never counted as a failure", report.counts.failed === 0);
    ok("tamper: the other file still verifies", report.counts.verified === 1);
  }

  // ── 4. an unrecorded file is not a fault ────────────────────────────────
  {
    const shoot = mkdtempSync(join(tmpdir(), "bitgraph-unrec-"));
    const a = join(shoot, "made.JPG");
    writeFileSync(a, jpeg(512, 3));
    await make(shoot, [a]);
    writeFileSync(join(shoot, "later.JPG"), jpeg(512, 4));

    const report = await checkFolder(shoot, opts());
    ok("unrecorded: counted apart from failures", report.counts.unrecorded === 1 && report.counts.failed === 0, JSON.stringify(report.counts));
    const row = report.speaking.find((f) => f.name === "later.JPG")!;
    ok("unrecorded: never says 'not on the ledger'", !/ledger/i.test(row.reason ?? ""), row.reason);
  }

  // ── 5. dedup is a convenience; 'again' overrides it ─────────────────────
  {
    const shoot = mkdtempSync(join(tmpdir(), "bitgraph-again-"));
    const a = join(shoot, "same.JPG");
    writeFileSync(a, jpeg(700, 9));
    const first = await make(shoot, [a]);
    const second = await make(shoot, [a]);
    ok("dedup: dropping it again mints nothing", second.made === null && second.skipped.length === 1);
    ok("dedup: and says where it already is", second.skipped[0]!.positions.length === 1);
    const third = await make(shoot, [a], { again: true });
    ok("again: asking again ticks again", third.made !== null && third.made.position.counter !== first.made!.position.counter);
    ok("again: and it is its own recording", third.made!.bundlePath !== first.made!.bundlePath);
  }

  // ── 6. a file too large to hold is a set of one, never a refusal ────────
  {
    const shoot = mkdtempSync(join(tmpdir(), "bitgraph-big-"));
    const big = join(shoot, "video.mov");
    writeFileSync(big, jpeg(300_000, 55));
    const { made } = await make(shoot, [big], { soloCeiling: 1000 });
    ok("big: it was recorded, not refused", made !== null);
    ok("big: as a set of one", made?.kind === "set" && made.files.length === 1, `${made?.kind}`);
    const report = await checkFolder(shoot, opts());
    ok("big: and it verifies", report.counts.verified === 1, JSON.stringify(report.speaking).slice(0, 300));
    ok("big: nothing was held: the check streamed it", (await checkFile(shoot, big, opts())).method === "streamed");
  }

  // ── 7. a renamed file keeps its BitGraph ────────────────────────────────
  {
    const shoot = mkdtempSync(join(tmpdir(), "bitgraph-rename-"));
    const a = join(shoot, "before.JPG");
    writeFileSync(a, jpeg(800, 21));
    await make(shoot, [a]);
    renameSync(a, join(shoot, "after.JPG"));
    const report = await checkFolder(shoot, opts());
    ok("rename: matching is by content, not by name", report.counts.verified === 1, JSON.stringify(report.speaking).slice(0, 300));
  }

  // ── 8. the library's index is an index ──────────────────────────────────
  {
    const shoot = mkdtempSync(join(tmpdir(), "bitgraph-index-"));
    const a = join(shoot, "x.JPG");
    writeFileSync(a, jpeg(400, 31));
    const { made } = await make(shoot, [a]);
    const before = recordings().length;
    unlinkSync(join(library, INDEX_FILE));
    const idx = await FolderIndex.open(join(library, INDEX_FILE));
    ok("index: it really was deleted", idx.fileCount === 0);
    ok("index: every recording is still there", recordings().length === before && existsSync(join(made!.bundlePath!, "proof.json")));
    /* ⚠️ The recordings are the authority. Deleting the index costs a rescan
     * of the library and nothing else. */
    const inPlace = await checkFolder(made!.bundlePath!, opts());
    ok("index: and a recording still checks without it", inPlace.counts.verified === 1, JSON.stringify(inPlace.counts));
  }

  // ── 9. a folder dropped whole ───────────────────────────────────────────
  {
    const shoot = mkdtempSync(join(tmpdir(), "bitgraph-tree-"));
    mkdirSync(join(shoot, "raw"));
    mkdirSync(join(shoot, "jpg"));
    writeFileSync(join(shoot, "raw", "IMG_1.JPG"), jpeg(300, 11));
    writeFileSync(join(shoot, "jpg", "IMG_1.JPG"), jpeg(300, 12));
    const files = await walk(shoot);
    ok("tree: the walk found both", files.length === 2);
    const { made } = await make(shoot, files);
    ok("tree: same name in two folders, both in the recording",
      existsSync(join(made!.bundlePath!, "raw", "IMG_1.JPG")) && existsSync(join(made!.bundlePath!, "jpg", "IMG_1.JPG")));
    const report = await checkFolder(shoot, opts());
    ok("tree: both verify", report.counts.verified === 2, JSON.stringify(report.speaking).slice(0, 300));
  }
} finally {
  stack.stop();
}

console.log(`\n${pass} checks passed${process.exitCode ? ", WITH FAILURES" : ""}`);
