#!/usr/bin/env node
// Runs the real parent server.ts against the local enclave. No ledger, no
// index URL, no production contact.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const parent = join(here, "..", "src", "parent", "server.ts");
const env = {
  ...process.env,
  PORT: process.env["PORT"] ?? "58080",
  VSOCK_BRIDGE_HOST: "127.0.0.1",
  VSOCK_BRIDGE_PORT: process.env["ENCLAVE_PORT"] ?? "59000",
  LEDGER_BUCKET: "",
  PROOF_INDEX_URL: "",
};
delete env["LEDGER_BUCKET"];
const child = spawn(process.execPath, ["--import", "tsx/esm", parent], { stdio: "inherit", env });
child.on("exit", (c) => process.exit(c ?? 1));
// A runner that is killed takes its child with it, so a driver's stop() never
// leaves an enclave or parent listening behind.
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, () => { child.kill("SIGTERM"); process.exit(0); });
