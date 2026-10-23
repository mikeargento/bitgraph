/**
 * Hosted files (Mike, 2026-10-10, option 1 of the Ask Jev question): a proof link may carry
 * `?files=<https URL>`, and the proof page fetches the BitGraph file bundle served there (a ZIP: the
 * files, usually with the tree's export, bitgraph-export/1) and shows the files ONLY when they rebuild
 * the signed proof exactly. Generic: any host, no host named in code. Replaces the Jev-specific loader
 * of 2026-10-07, reverted the same evening (9fd3bab7).
 *
 * The host is trusted for nothing:
 * - The proof is the page's own (read from bitgraph.ing), never the bundle's; the export inside the
 *   bundle only SELECTS which files to try, and the verdict is the existing tree rebuild
 *   (rebuildTreeFromFiles, the dropped-folder path) against the signed root, or, for a single-file
 *   proof, the file's SHA-256 against the signed digest.
 * - Nothing about the proof's own checks reads anything fetched here.
 * - https only (http only between loopback hosts, for a local build); no cookies, no referrer;
 *   size cap, entry cap, timeout. fflate inflates into the size each entry declares, so a lying
 *   entry is cut short (then fails its hash), never grows memory past the cap.
 *
 * Explicit .ts specifiers so node's test runner loads it (src/lib/__tests__/hosted-files.test.ts).
 */
import { unzipSync } from "fflate";
import { base64ToBytes, bytesToBase64, decodeTreeLeaves } from "@mikeargento/bitgraph-verify";
import { readTreeExports } from "./folder-check.ts";
import { bindTree, isTreeTitled } from "./fuse-tree.ts";
import { rebuildTreeFromFiles, rebuildMatches } from "./fuse-tree-make.ts";

export const HOSTED_FILES_PARAM = "files";
/** The bundle as fetched (compressed). */
export const HOSTED_MAX_BYTES = 25 * 1024 * 1024;
/** Everything in it once inflated, by the sizes its entries declare. */
export const HOSTED_MAX_UNZIPPED_BYTES = 100 * 1024 * 1024;
export const HOSTED_MAX_ENTRIES = 1000;
export const HOSTED_TIMEOUT_MS = 15_000;

export type HostedProblem =
  | "bad-url" // not a URL at all
  | "not-https" // http, data:, javascript:, a URL with a user name or password
  | "not-listed" // https, but not a host this site reads files from
  | "unreachable" // network error, or CORS refused
  | "status" // the host answered, not 2xx
  | "too-large"
  | "timeout"
  | "not-zip"
  | "mismatch"; // fetched and read, but the files do not rebuild this proof

export interface HostedSource { url: string; host: string }

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The hosts a proof page reads files from (Mike, 2026-10-10: approved hosts only, for now; the mechanism stays generic,
 *  and a host joins by being added here). Without a list, anyone could show content they recorded under bitgraph.ing. */
export const HOSTED_FILE_HOSTS = new Set(["live.bitgraph.ing"]);

/**
 * The `files` parameter as a fetchable source, or why not. `pageHostname` is the page's own hostname:
 * plain http is allowed only when both the page and the bundle are on this machine (a local build).
 */
export function hostedSourceOf(raw: string | null, pageHostname: string): { ok: true; source: HostedSource } | { ok: false; problem: "bad-url" | "not-https" | "not-listed"; host: string | null } {
  if (raw === null || raw.trim() === "") return { ok: false, problem: "bad-url", host: null };
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, problem: "bad-url", host: null }; }
  const host = u.host || null;
  if (u.username || u.password) return { ok: false, problem: "not-https", host };
  const localHttp = u.protocol === "http:" && LOOPBACK.has(u.hostname) && LOOPBACK.has(pageHostname);
  if (u.protocol !== "https:" && !localHttp) return { ok: false, problem: "not-https", host };
  if (!u.hostname) return { ok: false, problem: "bad-url", host: null };
  if (!localHttp && !HOSTED_FILE_HOSTS.has(u.hostname)) return { ok: false, problem: "not-listed", host };
  return { ok: true, source: { url: u.toString(), host: u.host } };
}

/** The bundle's bytes, or why not. The host named is the one that actually answered (after redirects). */
export async function fetchHostedBundle(
  source: HostedSource,
  opts: { fetchImpl?: typeof fetch; maxBytes?: number; timeoutMs?: number } = {},
): Promise<{ ok: true; bytes: Uint8Array; host: string } | { ok: false; problem: HostedProblem; host: string; status?: number }> {
  const max = opts.maxBytes ?? HOSTED_MAX_BYTES;
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, opts.timeoutMs ?? HOSTED_TIMEOUT_MS);
  let host = source.host;
  try {
    let res: Response;
    try {
      res = await (opts.fetchImpl ?? fetch)(source.url, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", signal: ctl.signal });
    } catch {
      return { ok: false, problem: timedOut ? "timeout" : "unreachable", host };
    }
    try { if (res.url) host = new URL(res.url).host || host; } catch { /* keep the asked host */ }
    if (!res.ok) { ctl.abort(); return { ok: false, problem: "status", host, status: res.status }; }
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > max) { ctl.abort(); return { ok: false, problem: "too-large", host }; }
    if (!res.body) {
      const buf = new Uint8Array(await res.arrayBuffer());
      return buf.byteLength > max ? { ok: false, problem: "too-large", host } : { ok: true, bytes: buf, host };
    }
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > max) { ctl.abort(); return { ok: false, problem: "too-large", host }; }
        parts.push(value);
      }
    } catch {
      return { ok: false, problem: timedOut ? "timeout" : "unreachable", host };
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const p of parts) { bytes.set(p, at); at += p.byteLength; }
    return { ok: true, bytes, host };
  } finally {
    clearTimeout(timer);
  }
}

export interface HostedFile { name: string; bytes: Uint8Array }

/** The ZIP's files (folders, macOS resource forks and .DS_Store left out), or null when it is not a ZIP within the caps. */
export function unzipHostedBundle(bytes: Uint8Array, caps: { maxEntries?: number; maxUnzipped?: number } = {}): HostedFile[] | null {
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null;
  const maxEntries = caps.maxEntries ?? HOSTED_MAX_ENTRIES;
  const maxUnzipped = caps.maxUnzipped ?? HOSTED_MAX_UNZIPPED_BYTES;
  let entries = 0, declared = 0, over = false;
  let out: Record<string, Uint8Array>;
  try {
    out = unzipSync(bytes, {
      filter: (f) => {
        if (f.name.endsWith("/") || /(^|\/)__MACOSX\//.test(f.name) || /(^|\/)\.DS_Store$/.test(f.name)) return false;
        entries += 1; declared += f.originalSize;
        if (entries > maxEntries || declared > maxUnzipped) { over = true; return false; }
        return true;
      },
    });
  } catch { return null; }
  if (over) return null;
  return Object.entries(out).map(([name, b]) => ({ name, bytes: b }));
}

async function sha256B64(bytes: Uint8Array): Promise<string> {
  return bytesToBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer)));
}

export type HostedMatch =
  | { ok: true; kind: "tree" | "file"; members: HostedFile[]; extras: string[] }
  | { ok: false; problem: "mismatch" };

/**
 * The bundle's files against the page's proof. A tree/1 proof: the files must rebuild its signed root
 * (count and root, the dropped-folder check). Files that are not in the tree (a README, the spec, the
 * export itself) are set aside by the bundle's own export when it carries the tree's leaves, or, with
 * no export, by being the export or the spec the proof pins; the rebuild alone decides. Any other proof:
 * a file whose SHA-256 is the signed digest.
 */
export async function matchHostedFiles(proof: unknown, files: readonly HostedFile[]): Promise<HostedMatch> {
  const p = proof as { artifact?: { digestB64?: string }; attribution?: { message?: string } } | null;
  const signed = p?.artifact?.digestB64;
  if (!signed || files.length === 0) return { ok: false, problem: "mismatch" };
  const digests = new Map<HostedFile, string>();
  for (const f of files) digests.set(f, await sha256B64(f.bytes));
  const extrasOf = (members: readonly HostedFile[]) => files.filter((f) => !members.includes(f)).map((f) => f.name);

  if (!isTreeTitled(p as never)) {
    const hit = files.find((f) => digests.get(f) === signed);
    return hit ? { ok: true, kind: "file", members: [hit], extras: extrasOf([hit]) } : { ok: false, problem: "mismatch" };
  }

  const bound = bindTree(proof);
  if (!bound.ok) return { ok: false, problem: "mismatch" };
  const asFile = new Map<File, HostedFile>();
  const fileList = files.map((f) => { const file = new File([f.bytes.slice()], f.name.split("/").pop() || f.name, { type: /\.json$/i.test(f.name) ? "application/json" : "" }); asFile.set(file, f); return file; });
  const { exports, rest } = await readTreeExports(fileList);
  const restHosted = rest.map((f) => asFile.get(f)!);

  // The leaves the bundle's own export lists for THIS proof (a selector only: the rebuild decides).
  const listed = new Set<string>();
  for (const e of exports) {
    if (e.exp.proof?.artifact?.digestB64 !== signed || typeof e.exp.tree?.leaves !== "string") continue;
    const raw = base64ToBytes(e.exp.tree.leaves);
    const leaves = raw === null ? null : decodeTreeLeaves(raw);
    for (const l of leaves ?? []) { listed.add(bytesToBase64(l.artifact)); listed.add(bytesToBase64(l.origin)); }
  }
  const spec = p?.attribution?.message ?? null;
  const tries: HostedFile[][] = [];
  const add = (set: HostedFile[]) => {
    if (set.length < bound.tree.count) return;
    if (tries.some((t) => t.length === set.length && t.every((f, i) => f === set[i]))) return;
    tries.push(set);
  };
  if (listed.size > 0) add(restHosted.filter((f) => listed.has(digests.get(f)!)));
  add(restHosted);
  if (spec) add(restHosted.filter((f) => digests.get(f) !== spec));

  for (const set of tries) {
    const r = await rebuildTreeFromFiles(set.map((f) => new File([f.bytes.slice()], f.name)), bound.tree.commitment);
    if (rebuildMatches(r.placed, bound.tree) || rebuildMatches(r.asIs, bound.tree)) {
      return { ok: true, kind: "tree", members: set, extras: extrasOf(set) };
    }
  }
  return { ok: false, problem: "mismatch" };
}
