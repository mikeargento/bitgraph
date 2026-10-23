// 30,000 files, once, against the local enclave. Measures each phase.
// Run: node --import tsx/esm e2e/scale.mts [count]
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStack } from "../../../server/commit-service/local-enclave/lib.mts";
import { makeFiles } from "../src/make.js";
import { checkFolder, walk } from "../src/check.js";
import { pathsFor } from "../src/paths.js";
import { readEvidence } from "../src/evidence.js";

const N = Number(process.argv[2] ?? 30_000);
const root = mkdtempSync(join(tmpdir(), "bg-scale-"));
const t = (label: string, ms: number) => console.log(`  ${label.padEnd(28)} ${(ms / 1000).toFixed(1)}s`);

let mark = Date.now();
for (let i = 0; i < N; i++) {
  const sub = join(root, `batch-${String(Math.floor(i / 2000)).padStart(2, "0")}`);
  if (i % 2000 === 0) mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, `note-${String(i).padStart(5, "0")}.txt`), `scale ${i}\n${"x".repeat(120 + (i % 97))}\n`);
}
t("made the files", Date.now() - mark);

const stack = await startStack({ quiet: true, anchor: true, parentEnv: { FUSE_ENABLED: "true" } });
const transport = { baseUrl: stack.parentUrl, allocatePath: "/allocate-slot", commitPath: "/commit", recoveryAttempts: 1, recoveryDelayMs: 1, timeoutMs: 180_000 };

try {
  mark = Date.now();
  const files = await walk(root);
  t(`walked ${files.length}`, Date.now() - mark);

  const phase: Record<string, number> = {};
  let last = Date.now();
  let seen = "";
  const total = Date.now();
  const { made, skipped } = await makeFiles(root, files, {
    transport,
    onProgress: (p) => {
      if (p.phase !== seen) {
        if (seen !== "") phase[seen] = (phase[seen] ?? 0) + (Date.now() - last);
        seen = p.phase;
        last = Date.now();
      }
    },
  });
  if (seen !== "") phase[seen] = (phase[seen] ?? 0) + (Date.now() - last);
  const makeMs = Date.now() - total;

  for (const [name, ms] of Object.entries(phase)) t(name, ms);
  t("MAKE, end to end", makeMs);

  console.log(`\n  set kind          ${made?.set}`);
  console.log(`  members           ${made?.files.length.toLocaleString()}`);
  console.log(`  position          ${made?.position.counter}`);
  console.log(`  skipped           ${skipped.length}`);

  const bitgraphs = pathsFor(root).bitgraphs;
  let evidenceBytes = 0;
  let evidenceCount = 0;
  const walkDir = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walkDir(p);
      else if (e.name.endsWith(".bitgraph") || e.name.endsWith(".position.json")) { evidenceCount++; evidenceBytes += statSync(p).size; }
    }
  };
  walkDir(bitgraphs);
  console.log(`  evidence files    ${evidenceCount.toLocaleString()}`);
  console.log(`  evidence on disk  ${(evidenceBytes / 1e6).toFixed(1)} MB  (${Math.round(evidenceBytes / Math.max(evidenceCount, 1))} bytes each)`);

  const one = await readEvidence(join(bitgraphs, "batch-00", "note-00000.txt.position.json"));
  console.log(`  a member carries  ${one?.member?.memberProof !== undefined ? "its inclusion path" : "no path"}`);

  const proof = JSON.parse(
    (await import("node:fs/promises")).readFileSync === undefined ? "{}" : "{}"
  ) as Record<string, never>;
  void proof;

  const { readFileSync } = await import("node:fs");
  const posDir = pathsFor(root).position(made!.position.epochId, made!.position.counter);
  const p = JSON.parse(readFileSync(join(posDir, "proof.json"), "utf8")) as { environment?: { measurement?: string } };

  mark = Date.now();
  const report = await checkFolder(root, { alsoKnownEnclaves: [{ pcr0: p.environment!.measurement!, label: "harness" }] });
  t("CHECK, end to end", Date.now() - mark);
  console.log(`  verified          ${report.counts.verified.toLocaleString()}`);
  console.log(`  failed            ${report.counts.failed}`);
  console.log(`  could not check   ${report.counts.undetermined}`);
  console.log(`  not recorded      ${report.counts.unrecorded}`);
  if (report.counts.verified !== N) {
    console.error("\nNOT EVERY FILE VERIFIED");
    console.error(JSON.stringify(report.speaking.slice(0, 3), null, 2));
    process.exitCode = 1;
  }
} finally {
  stack.stop();
}
