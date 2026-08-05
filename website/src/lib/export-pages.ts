// Copyright (c) 2024-2026 Mike Argento. All rights reserved.

/**
 * The HTML that ships inside a BitGraph export.
 *
 * An export is a folder you can open. `proofPage` renders one recording the way
 * /proof/[digest] renders it, and `indexPage` renders the contact sheet over a
 * collection. Both are written into the zip so an export read months later, on
 * a machine with no network, still explains itself.
 *
 * ⚠️ THIS IS THE SECOND IMPLEMENTATION. The first is `writeProofPage` /
 * `writeIndex` in `packages/folder/src/export.js`, which cannot import this:
 * it runs under JavaScript for Automation with no bundler and no dependencies,
 * which is the property that lets BitGraph Folder install without a runtime.
 * A site export and a Folder export must stay the same thing, so:
 *
 *   CHANGE ONE, CHANGE BOTH. The structure, the card order, the class names
 *   and the CSS values here are mirrored there deliberately.
 *
 * Everything is derived and inert: nothing verifies against these pages, and
 * `bitgraph-audit` ignores them because it discovers proofs by schema shape
 * rather than by filename.
 */

export interface ExportProof {
  artifact?: { digestB64?: string };
  commit?: { counter?: string; epochId?: string; prevB64?: string; slotHashB64?: string };
  signer?: { signatureB64?: string; publicKeyB64?: string };
  environment?: { measurement?: string; enforcement?: string; attestation?: { format?: string } };
  slotAllocation?: { counter?: string; nonceB64?: string; signatureB64?: string; epochId?: string };
  attribution?: { name?: string; message?: string };
  proofHash?: string;
}

export interface AnchorSide {
  /** Block number, from the anchor's own `ethereum` block. */
  block?: number | null;
  /** Unix seconds. Decoded from the witness header when one is present. */
  ts?: number | null;
}

const IMAGE_EXT = ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "avif", "bmp", "tiff", "tif", "svg"];
const TEXT_EXT = ["txt", "md", "markdown", "csv", "tsv", "json", "log", "xml", "yml", "yaml", "html", "htm", "rtf"];
const VIDEO_EXT = ["mp4", "m4v", "mov", "webm", "ogv"];
const AUDIO_EXT = ["mp3", "m4a", "aac", "wav", "aiff", "aif", "flac", "oga", "ogg"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function esc(s: unknown): string {
  return String(s ?? "")
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;");
}

function encodePath(p: string): string {
  return String(p).split("/").map(encodeURIComponent).join("/");
}

function extOf(name: string): string {
  const i = String(name).lastIndexOf(".");
  return i === -1 ? "" : String(name).slice(i + 1).toLowerCase();
}

function toUrlSafe(b64: string): string {
  return String(b64).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Absolute on purpose: an export is read off a disk, from a file: URL. */
const SITE = "https://bitgraph.ing";
const SITE_LABEL = "BitGraph.ing";

/**
 * The one link in an export that leaves the machine.
 *
 * It said "Open proof", which sat next to "Open file" and read as a second
 * local file, which is exactly what it is not. Naming the destination is the
 * whole job. Always a new tab, so following it never costs you your place.
 *
 * The arrow's class is a parameter because the sheet and the proof page carry
 * different stylesheets.
 */
function siteLink(digest: string, cls: string, arrowCls: string): string {
  return `<a${cls ? ` class="${cls}"` : ""}` +
    ` href="${SITE}/proof/${encodeURIComponent(toUrlSafe(digest))}"` +
    ` target="_blank" rel="noopener noreferrer">Open on ${esc(SITE_LABEL)}` +
    ` <span class="${arrowCls}">&rarr;</span></a>`;
}

/* ── RLP: the block timestamp is field 12 of an Ethereum block header ──
   Block times are not stored as fields anywhere in an export; they live inside
   headerRlpHex in the witness files. Deriving it from the witness rather than
   trusting a number alongside it is also the stronger construction, since the
   witness IS the header the proof's anchor commits to. */

function rlpItemAt(b: Uint8Array, i: number): { start: number; len: number; next: number; list: boolean } | null {
  const p = b[i];
  if (p === undefined) return null;
  if (p < 0x80) return { start: i, len: 1, next: i + 1, list: false };
  if (p <= 0xb7) return { start: i + 1, len: p - 0x80, next: i + 1 + (p - 0x80), list: false };
  if (p <= 0xbf) {
    const k = p - 0xb7;
    let n = 0;
    for (let j = 0; j < k; j++) n = n * 256 + b[i + 1 + j];
    return { start: i + 1 + k, len: n, next: i + 1 + k + n, list: false };
  }
  if (p <= 0xf7) return { start: i + 1, len: p - 0xc0, next: i + 1 + (p - 0xc0), list: true };
  const k = p - 0xf7;
  let n = 0;
  for (let j = 0; j < k; j++) n = n * 256 + b[i + 1 + j];
  return { start: i + 1 + k, len: n, next: i + 1 + k + n, list: true };
}

/** Unix seconds from an RLP block header, or 0. Header field order is fixed
 *  and its first twelve entries have never changed across forks. */
export function blockTimeFromHeader(headerRlpHex: string): number {
  const hex = String(headerRlpHex).replace(/^0x/, "");
  if (hex.length % 2 !== 0) return 0;
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < b.length; i++) {
    const v = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(v)) return 0;
    b[i] = v;
  }
  const outer = rlpItemAt(b, 0);
  if (!outer?.list) return 0;
  let i = outer.start;
  for (let n = 0; n < 11; n++) {
    const it = rlpItemAt(b, i);
    if (!it) return 0;
    i = it.next;
  }
  const ts = rlpItemAt(b, i);
  if (!ts || ts.len > 8) return 0;
  let v = 0;
  for (let q = 0; q < ts.len; q++) v = v * 256 + b[ts.start + q];
  return v;
}

/* ── time ── */

const dateOf = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;

/** "3:24:59 PM", the form the proof page uses. */
function clock12(d: Date): string {
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = String(d.getMinutes()).padStart(2, "0");
  // Seconds are not optional: anchors land every 12 seconds, so both bounds of
  // a window usually fall in the same minute and would print identically.
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${h12}:${mm}:${ss} ${h >= 12 ? "PM" : "AM"}`;
}

const TZ = (() => {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
      .formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
})();

/* ── shell ── */

function pageShell(title: string, extraCss: string, body: string): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${esc(title)}</title>` +
    // These pages sit at a fixed path and are rewritten in place, which is the
    // case a browser cache gets wrong.
    '<meta http-equiv="cache-control" content="no-cache, no-store, must-revalidate">' +
    "<style>" +
    "*{box-sizing:border-box}" +
    "body{margin:0;padding:48px 24px 80px;background:#f5f5f5;color:#111827;" +
    'font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;' +
    "-webkit-font-smoothing:antialiased}" +
    ".wrap{max-width:800px;margin:0 auto}" +
    ".s{margin:0 0 40px;color:#4b5563;font-size:14px}" +
    ".l a{color:#0065A4;font-weight:600;font-size:14px;text-decoration:none}" +
    ".arrow{display:inline-block;transition:transform .18s}" +
    "@media (hover:hover){.l a:hover .arrow{transform:translateX(3px)}}" +
    "@media (max-width:520px){body{padding:32px 16px 64px}}" +
    extraCss +
    '</style></head><body><div class="wrap">' + body + "</div></body></html>\n"
  );
}

const chevron =
  '<span class="chev" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" ' +
  'fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="square" ' +
  'stroke-linejoin="miter"><path d="M9 6 L15 12 L9 18"/></svg></span>';

/* ── the proof page, mirrored ── */

export interface ProofPageInput {
  /** Name of the recorded file, if the export carries it. */
  fileName?: string | null;
  /** Byte length of that file, for the identity row. */
  fileSize?: number | null;
  proof: ExportProof;
  before?: AnchorSide | null;
  after?: AnchorSide | null;
  /** Raw proof.json text, so the copied value is the file rather than a re-serialisation. */
  proofRaw?: string | null;
  /** True when this export sits in a collection that has a contact sheet. */
  hasIndex?: boolean;
}

export function proofPage(input: ProofPageInput): string {
  const { fileName, fileSize, proof, proofRaw } = input;
  const before = input.before ?? {};
  const after = input.after ?? {};

  const ext = fileName ? extOf(fileName) : "";
  const rel = fileName ? encodePath(fileName) : null;

  const field = (
    label: string,
    value: unknown,
    opts: { mono?: boolean; hl?: boolean; link?: boolean } = {}
  ): string => {
    if (value === undefined || value === null || value === "") return "";
    if (opts.link) {
      return `<div class="f"><span class="fl">${esc(label)}</span>` +
        `<a class="fv lnk" href="${esc(value)}" target="_blank" rel="noopener noreferrer">${esc(value)}</a></div>`;
    }
    const cls = "f" + (opts.mono ? " mono" : "") + (opts.hl ? " hl" : "");
    return `<div class="${cls}" data-copy="${esc(value)}">` +
      `<span class="fl">${esc(label)}</span><span class="fv">${esc(value)}</span></div>`;
  };

  // A plain card renders NO header: the proof page passes a title and draws
  // nothing for it, because the heading above already says it.
  const card = (title: string, inner: string, plain?: boolean): string => {
    if (!inner) return "";
    if (plain) return `<section class="cd">${inner}</section>`;
    return `<section class="cd"><details><summary class="hd"><span>${esc(title)}</span>${chevron}` +
      `</summary><div class="bd">${inner}</div></details></section>`;
  };

  let media = "";
  if (rel) {
    if (IMAGE_EXT.includes(ext)) media = `<div class="hero"><a href="${rel}"><img src="${rel}" alt=""></a></div>`;
    else if (ext === "pdf") media = `<div class="hero"><embed class="doc" src="${rel}" type="application/pdf"></div>`;
    else if (VIDEO_EXT.includes(ext)) media = `<div class="hero"><video class="av" src="${rel}" controls preload="metadata" playsinline></video></div>`;
    else if (AUDIO_EXT.includes(ext)) media = `<div class="hero"><audio class="au" src="${rel}" controls preload="metadata"></audio></div>`;
    else if (TEXT_EXT.includes(ext)) media = `<div class="hero"><iframe class="doc" src="${rel}" sandbox></iframe></div>`;
  }

  // The window leads the card, written the way the proof page writes it: the
  // date as the heading, the interval beneath in the data font. Never an
  // instant, because a proof carries no clock reading of its own.
  let whenRow = "";
  if (before.ts && after.ts) {
    const b = new Date(before.ts * 1000);
    const a = new Date(after.ts * 1000);
    whenRow = `<div class="when"><div class="wd">${dateOf(b)}</div>` +
      `<div class="wt">between ${clock12(b)} and ${clock12(a)} ${TZ}</div></div>`;
  } else if (before.ts) {
    const b = new Date(before.ts * 1000);
    whenRow = `<div class="when"><div class="wd">${dateOf(b)}</div>` +
      `<div class="wt">after ${clock12(b)} ${TZ}, sealing</div></div>`;
  }

  const sizeStr = fileSize
    ? fileSize >= 1048576 ? `${(fileSize / 1048576).toFixed(1)} MB`
      : fileSize >= 1024 ? `${Math.round(fileSize / 1024)} KB` : `${fileSize} bytes`
    : "";

  const digest = proof.artifact?.digestB64 ?? "";
  const head =
    whenRow + media +
    (fileName
      ? `<div class="fn"><span>${esc(fileName)}${sizeStr ? ` &middot; ${esc(sizeStr)}` : ""}</span>` +
        (rel ? `<a class="op" href="${rel}">Open <span class="arrow">&rarr;</span></a>` : "") + "</div>"
      : "") +
    field("File Hash", digest, { mono: true });

  const slot = proof.slotAllocation;
  const commit = proof.commit ?? {};
  const signer = proof.signer ?? {};
  const env = proof.environment ?? {};
  const attr = proof.attribution;

  const anchorCard = (title: string, side: AnchorSide): string => {
    if (!side.block && !side.ts) return "";
    let inner = field("Block", side.block ? `#${side.block}` : "", { hl: true });
    if (side.ts) {
      const d = new Date(side.ts * 1000);
      inner += field("Block Time", `${clock12(d)} on ${dateOf(d)}`);
    }
    if (side.block) inner += field("Etherscan", `https://etherscan.io/block/${side.block}`, { link: true });
    return card(title, inner);
  };

  // The construction's order, which is the proof page's order: what was
  // reserved, what was committed into it, who signed it, where it ran, and
  // only then the blocks that bracket the whole thing.
  const body =
    card("BitGraph Recorded", head, true) +
    (slot
      ? card("Reserved Slot",
          field("Slot Counter", slot.counter ? `#${slot.counter}` : "", { hl: true }) +
          field("Nonce", slot.nonceB64, { mono: true }) +
          field("Slot Signature", slot.signatureB64, { mono: true }) +
          field("Epoch ID", slot.epochId, { mono: true }))
      : "") +
    card("Artifact Commit",
      field("Artifact Counter", commit.counter ? `#${commit.counter}` : "", { hl: true }) +
      field("Epoch ID", slot ? "" : commit.epochId, { mono: true }) +
      field("Previous Hash", commit.prevB64, { mono: true }) +
      field("Slot Hash", commit.slotHashB64, { mono: true })) +
    card("Signature",
      field("This BitGraph's Hash", proof.proofHash, { mono: true }) +
      field("Signature", signer.signatureB64, { mono: true }) +
      field("Public Key", signer.publicKeyB64, { mono: true })) +
    card(env.enforcement === "software" ? "Software" : "Hardware Enclave",
      field("PCR0 Measurement", env.measurement, { mono: true }) +
      field("Attestation Format", env.attestation?.format)) +
    anchorCard("Recorded after this block", before) +
    anchorCard("Recorded before this block", after) +
    (attr
      ? card("Submitter's Note", field("Submitted by", attr.name) + field("Note", attr.message, { mono: true }))
      : "") +
    (proofRaw ? card("Raw JSON", `<pre class="copy" title="Click to copy">${esc(proofRaw)}</pre>`) : "");

  return pageShell(
    fileName || "BitGraph",
    PROOF_CSS,
    // Where the site link goes depends on whether the back link exists, and
    // both placements are the same rule: a link needs something to sit against.
    // With a back link the two pair off on one row, since splitting two links
    // of identical treatment left a staircase with an empty top right corner.
    // Without one, that row would hold a single link over a gap, so it drops to
    // the heading's line and baseline-aligns against it.
    (input.hasIndex
      ? '<nav class="nv"><a class="hm bk" href="../index.html">' +
        '<span class="arrow">&larr;</span> All recordings</a>' +
        siteLink(digest, "hm", "arrow") + "</nav>" +
        '<div class="tl"><h1>BitGraph Recorded</h1></div>'
      : '<div class="tl"><h1>BitGraph Recorded</h1>' +
        siteLink(digest, "hm", "arrow") + "</div>") + body +
      '<div id="c">Copied!</div>' + COPY_SCRIPT
  );
}

/* ── the contact sheet ── */

export interface IndexRow {
  /** Folder this row points at, relative to the index. */
  dir: string;
  fileName?: string | null;
  counter?: string | null;
  /** Standard base64. Builds the row's link to the recording on the site. */
  digest?: string | null;
  before?: AnchorSide | null;
  after?: AnchorSide | null;
}

export function indexPage(rows: IndexRow[]): string {
  const cells = rows.map((r) => {
    const ext = r.fileName ? extOf(r.fileName) : "";
    const page = `${encodePath(r.dir)}/index.html`;
    const rel = r.fileName ? `${encodePath(r.dir)}/${encodePath(r.fileName)}` : null;

    let thumb: string;
    if (rel && IMAGE_EXT.includes(ext)) thumb = `<a class="t" href="${page}"><img src="${rel}" alt="" loading="lazy"></a>`;
    else if (rel && ext === "pdf") thumb = `<a class="t pdf" href="${page}"><embed src="${rel}#toolbar=0&amp;navpanes=0&amp;scrollbar=0&amp;view=FitH" type="application/pdf"></a>`;
    else if (rel && VIDEO_EXT.includes(ext)) thumb = `<a class="t" href="${page}"><video src="${rel}" preload="metadata" muted playsinline tabindex="-1"></video></a>`;
    else if (rel && TEXT_EXT.includes(ext)) thumb = `<a class="t doc" href="${page}"><iframe src="${rel}" sandbox loading="lazy" tabindex="-1" scrolling="no"></iframe></a>`;
    else thumb = `<a class="t none" href="${page}">${esc(ext ? ext.toUpperCase() : "")}</a>`;

    // A cell is three things: the picture, its filename, and the two ways to
    // open it. It also carried the folder name, the counter and the full anchor
    // window, all of which were the proof page leaking into a contact sheet.
    // They are one click away and stated in full there.
    //
    // The links are stacked rather than side by side. Two on one line were what
    // set the cell's minimum width, and this page would rather spend that width
    // on pictures.
    return "<li>" + thumb +
      '<div class="m">' +
      `<p class="n" title="${esc(r.fileName || r.dir)}">${esc(r.fileName || r.dir)}</p>` +
      '<div class="l">' +
      `<a href="${page}">Open locally <span class="arrow">&rarr;</span></a>` +
      (r.digest ? siteLink(r.digest, "", "arrow") : "") +
      "</div></div></li>";
  }).join("");

  return pageShell(
    "BitGraph",
    INDEX_CSS,
    "<h1>BitGraph</h1>" +
      `<p class="s">${rows.length} ${rows.length === 1 ? "recording" : "recordings"}.</p>` +
      (cells ? `<ul>${cells}</ul>` : '<p class="empty">Nothing here.</p>')
  );
}

/* ── styles, mirrored from packages/folder/src/export.js ── */

const PROOF_CSS =
  ".nv{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 34px}" +
  ".hm{color:#0065A4;font-weight:600;font-size:14px;text-decoration:none}" +
  // An arrow leans the way it points, always outward. .hm carries both the back
  // link and the forward one now, so the direction cannot sit on .hm: it was
  // written when .hm was only the way out, and the forward arrow inherited the
  // leftward pull and appeared to retreat into the page.
  "@media (hover:hover){.hm:hover .arrow{transform:translateX(3px)}" +
  ".hm.bk:hover .arrow{transform:translateX(-3px)}}" +
  "h1{margin:0;font-size:20px;font-weight:800;letter-spacing:-.02em;color:#111827}" +
  // The heading and the site link share a line. Baseline, not centre: the h1 is
  // 20/800 and the link 14/600, so centring left the link visibly high against
  // the heavier type. The h1's own bottom margin moved here, so the pair spaces
  // the same as the heading did alone.
  // Wraps, because on a phone the pair does not fit: squeezed onto one line the
  // heading broke in half and the link's arrow orphaned onto its own row.
  // Wrapped, the heading keeps the full width and the link sits under it, and
  // nowrap keeps the arrow with the words it belongs to.
  ".tl{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;" +
  "gap:6px 16px;margin:0 0 10px}" +
  ".tl a{white-space:nowrap}" +
  ".cd{background:#fff;border:1px solid #d0d5dd;overflow:hidden;margin:0 0 10px}" +
  ".hd{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;" +
  "font-size:14px;font-weight:700;letter-spacing:.04em;color:#0065A4;padding:14px 16px;" +
  "background:#fff;cursor:pointer;list-style:none}" +
  ".hd::-webkit-details-marker{display:none}" +
  "details[open]>.hd{background:rgba(0,101,164,.07);border-bottom:1px solid #e2e5e9}" +
  "@media (hover:hover){summary.hd:hover{background:rgba(0,101,164,.07)}}" +
  ".chev{flex-shrink:0;display:inline-flex;transition:transform .18s}" +
  "details[open]>.hd .chev{transform:rotate(90deg)}" +
  ".when{display:flex;flex-direction:column;gap:5px;padding:14px 16px;border-bottom:1px solid #e2e5e9}" +
  ".wd{font-size:14px;font-weight:700;color:#111827;letter-spacing:-.01em}" +
  ".wt{font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#1f2937}" +
  ".f{display:flex;flex-direction:column;gap:5px;padding:14px 16px;border-bottom:1px solid #e2e5e9;cursor:pointer}" +
  ".f:last-child{border-bottom:0}" +
  ".fl{font-size:14px;color:#374151;font-weight:700}" +
  ".fv{font-size:14px;color:#1f2937;line-height:1.6;word-break:break-all}" +
  ".mono .fv{font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;overflow-x:auto;word-break:normal}" +
  ".hl .fv{color:#0065A4;font-weight:700}" +
  ".lnk{color:#0065A4;text-decoration:none;font-size:13px}" +
  ".hero{background:#fff;padding:20px;display:flex;align-items:center;justify-content:center}" +
  ".hero img{max-width:100%;max-height:min(70vh,640px);width:auto;height:auto;display:block;object-fit:contain}" +
  ".hero .doc{width:100%;height:min(70vh,640px);border:0;display:block;background:#fff}" +
  ".hero .av{max-width:100%;max-height:min(70vh,640px);display:block;background:#111827}" +
  ".hero .au{width:100%;display:block}" +
  ".fn{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;" +
  "border-top:1px solid #e2e5e9;font-size:14px;font-weight:600;color:#111827}" +
  ".op{color:#0065A4;font-weight:600;text-decoration:none;flex-shrink:0}" +
  "@media (hover:hover){.op:hover .arrow{transform:translateX(3px)}}" +
  ".bd pre.copy{margin:0;padding:14px 16px;background:#fff;border:0;" +
  "font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#374151;" +
  "white-space:pre-wrap;word-break:break-all;cursor:pointer;max-height:420px;overflow:auto}" +
  "#c{display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:50;" +
  "padding:10px 22px;font-size:14px;font-weight:700;color:#fff;background:#0065A4;" +
  "pointer-events:none;box-shadow:0 4px 20px rgba(0,0,0,.22)}";

const INDEX_CSS =
  ".wrap{max-width:none}" +
  "h1{margin:0 0 4px;font-size:28px;font-weight:600;letter-spacing:-.03em}" +
  // 230px. It was 300px to hold the full time window on one line, and with the
  // window and the side-by-side links both gone nothing in the cell needs that
  // width: the filename ellipsizes and the links are stacked. The narrower
  // minimum buys another column or two, which on a contact sheet is the point.
  "ul{list-style:none;margin:0;padding:0;display:grid;gap:34px 24px;" +
  "grid-template-columns:repeat(auto-fill,minmax(230px,1fr))}" +
  "li{display:block;min-width:0;background:#fff;border:1px solid #d0d5dd}" +
  ".t{display:flex;align-items:center;justify-content:center;overflow:hidden;width:100%;" +
  "aspect-ratio:4/3;background:#fff;border-bottom:1px solid #d0d5dd}" +
  // No backdrop on an image. object-fit:cover means an opaque one fills the box
  // and the colour behind it never shows, so the only things it ever painted
  // were the two cases where it does harm: a PNG with transparency, whose dark
  // parts vanish into it, and an image that has not loaded, which then reads as
  // a broken black block rather than an empty card. The card is white and .t
  // inherits that, so transparency composites onto the card it sits in.
  // Video keeps it: it paints its first frame only once metadata loads, and
  // dark is what an unpainted frame should look like.
  ".t img{width:100%;height:100%;object-fit:cover;display:block}" +
  ".t video{width:100%;height:100%;object-fit:cover;display:block;background:#111827}" +
  ".t.pdf,.t.doc{position:relative;display:block}" +
  ".t.pdf embed{position:absolute;top:0;left:0;width:100%;height:100%;border:0}" +
  ".t.doc iframe{position:absolute;top:0;left:0;width:780px;height:590px;border:0;background:#fff;" +
  "transform:scale(.42);transform-origin:top left;pointer-events:none}" +
  ".none{color:#6b7280;font:600 17px/1 ui-monospace,SFMono-Regular,Menlo,monospace;" +
  "letter-spacing:.14em;text-decoration:none}" +
  // The caption's spacing is its own, not the proof page's 14px/16px field
  // scale. A field there is one line in a dense stack; this is three lines
  // standing alone under a picture, and at the field's spacing they bunched
  // into a single grey block. The horizontal 16px stays, so a cell still lines
  // up with a card. line-height on the links is set rather than inherited, so
  // the gap between them is the gap and not the gap plus leading.
  ".m{min-width:0;padding:16px 16px 18px}" +
  ".n,.l a{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
  ".n{margin:0;font-weight:600}" +
  ".l{margin:15px 0 0}.l a{display:block;font-size:13.5px;line-height:1.5}.l a+a{margin-top:9px}" +
  ".empty{color:#4b5563}";

/** Tap a field or a JSON block to copy it, the proof page's own affordance,
 *  which is why neither has a copy button. */
const COPY_SCRIPT =
  '<script>(function(){var c=document.getElementById("c");' +
  'function ok(){c.style.display="block";setTimeout(function(){c.style.display="none"},1500)}' +
  'function put(t){if(navigator.clipboard&&navigator.clipboard.writeText){' +
  'navigator.clipboard.writeText(t).then(ok,function(){ok()})}else{ok()}}' +
  'Array.prototype.forEach.call(document.querySelectorAll("[data-copy]"),function(f){' +
  'f.addEventListener("click",function(){var v=f.querySelector(".fv");var o=v.textContent;' +
  'put(f.getAttribute("data-copy"));v.textContent="Copied!";v.style.color="#0065A4";' +
  'setTimeout(function(){v.textContent=o;v.style.color=""},1500)})});' +
  'Array.prototype.forEach.call(document.querySelectorAll("pre.copy"),function(p){' +
  'p.addEventListener("click",function(){put(p.textContent)})});' +
  "})();</script>";
