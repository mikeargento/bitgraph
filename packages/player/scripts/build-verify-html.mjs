#!/usr/bin/env node
// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Build verify.html: one self-contained page that runs `bitgraph-play
 * check` in a browser, offline.
 *
 *   node scripts/build-verify-html.mjs [--out <file>]...
 *
 * Bundles web/verify-page.ts with esbuild (platform: browser) together with
 * the SAME @mikeargento/bitgraph-audit and @mikeargento/bitgraph-verify the
 * CLI runs, and inlines the result into web/template.html. Node built-ins
 * the audit and verify packages import at module top are resolved to
 * browser stand-ins (web/shims): node:crypto to WebCrypto plus noble
 * hashes, and node:fs / node:path / node:zlib to loud stubs that the
 * in-memory ingest path never reaches. Buffer is injected from the
 * `buffer` package because verify and audit spell base64/hex through it.
 *
 * Default output: dist-web/verify.html. Every --out receives a copy.
 * The build stamps nothing time-dependent; two builds from the same
 * sources are byte-identical, so a shipped verify.html can be checked
 * against a rebuild.
 */

import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const outs = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--out") outs.push(resolve(argv[++i]));
}
const defaultOut = resolve(pkgRoot, "dist-web", "verify.html");

const shim = (name) => resolve(pkgRoot, "web", "shims", name);

/** Route every node: import to a browser stand-in. */
const nodeShims = {
  name: "node-shims",
  setup(b) {
    b.onResolve({ filter: /^node:crypto$/ }, () => ({ path: shim("node-crypto.ts") }));
    b.onResolve({ filter: /^node:(fs|fs\/promises|path|zlib|stream\/promises)$/ }, () => ({
      path: shim("node-empty.ts"),
    }));
    // The bare names too, in case a dependency spells them without the scheme.
    b.onResolve({ filter: /^(fs|path|zlib|crypto)$/ }, (args) => ({
      path: args.path === "crypto" ? shim("node-crypto.ts") : shim("node-empty.ts"),
    }));
  },
};

const result = await build({
  entryPoints: [resolve(pkgRoot, "web", "verify-page.ts")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  target: ["es2022"],
  minify: true,
  legalComments: "none",
  sourcemap: false,
  logLevel: "warning",
  plugins: [nodeShims],
  inject: [resolve(pkgRoot, "web", "shims", "buffer-global.js")],
  define: { "process.env.NODE_ENV": '"production"' },
});

const js = result.outputFiles[0].text;
// Inlined into <script>: a literal "</script>" inside the JS would end the
// element early, so escape the sequence (only strings/comments could hold it).
const safeJs = js.replace(/<\/script/gi, "<\\/script");
const template = readFileSync(resolve(pkgRoot, "web", "template.html"), "utf8");
if (!template.includes("/*__BUNDLE__*/")) throw new Error("template.html lacks the /*__BUNDLE__*/ marker");
const html = template.replace("/*__BUNDLE__*/", () => safeJs);

mkdirSync(dirname(defaultOut), { recursive: true });
writeFileSync(defaultOut, html);
for (const out of outs) {
  mkdirSync(dirname(out), { recursive: true });
  copyFileSync(defaultOut, out);
}
const kb = (html.length / 1024).toFixed(0);
process.stderr.write(`verify.html: ${kb} KB -> ${defaultOut}${outs.length ? ` (+${outs.length} cop${outs.length === 1 ? "y" : "ies"})` : ""}\n`);
