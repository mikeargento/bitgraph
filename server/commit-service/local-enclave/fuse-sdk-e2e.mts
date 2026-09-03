// The SDK end to end against the unmodified enclave through the real parent
// (parent-direct transport). Run: node --import tsx/esm fuse-sdk-e2e.mts
import { startStack } from "./lib.mts";
import { fuse, builderFor } from "../../../packages/fuse/dist/index.js";
import { verifyFuse, assembledAfterCommit } from "../../../packages/verify/dist/index.js";

const stack = await startStack({ quiet: true, parentEnv: { FUSE_ENABLED: "true" } });
let pass = 0;
const ok = (name: string, cond: boolean, detail?: unknown) => { if (!cond) { console.error("FAIL", name, JSON.stringify(detail ?? "").slice(0, 300)); process.exitCode = 1; } else { pass++; console.log("ok  ", name); } };
try {
  const transport = { baseUrl: stack.parentUrl, allocatePath: "/allocate-slot", commitPath: "/commit", recoveryAttempts: 1, recoveryDelayMs: 1 };
  const original = new TextEncoder().encode("an original that existed before the slot\n");

  const a = await fuse(builderFor("trailer/1", original), { placement: "trailer/1", original, fusedFile: "note.txt", transport, keepFused: true });
  ok("trailer/1 minted and verified FUSED_DIRECT", a.verification.category === "FUSED_DIRECT");
  ok("proof landed on bitgraph:main", (a.proof.commit as { chainId?: string }).chainId === "bitgraph:main");
  const fromOriginal = await verifyFuse({ proof: a.proof, bytes: original });
  ok("the original alone rebuilds it", fromOriginal.category === "FUSED_FROM_ORIGIN", fromOriginal.reason);

  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const b = await fuse(builderFor("container/1", png), { placement: "container/1", original: png, transport });
  ok("container/1 minted and verified", b.verification.category === "FUSED_DIRECT");
  ok("strict order: b was assembled after a committed", assembledAfterCommit(a.proof, b.proof) === true);

  const c = await fuse(builderFor("produced/1"), { placement: "produced/1", originDigest: new Uint8Array(Buffer.from(a.artifactDigestB64, "base64")), transport });
  ok("produced/1 naming a's fused bytes as source", c.verification.category === "FUSED_DIRECT" && c.originDigestB64 === a.artifactDigestB64);
  ok("Form C keeps its bytes", c.fusedBytes !== undefined);
} finally {
  stack.stop();
}
console.log(`\n${pass} checks passed${process.exitCode ? ", with failures" : ""}`);

// ---- the CLI harness against the same stack ----
{
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, readFileSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const stack2 = await startStack({ quiet: true, parentEnv: { FUSE_ENABLED: "true" } });
  let cliPass = 0;
  const okc = (name: string, cond: boolean, detail?: unknown) => { if (!cond) { console.error("FAIL", name, String(detail ?? "").slice(0, 400)); process.exitCode = 1; } else { cliPass++; console.log("ok  ", name); } };
  try {
    const dir = mkdtempSync(join(tmpdir(), "bitgraph-fuse-cli-"));
    const src = join(dir, "note.txt");
    writeFileSync(src, "a note that already exists\n");
    const { fileURLToPath } = await import("node:url");
    const cli = fileURLToPath(new URL("../../../packages/fuse/dist/cli.js", import.meta.url));
    const common = ["--base-url", stack2.parentUrl, "--allocate-path", "/allocate-slot", "--commit-path", "/commit", "--out", dir];
    const a = spawnSync(process.execPath, [cli, "fuse", src, "--placement", "trailer/1", "--keep", ...common], { encoding: "utf8" });
    okc("cli fuse trailer/1 exits 0", a.status === 0, a.stderr + a.stdout);
    okc("cli prints the bounded copy", a.stdout.includes("Original recorded") && a.stdout.includes("These bytes were assembled after their slot allocation"), a.stdout);
    okc("cli never prints a raw nonce line", !/nonce/i.test(a.stdout));
    const frame = join(dir, "note.txt.bitgraph-fuse.json");
    okc("Frame written", existsSync(frame));
    const fused = join(dir, "note.fused.txt");
    okc("fused bytes written with --keep", existsSync(fused));
    const c1 = spawnSync(process.execPath, [cli, "check", frame, fused], { encoding: "utf8" });
    okc("cli check on fused bytes: FUSED_DIRECT, exit 0", c1.status === 0 && /category\s+FUSED_DIRECT/.test(c1.stdout), c1.stdout + c1.stderr);
    const c2 = spawnSync(process.execPath, [cli, "check", frame, src], { encoding: "utf8" });
    okc("cli check on the original: FUSED_FROM_ORIGIN, exit 0", c2.status === 0 && /category\s+FUSED_FROM_ORIGIN/.test(c2.stdout), c2.stdout + c2.stderr);
    writeFileSync(join(dir, "other.txt"), "unrelated\n");
    const c3 = spawnSync(process.execPath, [cli, "check", frame, join(dir, "other.txt")], { encoding: "utf8" });
    okc("cli check on an unrelated file: NO_MATCH, exit 2", c3.status === 2 && /NO_MATCH/.test(c3.stdout), c3.stdout);
    const p = spawnSync(process.execPath, [cli, "produce", "--origin", src, ...common], { encoding: "utf8" });
    okc("cli produce (Form C) exits 0 and writes produced.json", p.status === 0 && existsSync(join(dir, "produced.json")), p.stderr + p.stdout);
    const usage = spawnSync(process.execPath, [cli], { encoding: "utf8" });
    okc("cli usage exits 64", usage.status === 64);
    void readFileSync;
  } finally {
    stack2.stop();
  }
  console.log(`\n${cliPass} CLI checks passed`);
}
