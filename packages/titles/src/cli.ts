#!/usr/bin/env node
// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * bitgraph-title — author, convey, and check possession messages.
 *
 *   keygen  --out <key.json>
 *   open    <work> --key <key.json> [--body <text>] [--out <pm.json>]
 *   give    <work> --key <key.json> --re <head.pm.json> --to <pubkeyB64 | key.json> [--body] [--out]
 *   take    <work> --key <key.json> --re <give.pm.json> [--body] [--out]
 *   marker  <pm.json> [--out <marker.json>]
 *   verify  <pm.json> [--work <file>]
 *   thread  <pm.json>... [--work <file>]
 *   rule    <pm.json>... --floor <hash-linked|assumption-dependent> [--out <rule.json>]
 *   vault   init --vault <v> | put --vault <v> --work <file> <pm.json>... | get --vault <v> --work <file>
 *
 * Fully offline, like Player: this tool never records anything and never
 * touches the network. Recording a message or a marker — giving it a
 * causal position — happens through the ordinary BitGraph surfaces (the
 * drop, the Folder, the MCP). Passphrases come only from the
 * BITGRAPH_KEY_PASSPHRASE environment variable, never argv.
 *
 * Exit codes: 0 ok/valid, 1 invalid/refuted, 2 undeterminable, 3 error.
 * Diagnostics to stderr; produced bytes to stdout or --out.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { keyObjectFor } from "@mikeargento/bitgraph-player";
import { mintVersion } from "./version.js";
import { buildThread, ThreadError } from "./thread.js";
import { buildTitleRule } from "./titlerule.js";
import { keygen, loadKey, KeyFileError } from "./keysfile.js";
import { markerBytes } from "./marker.js";
import { checkPm, createPm, parsePm, PmError, sha256HexOf } from "./pm.js";
import type { PmKeyRef } from "./types.js";
import { initVault, vaultGet, vaultPut, VaultError } from "./vault.js";

function usage(): number {
  process.stderr.write(
    "usage: bitgraph-title mint <work> [--body <text>] [--out <version.json>]\n" +
      "       bitgraph-title keygen --out <key.json>\n" +
      "       bitgraph-title open <work> --key <key.json> [--body <text>] [--out <pm.json>]\n" +
      "       bitgraph-title give <work> --key <key.json> --re <head.pm.json> --to <pubkeyB64|key.json> [--body] [--out]\n" +
      "       bitgraph-title take <work> --key <key.json> --re <give.pm.json> [--body] [--out]\n" +
      "       bitgraph-title marker <pm.json> [--out <marker.json>]\n" +
      "       bitgraph-title verify <pm.json> [--work <file>]\n" +
      "       bitgraph-title thread <pm.json>... [--work <file>]\n" +
      "       bitgraph-title rule <pm.json>... --floor <tier> [--out <rule.json>]\n" +
      "       bitgraph-title vault init|put|get --vault <file> [--work <file>] [pm.json...]\n" +
      "  exit codes: 0 ok, 1 invalid, 2 undeterminable, 3 error\n" +
      "  recording is not this tool's job: give messages positions via the ordinary BitGraph surfaces\n"
  );
  return 3;
}

interface Parsed {
  positional: string[];
  options: Map<string, string>;
}

function parseArgs(argv: string[]): Parsed | undefined {
  const positional: string[] = [];
  const options = new Map<string, string>();
  let i = 0;
  let optionsEnded = false;
  while (i < argv.length) {
    const arg = argv[i] as string;
    if (!optionsEnded && arg === "--") {
      optionsEnded = true;
      i += 1;
      continue;
    }
    if (!optionsEnded && arg.startsWith("--")) {
      const name = arg.slice(2);
      const value = argv[i + 1];
      if (value === undefined) return undefined;
      options.set(name, value);
      i += 2;
      continue;
    }
    positional.push(arg);
    i += 1;
  }
  return { positional, options };
}

function emit(bytes: Uint8Array, outPath: string | undefined): void {
  if (outPath !== undefined) {
    writeFileSync(outPath, bytes, { flag: "wx" });
    process.stderr.write(`wrote ${outPath}\n`);
  } else {
    process.stdout.write(bytes);
  }
}

function readSigner(options: Map<string, string>): ReturnType<typeof loadKey> {
  const keyPath = options.get("key");
  if (keyPath === undefined) throw new KeyFileError("--key <key.json> is required");
  return loadKey(keyPath, process.env["BITGRAPH_KEY_PASSPHRASE"]);
}

function recipientOf(value: string): PmKeyRef {
  // A path to a key file, or inline key material: raw ed25519 base64,
  // or "es256:<spkiDerB64>". A give naming an undecodable recipient is
  // a dead end nobody could ever take, so this validates HARD: a
  // typo'd path or corrupt file must never silently become a "key".
  let ref: PmKeyRef | undefined;
  let readAsJson = false;
  try {
    const raw = JSON.parse(readFileSync(value, "utf8")) as {
      key?: string;
      alg?: string;
      publicKey?: string;
    };
    readAsJson = true;
    if (raw.key === "bitgraph-key/1" && raw.alg === "ed25519" && typeof raw.publicKey === "string") {
      ref = { alg: "ed25519", publicKey: raw.publicKey };
    } else {
      throw new KeyFileError(`--to: ${value} is a file but not a bitgraph-key/1 ed25519 key file`);
    }
  } catch (err) {
    if (err instanceof KeyFileError) throw err;
    if (readAsJson) throw err;
    // Not a readable file: treat as inline key material.
    ref = value.startsWith("es256:")
      ? { alg: "es256", publicKey: value.slice("es256:".length) }
      : { alg: "ed25519", publicKey: value };
  }
  if (keyObjectFor(ref) === undefined) {
    throw new KeyFileError(
      `--to is neither a readable bitgraph-key/1 file nor decodable key material ` +
        `(raw ed25519 base64, or "es256:<spkiDerB64>"): ${value}`
    );
  }
  return ref;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) return usage();
  const command = argv[0] as string;
  const parsed = parseArgs(argv.slice(1));
  if (parsed === undefined) return usage();
  const { positional, options } = parsed;
  const body = options.get("body");

  switch (command) {
    case "keygen": {
      const out = options.get("out");
      if (out === undefined) return usage();
      const passphrase = process.env["BITGRAPH_KEY_PASSPHRASE"];
      const publicKey = keygen(out, passphrase);
      // The warning gate must match keygen's own encryption predicate:
      // an EMPTY passphrase writes plaintext and must still warn.
      if (passphrase === undefined || passphrase.length === 0) {
        process.stderr.write(
          "warning: key written UNENCRYPTED" +
            (passphrase === "" ? " (BITGRAPH_KEY_PASSPHRASE was set but empty)" : "") +
            " (set BITGRAPH_KEY_PASSPHRASE to encrypt). " +
            "Never keep a key file in any folder that records things.\n"
        );
      }
      process.stderr.write(`wrote ${out}\n`);
      process.stdout.write(publicKey + "\n");
      return 0;
    }

    case "open":
    case "give":
    case "take": {
      const workPath = positional[0];
      if (workPath === undefined) return usage();
      const subjectBytes = readFileSync(workPath);
      const signer = readSigner(options);

      let re: string | undefined;
      let to: PmKeyRef | undefined;
      if (command === "open") {
        // The origin claim. Only-already-BitGraphed is a product rule the
        // recording surfaces enforce; authoring is possible offline and the
        // generated title rule demands the work's recording anyway.
      } else {
        const rePath = options.get("re");
        if (rePath === undefined) {
          process.stderr.write(`${command}: --re <predecessor pm.json> is required\n`);
          return 3;
        }
        const predBytes = readFileSync(rePath);
        const pred = parsePm(predBytes);
        re = `sha256:${sha256HexOf(predBytes)}`;
        if (command === "give") {
          const toValue = options.get("to");
          if (toValue === undefined) {
            process.stderr.write("give: --to <pubkeyB64|key.json> is required\n");
            return 3;
          }
          to = recipientOf(toValue);
        } else {
          if (pred.claim !== "give") {
            process.stderr.write(`take: the predecessor is a "${pred.claim}", not a give\n`);
            return 1;
          }
          const named = pred.to as PmKeyRef;
          if (named.alg !== signer.alg || named.publicKey !== signer.publicKey) {
            process.stderr.write(
              "take: the give does not name this key; the resulting take would be structurally invalid\n"
            );
            return 1;
          }
        }
      }

      const claim = command === "open" ? "held" : command;
      const input: Parameters<typeof createPm>[0] = { subjectBytes, claim, signer };
      if (re !== undefined) input.re = re;
      if (to !== undefined) input.to = to;
      if (body !== undefined) input.body = body;
      const { bytes } = createPm(input);
      emit(bytes, options.get("out"));
      if (command === "take") {
        // The marker that CONSUMES the handed-off head is the marker of
        // the give's predecessor (the file the give's `re` names): that
        // is the same object any future buyer offered a competing give
        // re: the same head will derive and look up. Recording the
        // GIVE's marker would protect nothing — only the same named
        // recipient could ever collide with it.
        const pred = parsePm(readFileSync(options.get("re") as string));
        const consumed = pred.re === undefined ? "(the give has no re: it replies to nothing)" : pred.re;
        process.stderr.write(
          "note: before relying on this take, derive the consumption marker of the head the give\n" +
            `replies to (${consumed}) with: bitgraph-title marker <that head's pm.json>\n` +
            "and record it via an ordinary drop. A fresh recording means this handoff was unclaimed;\n" +
            "a dedup hit means someone already consumed that head. Markers are discovery, never\n" +
            "validity: investigate a hit, never rely on a marker alone.\n"
        );
      }
      return 0;
    }

    case "mint": {
      // A VERSION: the holdable object of a recorded work. Bearer, keyless,
      // possession-gated: minting requires the work's full bytes.
      const workPath = positional[0];
      if (workPath === undefined) return usage();
      const workBytes = readFileSync(workPath);
      const input: Parameters<typeof mintVersion>[1] = {};
      if (body !== undefined) input.body = body;
      const { bytes } = mintVersion(workBytes, input);
      emit(bytes, options.get("out"));
      process.stderr.write(
        "note: record the version via an ordinary drop to give it its position; " +
          "keep the file — the version IS the salted bytes, and a lost file leaves a mute digest\n"
      );
      return 0;
    }

    case "marker": {
      const pmPath = positional[0];
      if (pmPath === undefined) return usage();
      const pmBytes = readFileSync(pmPath);
      parsePm(pmBytes);
      emit(markerBytes(sha256HexOf(pmBytes)), options.get("out"));
      return 0;
    }

    case "verify": {
      const pmPath = positional[0];
      if (pmPath === undefined) return usage();
      const pm = parsePm(readFileSync(pmPath));
      const workPath = options.get("work");
      const check = checkPm(pm, workPath !== undefined ? readFileSync(workPath) : undefined);
      const report = {
        structure: check.structure,
        signature: check.signature,
        possession: check.possession,
        issues: check.issues,
      };
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      if (!check.signature || check.possession === "refuted") return 1;
      if (check.possession === "unverifiable") return 2;
      return 0;
    }

    case "thread": {
      if (positional.length === 0) return usage();
      const files = positional.map((p) => new Uint8Array(readFileSync(p)));
      const workPath = options.get("work");
      const thread = buildThread(files, workPath !== undefined ? readFileSync(workPath) : undefined);
      const summary = {
        about: thread.about,
        links: thread.links.map((l) => ({
          sha256Hex: l.sha256Hex,
          claim: l.pm.claim,
          signer: `${l.pm.alg}:${l.pm.publicKey.slice(0, 12)}…`,
        })),
        head: thread.head.sha256Hex,
        holderKey: { alg: thread.holderKey.alg, publicKey: thread.holderKey.publicKey },
        issues: thread.issues,
      };
      process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
      return thread.issues.length === 0 ? 0 : 1;
    }

    case "rule": {
      if (positional.length === 0) return usage();
      const floor = options.get("floor");
      if (floor !== "hash-linked" && floor !== "assumption-dependent") {
        process.stderr.write("rule: --floor must be hash-linked or assumption-dependent (no default: the floor is your security policy)\n");
        return 3;
      }
      const files = positional.map((p) => new Uint8Array(readFileSync(p)));
      const thread = buildThread(files);
      if (thread.issues.length > 0) {
        process.stderr.write(`rule: the thread is not structurally clean:\n  ${thread.issues.join("\n  ")}\n`);
        return 1;
      }
      emit(Buffer.from(buildTitleRule(thread, { ordering: floor }), "utf8"), options.get("out"));
      return 0;
    }

    case "vault": {
      const sub = positional[0];
      const vaultPath = options.get("vault");
      if (vaultPath === undefined) return usage();
      if (sub === "init") {
        initVault(vaultPath);
        process.stderr.write(`wrote ${vaultPath}\n`);
        return 0;
      }
      const workPath = options.get("work");
      if (workPath === undefined) return usage();
      const subjectBytes = readFileSync(workPath);
      if (sub === "put") {
        const pmPaths = positional.slice(1);
        if (pmPaths.length === 0) return usage();
        for (const p of pmPaths) {
          const bytes = readFileSync(p);
          parsePm(bytes);
          vaultPut(vaultPath, subjectBytes, bytes);
        }
        process.stderr.write(`sealed ${pmPaths.length} message(s)\n`);
        return 0;
      }
      if (sub === "get") {
        const opened = vaultGet(vaultPath, subjectBytes);
        for (const bytes of opened) process.stdout.write(bytes);
        process.stderr.write(`opened ${opened.length} message(s)\n`);
        return opened.length > 0 ? 0 : 2;
      }
      return usage();
    }

    default:
      return usage();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    if (
      err instanceof PmError ||
      err instanceof ThreadError ||
      err instanceof KeyFileError ||
      err instanceof VaultError
    ) {
      process.stderr.write(`${(err as Error).message}\n`);
      process.exitCode = err instanceof PmError || err instanceof ThreadError ? 1 : 3;
      return;
    }
    process.stderr.write(`error: ${(err as Error).message}\n`);
    process.exitCode = 3;
  });
