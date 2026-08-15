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
// Rendering
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

function markClass(r: ThreeValued): string {
  return r === "TRUE" ? "mark true" : r === "FALSE" ? "mark false" : "mark undet";
}

function markText(r: ThreeValued): string {
  return r === "TRUE" ? "TRUE" : r === "FALSE" ? "FALSE" : "UNDETERMINED";
}

function renderLine(line: CheckLine): HTMLElement {
  return el("div", { class: "line" }, [
    el("span", { class: markClass(line.result) }, [markText(line.result)]),
    el("span", { class: "line-name" }, [line.name]),
    el("span", { class: "line-detail" }, [line.detail]),
  ]);
}

function renderRecording(rec: CheckRecording, index: number): HTMLElement {
  const title = rec.filePath !== undefined ? rec.filePath : `Recording ${index + 1}`;
  const meta: string[] = [];
  if (rec.counter !== undefined) meta.push(`position ${rec.counter}`);
  if (rec.epochId !== undefined) meta.push(`epoch ${rec.epochId}`);
  return el("section", { class: "card" }, [
    el("div", { class: "card-head" }, [
      el("div", { class: "card-title" }, [title]),
      el("span", { class: markClass(rec.result) }, [markText(rec.result)]),
    ]),
    el("div", { class: "meta" }, [meta.join(" · ")]),
    el("div", { class: "meta mono" }, [`sha256 ${rec.digestB64}`]),
    ...rec.lines.map(renderLine),
    el("div", { class: "line bounds" }, [
      el("span", { class: "mark bound" }, ["BOUNDS"]),
      el("span", { class: "line-name" }, [rec.bounds.status]),
      el("span", { class: "line-detail" }, [rec.bounds.detail]),
    ]),
  ]);
}

function renderAnchor(a: CheckAnchor, index: number): HTMLElement {
  const title = a.blockNumber !== undefined ? `Ethereum anchor: block ${a.blockNumber}` : `Ethereum anchor ${index + 1}`;
  const meta: string[] = [];
  if (a.counter !== undefined) meta.push(`position ${a.counter}`);
  if (a.blockHash !== undefined) meta.push(a.blockHash);
  return el("section", { class: "card" }, [
    el("div", { class: "card-head" }, [
      el("div", { class: "card-title" }, [title]),
      el("span", { class: markClass(a.result) }, [markText(a.result)]),
    ]),
    el("div", { class: "meta mono" }, [meta.join(" · ")]),
    ...a.lines.map(renderLine),
  ]);
}

function renderList(title: string, items: string[], cls: string): HTMLElement | null {
  if (items.length === 0) return null;
  return el("section", { class: `card ${cls}` }, [
    el("div", { class: "card-title" }, [title]),
    el("ul", {}, items.map((t) => el("li", {}, [t]))),
  ]);
}

function renderReport(report: CheckReport, root: HTMLElement): void {
  root.replaceChildren();
  const summary = el("h2", { class: `summary ${report.result.toLowerCase()}` }, [report.summary]);
  root.append(summary);
  report.recordings.forEach((r, i) => root.append(renderRecording(r, i)));
  report.anchors.forEach((a, i) => root.append(renderAnchor(a, i)));
  const contradictions = renderList(
    "Contradictions",
    report.contradictions.map((c) => c.detail),
    "contradictions"
  );
  if (contradictions !== null) root.append(contradictions);
  const notes = renderList("Notes", report.notes, "notes");
  if (notes !== null) root.append(notes);
  const notChecked = renderList("Not checked: no offline check can establish these", report.notChecked, "notes");
  if (notChecked !== null) root.append(notChecked);
  root.append(
    el("div", { class: "foot" }, [
      `Result: ${report.result} · bitgraph-player ${report.evaluator.version} · bitgraph-audit ${report.evaluator.audit} · network: none`,
    ])
  );
  root.append(
    el("div", { class: "foot" }, [
      "This verifier is code that came with your BitGraph Folder or from bitgraph.ing/verify.html. The same check runs from npm as ",
      el("code", {}, ["bitgraph-play check"]),
      ". If it matters, compare copies or run the command; they are built from the same source.",
    ])
  );
  const again = el("button", { class: "again", type: "button" }, ["Check another"]);
  again.addEventListener("click", () => location.reload());
  root.append(again);
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
    zone.hidden = true;
    status.textContent = "";
    results.hidden = false;
    renderReport(report, results);
    document.title = `${report.result} · BitGraph verify`;
  } catch (err) {
    status.textContent = `The check could not run: ${(err as Error).message}`;
  } finally {
    zone.classList.remove("busy");
  }
}

function wire(): void {
  const zone = document.getElementById("drop") as HTMLElement;
  const status = document.getElementById("status") as HTMLElement;
  const pickFiles = document.getElementById("pick-files") as HTMLInputElement;
  const pickFolder = document.getElementById("pick-folder") as HTMLInputElement;

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
    });
    document.body.addEventListener(name, prevent);
  }
  for (const name of ["dragleave", "drop"]) {
    zone.addEventListener(name, (e) => {
      prevent(e);
      zone.classList.remove("over");
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
