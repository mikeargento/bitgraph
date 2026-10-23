import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startBitcoinAnchor, manualAnchor, getAnchorStatus, setAnchorInterval } from "./bitcoin-anchor.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DASHBOARD_DIR = resolve(__dirname, "../dashboard");
const PORT = parseInt(process.env.PORT ?? "3100", 10);

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk: Buffer) => { data += chunk.toString(); });
    req.on("end", () => resolve(data));
  });
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

function serveDashboard(pathname: string, res: ServerResponse): boolean {
  if (!existsSync(DASHBOARD_DIR)) return false;
  const exactPath = join(DASHBOARD_DIR, pathname);
  if (existsSync(exactPath) && statSync(exactPath).isFile()) {
    const ext = extname(exactPath);
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    const content = readFileSync(exactPath);
    const isAsset = pathname.includes("/_next/");
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": content.length,
      "Cache-Control": isAsset ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(content);
    return true;
  }
  if (!extname(pathname)) {
    const htmlPath = exactPath + ".html";
    if (existsSync(htmlPath)) {
      const content = readFileSync(htmlPath);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": content.length, "Cache-Control": "no-cache" });
      res.end(content);
      return true;
    }
  }
  return false;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const str = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(str) });
  res.end(str);
}

async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // Health
  if (pathname === "/api/health" && req.method === "GET") {
    json(res, 200, { ok: true });
    return;
  }

  // Anchor API
  if (pathname === "/api/anchor/status" && req.method === "GET") {
    json(res, 200, getAnchorStatus());
    return;
  }
  if (pathname === "/api/anchor/now" && req.method === "POST") {
    try {
      const result = await manualAnchor();
      if (result) {
        json(res, 200, { ok: true, block: result.block, digestB64: result.digestB64 });
      } else {
        json(res, 500, { error: "Anchor failed — TEE unavailable" });
      }
    } catch (err) {
      json(res, 500, { error: (err as Error).message });
    }
    return;
  }
  if (pathname === "/api/anchor/interval" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const { seconds } = JSON.parse(body);
      if (typeof seconds !== "number") {
        json(res, 400, { error: "seconds must be a number" });
        return;
      }
      json(res, 200, setAnchorInterval(seconds));
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return;
  }

  // Dashboard static files
  if (pathname === "/" || pathname === "") {
    const indexPath = join(DASHBOARD_DIR, "index.html");
    if (existsSync(indexPath)) {
      const content = readFileSync(indexPath);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": content.length, "Cache-Control": "no-cache" });
      res.end(content);
      return;
    }
  }

  if (serveDashboard(pathname, res)) return;

  // SPA fallback
  const indexPath = join(DASHBOARD_DIR, "index.html");
  if (existsSync(indexPath)) {
    const content = readFileSync(indexPath);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": content.length, "Cache-Control": "no-cache" });
    res.end(content);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
}

const server = createServer(handler);
server.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("  ┌─────────────────────────────────┐");
  console.log("  │     BitGraph Ethereum Anchor Service   │");
  console.log("  └─────────────────────────────────┘");
  console.log("");
  console.log(`  Dashboard:  http://localhost:${PORT}`);
  console.log(`  Anchor API: http://localhost:${PORT}/api/anchor/status`);
  // Enclave v10 (2026-10-06) takes every floor from a Base block it fixes at
  // allocation, so the Ethereum anchor stream is no longer in any proof's path.
  // ANCHOR_STREAM=off stops it without removing it: setting it back (or
  // unsetting it) restarts anchoring on the next deploy, and v10 still accepts
  // authenticated anchor claims.
  const streamOff = (process.env.ANCHOR_STREAM || "").toLowerCase() === "off";
  console.log(streamOff ? "  ETH Anchor: OFF (ANCHOR_STREAM=off; floors come from Base, enclave v10)" : `  ETH Anchor: every 12s → TEE → S3 (same chain)`);
  console.log("");

  if (!streamOff) startBitcoinAnchor();
});
