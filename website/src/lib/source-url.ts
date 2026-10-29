// Copyright (c) Argento Computing Inc. All rights reserved. See LICENSE.

/**
 * A hosted original (app/api/sources): where the holder keeps the exact file, so anyone who finds the record can fetch
 * the bytes and run the proof. The link is never trusted; the bytes are. Everything here serves that one rule: a link
 * is admitted only when what it serves hashes to the bound digest, and a download is hashed on the way through.
 *
 * Share links are rewritten to the address that serves the file itself (Drive, Dropbox, OneDrive, GitHub), so a person
 * pastes whatever they have. Hosts on private networks are refused at every hop, so the check cannot be pointed at our
 * own network. Signed links expire, so they are refused with a reason.
 */

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** The largest original fetched and hashed here; larger files wait for an integration. */
export const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const HOPS = 5;
const UA = "BitGraph source check (+https://bitgraph.ing)";

export type Rewritten = { url: string; host: string };
export type SourceError = { ok: false; error: string };

const SIGNED = ["x-amz-signature", "x-amz-expires", "x-goog-signature", "signature", "expires", "sig", "se", "token"];

/** The address that serves the file, from whatever share link was pasted, with the host to credit. */
export function rewriteShareLink(raw: string): Rewritten | SourceError {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return { ok: false, error: "That is not a web address." }; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "Only http and https links can be checked." };
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  for (const k of u.searchParams.keys()) if (SIGNED.includes(k.toLowerCase())) return { ok: false, error: "This link expires (it is a signed address). Use a permanent link to the file." };
  if (host === "drive.google.com" || host === "docs.google.com") {
    const id = /\/file\/d\/([^/?#]+)/.exec(u.pathname)?.[1] ?? u.searchParams.get("id");
    if (!id || host === "docs.google.com") return { ok: false, error: "That is a Google Docs page, not a file. Share the file itself as “anyone with the link”." };
    return { url: `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`, host: "drive.google.com" };
  }
  if (host === "dropbox.com") { u.searchParams.set("dl", "1"); return { url: u.toString(), host }; }
  if (host === "onedrive.live.com" && /\/redir$/i.test(u.pathname)) { u.pathname = u.pathname.replace(/redir$/i, "download"); return { url: u.toString(), host }; }
  if (host === "github.com") {
    const m = /^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/.exec(u.pathname);
    if (m) return { url: `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`, host };
  }
  return { url: u.toString(), host };
}

function privateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80")) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  return mapped ? privateIp(mapped[1]!) : false;
}

/** Refuses hosts that resolve to private or local addresses: the check fetches only from the public internet. */
async function assertPublic(hostname: string) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) throw new Error("That host is not on the public internet.");
  const addrs = isIP(h) ? [{ address: h }] : await lookup(h, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error("That host could not be found.");
  if (addrs.some((a) => privateIp(a.address))) throw new Error("That host is not on the public internet.");
}

/** Opens the address, following up to five redirects, each hop rewritten and checked. Returns the final response. */
export async function openSource(startUrl: string): Promise<{ ok: true; res: Response; host: string } | SourceError> {
  let url = startUrl, host = "";
  for (let hop = 0; hop < HOPS; hop++) {
    const r = rewriteShareLink(url);
    if ("error" in r) return r;
    url = r.url; host = host || r.host;
    try { await assertPublic(new URL(url).hostname); } catch (e) { return { ok: false, error: (e as Error).message }; }
    let res: Response;
    try { res = await fetch(url, { redirect: "manual", headers: { "user-agent": UA, accept: "*/*" }, signal: AbortSignal.timeout(50_000) }); }
    catch { return { ok: false, error: "The host did not answer." }; }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      try { url = new URL(res.headers.get("location")!, url).toString(); } catch { return { ok: false, error: "The host sent a redirect that could not be followed." }; }
      await res.body?.cancel().catch(() => {});
      continue;
    }
    if (res.status === 401 || res.status === 403) { await res.body?.cancel().catch(() => {}); return { ok: false, error: "The host wants a login. Share the file as “anyone with the link”." }; }
    if (res.status === 404) { await res.body?.cancel().catch(() => {}); return { ok: false, error: "Nothing is at that address (404)." }; }
    if (!res.ok) { await res.body?.cancel().catch(() => {}); return { ok: false, error: `The host answered ${res.status}.` }; }
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (type.startsWith("text/html")) { await res.body?.cancel().catch(() => {}); return { ok: false, error: "That address serves a web page, not the file. Use a link to the file itself." }; }
    const len = Number(res.headers.get("content-length"));
    if (Number.isFinite(len) && len > MAX_SOURCE_BYTES) { await res.body?.cancel().catch(() => {}); return { ok: false, error: "Larger than 100 MB; files that size are not checked here yet." }; }
    if (!res.body) return { ok: false, error: "The host sent no file." };
    return { ok: true, res, host };
  }
  return { ok: false, error: "Too many redirects." };
}

/** Fetches the address and hashes what it serves. */
export async function fetchAndHash(url: string): Promise<{ ok: true; digestB64: string; bytes: number; contentType: string | null; host: string } | SourceError> {
  const o = await openSource(url);
  if (!o.ok) return o;
  const hash = createHash("sha256");
  let bytes = 0;
  const reader = o.res.body!.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_SOURCE_BYTES) { await reader.cancel().catch(() => {}); return { ok: false, error: "Larger than 100 MB; files that size are not checked here yet." }; }
    hash.update(value);
  }
  return { ok: true, digestB64: hash.digest("base64"), bytes, contentType: o.res.headers.get("content-type"), host: o.host };
}
