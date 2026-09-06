#!/usr/bin/env node
// Runs the unmodified enclave app.ts locally. See README.md.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src", "enclave", "app.ts");
const outDir = join(here, ".build");
const out = join(outDir, "app.local.ts");
mkdirSync(outDir, { recursive: true });

let code = readFileSync(src, "utf8");
function patch(anchor, replacement, label) {
  const n = code.split(anchor).length - 1;
  if (n !== 1) throw new Error(`harness: anchor for ${label} found ${n} times; app.ts changed, refresh the harness`);
  code = code.replace(anchor, replacement);
}

// 1. NSM: the only hardware dependency. Everything the enclave asks of it is
//    answered in software here. Random bytes are real crypto random.
patch(
  "const nsmClient = new DefaultNsmClient();",
  `// LOCAL HARNESS ONLY: software NSM so the enclave's own slot logic runs off-Nitro.
import { randomBytes as __harnessRandom } from "node:crypto";
const nsmClient = {
  async request(req: Record<string, unknown>): Promise<Record<string, unknown>> {
    if ("DescribePCR" in req) return { DescribePCR: { lock: true, data: new Uint8Array(48).fill(0xab) } };
    if ("GetRandom" in req) return { GetRandom: { random: new Uint8Array(__harnessRandom(256)) } };
    if ("Attestation" in req) {
      const ud = (req["Attestation"] as { user_data?: Uint8Array }).user_data ?? new Uint8Array();
      return { Attestation: { document: new TextEncoder().encode("LOCAL-HARNESS-ATTESTATION:" + Buffer.from(ud).toString("hex")) } };
    }
    throw new Error("harness NSM: unsupported request " + JSON.stringify(Object.keys(req)));
  },
};`,
  "nsm client",
);

// 2. Listen on loopback TCP instead of the enclave's Unix socket.
patch(
  'server.listen(SOCKET_PATH, () => {\n  console.log(`[enclave] listening on ${SOCKET_PATH}`);\n});',
  'const __harnessPort = Number(process.env["ENCLAVE_PORT"] ?? 59000);\nserver.listen(__harnessPort, "127.0.0.1", () => {\n  console.log(`[enclave] LOCAL HARNESS listening on 127.0.0.1:${__harnessPort} (instead of ${SOCKET_PATH})`);\n});',
  "listen",
);

// 3. Enclave v7: the anchor service public key is a measured constant. The
//    harness swaps in a test key so anchor-v7.mts can sign claims itself.
if (process.env["HARNESS_ANCHOR_PUBKEY_B64"]) {
  const m = code.match(/const ANCHOR_SERVICE_PUBLIC_KEY_B64 = "[A-Za-z0-9+/=]+";/);
  if (!m) throw new Error("harness: ANCHOR_SERVICE_PUBLIC_KEY_B64 constant not found; app.ts changed, refresh the harness");
  patch(m[0], `const ANCHOR_SERVICE_PUBLIC_KEY_B64 = "${process.env["HARNESS_ANCHOR_PUBKEY_B64"]}"; // LOCAL HARNESS ONLY`, "anchor key");
}

writeFileSync(out, code);
const child = spawn(process.execPath, ["--import", "tsx/esm", out], { stdio: "inherit", env: process.env });
child.on("exit", (c) => process.exit(c ?? 1));
// A runner that is killed takes its child with it, so a driver's stop() never
// leaves an enclave or parent listening behind.
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, () => { child.kill("SIGTERM"); process.exit(0); });
