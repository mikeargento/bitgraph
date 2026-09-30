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
 *   bitgraph verify <path>            offline judgment, one line per claim (BitGraphed files need nothing else;
 *                                     --eth-rpc/--base-rpc confirm the blocks, --pcr0 names the images accepted)
 *   bitgraph bitgraphed <path>        write the BitGraphed file (carrier/2) beside the original
 *   bitgraph complete <path>          fetch the closing anchor and the Base ceiling into a BitGraphed file
 *   bitgraph ceiling verify <proof> <ceiling>   check a ceiling in time (offline; --rpc asks Base)
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

/** BitGraph's published ceiling writer on Base mainnet (bitgraph.ing/ceilings). */
const BITGRAPH_CEILING_WRITER = "0xf3972408D853c975F86351C311f4310220bbF2a3";

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
  verify <path> [--proof proof.json] [--eth-rpc URL] [--base-rpc URL] [--pcr0 hex,..]
                                       offline judgment, one line per claim; exit 2 on FALSE/corrupt.
                                       The rpc flags confirm each block against a node.
  bitgraphed <path> [--wait ms] [--out file]
  complete <path> [--wait ms]
  ceiling verify <proof.json> <ceiling.json> [--rpc URL] [--writer 0x..] [--chain 8453]
                                       check a ceiling in time offline; --rpc also
                                       asks a Base node that the block is Base's
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
          `position #${slot.slotCounter} held${slot.floor ? ` · no earlier than block ${slot.floor.block}` : ""}`,
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
      // The confirmed level: a node per chain answers whether each header is the chain's own block.
      const rpcLookup = (url: string) => async (n: number): Promise<string | null> => {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["0x" + n.toString(16), false] }),
          signal: AbortSignal.timeout(15_000),
        });
        const j = (await res.json()) as { result?: { hash?: string } | null };
        return j.result?.hash ?? null;
      };
      const ethRpc = flags.get("eth-rpc"), baseRpc = flags.get("base-rpc"), pcr0 = flags.get("pcr0");
      const v = await bg.verify(target, proof, {
        lookups: {
          ...(typeof ethRpc === "string" ? { ethereumBlockHash: rpcLookup(ethRpc) } : {}),
          ...(typeof baseRpc === "string" ? { baseBlockHash: rpcLookup(baseRpc) } : {}),
        },
        ...(typeof pcr0 === "string" ? { pins: { pcr0: pcr0.split(",").map((x) => x.trim()).filter(Boolean) } } : {}),
      });
      out(v, () => {
        const lines = [`${v.verdict}${v.carrier === "corrupt" ? " (carrier block unreadable: corrupted, not judged)" : ""}`];
        if (v.bounds) lines.push(`  ${carrierLine(v.bounds)}`);
        for (const c of v.claims) {
          const mark = c.result === "TRUE" ? "ok " : c.result === "FALSE" ? "!! " : c.result === "NOT_CARRIED" ? "-- " : "?? ";
          lines.push(`  ${mark} ${c.name}${c.result === "TRUE" && c.restsOn ? ` [${c.restsOn}]` : ""}${c.result !== "TRUE" ? `: ${c.detail}` : ""}`);
        }
        if (v.claims.length === 0) for (const r of v.reasons) lines.push(`  - ${r}`);
        if (v.reading) lines.push("", `  ${v.reading}`);
        if (v.claims.length > 0 && typeof ethRpc !== "string") lines.push("", "  add --eth-rpc <url> and --base-rpc <url> to confirm the blocks against nodes; --pcr0 <hex,...> to name the images you accept");
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
      out({ path: outPath, ceiling: built.ceiling, ceilingInTime: built.ceilingInTime, witness: built.witness }, () =>
        `BitGraphed file written at ${outPath}` +
        (built.ceilingInTime === "unfetched" ? "\n  Base ceiling NOT FETCHED yet (it lands seconds after the commit); run: bitgraph complete " + JSON.stringify(outPath) : "") +
        (built.ceiling === "unfetched" ? "\n  closing anchor NOT FETCHED yet; run: bitgraph complete " + JSON.stringify(outPath) : "") +
        (built.witness ? "" : "\n  the openssl attestation witness was left out to keep this ZIP-family file under its 64 KiB limit; the proof inside still carries the attestation")
      );
      return;
    }
    case "complete": {
      const target = args[0];
      if (target === undefined) fail("complete needs a BitGraphed file's path");
      const wait = flags.get("wait");
      const done = await bg.complete(target, typeof wait === "string" ? { waitForCeilingMs: Number(wait) } : {});
      if (done.changed) await writeFile(target, done.bytes);
      out({ path: target, changed: done.changed, ceiling: done.ceiling, ceilingInTime: done.ceilingInTime }, () => {
        const complete = done.ceiling === "present" && done.ceilingInTime !== "unfetched";
        if (done.changed) return complete ? "fetched in; the window is complete" : "fetched in; still waiting for " + (done.ceiling !== "present" ? "the closing anchor" : "the Base ceiling");
        return complete ? "already complete; nothing changed" : "nothing has landed yet; try again in a moment";
      });
      return;
    }
    case "ceiling": {
      if (args[0] !== "verify" || args.length !== 3) fail("usage: bitgraph ceiling verify <proof.json> <ceiling.json> [--rpc URL] [--writer 0x..] [--chain 8453]");
      const { readFile } = await import("node:fs/promises");
      const { verifyCeiling, checkCeilingOnline } = await import("@mikeargento/bitgraph-verify");
      const proof = JSON.parse(await readFile(args[1] as string, "utf8"));
      const sidecar = JSON.parse(await readFile(args[2] as string, "utf8"));
      const writer = typeof flags.get("writer") === "string" ? (flags.get("writer") as string) : BITGRAPH_CEILING_WRITER;
      const chainId = typeof flags.get("chain") === "string" ? Number(flags.get("chain")) : 8453;
      const r = await verifyCeiling(proof, sidecar, { writerAddress: writer, chainId });
      const rpc = flags.get("rpc");
      let online: { onChain: boolean | null; detail: string } = { onChain: null, detail: "header not checked against chain (add --rpc https://mainnet.base.org)" };
      if (r.ok && typeof rpc === "string") {
        online = await checkCeilingOnline(sidecar, async (n) => {
          const res = await fetch(rpc, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["0x" + n.toString(16), false] }),
            signal: AbortSignal.timeout(15_000),
          });
          const j = (await res.json()) as { result?: { hash?: string } | null };
          return j.result?.hash ?? null;
        });
      }
      out({ ...r, writer, chainId, onChain: online.onChain, onChainDetail: online.detail }, () => {
        if (!r.ok) return `NOT VERIFIED: ${r.reason}`;
        const w = r.window!;
        const lines = [`VERIFIED  ${r.label}`];
        if (w.floor.blockTimestamp != null) lines.push(`  window: ${w.widthSeconds} s, from Ethereum block ${w.floor.blockNumber} to Base block ${w.ceiling.blockNumber}`);
        else lines.push(`  floor: Ethereum block ${w.floor.blockNumber} (no header carried, so its time needs an Ethereum node)`);
        lines.push(`  ${online.detail}`);
        for (const c of r.checks) lines.push(`  ${c.ok ? "ok " : "!! "} ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
        return lines.join("\n");
      });
      if (!r.ok || online.onChain === false) process.exit(2);
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
