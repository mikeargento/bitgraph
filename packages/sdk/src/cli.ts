#!/usr/bin/env node
// Copyright (c) 2025-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * The bitgraph CLI: the SDK's verbs for any language that can spawn a
 * process. Every command accepts --json and prints one JSON document to
 * stdout; without it, a short human line per result. Exit 0 on success,
 * 1 on refusal or failure, 2 on a FALSE or corrupt verdict from verify.
 *
 *   bitgraph record <paths...>        one new file is one BitGraph, several are one tree and one
 *                                     BitGraph; each proof is saved beside its file (make is the same command)
 *   bitgraph check <paths|digests...> read-only: on record?
 *   bitgraph proof (--digest D | --path P | --number N)
 *   bitgraph verify <path> [--proof proof.json]   offline judgment
 *   bitgraph serve [--port 8791]      the same verbs on 127.0.0.1 for every runtime
 *
 * --base-url and --api-key (or BITGRAPH_API_URL / BITGRAPH_API_KEY) point a
 * licensee at their own site. Recording is permanent: record only what the
 * user asked for.
 */

import { readFile } from "node:fs/promises";
import { BitGraph } from "./bitgraph.js";
import { serve, DEFAULT_PORT } from "./serve.js";
import { ApiError } from "./api.js";
import { carrierLine } from "./carrier-io.js";
import type { RecordResult } from "./record.js";

interface Parsed {
  cmd: string;
  args: string[];
  flags: Map<string, string | true>;
}

function parseArgv(argv: string[]): Parsed {
  const [cmd = "help", ...rest] = argv;
  const args: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as string;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, true);
      }
    } else {
      args.push(a);
    }
  }
  return { cmd, args, flags };
}

const HELP = `bitgraph: make, check and verify BitGraphs from any stack

  record <paths...> [--no-write]       make BitGraphs of files. Each is one atomic action in the
                                       enclave: a fresh nonce at one count, the SHA-256 at the next,
                                       signed together. One new file is one BitGraph; several are
                                       one tree and one BitGraph. Each proof is saved beside its
                                       file as <file>.bitgraph.json (--no-write: not). Files already
                                       on record are not made again. make is the same command.
  check <paths|digests...>             read-only: are these bytes on record?
  proof --digest D | --path P | --number N
  verify <path> [--proof proof.json] [--pcr0 hex,..]
                                       offline judgment; exit 2 on FALSE or a corrupt block
  serve [--port ${DEFAULT_PORT}]                    localhost API (127.0.0.1 only)

Every command takes --json (one JSON document on stdout), --base-url and
--api-key (or BITGRAPH_API_URL / BITGRAPH_API_KEY). Files are read locally
and never uploaded. A BitGraph is permanent; make one only of what was asked for.`;

/** One short block per record call: the BitGraph made, with its nonce, then each file. */
function recordLines(r: RecordResult): string {
  const lines: string[] = [];
  const m = r.made;
  if (m !== null) {
    const what = m.tree !== null ? `a tree of ${m.tree.files} files` : "1 file";
    lines.push(`BitGraph #${m.number ?? "?"} (counts ${m.counts?.join(", ") ?? "?"}) · ${what}`);
    lines.push(`  nonce ${m.nonce ?? "?"}`);
    lines.push(`  ${m.proofUrl}`);
    if (m.tree !== null && m.tree.indexError !== null) lines.push(`  index: ${m.tree.indexError}; each file's own proof still verifies`);
  } else {
    lines.push("nothing new to make");
  }
  for (const f of r.files) {
    if (f.outcome === "made") lines.push(`made · ${f.path}${f.member !== null ? ` (file ${f.member.index + 1} of ${f.member.files})` : ""}\n  ${f.proofPath !== null ? `proof saved: ${f.proofPath}` : "proof not saved (--no-write): keep it from --json"}`);
    else if (f.outcome === "on record") lines.push(`on record · #${f.number ?? "?"} · ${f.path}\n  ${f.proofUrl}`);
    else lines.push(`skipped · ${f.path}: ${f.reason ?? ""}`);
  }
  return lines.join("\n");
}

function fail(message: string, code = 1): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

async function main(): Promise<void> {
  const { cmd, args, flags } = parseArgv(process.argv.slice(2));
  const json = flags.get("json") === true;
  const opts: { baseUrl?: string; apiKey?: string } = {};
  const baseUrl = flags.get("base-url");
  const apiKey = flags.get("api-key");
  if (typeof baseUrl === "string") opts.baseUrl = baseUrl.replace(/\/+$/, "");
  if (typeof apiKey === "string") opts.apiKey = apiKey;
  const bg = new BitGraph(opts);
  const out = (value: unknown, human: () => string) => {
    process.stdout.write(json ? JSON.stringify(value, null, 2) + "\n" : human() + "\n");
  };

  switch (cmd) {
    case "make":
    case "record": {
      if (args.length === 0) fail(`${cmd} needs at least one path`);
      const r = await bg.record(args, { write: flags.get("no-write") !== true });
      out(r, () => recordLines(r));
      return;
    }
    case "check": {
      if (args.length === 0) fail("check needs paths or digests");
      const results = await bg.check(args);
      out(results, () =>
        results
          .map((r) => {
            const head = r.onRecord
              ? `on record · #${r.positions[0]?.counter ?? "?"} · ${r.input}\n  ${r.proofUrl}`
              : r.carrier
                ? `not in this ledger · ${r.input}`
                : r.note !== undefined
                  ? `not judged · ${r.input}\n  ${r.note}`
                  : `not on record · ${r.input}`;
            const carrier = r.carrier ? `\n  ${carrierLine(r.carrier)}` : "";
            const c2pa = r.c2pa === true ? "\n  Content Credentials (C2PA) detected" : "";
            return head + carrier + c2pa;
          })
          .join("\n")
      );
      return;
    }
    case "proof": {
      const sel: { digest?: string; path?: string; number?: string; counter?: string; epoch?: string } = {};
      for (const key of ["digest", "path", "number", "counter", "epoch"] as const) {
        const v = flags.get(key);
        if (typeof v === "string") sel[key] = v;
      }
      if (sel.digest === undefined && sel.path === undefined && sel.number === undefined && args[0] !== undefined) sel.digest = args[0];
      const detail = await bg.proof(sel);
      out(detail, () => {
        const p = detail.proofs[0]?.proof;
        const counter = p?.commit?.counter ?? "?";
        const lines = [`BitGraph #${counter} · digest ${p?.artifact?.digestB64 ?? "?"}`];
        if (detail.carrier) lines.push(carrierLine(detail.carrier));
        return lines.join("\n");
      });
      return;
    }
    case "verify": {
      const target = args[0];
      if (target === undefined) fail("verify needs a path");
      const proofPath = flags.get("proof");
      const proof = typeof proofPath === "string" ? (JSON.parse(await readFile(proofPath, "utf8")) as unknown) : undefined;
      const pcr0 = flags.get("pcr0");
      const v = await bg.verify(target, proof, typeof pcr0 === "string" ? { pins: { pcr0: pcr0.split(",").map((x) => x.trim()).filter(Boolean) } } : {});
      out(v, () => {
        const lines = [`${v.verdict}${v.carrier === "corrupt" ? " (carrier block unreadable: corrupted, not judged)" : ""}`];
        if (v.view) lines.push(`  ${carrierLine(v.view)}`);
        for (const c of v.claims) {
          const mark = c.result === "TRUE" ? "ok " : c.result === "FALSE" ? "!! " : c.result === "NOT_CARRIED" ? "-- " : "?? ";
          lines.push(`  ${mark} ${c.name}${c.result === "TRUE" && c.restsOn ? ` [${c.restsOn}]` : ""}${c.result !== "TRUE" ? `: ${c.detail}` : ""}`);
        }
        if (v.claims.length === 0) for (const r of v.reasons) lines.push(`  - ${r}`);
        if (v.reading) lines.push("", `  ${v.reading}`);
        return lines.join("\n");
      });
      if (v.verdict === "FALSE" || v.carrier === "corrupt") process.exit(2);
      return;
    }
    case "serve": {
      const portFlag = flags.get("port");
      const running = await serve({ ...(typeof portFlag === "string" ? { port: Number(portFlag) } : {}), bitgraph: bg });
      process.stdout.write(`bitgraph serve on http://127.0.0.1:${running.port} (127.0.0.1 only; GET / for the map)\n`);
      return; // stays up until the process is killed
    }
    case "help":
    case "--help":
    default:
      process.stdout.write(HELP + "\n");
      if (cmd !== "help" && cmd !== "--help") process.exit(1);
  }
}

main().catch((err) => {
  const message = err instanceof ApiError ? `Error ${err.status}: ${err.message}` : err instanceof Error ? err.message : String(err);
  process.stderr.write(message + "\n");
  process.exit(1);
});
