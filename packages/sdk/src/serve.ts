// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * `bitgraph serve`: the SDK's verbs on a localhost API, so every runtime
 * plugs in with an HTTP call and two lines of code. Python:
 *
 *   import requests
 *   requests.post("http://127.0.0.1:8791/record", json={"paths": ["run.log"]}).json()
 *
 * BOUND TO 127.0.0.1 ONLY, always: this process reads local files by path,
 * so it must never be reachable from anywhere but this machine. Bodies are
 * JSON in, JSON out; errors are { error, status }. Nothing here uploads
 * bytes anywhere: the daemon runs the same local pipelines as the class.
 *
 * Routes (all POST unless noted):
 *   GET  /            → { name, version, verbs } — the map
 *   POST /record      → { paths: string[], again? }            → RecordResult
 *   POST /check       → { paths?: string[], digests?: string[] } → CheckedInput[]
 *   POST /proof       → { digest? | path? | number?, counter?, epoch? } → proof detail
 *   POST /open        → {}                                      → Slot (token included; seal within ttlSeconds)
 *   POST /seal        → { token, path? | digestB64? }           → sealed task (proof written beside path)
 *   POST /verify      → { path }                                → offline verdict and window
 *   POST /bitgraphed  → { path, waitForCeilingMs?, out? }       → writes the BitGraphed file, returns where
 *   POST /complete    → { path, waitForCeilingMs?, out? }       → closing anchor fetched in, returns where
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BitGraph } from "./bitgraph.js";
import { carrierFileName } from "./carrier-build.js";
import { ApiError } from "./api.js";

export interface ServeOptions {
  port?: number;
  bitgraph?: BitGraph;
}

export interface RunningServer {
  port: number;
  close: () => Promise<void>;
  server: Server;
}

export const DEFAULT_PORT = 8791;

async function readBody(req: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ApiError(400, "the request body is not JSON");
  }
}

const str = (b: Record<string, unknown>, key: string): string | undefined => (typeof b[key] === "string" ? (b[key] as string) : undefined);
const num = (b: Record<string, unknown>, key: string): number | undefined => (typeof b[key] === "number" ? (b[key] as number) : undefined);

export function serve(options: ServeOptions = {}): Promise<RunningServer> {
  const bg = options.bitgraph ?? new BitGraph();
  const port = options.port ?? DEFAULT_PORT;

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const send = (status: number, payload: unknown) => {
      const body = JSON.stringify(payload, null, 2);
      res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
      res.end(body);
    };
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/") {
        send(200, {
          name: "bitgraph serve",
          verbs: ["record", "check", "proof", "open", "seal", "verify", "bitgraphed", "complete"],
          note: "POST JSON to each verb; 127.0.0.1 only; files are read locally and never uploaded.",
        });
        return;
      }
      if (req.method !== "POST") {
        send(405, { error: "POST only (GET / for the map)", status: 405 });
        return;
      }
      const b = (await readBody(req)) as Record<string, unknown>;
      switch (url.pathname) {
        case "/record": {
          const paths = Array.isArray(b["paths"]) ? (b["paths"] as string[]) : undefined;
          if (!paths || paths.length === 0) throw new ApiError(400, "paths: string[] is required");
          send(200, await bg.record(paths, b["again"] === true ? { again: true } : {}));
          return;
        }
        case "/check": {
          const paths = Array.isArray(b["paths"]) ? (b["paths"] as string[]) : [];
          const digests = Array.isArray(b["digests"]) ? (b["digests"] as string[]) : [];
          if (paths.length + digests.length === 0) throw new ApiError(400, "pass paths and/or digests");
          send(200, await bg.check([...paths, ...digests]));
          return;
        }
        case "/proof": {
          send(200, await bg.proof({
            ...(str(b, "digest") !== undefined ? { digest: str(b, "digest") as string } : {}),
            ...(str(b, "path") !== undefined ? { path: str(b, "path") as string } : {}),
            ...(str(b, "number") !== undefined ? { number: str(b, "number") as string } : {}),
            ...(str(b, "counter") !== undefined ? { counter: str(b, "counter") as string } : {}),
            ...(str(b, "epoch") !== undefined ? { epoch: str(b, "epoch") as string } : {}),
          }));
          return;
        }
        case "/open": {
          const slot = await bg.open();
          const { seal: _seal, ...wire } = slot;
          send(200, wire);
          return;
        }
        case "/seal": {
          const token = str(b, "token");
          if (token === undefined) throw new ApiError(400, "token is required (from /open)");
          const path = str(b, "path");
          const digestB64 = str(b, "digestB64");
          if (path === undefined && digestB64 === undefined) throw new ApiError(400, "pass path or digestB64");
          const sealed = await bg.seal(token, path !== undefined ? path : { digestB64: digestB64 as string });
          let proofPath: string | null = null;
          if (path !== undefined) {
            try { proofPath = await bg.writeProofBeside(path, sealed.proof); } catch { proofPath = null; }
          }
          send(200, { ...sealed, proofPath });
          return;
        }
        case "/verify": {
          const path = str(b, "path");
          if (path === undefined) throw new ApiError(400, "path is required");
          send(200, await bg.verify(path));
          return;
        }
        case "/bitgraphed": {
          const path = str(b, "path");
          if (path === undefined) throw new ApiError(400, "path is required");
          const wait = num(b, "waitForCeilingMs");
          const built = await bg.bitgraphedFile(path, wait !== undefined ? { waitForCeilingMs: wait } : {});
          const out = str(b, "out") ?? join(dirname(path), built.fileName);
          await writeFile(out, built.bytes, { flag: "wx" });
          send(200, { path: out, ceiling: built.ceiling });
          return;
        }
        case "/complete": {
          const path = str(b, "path");
          if (path === undefined) throw new ApiError(400, "path is required");
          const wait = num(b, "waitForCeilingMs");
          const done = await bg.complete(path, wait !== undefined ? { waitForCeilingMs: wait } : {});
          const out = str(b, "out") ?? path;
          if (done.changed) await writeFile(out, done.bytes);
          send(200, { path: out, changed: done.changed, ceiling: done.ceiling });
          return;
        }
        default:
          send(404, { error: `no verb at ${url.pathname} (GET / for the map)`, status: 404 });
      }
    } catch (err) {
      const status = err instanceof ApiError ? (err.status >= 400 && err.status < 600 ? err.status : 502) : 500;
      send(status, { error: err instanceof Error ? err.message : String(err), status });
    }
  };

  const server = createServer((req, res) => {
    void handler(req, res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    // 127.0.0.1 ONLY: this daemon reads local files by path and must never
    // be reachable from off this machine.
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const bound = addr !== null && typeof addr === "object" ? addr.port : port;
      resolve({
        port: bound,
        server,
        close: () => new Promise<void>((done, fail) => server.close((e) => (e ? fail(e) : done()))),
      });
    });
  });
}
