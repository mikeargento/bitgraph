// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.

/**
 * verify.html: the offline, drag-and-drop face of `bitgraph-play check`.
 *
 * One self-contained page, served from bitgraph.ing/verify.html and meant to
 * be saved and opened from disk. Choose or drop a recording folder
 * (or a proof.json beside the file it records) and it renders the same
 * bitgraph-check/1 report the CLI prints, computed by the same code: this
 * file is a thin DOM front over ingestEntries() and checkIngest(), bundled
 * together with bitgraph-audit and bitgraph-verify. Nothing leaves the
 * page: it makes no network request of any kind, uploads nothing, and runs
 * with the machine offline.
 *
 * It is deliberately NOT hosted on bitgraph.ing: the site's own drop box
 * checks a file against the public ledger, and a second box that could only
 * say "self-consistent" would be two boxes with different meanings. The
 * same check runs from npm as `bitgraph-play check`.
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
  } else {
    for (const entry of entries) await walkEntry(entry, "", out);
  }
  if (out.length === 0) {
    // The entries API answered but yielded nothing readable: take whatever
    // plain files the drop carried.
    return Array.from(dt.files ?? []).map((file) => ({ path: file.name, file }));
  }
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

/**
 * A mark only where a line is NOT verified: FALSE in red, UNDETERMINED in
 * grey. Verified is the default state of the page and is not marked line by
 * line; the title says it once.
 */
function markEl(r: ThreeValued): HTMLElement | null {
  if (r === "TRUE") return null;
  return el("span", { class: r === "FALSE" ? "mark false" : "mark undet" }, [r]);
}

/** A field row: label above value, like the proof page's Field. */
function field(label: string, value: string, opts: { mono?: boolean; mark?: ThreeValued } = {}): HTMLElement {
  const head = el("div", { class: "field-head" }, [el("span", { class: "field-label" }, [label])]);
  const mark = opts.mark !== undefined ? markEl(opts.mark) : null;
  if (mark !== null) head.append(mark);
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

// Formatting, matching the proof page: "#25,725,011", "August 10, 2026",
// "9:51:47 AM EDT". en-US like the site; the reader's own time zone.
function fmtBlock(n: string | undefined): string {
  if (n === undefined) return "";
  return `#${Number(n).toLocaleString("en-US")}`;
}
function fmtDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}
function fmtTime(unix: number, withZone: boolean): string {
  return new Date(unix * 1000).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    ...(withZone ? { timeZoneName: "short" } : {}),
  });
}
function fmtDateTime(unix: number): string {
  return new Date(unix * 1000).toLocaleString("en-US", {
    month: "numeric", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short",
  });
}

/**
 * The proof page's "when" row: the date in bold, and under it the window
 * the recording sits in, from the verified block headers in the bundle:
 * "between 9:51:47 AM and 9:51:59 AM EDT". Grey connective words, dark
 * times. Absent bounds are said plainly in the same slot.
 */
function whenRow(rec: CheckRecording): HTMLElement {
  const b = rec.bounds;
  const grey = (t: string): HTMLElement => el("span", { class: "when-grey" }, [t]);
  const dark = (t: string): HTMLElement => el("span", { class: "when-dark" }, [t]);
  const row = el("div", { class: "when" });
  if (b.notBefore !== undefined || b.notAfter !== undefined) {
    const anchorTs = (b.notBefore ?? b.notAfter) as CheckBoundLike;
    row.append(el("div", { class: "when-date" }, [fmtDate(anchorTs.timestamp)]));
    const line = el("div", { class: "when-line" });
    if (b.notBefore !== undefined && b.notAfter !== undefined) {
      line.append(grey("between "), dark(fmtTime(b.notBefore.timestamp, false)), grey(" and "), dark(fmtTime(b.notAfter.timestamp, true)));
    } else if (b.notBefore !== undefined) {
      line.append(grey("after "), dark(fmtTime(b.notBefore.timestamp, true)));
    } else if (b.notAfter !== undefined) {
      line.append(grey("before "), dark(fmtTime(b.notAfter.timestamp, true)));
    }
    row.append(line);
  } else {
    row.append(el("div", { class: "when-line" }, [grey("no verified Ethereum bound in this bundle")]));
  }
  return row;
}
type CheckBoundLike = { timestamp: number };

// ---------------------------------------------------------------------------
// File preview: the proof page's, from the dropped bytes
// ---------------------------------------------------------------------------

type FileKind = "image" | "video" | "audio" | "text" | "pdf" | "other";

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|svg)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|ogv)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|ogg|oga)$/i;
const TEXT_EXT = /\.(txt|md|markdown|json|csv|tsv|log|xml|yaml|yml|html?|css|js|ts|py|sh|rtf)$/i;

function looksLikeText(bytes: Uint8Array): boolean {
  const b = bytes.subarray(0, Math.min(2048, bytes.length));
  if (!b.length) return false;
  let ok = 0;
  for (const c of b) {
    if (c === 0) return false;
    if (c === 9 || c === 10 || c === 13 || c >= 32) ok++;
  }
  return ok / b.length > 0.97;
}

function fileKindOf(name: string, bytes: Uint8Array): FileKind {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "pdf";
  if (IMAGE_EXT.test(n)) return "image";
  if (VIDEO_EXT.test(n)) return "video";
  if (AUDIO_EXT.test(n)) return "audio";
  if (TEXT_EXT.test(n) || looksLikeText(bytes)) return "text";
  return "other";
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * The preview block above the file row, exactly as the proof page draws it:
 * image or video centred in a 20px box at up to min(70vh, 640px); audio at
 * full width; text as a 24-line monospace excerpt; nothing for PDF and
 * other kinds (the identity row carries them). Returns null when there is
 * nothing to draw.
 */
function previewBlock(file: File, bytes: Uint8Array, kind: FileKind): HTMLElement | null {
  if (kind === "image" || kind === "video") {
    const url = URL.createObjectURL(file);
    const media =
      kind === "image"
        ? el("img", { src: url, alt: file.name, style: "display:block;max-width:100%;max-height:min(70vh,640px);width:auto;height:auto;object-fit:contain;border-radius:0" })
        : el("video", { src: url, controls: "", style: "display:block;max-width:100%;max-height:min(70vh,640px);border-radius:0" });
    return el("div", { style: "padding:20px;display:flex;align-items:center;justify-content:center" }, [media]);
  }
  if (kind === "audio") {
    const url = URL.createObjectURL(file);
    return el("div", { style: "padding:20px 16px" }, [el("audio", { src: url, controls: "", style: "display:block;width:100%" })]);
  }
  if (kind === "text") {
    try {
      const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 6000));
      const lines = raw.split("\n");
      const text = lines.slice(0, 24).join("\n").slice(0, 3000);
      const truncated = lines.length > 24 || raw.length > text.length || bytes.byteLength > 6000;
      return el("pre", { class: "excerpt" }, [text + (truncated ? "\n…" : "")]);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The proof page's identity row: the name, small and bold, with the size,
 * and "Open →" for kinds a browser truly opens (image, text, PDF); the
 * three-valued mark on the right when the file line is not verified.
 */
function fileRow(rec: CheckRecording, file: File | undefined, kind: FileKind | undefined, hasPreviewAbove: boolean): HTMLElement {
  const fileLine = rec.lines.find((l) => l.name === "file");
  const row = el("div", { class: hasPreviewAbove ? "file-row above" : "file-row" });
  if (rec.filePath !== undefined) {
    const label = el("span", { class: "file-ident" }, [el("span", { class: "file-name" }, [rec.filePath])]);
    if (file !== undefined) label.append(document.createTextNode(` · ${fmtSize(file.size)}`));
    row.append(label);
    const right = el("span", { class: "file-right" });
    if (file !== undefined && kind !== undefined && (kind === "image" || kind === "text" || kind === "pdf")) {
      right.append(el("a", { class: "bg-arrow-link", href: URL.createObjectURL(file), target: "_blank", rel: "noopener" }, ["Open ", el("span", { class: "arrow", "aria-hidden": "true" }, ["→"])]));
    }
    const mark = fileLine !== undefined ? markEl(fileLine.result) : null;
    if (mark !== null) right.append(mark);
    if (right.childNodes.length > 0) row.append(right);
  } else {
    row.append(el("span", { class: "file-missing" }, ["file not in this bundle"]));
    const mark = fileLine !== undefined ? markEl(fileLine.result) : null;
    if (mark !== null) row.append(mark);
  }
  return row;
}

/** A field with the proof page's exact styling: 14/700 label, value beneath. */
function proofField(label: string, value: string, mono = false): HTMLElement {
  return field(label, value, { mono });
}

/** The page's one action, at the top right of the title row, across from the title. */
function titleAction(text: string, onClick: () => void): void {
  const slot = document.getElementById("title-action");
  if (slot === null) return;
  const a = el("a", { class: "bg-arrow-link", href: "#" }, [text + " ", el("span", { class: "arrow", "aria-hidden": "true" }, ["→"])]);
  a.addEventListener("click", (e) => {
    e.preventDefault();
    onClick();
  });
  slot.replaceChildren(a);
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

/**
 * An anchor opener with the proof page's rows: Block, Block Time (from the
 * verified header), Block Hash, Anchor position, Etherscan, then the two
 * checks as marked fields.
 */
function anchorOpener(a: CheckAnchor, side: "before" | "after" | "other", index: number, ts: number | undefined): HTMLElement {
  const title =
    side === "before" ? "Recorded after this block" : side === "after" ? "Recorded before this block" : `Ethereum anchor ${index + 1}`;
  const body: HTMLElement[] = [];
  if (a.blockNumber !== undefined) body.push(proofField("Block", fmtBlock(a.blockNumber), true));
  if (ts !== undefined) body.push(proofField("Block Time", fmtDateTime(ts)));
  if (a.blockHash !== undefined) body.push(proofField("Block Hash", a.blockHash, true));
  if (a.counter !== undefined) body.push(proofField("Anchor position", `#${a.counter}`, true));
  if (a.blockNumber !== undefined) {
    const link = el("a", { class: "field-link", href: `https://etherscan.io/block/${a.blockNumber}`, target: "_blank", rel: "noopener" }, [`https://etherscan.io/block/${a.blockNumber}`]);
    body.push(el("div", { class: "field" }, [el("span", { class: "field-label" }, ["Etherscan"]), link]));
  }
  for (const l of a.lines) {
    body.push(field(l.name === "witness" ? "Block header" : "Anchor signature", l.detail, { mark: l.result }));
  }
  if (a.witnessPath === undefined) {
    body.push(field("Block header", "no block-header witness in this bundle, so this anchor's block hash is not verified here and it bounds nothing"));
  }
  return opener(a.result === "TRUE" ? title : `${title}  [${a.result}]`, body);
}

async function renderReport(report: CheckReport, root: HTMLElement, titleEl: HTMLElement, files: Map<string, File>): Promise<void> {
  root.replaceChildren();
  const again = (): void => location.reload();

  // Nothing to verify: no proof in what was chosen. Almost always the wrong
  // level of the folder, or a plain file, so say where a recording lives.
  if (report.recordings.length === 0 && report.anchors.length === 0) {
    titleEl.textContent = "No BitGraph Found";
    root.append(
      el("section", { class: "card primary" }, [
        el("div", { class: "notice" }, [
          "No BitGraph proof was found in what you chose. A recording is a folder named for the file it holds, like BitGraph (photo.jpg). Inside it are proof.json, the file itself, and an ethereum-anchors folder.",
        ]),
      ])
    );
    titleAction("Choose a recording folder", again);
    root.append(opener("Report JSON", [el("pre", { class: "json" }, [JSON.stringify(report, null, 2)])]));
    const moreSlot = document.getElementById("more") as HTMLElement;
    moreSlot.replaceChildren();
    moreSlot.hidden = true;
    return;
  }

  titleEl.textContent = pageTitleFor(report.result);
  const one = report.recordings.length === 1 ? report.recordings[0] : undefined;

  // Primary card, the proof page's "BitGraph Recorded" card: when, file,
  // position, hash, action. A non-TRUE result states its sentence first.
  const primary = el("section", { class: "card primary" });
  if (report.result !== "TRUE") {
    primary.append(el("div", { class: `notice ${report.result.toLowerCase()}` }, [report.summary]));
  }
  if (one !== undefined) {
    primary.append(whenRow(one));
    const file = one.filePath !== undefined ? files.get(one.filePath) : undefined;
    let kind: FileKind | undefined;
    let preview: HTMLElement | null = null;
    if (file !== undefined) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      kind = fileKindOf(file.name, bytes);
      preview = previewBlock(file, bytes, kind);
    }
    if (preview !== null) primary.append(preview);
    primary.append(fileRow(one, file, kind, preview !== null));
    if (one.counter !== undefined) {
      primary.append(proofField("Position", `#${one.counter}${one.epochId !== undefined ? `  ·  epoch ${one.epochId}` : ""}`, true));
    }
    primary.append(proofField("File Hash", one.digestB64, true));
  } else if (report.recordings.length > 1) {
    for (const rec of report.recordings) primary.append(fileRow(rec, rec.filePath !== undefined ? files.get(rec.filePath) : undefined, undefined, false));
  } else {
    primary.append(proofField("Recordings", "no recordings in this bundle"));
  }
  root.append(primary);
  titleAction("Check another BitGraph", again);

  // Openers.
  if (one !== undefined) {
    const open = one.lines.filter((l) => l.result !== "TRUE").length;
    root.append(opener(open === 0 ? "Recording checks" : `Recording checks  ${open} not verified`, recordingChecks(one), { open: report.result !== "TRUE" }));
  } else {
    report.recordings.forEach((rec, i) => {
      root.append(
        opener(`Recording ${i + 1}: ${rec.filePath ?? rec.digestB64.slice(0, 16) + "…"}  [${rec.result}]`, [
          whenRow(rec),
          ...(rec.counter !== undefined ? [proofField("Position", `#${rec.counter}${rec.epochId !== undefined ? `  ·  epoch ${rec.epochId}` : ""}`, true)] : []),
          proofField("File Hash", rec.digestB64, true),
          ...recordingChecks(rec),
        ], { open: rec.result !== "TRUE" })
      );
    });
  }

  // Ethereum bounds: one opener per anchor, titled the way the proof page
  // titles its bounding blocks when the anchor bounds the single recording.
  const tsByAnchor = new Map<string, number>();
  for (const rec of report.recordings) {
    if (rec.bounds.notBefore) tsByAnchor.set(rec.bounds.notBefore.anchorProofHash, rec.bounds.notBefore.timestamp);
    if (rec.bounds.notAfter) tsByAnchor.set(rec.bounds.notAfter.anchorProofHash, rec.bounds.notAfter.timestamp);
  }
  report.anchors.forEach((a, i) => {
    let side: "before" | "after" | "other" = "other";
    if (one !== undefined) {
      if (one.bounds.notBefore?.anchorProofHash === a.proofHash) side = "before";
      else if (one.bounds.notAfter?.anchorProofHash === a.proofHash) side = "after";
    }
    root.append(anchorOpener(a, side, i, tsByAnchor.get(a.proofHash)));
  });

  if (report.contradictions.length > 0) {
    root.append(
      opener(`Contradictions  ${report.contradictions.length}`, report.contradictions.map((c) => field("Contradiction", c.detail, { mark: "FALSE" })), { open: true, tone: "danger" })
    );
  }
  if (report.notes.length > 0) {
    root.append(opener(`Notes  ${report.notes.length}`, [el("ul", { class: "list" }, report.notes.map((t) => el("li", {}, [t])))]));
  }
  root.append(opener("Not checked", [el("ul", { class: "list" }, report.notChecked.map((t) => el("li", {}, [t])))]));
  root.append(opener("Report JSON", [el("pre", { class: "json" }, [JSON.stringify(report, null, 2)])]));

  // The slot under the results is empty in results mode: the action lives in
  // the card, where the proof page keeps Export.
  const more = document.getElementById("more") as HTMLElement;
  more.replaceChildren();
  more.hidden = true;
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
    document.querySelector(".bitgraph-wrap")?.classList.add("bitgraph-results");
    document.querySelector(".bitgraph-hero")?.classList.add("results");
    status.textContent = "";
    results.hidden = false;
    const byPath = new Map<string, File>(dropped.map((d) => [d.path, d.file]));
    await renderReport(report, results, document.getElementById("title") as HTMLElement, byPath);
    document.title = `${report.result} · BitGraph verify`;
  } catch (err) {
    status.textContent = `The check could not run: ${(err as Error).message}`;
  } finally {
    zone.classList.remove("busy");
  }
}

/**
 * The wrap is as tall as the viewport, so the composition (title, deck, the
 * framed link, the edition line) sits centred on the screen. No nav on this
 * page: the title carries the name.
 */
function fitWrap(): void {
  const wrap = document.querySelector(".bitgraph-wrap") as HTMLElement | null;
  if (!wrap) return;
  wrap.style.setProperty("--bg-wrap-min", `${Math.round(window.innerHeight)}px`);
}

function wire(): void {
  const zone = document.getElementById("drop") as HTMLElement;
  const status = document.getElementById("status") as HTMLElement;
  const pickFiles = document.getElementById("pick-files") as HTMLInputElement;
  const pickFolder = document.getElementById("pick-folder") as HTMLInputElement;

  fitWrap();
  window.addEventListener("resize", fitWrap);
  window.addEventListener("orientationchange", fitWrap);

  if (!webCryptoAvailable) {
    status.textContent =
      "This browser context has no WebCrypto, so attestations will read UNDETERMINED here; open the file directly (file://) or over https, or run bitgraph-play check.";
  }

  // Hover, focus, and drag-over are state on the card.
  let hovered = false;
  let focused = false;
  let dragging = false;
  const repaint = (): void => {
    zone.classList.toggle("hot", hovered || focused || dragging);
    zone.classList.toggle("over", dragging);
  };
  zone.addEventListener("mouseenter", () => { hovered = true; repaint(); });
  zone.addEventListener("mouseleave", () => { hovered = false; repaint(); });
  zone.addEventListener("focusin", () => { focused = true; repaint(); });
  zone.addEventListener("focusout", () => { focused = false; repaint(); });

  const prevent = (e: Event): void => {
    e.preventDefault();
    e.stopPropagation();
  };
  for (const name of ["dragenter", "dragover"]) {
    zone.addEventListener(name, (e) => {
      prevent(e);
      dragging = true;
      repaint();
    });
    document.body.addEventListener(name, prevent);
  }
  for (const name of ["dragleave", "drop"]) {
    zone.addEventListener(name, (e) => {
      prevent(e);
      dragging = false;
      repaint();
    });
    document.body.addEventListener(name, prevent);
  }
  zone.addEventListener("drop", (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (dt === null) return;
    status.textContent = "Reading the drop…";
    filesFromDrop(dt).then(
      (dropped) => {
        if (dropped.length === 0) {
          status.textContent = "Nothing readable was dropped. Click the box and choose the recording's folder instead.";
          return;
        }
        return run(dropped);
      },
      (err: unknown) => {
        status.textContent = `The drop could not be read here: ${(err as Error).message}. Click the box and choose the recording's folder instead.`;
      }
    );
  });
  // The box is one click target: a click (or Enter/Space) opens the folder
  // picker. The inputs stay hidden so a drop always lands on the box itself.
  zone.addEventListener("click", () => pickFolder.click());
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pickFolder.click();
    }
  });
  pickFiles.addEventListener("change", () => void run(filesFromInput(pickFiles)));
  pickFolder.addEventListener("change", () => void run(filesFromInput(pickFolder)));
}

document.addEventListener("DOMContentLoaded", wire);
