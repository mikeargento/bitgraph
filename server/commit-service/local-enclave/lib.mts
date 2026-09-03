// Shared helpers for harness drivers: start both processes, wait, stop.
import { spawn, type ChildProcess } from "node:child_process";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Stack { enclave: ChildProcess; parent: ChildProcess; parentUrl: string; stop(): void }

async function waitTcp(port: number, ms = 30_000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ok = await new Promise<boolean>((res) => {
      const s = connect({ host: "127.0.0.1", port }, () => { s.destroy(); res(true); });
      s.on("error", () => res(false));
    });
    if (ok) return;
    await sleep(150);
  }
  throw new Error(`port ${port} never came up`);
}

async function waitKey(url: string, ms = 30_000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`${url}/key`);
      const j = (await r.json()) as { epochId?: string };
      if (j.epochId) return;
    } catch { /* not yet */ }
    await sleep(150);
  }
  throw new Error("parent never answered /key");
}

export async function startStack(opts: { enclavePort?: number; parentPort?: number; parentEnv?: Record<string, string>; quiet?: boolean } = {}): Promise<Stack> {
  const enclavePort = opts.enclavePort ?? 59000 + Math.floor(Math.random() * 500);
  const parentPort = opts.parentPort ?? 58000 + Math.floor(Math.random() * 500);
  const stdio = opts.quiet ? "ignore" : "inherit";
  const enclave = spawn(process.execPath, [join(here, "run-local-enclave.mjs")], {
    stdio, env: { ...process.env, ENCLAVE_PORT: String(enclavePort) },
  });
  await waitTcp(enclavePort);
  const parent = spawn(process.execPath, [join(here, "run-local-parent.mjs")], {
    stdio, env: { ...process.env, ENCLAVE_PORT: String(enclavePort), PORT: String(parentPort), ...(opts.parentEnv ?? {}) },
  });
  const parentUrl = `http://127.0.0.1:${parentPort}`;
  await waitKey(parentUrl);
  return { enclave, parent, parentUrl, stop() { parent.kill(); enclave.kill(); } };
}

export async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: any; headers: Headers }> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json, headers: r.headers };
}

export function randomDigestB64(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Buffer.from(b).toString("base64");
}
