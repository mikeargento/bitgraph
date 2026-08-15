// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * verify.html: the offline, drag-and-drop face of `bitgraph-play check`.
 *
 * One self-contained page. Drop a BitGraph export (a recording folder, or
 * a proof.json beside the file it records) and it renders the same
 * bitgraph-check/1 report the CLI prints, computed by the same code:
 * this file is a thin DOM front over ingestEntries() and checkIngest(),
 * bundled together with bitgraph-audit and bitgraph-verify. Nothing
 * leaves the page: no network request is made, no file is uploaded, and
 * it runs from a file:// URL with the machine offline.
 *
 * Trust posture, stated on the page too: this verifier is code, and code
 * came from somewhere. It ships inside the BitGraph Folder installer and
 * at bitgraph.ing/verify.html; the same check runs from npm as
 * `bitgraph-play check`. A reader who cares can compare copies or run
 * the CLI. What the page proves is exactly what the CLI proves, and the
 * report says what it cannot.
 */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2";
import { ingestEntries } from "@mikeargento/bitgraph-audit";
import type { BundleEntrySource } from "@mikeargento/bitgraph-audit";
import { checkIngest } from "../src/check.js";
import type { CheckAnchor, CheckLine, CheckRecording, CheckReport } from "../src/check.js";
import type { ThreeValued } from "../src/types.js";

// Ed25519 hashing on pure JS regardless of context: noble/ed25519 reaches
// for crypto.subtle by default, which a non-secure context lacks; sha512
// from noble/hashes is identical in result and always present.
ed.etc.sha512Async = async (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

const webCryptoAvailable = typeof globalThis.crypto !== "undefined" && globalThis.crypto.subtle !== undefined;

// ---------------------------------------------------------------------------
// Reading what was dropped
// ---------------------------------------------------------------------------

interface DroppedFile {
  /** Path relative to the drop, forward slashes. */
  path: string;
  file: File;
}

/** Walk a dropped directory entry (WebKit entries API). */
function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  // readEntries returns in batches; call until an empty batch.
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const step = (): void => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all);
          return;
        }
        all.push(...batch);
        step();
      }, reject);
    };
    step();
  });
}

function fileOfEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walkEntry(entry: FileSystemEntry, prefix: string, out: DroppedFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await fileOfEntry(entry as FileSystemFileEntry);
    out.push({ path: prefix + entry.name, file });
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children = await readAllEntries(reader);
    for (const child of children) {
      // Skip macOS metadata that a Finder drop can carry along.
      if (child.name === ".DS_Store") continue;
      await walkEntry(child, `${prefix}${entry.name}/`, out);
    }
  }
}

/**
 * Collect files from a drop. A single dropped folder is read as the bundle
 * root (its own name stripped, so paths read "proof.json" and
 * "ethereum-anchors/…" exactly as the CLI reports them for that folder);
 * several dropped items keep their names as top-level directories.
 */
async function filesFromDrop(dt: DataTransfer): Promise<DroppedFile[]> {
  const items = Array.from(dt.items ?? []);
  const entries = items
    .map((item) => (typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => e !== null);

  if (entries.length === 0) {
    // No entries API: plain files only.
    return Array.from(dt.files ?? []).map((file) => ({ path: file.name, file }));
  }

  const out: DroppedFile[] = [];
  if (entries.length === 1 && entries[0] !== undefined && entries[0].isDirectory) {
    const root = entries[0] as FileSystemDirectoryEntry;
    for (const child of await readAllEntries(root.createReader())) {
      if (child.name === ".DS_Store") continue;
      await walkEntry(child, "", out);
    }
    return out;
  }
  for (const entry of entries) await walkEntry(entry, "", out);
  return out;
}

/** Files chosen through an <input type=file>, with or without webkitdirectory. */
function filesFromInput(input: HTMLInputElement): DroppedFile[] {
  const files = Array.from(input.files ?? []);
  const rels = files.map((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name);
  // A folder pick prefixes every path with the folder's name; strip it so
  // the paths match a drop of the same folder.
  const firstSlash = rels.map((r) => r.indexOf("/"));
  const common = rels.length > 0 && firstSlash.every((i) => i > 0) ? rels[0]!.slice(0, firstSlash[0]!) : undefined;
  const stripAll = common !== undefined && rels.every((r) => r.startsWith(`${common}/`));
  return files
    .map((file, i) => ({ path: stripAll ? rels[i]!.slice(common.length + 1) : rels[i]!, file }))
    .filter((d) => !d.path.endsWith("/.DS_Store") && d.path !== ".DS_Store");
}

function toEntries(dropped: DroppedFile[]): BundleEntrySource[] {
  return dropped.map((d) => ({
    path: d.path,
    open: () => d.file.arrayBuffer().then((b) => new Uint8Array(b)),
  }));
}

// ---------------------------------------------------------------------------
// Rendering: the proof page's grammar. A page title, one primary card that
// carries the essentials, then openers (collapsible cards) for the checks,
// each Ethereum bound, notes, what is not checked, and the raw report.
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: Array<Node | string> = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) node.append(typeof child === "string" ? document.createTextNode(child) : child);
  return node;
}

function markEl(r: ThreeValued): HTMLElement {
  const cls = r === "TRUE" ? "mark true" : r === "FALSE" ? "mark false" : "mark undet";
  return el("span", { class: cls }, [r]);
}

/** A field row: label above value, like the proof page's Field. */
function field(label: string, value: string, opts: { mono?: boolean; mark?: ThreeValued } = {}): HTMLElement {
  const head = el("div", { class: "field-head" }, [el("span", { class: "field-label" }, [label])]);
  if (opts.mark !== undefined) head.append(markEl(opts.mark));
  return el("div", { class: "field" }, [head, el("span", { class: opts.mono ? "field-value mono" : "field-value" }, [value])]);
}

/** A collapsible card with the proof page's header affordance. */
function opener(title: string, body: HTMLElement[], opts: { open?: boolean; tone?: "danger" } = {}): HTMLElement {
  let open = opts.open === true;
  const chev = el("span", { class: "chev", "aria-hidden": "true" });
  chev.innerHTML =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="square" stroke-linejoin="miter"><path d="M9 6 L15 12 L9 18"/></svg>';
  const head = el("button", { class: `opener-head${opts.tone === "danger" ? " danger" : ""}`, type: "button", "aria-expanded": String(open) }, [
    el("span", {}, [title]),
    chev,
  ]);
  const content = el("div", { class: "opener-body" }, body);
  const card = el("section", { class: "card" }, [head, content]);
  const apply = (): void => {
    head.classList.toggle("open", open);
    head.setAttribute("aria-expanded", String(open));
    content.hidden = !open;
    chev.classList.toggle("open", open);
  };
  head.addEventListener("click", () => {
    open = !open;
    apply();
  });
  apply();
  return card;
}

function pageTitleFor(result: ThreeValued): string {
  return result === "TRUE" ? "BitGraph Verified" : result === "FALSE" ? "Verification Failed" : "Not Fully Verified";
}

function positionText(x: { counter?: string; epochId?: string }): string {
  const parts: string[] = [];
  if (x.counter !== undefined) parts.push(`position ${x.counter}`);
  if (x.epochId !== undefined) parts.push(`epoch ${x.epochId}`);
  return parts.join("  ·  ");
}

function boundsText(rec: CheckRecording): string {
  const b = rec.bounds;
  if (b.status === "unanchored") return "no verified Ethereum anchor in this bundle";
  const parts: string[] = [];
  if (b.notBefore !== undefined) parts.push(`after block ${b.notBefore.blockNumber ?? b.notBefore.blockHash}`);
  if (b.notAfter !== undefined) parts.push(`before block ${b.notAfter.blockNumber ?? b.notAfter.blockHash}`);
  const weaker = (b.notBefore?.weaker ?? false) || (b.notAfter?.weaker ?? false);
  return `${parts.join(", ")} (headers verified in this bundle${weaker ? "; ordered by counter position within the epoch" : ""})`;
}

/** The essentials of one recording, as fields. */
function recordingFields(rec: CheckRecording): HTMLElement[] {
  const fileLine = rec.lines.find((l) => l.name === "file");
  return [
    field("File", rec.filePath ?? "not in this bundle", { ...(fileLine !== undefined ? { mark: fileLine.result } : {}) }),
    field("Recorded", positionText(rec) || "no causal position", { mono: true }),
    field("Ethereum bounds", boundsText(rec)),
    field("File Hash", rec.digestB64, { mono: true }),
  ];
}

/** The four checks of one recording, as marked fields. */
function recordingChecks(rec: CheckRecording): HTMLElement[] {
  const label: Record<string, string> = {
    file: "File",
    signature: "Signature",
    attestation: "Hardware Enclave attestation",
    enclave: "Enclave identity",
    witness: "Block header",
    contradiction: "Contradiction",
  };
  return rec.lines.map((l) => field(label[l.name] ?? l.name, l.detail, { mark: l.result }));
}

function anchorOpener(a: CheckAnchor, side: "before" | "after" | "other", index: number): HTMLElement {
  const title =
    side === "before" ? "Recorded after this block" : side === "after" ? "Recorded before this block" : `Ethereum anchor ${index + 1}`;
  const body: HTMLElement[] = [];
  if (a.blockNumber !== undefined) body.push(field("Ethereum block", a.blockNumber, { mono: true }));
  if (a.blockHash !== undefined) body.push(field("Block hash", a.blockHash, { mono: true }));
  body.push(field("Anchor position", positionText(a) || "no causal position", { mono: true }));
  for (const l of a.lines) {
    body.push(field(l.name === "witness" ? "Block header" : "Anchor signature", l.detail, { mark: l.result }));
  }
  if (a.witnessPath === undefined) {
    body.push(field("Block header", "no block-header witness in this bundle, so this anchor's block hash is not verified here and it bounds nothing"));
  }
  return opener(`${title}  ${a.result === "TRUE" ? "" : `[${a.result}]`}`.trim(), body);
}

function renderReport(report: CheckReport, root: HTMLElement, titleEl: HTMLElement): void {
  root.replaceChildren();
  titleEl.textContent = pageTitleFor(report.result);

  const one = report.recordings.length === 1 ? report.recordings[0] : undefined;

  // Primary card: the summary line, then the essentials of the recording
  // (or the list of recordings when there are several).
  const primary = el("section", { class: "card primary" }, [
    el("div", { class: `summary ${report.result.toLowerCase()}` }, [report.summary]),
  ]);
  if (one !== undefined) {
    for (const f of recordingFields(one)) primary.append(f);
  } else if (report.recordings.length > 1) {
    for (const rec of report.recordings) {
      primary.append(field(rec.filePath ?? `Recording (${rec.digestB64.slice(0, 12)}…)`, positionText(rec) || "no causal position", { mono: true, mark: rec.result }));
    }
  } else {
    primary.append(field("Recordings", "no recordings in this bundle"));
  }
  root.append(primary);

  // Openers.
  if (one !== undefined) {
    const passed = one.lines.filter((l) => l.result === "TRUE").length;
    root.append(opener(`Recording checks  ${passed} of ${one.lines.length} TRUE`, recordingChecks(one), { open: report.result !== "TRUE" }));
  } else {
    report.recordings.forEach((rec, i) => {
      root.append(
        opener(`Recording ${i + 1}: ${rec.filePath ?? rec.digestB64.slice(0, 16) + "…"}  [${rec.result}]`, [
          ...recordingFields(rec),
          ...recordingChecks(rec),
        ], { open: rec.result !== "TRUE" })
      );
    });
  }

  // Ethereum bounds: one opener per anchor, titled the way the proof page
  // titles its bounding blocks when the anchor is a bound of the (single)
  // recording; plain "Ethereum anchor n" otherwise.
  report.anchors.forEach((a, i) => {
    let side: "before" | "after" | "other" = "other";
    if (one !== undefined) {
      if (one.bounds.notBefore?.anchorProofHash === a.proofHash) side = "before";
      else if (one.bounds.notAfter?.anchorProofHash === a.proofHash) side = "after";
    }
    root.append(anchorOpener(a, side, i));
  });

  if (report.contradictions.length > 0) {
    root.append(
      opener(`Contradictions  ${report.contradictions.length}`, report.contradictions.map((c) => field("FALSE", c.detail, { mark: "FALSE" })), { open: true, tone: "danger" })
    );
  }
  if (report.notes.length > 0) {
    root.append(opener(`Notes  ${report.notes.length}`, [el("ul", { class: "list" }, report.notes.map((t) => el("li", {}, [t])))]));
  }
  root.append(opener("Not checked", [el("ul", { class: "list" }, report.notChecked.map((t) => el("li", {}, [t])))]));
  root.append(opener("Report JSON", [el("pre", { class: "json" }, [JSON.stringify(report, null, 2)])]));

  // The link under the results, in the slot the home page gives its example
  // link: same class, same voice.
  const more = document.getElementById("more") as HTMLElement;
  more.replaceChildren(); // the download link gives way to "Check another"
  const again = el("a", { class: "bg-arrow-link", href: "#" }, ["Check another BitGraph ", el("span", { class: "arrow", "aria-hidden": "true" }, ["→"])]);
  again.addEventListener("click", (e) => {
    e.preventDefault();
    location.reload();
  });
  more.append(again);
  more.hidden = false;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

async function run(dropped: DroppedFile[]): Promise<void> {
  const zone = document.getElementById("drop") as HTMLElement;
  const results = document.getElementById("results") as HTMLElement;
  const status = document.getElementById("status") as HTMLElement;
  if (dropped.length === 0) {
    status.textContent = "Nothing readable was dropped.";
    return;
  }
  zone.classList.add("busy");
  status.textContent = `Checking ${dropped.length} file${dropped.length === 1 ? "" : "s"}…`;
  try {
    const ingest = await ingestEntries(toEntries(dropped), { label: "dropped" });
    const report = await checkIngest(ingest, { webCryptoAvailable });
    (document.getElementById("camera") as HTMLElement).hidden = true;
    (document.getElementById("deck") as HTMLElement).hidden = true;
    status.textContent = "";
    results.hidden = false;
    renderReport(report, results, document.getElementById("title") as HTMLElement);
    document.title = `${report.result} · BitGraph verify`;
  } catch (err) {
    status.textContent = `The check could not run: ${(err as Error).message}`;
  } finally {
    zone.classList.remove("busy");
  }
}

/**
 * The site's dashed edge, ported from website/src/lib/use-dashed-edges.ts:
 * four 2px repeating gradients whose dash and gap are fitted to each edge
 * length so the corners land on dashes (dash:gap 9:7 at a 16px period).
 */
function fitDash(L: number): { d: number; g: number } {
  const RATIO = 9 / 7;
  const PERIOD = 16;
  if (!L) return { d: 9, g: 7 };
  const n = Math.max(2, Math.round((L + PERIOD / (1 + RATIO)) / PERIOD));
  const g = L / (n * RATIO + n - 1);
  return { d: RATIO * g, g };
}

function paintDashedEdges(box: HTMLElement, color: string): void {
  const w = box.clientWidth;
  const h = box.clientHeight;
  if (!w || !h) return;
  const H = fitDash(w);
  const V = fitDash(h);
  const across = `repeating-linear-gradient(to right, ${color} 0 ${H.d}px, transparent ${H.d}px ${H.d + H.g}px)`;
  const down = `repeating-linear-gradient(to bottom, ${color} 0 ${V.d}px, transparent ${V.d}px ${V.d + V.g}px)`;
  box.style.backgroundImage = [across, down, across, down].join(", ");
  box.style.backgroundSize = "100% 2px, 2px 100%, 100% 2px, 2px 100%";
  box.style.backgroundPosition = "0 0, 100% 0, 0 100%, 0 0";
  box.style.backgroundRepeat = "no-repeat";
}

const EDGE = "#b3bac2";
const EDGE_ACTIVE = "#0065A4";

/**
 * The home page's frame measurement (website/src/app/page.tsx), ported:
 * the wrap is as tall as the viewport minus the nav at BOTH ends (so its
 * centre is the viewport's centre while it still starts under the nav),
 * and the frame gets whatever the wrap's padding and the frame's siblings
 * leave, floored at 180 (120 on a short viewport). Summed from the
 * siblings, never from the wrap's leftover height, so it cannot feed itself.
 */
function fitFrame(): void {
  const wrap = document.querySelector(".bitgraph-wrap") as HTMLElement | null;
  const cam = document.getElementById("camera");
  const nav = document.getElementById("site-nav");
  if (!wrap || !cam || !nav) return;
  const box = (el: Element): number => {
    const cs = getComputedStyle(el);
    return (el as HTMLElement).offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
  };
  const top = nav.offsetHeight;
  const room = Math.round(window.innerHeight - top * 2);
  const wcs = getComputedStyle(wrap);
  let other = parseFloat(wcs.paddingTop) + parseFloat(wcs.paddingBottom) + box(cam) - cam.offsetHeight;
  const hero = cam.parentElement;
  if (hero) for (const el of Array.from(hero.children)) if (el !== cam) other += box(el);
  const floor = window.innerHeight <= 520 ? 120 : 180;
  const avail = Math.max(floor, Math.round(room - other));
  wrap.style.setProperty("--bg-cam-avail", `${avail}px`);
  wrap.style.setProperty("--bg-wrap-min", `${room}px`);
}

/**
 * Under the frame: the Folder edition this page shipped with, and the one
 * action that fits it. Opened from disk the page IS the copy the Folder
 * installer placed (refreshed on every install), so the edition is the one
 * the reader is on and the action is to check for updates; hosted, the
 * action is to get it. Both go to the Folder page, which shows the current
 * release.
 */
function labelFolderLink(): void {
  const link = document.getElementById("folder-link");
  if (link === null) return;
  const local = location.protocol === "file:";
  link.replaceChildren(
    document.createTextNode(local ? "Check for updates " : "Download for macOS "),
    el("span", { class: "arrow", "aria-hidden": "true" }, ["→"])
  );
}

function wire(): void {
  labelFolderLink();
  const zone = document.getElementById("drop") as HTMLElement;
  const status = document.getElementById("status") as HTMLElement;
  const pickFiles = document.getElementById("pick-files") as HTMLInputElement;
  const pickFolder = document.getElementById("pick-folder") as HTMLInputElement;

  fitFrame();
  window.addEventListener("resize", fitFrame);
  window.addEventListener("orientationchange", fitFrame);
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(fitFrame);
    const title = document.getElementById("title");
    const more = document.getElementById("more");
    if (title) ro.observe(title);
    if (more) ro.observe(more);
    new ResizeObserver(() => paintDashedEdges(zone, zone.classList.contains("over") ? EDGE_ACTIVE : EDGE)).observe(zone);
  }
  document.fonts?.ready.then(fitFrame).catch(() => {});
  paintDashedEdges(zone, EDGE);

  if (!webCryptoAvailable) {
    status.textContent =
      "This browser context has no WebCrypto, so attestations will read UNDETERMINED here; open the file directly (file://) or over https, or run bitgraph-play check.";
  }

  const prevent = (e: Event): void => {
    e.preventDefault();
    e.stopPropagation();
  };
  for (const name of ["dragenter", "dragover"]) {
    zone.addEventListener(name, (e) => {
      prevent(e);
      zone.classList.add("over");
      paintDashedEdges(zone, EDGE_ACTIVE);
    });
    document.body.addEventListener(name, prevent);
  }
  for (const name of ["dragleave", "drop"]) {
    zone.addEventListener(name, (e) => {
      prevent(e);
      zone.classList.remove("over");
      paintDashedEdges(zone, EDGE);
    });
    document.body.addEventListener(name, prevent);
  }
  zone.addEventListener("drop", (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (dt === null) return;
    void filesFromDrop(dt).then(run);
  });
  pickFiles.addEventListener("change", () => void run(filesFromInput(pickFiles)));
  pickFolder.addEventListener("change", () => void run(filesFromInput(pickFolder)));
}

document.addEventListener("DOMContentLoaded", wire);
