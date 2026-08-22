// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * The pin store, and the fetch behind `bitgraph-play pin`: the ONLY code
 * in this package that touches the network, and only when the reader
 * invokes it. A pin is the reader's act and the reader's record: the
 * domain's file is stored byte-verbatim on the reader's machine, and
 * `check --from` reads the store and never fetches. A missing pin is an
 * invocation error with the pin command as its remedy, never a verdict,
 * and a stored pin outlives the file that provided it, deliberately.
 */

import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DomainFile } from "./domain.js";
import { DOMAIN_FILE_MAX_BYTES, DOMAIN_WELL_KNOWN_PATH, isDomainName, parseDomainFile } from "./domain.js";

/** ~/.bitgraph/pins, or BITGRAPH_PINS, or the --pins flag above this. */
export function defaultPinsDir(): string {
  const env = process.env["BITGRAPH_PINS"];
  return env !== undefined && env.length > 0 ? env : join(homedir(), ".bitgraph", "pins");
}

function pinPath(pinsDir: string, domain: string): string {
  if (!isDomainName(domain)) throw new Error(`not a domain name: ${domain}`);
  // The domain grammar admits no path separators, so the name is the file.
  return join(pinsDir, domain);
}

export interface StoredPin {
  domain: string;
  file: DomainFile;
  bytes: Buffer;
  pinnedAt: Date;
}

/**
 * Read one stored pin. Undefined when no pin exists; throws
 * DomainFileError when the stored bytes no longer parse (the remedy is to
 * pin again, or --forget).
 */
export function readPin(domain: string, pinsDir: string = defaultPinsDir()): StoredPin | undefined {
  const path = pinPath(pinsDir, domain);
  let bytes: Buffer;
  let pinnedAt: Date;
  try {
    bytes = readFileSync(path);
    pinnedAt = statSync(path).mtime;
  } catch {
    return undefined;
  }
  const file = parseDomainFile(bytes, domain);
  return { domain, file, bytes, pinnedAt };
}

/** Store the fetched bytes verbatim. Overwrites: a pin is current by choice. */
export function writePin(domain: string, bytes: Uint8Array, pinsDir: string = defaultPinsDir()): string {
  const path = pinPath(pinsDir, domain);
  mkdirSync(pinsDir, { recursive: true });
  writeFileSync(path, bytes);
  return path;
}

/** Remove one pin. False when there was none. */
export function forgetPin(domain: string, pinsDir: string = defaultPinsDir()): boolean {
  try {
    unlinkSync(pinPath(pinsDir, domain));
    return true;
  } catch {
    return false;
  }
}

export interface PinListEntry {
  domain: string;
  /** Undefined when the stored bytes no longer parse. */
  party?: string;
  keyCount?: number;
  pinnedAt: Date;
  malformed: boolean;
}

/** Every stored pin, domain order. Malformed entries are listed, flagged. */
export function listPins(pinsDir: string = defaultPinsDir()): PinListEntry[] {
  let names: string[];
  try {
    names = readdirSync(pinsDir);
  } catch {
    return [];
  }
  const entries: PinListEntry[] = [];
  for (const name of names.sort()) {
    if (!isDomainName(name)) continue;
    try {
      const pin = readPin(name, pinsDir);
      if (pin === undefined) continue;
      entries.push({
        domain: name,
        party: pin.file.party,
        keyCount: Object.keys(pin.file.keys).length,
        pinnedAt: pin.pinnedAt,
        malformed: false,
      });
    } catch {
      entries.push({ domain: name, pinnedAt: statSync(join(pinsDir, name)).mtime, malformed: true });
    }
  }
  return entries;
}

/** The slice of fetch() this module uses; injectable for tests. */
export interface FetchLike {
  (url: string, init?: { signal?: AbortSignal; redirect?: "follow" }): Promise<{
    ok: boolean;
    status: number;
    headers: { get(name: string): string | null };
    arrayBuffer(): Promise<ArrayBuffer>;
  }>;
}

/**
 * Fetch a domain's bitgraph-domain/1 file: one HTTPS GET of the fixed
 * well-known path. Redirects are followed, but the file's own `domain`
 * field must equal the requested domain (parseDomainFile enforces it), so
 * a redirect cannot repoint the name. Throws on any failure; a malformed
 * file is refused here and never stored.
 */
export async function fetchDomainFile(
  domain: string,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike
): Promise<{ bytes: Buffer; file: DomainFile }> {
  if (!isDomainName(domain)) {
    const hint = domain.includes("://") ? " (pass the bare hostname, without scheme or path)" : "";
    throw new Error(`not a domain name: ${domain}${hint}`);
  }
  const url = `https://${domain}${DOMAIN_WELL_KNOWN_PATH}`;
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000), redirect: "follow" });
  } catch (err) {
    throw new Error(`cannot fetch ${url}: ${(err as Error).message}`);
  }
  if (!res.ok) throw new Error(`no domain file at ${url} (HTTP ${res.status})`);
  const declared = res.headers.get("content-length");
  if (declared !== null && Number(declared) > DOMAIN_FILE_MAX_BYTES) {
    throw new Error(`the file at ${url} declares ${declared} bytes; the cap is ${DOMAIN_FILE_MAX_BYTES}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > DOMAIN_FILE_MAX_BYTES) {
    throw new Error(`the file at ${url} is ${bytes.length} bytes; the cap is ${DOMAIN_FILE_MAX_BYTES}`);
  }
  const file = parseDomainFile(bytes, domain);
  return { bytes, file };
}
