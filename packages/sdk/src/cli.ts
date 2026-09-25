#!/usr/bin/env node
// Copyright (c) 2024-2026 Argento Computing Inc. Licensed under the MIT License. See LICENSE.

/**
 * The bitgraph CLI: the SDK's verbs for any language that can spawn a
 * process. Every command accepts --json and prints one JSON document to
 * stdout; without it, a short human line per result. Exit 0 on success,
 * 1 on refusal or failure, 2 on a FALSE or corrupt verdict from verify.
 *
 *   bitgraph record <paths...>        make ONE BitGraph (one file solo; many as one set)
 *   bitgraph check <paths|digests...> read-only: on record?
 *   bitgraph proof (--digest D | --path P | --number N)
 *   bitgraph open                     hold a position; prints the commitment and a token
 *   bitgraph seal --token T <path>    seal the task that carries the commitment
 *   bitgraph verify <path>            offline judgment (BitGraphed files need nothing else)
 *   bitgraph bitgraphed <path>        write the BitGraphed file beside the original
 *   bitgraph complete <path>          fetch the closing anchor into a BitGraphed file
 *   bitgraph serve [--port 8791]      the same verbs on 127.0.0.1 for every runtime
 *
 * --base-url and --api-key (or BITGRAPH_API_URL / BITGRAPH_API_KEY) point a
 * licensee at their own boundary. Recording is permanent: record only what
 * the user asked for.
 */

import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BitGraph } from "./bitgraph.js";
import { serve, DEFAULT_PORT } from "./serve.js";
import { ApiError } from "./api.js";
import { carrierLine } from "./carrier-io.js";
import { SLOT_TTL_SECONDS } from "./task.js";

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

const HELP = `bitgraph — make, check and verify BitGraphs from any stack

  record <paths...>                    make ONE BitGraph of everything given
  check <paths|digests...>             read-only: are these bytes on record?
  proof --digest D | --path P | --number N
  open                                 hold a position before the work exists
  seal --token T <path>                seal the task that carries the commitment
  verify <path> [--proof proof.json]   offline judgment; exit 2 on FALSE/corrupt
  bitgraphed <path> [--wait ms] [--out file]
  complete <path> [--wait ms]
  serve [--port ${DEFAULT_PORT}]                    localhost API (127.0.0.1 only)

Every command takes --json (one JSON document on stdout), --base-url and
--api-key (or BITGRAPH_API_URL / BITGRAPH_API_KEY). Files are read locally
and never uploaded. Recording is permanent; record only what was asked for.`;

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
  if (typeof baseUrl === "string") opts.baseUrl = baseUrl;
  if (typeof apiKey === "string") opts.apiKey = apiKey;
  const bg = new BitGraph(opts);
  const out = (value: unknown, human: () => string) => {
    process.stdout.write(json ? JSON.stringify(value, null, 2) + "\n" : human() + "\n");
  };

  switch (cmd) {
    case "record": {
      if (args.length === 0) fail("record needs at least one path");
      const r = await bg.record(args);
      out(r, () => {
        const lines: string[] = [];
        if (r.made?.kind === "solo") lines.push(`recorded · #${r.made.counter ?? "?"} · ${r.made.proofUrl}`);
        if (r.made?.kind === "set") lines.push(`recorded · #${r.made.counter ?? "?"} · one set of ${r.made.count} · ${r.made.proofUrl}`);
        for (const f of r.files) {
          if (f.outcome === "recorded" && r.made?.kind === "set") lines.push(`  ${f.member} of ${f.memberCount} · ${f.path}`);
          else if (f.outcome === "on record") lines.push(`on record · #${f.counter ?? "?"} · ${f.path}\n  ${f.proofUrl}`);
          else if (f.outcome === "carried") lines.push(`BitGraphed file (proof inside, nothing minted) · ${f.path}${f.carrier ? `\n  ${carrierLine(f.carrier)}` : ""}`);
          else if (f.outcome === "refused") lines.push(`refused · ${f.path}: ${f.error ?? "?"}`);
          if (f.c2pa === true) lines.push("  Content Credentials (C2PA) detected");
        }
        return lines.join("\n");
      });
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
    case "open": {
      const slot = await bg.open();
      const { seal: _seal, ...wire } = slot;
      out(wire, () =>
        [
          `position held · slot ${slot.slotCounter}${slot.floor ? ` · no earlier than block ${slot.floor.block}` : ""}`,
          `commitment (put this INSIDE the task): ${slot.commitment}`,
          `seal within ${SLOT_TTL_SECONDS}s:`,
          `  bitgraph seal --token ${slot.token} <task-file>`,
        ].join("\n")
      );
      return;
    }
    case "seal": {
      const token = flags.get("token");
      if (typeof token !== "string") fail("seal needs --token from open");
      const target = args[0];
      const digest = flags.get("digest");
      if (target === undefined && typeof digest !== "string") fail("seal needs a task file path (or --digest)");
      const sealed = await bg.seal(token, target !== undefined ? target : { digestB64: digest as string });
      let proofPath: string | null = null;
      if (target !== undefined) {
        try {
          proofPath = await bg.writeProofBeside(target, sealed.proof);
        } catch {
          proofPath = null;
        }
      }
      out({ ...sealed, proofPath }, () =>
        [
          `sealed · #${sealed.proof.commit?.counter ?? "?"}`,
          sealed.offsets !== null ? `the commitment sits in the sealed bytes at offset ${sealed.offsets[0]}` : "the bytes were not read here; a verifier looks for the commitment inside them",
          proofPath !== null ? `proof written whole at ${proofPath}; leave it as written` : "save the proof from --json output, whole and unedited",
        ].join("\n")
      );
      return;
    }
    case "verify": {
      const target = args[0];
      if (target === undefined) fail("verify needs a path");
      let proof: unknown;
      const proofPath = flags.get("proof");
      if (typeof proofPath === "string") {
        const { readFile } = await import("node:fs/promises");
        proof = JSON.parse(await readFile(proofPath, "utf8")) as unknown;
      }
      const v = await bg.verify(target, proof);
      out(v, () => {
        const lines = [`${v.verdict}${v.carrier === "corrupt" ? " (carrier block unreadable: corrupted, not judged)" : ""}`];
        if (v.bounds) lines.push(`  ${carrierLine(v.bounds)}`);
        for (const r of v.reasons) lines.push(`  - ${r}`);
        return lines.join("\n");
      });
      if (v.verdict === "FALSE" || v.carrier === "corrupt") process.exit(2);
      return;
    }
    case "bitgraphed": {
      const target = args[0];
      if (target === undefined) fail("bitgraphed needs a path to committed bytes already on record");
      const wait = flags.get("wait");
      const built = await bg.bitgraphedFile(target, typeof wait === "string" ? { waitForCeilingMs: Number(wait) } : {});
      const outPath = typeof flags.get("out") === "string" ? (flags.get("out") as string) : join(dirname(target), built.fileName);
      await writeFile(outPath, built.bytes, { flag: "wx" });
      out({ path: outPath, ceiling: built.ceiling }, () =>
        `BitGraphed file written at ${outPath}${built.ceiling === "unfetched" ? "\n  closing anchor NOT FETCHED yet; run: bitgraph complete " + JSON.stringify(outPath) : ""}`
      );
      return;
    }
    case "complete": {
      const target = args[0];
      if (target === undefined) fail("complete needs a BitGraphed file's path");
      const wait = flags.get("wait");
      const done = await bg.complete(target, typeof wait === "string" ? { waitForCeilingMs: Number(wait) } : {});
      if (done.changed) await writeFile(target, done.bytes);
      out({ path: target, changed: done.changed, ceiling: done.ceiling }, () =>
        done.changed ? `closing anchor fetched in; the window is complete` : done.ceiling === "present" ? "already complete; nothing changed" : "the window has not closed yet; try again after the next anchor"
      );
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
