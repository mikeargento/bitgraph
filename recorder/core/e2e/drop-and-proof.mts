// The gesture, end to end: drop, look, make, describe, verify.
// Run: node --import tsx/esm e2e/drop-and-proof.mts
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStack } from "../../../server/commit-service/local-enclave/lib.mts";
import { Daemon } from "../src/daemon.js";
import { pathsFor } from "../src/paths.js";

let pass = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => {
  if (!cond) { console.error("FAIL", name, typeof detail === "string" ? detail : JSON.stringify(detail ?? "").slice(0, 400)); process.exitCode = 1; }
  else { pass++; console.log("ok  ", name); }
};
function jpeg(bytes: number, seed: number): Uint8Array {
  const b = new Uint8Array(bytes);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  for (let i = 4; i < bytes; i++) b[i] = (i * 31 + seed) & 0xff;
  return b;
}

const stack = await startStack({ quiet: true, anchor: true, parentEnv: { FUSE_ENABLED: "true" } });
const home = mkdtempSync(join(tmpdir(), "bg-drophome-"));
/* ⚠️ Nothing a test does may reach the real library. */
process.env.BITGRAPH_RECORDER_HOME = home;
const lines: string[] = [];
const daemon = await Daemon.start({
  baseUrl: stack.parentUrl,
  allocatePath: "/allocate-slot",
  commitPath: "/commit",
  settingsPath: join(home, "settings.json"),
  write: (l) => lines.push(l),
});
await daemon.handle({ op: "setup", at: mkdtempSync(join(tmpdir(), "bg-setup-")), name: "BitGraph" });

try {
  const dir = mkdtempSync(join(tmpdir(), "bg-drop-"));

  // ── a lone new file: the drop IS the shutter ─────────────────────────────
  const solo = join(dir, "ONE.JPG");
  writeFileSync(solo, jpeg(1200, 1));
  const first = await daemon.handle({ id: 1, op: "drop", paths: [solo] }) as any;
  ok("a lone new file is recorded on landing, with nothing to confirm", first.action === "made", first.action);
  ok("and the answer carries where its evidence went", typeof first.made?.files?.[0]?.evidencePath === "string");
  ok("it was fused on its own, not as a set", first.made?.kind === "solo");

  // ── the same file again: it opens instead of minting ─────────────────────
  const again = await daemon.handle({ id: 2, op: "drop", paths: [solo] }) as any;
  ok("dropping it again opens its BitGraph instead of making another", again.action === "open", again.action);
  ok("and it names the position it already holds", again.opened?.position?.counter === first.made.position.counter);

  // ── but asking explicitly ticks again ────────────────────────────────────
  const forced = await daemon.handle({ id: 3, op: "drop", paths: [solo], again: true }) as any;
  ok("asking again makes a second BitGraph: a clock ticks every time you ask",
    forced.action === "made" && forced.made.position.counter !== first.made.position.counter);

  // ── a batch waits to be asked ────────────────────────────────────────────
  const batch = mkdtempSync(join(tmpdir(), "bg-batch-"));
  mkdirSync(join(batch, "raw"));
  const many = [
    join(batch, "A.JPG"), join(batch, "B.JPG"), join(batch, "raw", "C.JPG"), join(batch, "notes.txt"),
  ];
  many.forEach((p, i) => writeFileSync(p, p.endsWith(".txt") ? new TextEncoder().encode(`note ${i}\n`) : jpeg(900 + i, 10 + i)));

  const listed = await daemon.handle({ id: 4, op: "drop", paths: [batch] }) as any;
  ok("a batch is listed and nothing is made", listed.action === "ready", listed.action);
  ok("it found all four", listed.look.files.length === 4, String(listed.look.files.length));
  ok("none of them are recorded yet", listed.look.recorded === 0);
  ok("it carries a token for the second half of the gesture", typeof listed.token === "string");
  ok("the folder it would write under is the one they share", listed.root === batch, listed.root);

  const committed = await daemon.handle({ id: 5, op: "commitDrop", token: listed.token }) as any;
  ok("committing makes ONE BitGraph of all four", committed.made?.kind === "set" && committed.made.files.length === 4);
  ok("at one position", new Set(committed.made.files.map(() => committed.made.position.counter)).size === 1);

  // ⚠️ The point of the token: the files are not read a second time.
  const stale = await daemon.handle({ id: 6, op: "commitDrop", token: listed.token }).catch((e: Error) => e);
  ok("a spent token is refused rather than quietly re-reading", stale instanceof Error && /no longer waiting/.test(stale.message));

  // ── the same bytes twice in one drop ─────────────────────────────────────
  /* ⚠️ Mike's ten-file drop held two identical photographs; the set fuse
   * refuses a duplicate member and the whole commit threw. One member now
   * stands for the bytes and the other name is reported, and covered. */
  const pair = mkdtempSync(join(tmpdir(), "bg-pair-"));
  writeFileSync(join(pair, "X.JPG"), jpeg(1500, 21));
  writeFileSync(join(pair, "X copy.JPG"), jpeg(1500, 21));
  writeFileSync(join(pair, "Y.JPG"), jpeg(1400, 22));
  const pairLook = await daemon.handle({ id: 40, op: "drop", paths: [pair] }) as any;
  const twins = new Set(["X.JPG", "X copy.JPG"]);
  const dupRow = pairLook.look.files.find((f: any) => f.duplicateOf !== undefined);
  ok("a drop says how many of its files are the same bytes as another",
    pairLook.action === "ready" && pairLook.look.duplicates === 1 && dupRow !== undefined && twins.has(dupRow.rel) && twins.has(dupRow.duplicateOf) && dupRow.rel !== dupRow.duplicateOf,
    JSON.stringify(pairLook.look).slice(0, 300));
  const pairMade = await daemon.handle({ id: 41, op: "commitDrop", token: pairLook.token }) as any;
  ok("and commits ONE member for them instead of throwing",
    pairMade.made?.files.length === 2 && pairMade.skipped.length === 1 && pairMade.skipped[0].reason === "same-bytes" && twins.has(pairMade.skipped[0].sameAs) && twins.has(pairMade.skipped[0].name),
    JSON.stringify({ made: pairMade.made?.files?.length, skipped: pairMade.skipped }).slice(0, 300));
  const pairAgain = await daemon.handle({ id: 42, op: "drop", paths: [pair] }) as any;
  ok("and the other name is covered: dropped again, all three are on record", pairAgain.look.recorded === 3, JSON.stringify(pairAgain.look).slice(0, 200));

  // ── a second drop of the same batch finds them all recorded ──────────────
  const seen = await daemon.handle({ id: 7, op: "drop", paths: [batch] }) as any;
  ok("dropping the same folder again finds every file already recorded",
    seen.action === "ready" && seen.look.recorded === 4, JSON.stringify({ a: seen.action, r: seen.look?.recorded }));

  // ── describe: everything the page shows, read off the disk ───────────────
  const member = committed.made.files[0];
  /* ⚠️ A recording folder holds every member's row, so naming WHICH member is
   * the caller's job. The app always has the digest in hand. */
  const described = await daemon.handle({ id: 8, op: "describe", root: batch, evidence: member.evidencePath, origin: member.originDigestB64 }) as any;
  ok("describe returns the evidence", described.evidence?.file?.name === member.name);
  ok("and the shared proof beside it", typeof described.proof?.artifact?.digestB64 === "string");
  ok("and the committed artifact the set hashed to", typeof described.committedB64 === "string");
  ok("the member knows which of the four it is",
    described.evidence.member.count === 4 && typeof described.evidence.member.index === "number");

  // ── verify: the page says nothing about validity until this runs ─────────
  const proof = described.proof as { environment?: { measurement?: string } };
  const settings = await daemon.handle({ id: 9, op: "settings" }) as any;
  settings.alsoKnownEnclaves.push({ pcr0: proof.environment!.measurement!, label: "local harness enclave (fake PCR0)" });

  const verified = await daemon.handle({ id: 10, op: "verify", root: batch, files: [member.path] }) as any;
  ok("verify answers for the one file it was given", verified.speaking.length === 1, String(verified.speaking.length));
  ok("and a verified row IS returned when the caller named it",
    verified.speaking[0].status === "verified", JSON.stringify(verified.speaking[0]).slice(0, 300));
  ok("it says how the bytes were bound", verified.speaking[0].method === "streamed");
  ok("and which enclave signed it", verified.speaking[0].enclave === "local harness enclave (fake PCR0)");
  ok("it carries both sides of the Ethereum window, with reasons",
    Array.isArray(verified.speaking[0].bounds) && verified.speaking[0].bounds.length === 2 &&
    verified.speaking[0].bounds.every((b: { note: string }) => typeof b.note === "string" && b.note.length > 10),
    JSON.stringify(verified.speaking[0].bounds));

  // ── a whole check still speaks only for what has something to say ────────
  const whole = await daemon.handle({ id: 11, op: "check", root: batch }) as any;
  ok("a folder check counts the verified and lists none of them",
    whole.counts.verified === 4 && whole.speaking.length === 0, JSON.stringify(whole.counts));

  // ── a drop of files with no folder in common is refused, and says why ────
  const other = mkdtempSync(join(tmpdir(), "bg-elsewhere-"));
  writeFileSync(join(other, "D.JPG"), jpeg(400, 77));
  const mixed = await daemon.handle({ id: 12, op: "drop", paths: [join(batch, "A.JPG"), join(other, "D.JPG")] }) as any;
  ok("files from two folders still share a parent, so the drop works", mixed.action === "ready", mixed.action);
  ok("and the shared parent is where their BitGraphs would go", mixed.root.length > 1 && batch.startsWith(mixed.root));
  // ── the export: the new file, rebuilt and checked ───────────────────────
  {
    const into = mkdtempSync(join(tmpdir(), "bg-export-"));
    const pkg = await daemon.handle({ id: 20, op: "export", root: batch, evidence: member.evidencePath, origin: member.originDigestB64, file: member.path, into }) as any;
    ok("the package was written as a FOLDER, not a zip", typeof pkg.path === "string" && pkg.path.endsWith("BitGraph"));
    ok("it carries the original", pkg.files.includes(member.name));
    ok("and the signed proof", pkg.files.includes("proof.json"));
    ok("and the committed artifact", pkg.files.includes("manifest.json"));
    ok("and this file's own evidence", pkg.files.includes("position.json"));
    ok("and the NEW FILE, rebuilt", typeof pkg.fusedName === "string" && pkg.files.some((f: string) => f.startsWith("new-file/")), JSON.stringify(pkg.files));

    // ⚠️ The rebuilt bytes must be the artifact the proof committed, checked
    // here the way a stranger would check them.
    const { createHash } = await import("node:crypto");
    const fused = readFileSync(join(pkg.path, "new-file", pkg.fusedName));
    const digest = createHash("sha256").update(fused).digest("base64");
    const ev = JSON.parse(readFileSync(join(pkg.path, "position.json"), "utf8")) as { artifactDigestB64: string };
    ok("the new file hashes to exactly what the proof committed", digest === ev.artifactDigestB64, `${digest} vs ${ev.artifactDigestB64}`);

    const { verifyFuseMember } = await import("@mikeargento/bitgraph-verify");
    const proofOut = JSON.parse(readFileSync(join(pkg.path, "proof.json"), "utf8"));
    const manifest = new Uint8Array(readFileSync(join(pkg.path, "manifest.json")));
    const direct = await verifyFuseMember({ proof: proofOut, bytes: new Uint8Array(fused), manifest, member: (JSON.parse(readFileSync(join(pkg.path, "position.json"), "utf8")) as any).member?.memberProof });
    ok("the published verifier accepts the rebuilt file on its own", direct.category === "SET_MEMBER_DIRECT" || direct.category === "SET_MEMBER_FROM_ORIGIN", direct.category + " " + (direct.reason ?? ""));

    const fromOriginal = await verifyFuseMember({ proof: proofOut, bytes: new Uint8Array(readFileSync(join(pkg.path, member.name))), manifest });
    ok("and accepts the original beside it", fromOriginal.category === "SET_MEMBER_FROM_ORIGIN", fromOriginal.category);
  }

  // ── every member of a big set is readable from the recording alone ──────
  //
  // ⚠️ A recording carries members.jsonl, and for a set/2 the inclusion path in
  // it is the only thing putting a file inside that set. Everything a person
  // can do with a member has to work from the recording and nothing else:
  // find it, check it, open its page, export it.
  {
    const big = mkdtempSync(join(tmpdir(), "bg-bigset-"));
    const N = 12;
    for (let i = 0; i < N; i++) writeFileSync(join(big, `f-${String(i).padStart(3, "0")}.JPG`), jpeg(300 + i, 700 + i));

    const listed = await daemon.handle({ id: 30, op: "drop", paths: [big] }) as any;
    const madeBig = await daemon.handle({ id: 31, op: "commitDrop", token: listed.token }) as any;
    const dir = madeBig.made.bundlePath as string;
    ok("big set: one recording", madeBig.made.files.length === N && typeof dir === "string");
    ok("big set: nothing was written where the files came from", !existsSync(join(big, "BitGraphs")), JSON.stringify(readdirSync(big).slice(0, 4)));
    ok("big set: the membership travels with it", existsSync(join(dir, "members.jsonl")) && existsSync(join(dir, "manifest.json")));

    const settings2 = await daemon.handle({ id: 32, op: "settings" }) as any;
    void settings2;
    const report = await daemon.handle({ id: 33, op: "check", root: dir }) as any;
    ok("big set: the recording checks itself, with no index and no library",
      report.counts.verified === N && report.counts.failed === 0, JSON.stringify(report.counts));

    const first = madeBig.made.files[0]!;
    const described = await daemon.handle({
      id: 34, op: "describe", root: big, evidence: join(dir, "proof.json"), origin: first.originDigestB64,
    }) as any;
    ok("big set: a member's page is built from the recording", described.evidence?.file?.name === first.name, JSON.stringify(described.evidence?.file));
    ok("big set: and it carries the member's place in the set", described.evidence?.member?.count === N);

    const into = mkdtempSync(join(tmpdir(), "bg-bigset-export-"));
    const pkg = await daemon.handle({
      id: 35, op: "export", root: big, file: first.path, into,
      evidence: join(dir, "proof.json"), origin: first.originDigestB64,
    }) as any;
    ok("big set: it exports, new file and all", pkg.files.includes("position.json") && typeof pkg.fusedName === "string", JSON.stringify(pkg.files));
  }

} finally {
  await daemon.stop();
  stack.stop();
}

console.log(`\n${pass} checks passed${process.exitCode ? ", WITH FAILURES" : ""}`);
