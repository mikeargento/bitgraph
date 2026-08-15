// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * Browser stand-in for `node:fs`, `node:fs/promises`, `node:path`, and
 * `node:zlib`. bitgraph-audit imports these at module top for its
 * directory and archive ingest and its bundle export, none of which the
 * browser page calls: it ingests through ingestEntries(), which is
 * filesystem-free. Every export here throws if reached, so a code path
 * that did touch the filesystem would fail loudly rather than silently
 * return nothing.
 */

function unavailable(name: string): () => never {
  return () => {
    throw new Error(`${name} is not available in the browser verifier`);
  };
}

export const createReadStream = unavailable("fs.createReadStream");
export const readFileSync = unavailable("fs.readFileSync");
export const existsSync = unavailable("fs.existsSync");
export const writeFileSync = unavailable("fs.writeFileSync");
export const open = unavailable("fs.open");
export const readdir = unavailable("fs.readdir");
export const readFile = unavailable("fs.readFile");
export const stat = unavailable("fs.stat");
export const mkdir = unavailable("fs.mkdir");
export const writeFile = unavailable("fs.writeFile");
export const join = unavailable("path.join");
export const basename = unavailable("path.basename");
export const createGunzip = unavailable("zlib.createGunzip");
export const gzipSync = unavailable("zlib.gzipSync");
export default {};
