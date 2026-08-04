// Copyright (c) 2024-2026 Mike Argento. Licensed under the MIT License. See LICENSE.
//
// BitGraph Folder exporter.
//
// Runs under JavaScript for Automation (`osascript -l JavaScript`), which ships
// with every Mac. That is the whole reason it is written this way rather than
// for node: a folder that records photos should not require its owner to
// install a runtime first. Bundling node would have meant a 229 MB binary, a
// second Apple certificate, and taking on responsibility for shipping a runtime
// with its own CVEs. This has none of those and produces byte-identical output.
//
// Wraps one recorded drop into the same export layout the website produces, so
// the proof material in a folder built here and in a zip downloaded from a
// proof page is the same thing. One addition the zip does not carry: an
// index.html, written so the folder can be read in a browser. It is derived,
// rebuilt on every index pass, ignored by bitgraph-audit (which finds proofs by
// schema shape rather than by filename), and deletable with nothing lost.
//
//   bitgraph-proof-1858/
//       proof.json
//       random-494.txt                          the original bytes, moved in
//       ethereum-anchors/
//           anchor-before.json                  lower bound
//           anchor-before-witness.json          its block header
//           anchor-after.json                   upper bound, the seal
//           anchor-after-witness.json           its block header
//
// No archive is written: bitgraph-audit ingests a directory directly and
// discovers entries by schema shape rather than by filename, so the folder
// audits as-is with `npx @mikeargento/bitgraph-audit <folder>`.
//
// Read-only against the ledger. It assembles proof material that already
// exists, never commits, and the file bytes never leave the machine.
//
// Usage (always via osascript -l JavaScript):
//   export.js <file> <digestB64> <counter> <epochUrlSafe>   build one export
//   export.js --complete <folder>                           finish pending ones
//   export.js --json batch|commit <responseFile>            parse a response
//
// Responses are read from FILES rather than piped in. doShellScript carries
// output through a shell pipe, and proofs embed a multi-kilobyte attestation;
// reading a file has no such ceiling and cannot silently truncate.

'use strict';

var app = Application.currentApplication();
app.includeStandardAdditions = true;

// Unwrap the whole environment dictionary rather than calling objectForKey.
// An ObjC nil returned for a missing key is TRUTHY in JavaScript (it arrives as
// a function), so the obvious `objectForKey(k) ? ... : default` reads as "found"
// for a key that does not exist and yields undefined, which then silently
// becomes the string "undefined" in every URL.
var ENV = ObjC.unwrap($.NSProcessInfo.processInfo.environment) || {};
var API = ENV.BITGRAPH_API || 'https://bitgraph.ing';

// Anchors land within roughly 12-24s at the normal cadence, so the ceiling is
// about 2x that. It is a ceiling, not a delay: the wait returns the moment the
// anchor appears. Past it the export is written pending and a later run
// completes it, which is the path that carries a slow cadence and the daily
// rotation window. Keeping it short matters because the caller holds a lock.
var SEAL_WAIT_MS = 45000;
var POLL_MS = 3000;
var PENDING = '.bitgraph-pending.json';
var ANCHOR_DIR = 'ethereum-anchors';

// How many exports the folder holds, set by writeIndex before it walks them.
// A page only offers a way back when there is a sheet worth going back to:
// with one recording the contact sheet is that same recording, and with an
// export copied somewhere on its own there is no sheet at all.
var SIBLINGS = 0;

// ---------------------------------------------------------------------------
// Shell and filesystem
// ---------------------------------------------------------------------------

function quote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function sh(cmd) {
  try {
    return app.doShellScript(cmd);
  } catch (e) {
    return null;
  }
}

// Path("") raises an ObjC exception, which a JavaScript try/catch cannot catch:
// it terminates the process outright rather than returning an error. So every
// entry point checks for an empty path before constructing a Path, and a
// missing argument produces a clean failure instead of a crash.
function badPath(p) {
  return typeof p !== 'string' || p.length === 0;
}

function readFile(path) {
  if (badPath(path)) return null;
  try {
    return app.read(Path(path));
  } catch (e) {
    return null;
  }
}

/**
 * Write text as UTF-8.
 *
 * StandardAdditions' `write` encodes in the system's legacy encoding, not
 * UTF-8: an em dash came back out as the single byte 0xD1, which is what it is
 * in Mac Roman, and `file` reported the result as ISO-8859 despite the
 * document declaring charset=utf-8. Any filename carrying an accent or an
 * emoji would have been mangled the same way, and proof.json shares this
 * function, so attribution text was exposed too.
 *
 * NSString writes the encoding we ask for. Atomically, so a reader never sees
 * a half-written file.
 */
function writeFile(path, text) {
  if (badPath(path)) throw new Error('refusing to write to an empty path');
  var ok = $.NSString.stringWithString(String(text)).writeToFileAtomicallyEncodingError(
    path,
    true,
    $.NSUTF8StringEncoding,
    $()
  );
  if (!ok) throw new Error('could not write ' + path);
}

function writeJson(path, value) {
  writeFile(path, JSON.stringify(value, null, 2) + '\n');
}

function exists(path) {
  if (badPath(path)) return false;
  return sh('test -e ' + quote(path) + ' && echo yes') === 'yes';
}

function mkdirp(path) {
  if (badPath(path)) return;
  sh('mkdir -p ' + quote(path));
}

function sleepMs(ms) {
  sh('sleep ' + (ms / 1000));
}

function tempPath() {
  return sh('mktemp -t bitgraph-export') || '/tmp/bitgraph-export.json';
}

/** GET a URL and parse it. Returns null on any failure, which callers treat as absent. */
function getJson(url) {
  var tmp = tempPath();
  try {
    sh('curl -s --max-time 25 -o ' + quote(tmp) + ' ' + quote(url));
    var body = readFile(tmp);
    if (!body) return null;
    var parsed = JSON.parse(body);
    return parsed && parsed.error ? null : parsed;
  } catch (e) {
    return null;
  } finally {
    sh('rm -f ' + quote(tmp));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toUrlSafe(b64) {
  return String(b64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// Ledger reads
// ---------------------------------------------------------------------------

/** The proof at this exact causal position, or null. */
function fetchProof(digestB64, counter) {
  var data = getJson(API + '/api/proofs/digest/' + toUrlSafe(digestB64));
  if (!data || !data.proofs || !data.proofs.length) return null;
  // The same bytes can sit at several positions (BitGraph Again), so match on
  // the counter rather than taking the first.
  for (var i = 0; i < data.proofs.length; i++) {
    var p = data.proofs[i].proof || data.proofs[i];
    if (p && p.commit && String(p.commit.counter) === String(counter)) return p;
  }
  return null;
}

/** { before, after } anchor proofs bracketing a position. Either may be null. */
function fetchAnchors(counter, epochUrlSafe) {
  var q = 'counter=' + encodeURIComponent(counter) + '&epoch=' + encodeURIComponent(epochUrlSafe);
  var after = getJson(API + '/api/proofs/anchors?' + q + '&limit=1');
  var before = getJson(API + '/api/proofs/anchors?' + q + '&before=1');
  return {
    before: before && before.anchors && before.anchors[0] ? before.anchors[0] : null,
    after: after && after.anchors && after.anchors[0] ? after.anchors[0] : null,
  };
}

/**
 * The offline block-header witness for an anchor's block, or null.
 * The server self-checks it (returns it only when keccak256(header) equals the
 * signed block hash), so a miss just omits the file and the export stays valid.
 */
function fetchWitness(anchor) {
  var eth = anchor && anchor.ethereum;
  if (!eth || typeof eth.blockNumber !== 'number' || typeof eth.blockHash !== 'string') return null;
  return getJson(API + '/api/proofs/witness?block=' + eth.blockNumber +
    '&hash=' + encodeURIComponent(eth.blockHash));
}

/** Wait for the sealing anchor, returning as soon as it appears or at the deadline. */
function awaitSeal(counter, epochUrlSafe, deadlineMs) {
  var waited = 0;
  var anchors = fetchAnchors(counter, epochUrlSafe);
  while (!anchors.after && waited < deadlineMs) {
    sleepMs(POLL_MS);
    waited += POLL_MS;
    anchors = fetchAnchors(counter, epochUrlSafe);
  }
  return anchors;
}

// ---------------------------------------------------------------------------
// Export assembly
// ---------------------------------------------------------------------------

/** Write the proof material into an export directory. True once sealed. */
function writeExportContents(dir, meta, proof, waitMs) {
  var anchors = awaitSeal(meta.counter, meta.epochUrlSafe, waitMs);

  writeJson(dir + '/proof.json', proof);

  // Rebuilt wholesale each pass so a completion run cannot leave a stale
  // half-set behind.
  sh('rm -rf ' + quote(dir + '/' + ANCHOR_DIR));
  var sides = ['before', 'after'].filter(function (s) { return anchors[s]; });
  if (sides.length) {
    mkdirp(dir + '/' + ANCHOR_DIR);
    sides.forEach(function (side) {
      var anchor = anchors[side];
      writeJson(dir + '/' + ANCHOR_DIR + '/anchor-' + side + '.json', anchor);
      var witness = fetchWitness(anchor);
      if (witness) {
        writeJson(dir + '/' + ANCHOR_DIR + '/anchor-' + side + '-witness.json', witness);
      }
    });
  }
  return Boolean(anchors.after);
}

function markPending(dir, meta, sealed) {
  if (sealed) sh('rm -f ' + quote(dir + '/' + PENDING));
  else writeJson(dir + '/' + PENDING, meta);
}

/**
 * Pick the export directory, matching the website's bitgraph-proof-<counter>.
 * Counters are unique within an epoch but repeat across epochs, so on a real
 * collision with different bytes the epoch is appended rather than overwriting.
 */
function resolveDir(folder, counter, epochUrlSafe, digestB64) {
  var plain = folder + '/bitgraph-proof-' + counter;
  var existing = readFile(plain + '/proof.json');
  if (existing === null) return { dir: plain, alreadyBuilt: false };
  try {
    var p = JSON.parse(existing);
    if (p && p.artifact && p.artifact.digestB64 === digestB64) {
      return { dir: plain, alreadyBuilt: true };
    }
  } catch (e) {
    /* unreadable, treat as a collision */
  }
  var dir = plain + '-' + String(epochUrlSafe).slice(0, 8);
  return { dir: dir, alreadyBuilt: exists(dir + '/proof.json') };
}

function baseName(p) {
  var parts = String(p).split('/');
  return parts[parts.length - 1];
}

function dirName(p) {
  var parts = String(p).split('/');
  parts.pop();
  return parts.join('/') || '/';
}

/** Build a fresh export folder for one recorded file. */
function buildExport(filePath, digestB64, counter, epochUrlSafe) {
  var fileName = baseName(filePath);
  var folder = dirName(filePath);

  var proof = fetchProof(digestB64, counter);
  if (!proof) return 'error: no proof at #' + counter + ' for ' + fileName + ', file left in place';

  var r = resolveDir(folder, counter, epochUrlSafe, digestB64);
  if (r.alreadyBuilt) {
    // A re-fired watch must not redo the work. Still finish the move: the
    // caller marks the digest handled before calling in, so a run that died
    // between writing the contents and moving the file would otherwise strand
    // it at the top level forever.
    if (exists(filePath)) sh('mv ' + quote(filePath) + ' ' + quote(r.dir + '/' + fileName));
    return 'ok: already exported';
  }
  mkdirp(r.dir);

  var meta = {
    fileName: fileName,
    digestB64: digestB64,
    counter: String(counter),
    epochUrlSafe: String(epochUrlSafe),
  };
  var sealed = writeExportContents(r.dir, meta, proof, SEAL_WAIT_MS);
  markPending(r.dir, meta, sealed);

  // Moved in last, so a failure above never strands the file.
  if (exists(filePath)) sh('mv ' + quote(filePath) + ' ' + quote(r.dir + '/' + fileName));

  // Refresh the contact sheet, and never let it break a recording. The proof
  // is already written and sealed by this point; index.html is a derived view,
  // so a failure here costs a stale listing that the next drop or `--index`
  // repairs, and must not turn a successful recording into an error.
  try {
    writeIndex(folder);
  } catch (e) {
    /* rebuilt on the next drop */
  }

  return 'ok: ' + baseName(r.dir) + (sealed ? '' : ' (pending seal)');
}

/** Finish any export still waiting on the anchor that seals it. */
function completePending(folder) {
  var listing = sh('ls -1 ' + quote(folder) + ' 2>/dev/null');
  if (!listing) return 'ok: nothing pending';
  var names = listing.split('\r').join('\n').split('\n').filter(Boolean);
  var sealedCount = 0;

  names.forEach(function (name) {
    var dir = folder + '/' + name;
    var raw = readFile(dir + '/' + PENDING);
    if (raw === null) return;

    var meta;
    try {
      meta = JSON.parse(raw);
    } catch (e) {
      return;
    }
    var proof = fetchProof(meta.digestB64, meta.counter);
    if (!proof) return;
    try {
      // No waiting on a completion pass: take whatever has landed by now, so a
      // backlog of pending folders cannot stall the run.
      var sealed = writeExportContents(dir, meta, proof, 0);
      markPending(dir, meta, sealed);
      if (sealed) sealedCount++;
    } catch (e) {
      /* leave it pending; the next run tries again */
    }
  });
  // A completion pass turns pending exports into sealed ones, which changes
  // nothing the index shows today but keeps it correct if it ever surfaces
  // seal state. It also self-heals a folder whose index was never written,
  // e.g. one recorded before this version was installed.
  try {
    writeIndex(folder);
  } catch (e) {
    /* rebuilt on the next drop */
  }

  return 'ok: sealed ' + sealedCount;
}

// ---------------------------------------------------------------------------
// Response parsing for the shell script
// ---------------------------------------------------------------------------

function epochToUrlSafe(e) {
  return String(e || '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Batch-check response to `yes\t<counter>\t<epoch>` / `no` / `error`.
 * Reports the EARLIEST position so an already-on-record drop is exported from
 * its originating proof rather than a later BitGraph Again position.
 */
function parseBatch(body) {
  try {
    var results = JSON.parse(body).results || {};
    var keys = Object.keys(results);
    if (!keys.length) return 'no';
    var proofs = results[keys[0]].proofs || [];
    if (!proofs.length) return 'no';

    var earliest = null;
    proofs.forEach(function (entry) {
      var c = (entry.proof || entry).commit || {};
      if (earliest === null || Number(c.counter || 0) < Number(earliest.counter || 0)) earliest = c;
    });
    return 'yes\t' + (earliest.counter || '') + '\t' + epochToUrlSafe(earliest.epochId);
  } catch (e) {
    return 'error';
  }
}

/** Commit response to `ok\t<counter>\t<epoch>` / `retry` / `fail`. */
function parseCommit(body) {
  try {
    var parsed = JSON.parse(body);
    var p = Array.isArray(parsed) ? parsed[0] : parsed;
    var commit = (p && p.commit) || {};
    if (commit.counter !== undefined && commit.counter !== null) {
      return 'ok\t' + commit.counter + '\t' + epochToUrlSafe(commit.epochId);
    }
    // The service holds drops rather than failing them during epoch rotation.
    return p && p.code === 'tee-restarting' ? 'retry' : 'fail';
  } catch (e) {
    return 'fail';
  }
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------
//
// A contact sheet for the folder, written to index.html beside the proofs.
//
// It exists because a wall of `bitgraph-proof-1670` tells you nothing about
// what you recorded. Putting the filename in the folder name was the obvious
// fix and it is not enough: camera files are IMG_4032.jpg and downloads are
// HO1zC4UWMAAIqx0.jpg, so reading the name is not seeing the photo.
//
// Custom Finder icons were prototyped first and rejected. NSWorkspace can set
// one from an image in a single call, but every non-image needs a raster
// thumbnail generated for it, and `qlmanage -t` hung for over three minutes on
// a plain text file during that test. Thumbnail generation sits directly in the
// drop path here, so a hang there stalls recording. The browser has no such
// problem: it renders the image straight out of the folder, and a file that has
// no preview simply shows its name and type.
//
// DERIVED, never authoritative. Everything here is read back off disk each
// time, so this is a view rather than a second copy of anything. It cannot
// misreport a proof, because every row points at the real folder and the real
// proof page. If it is deleted, stale, or never written, nothing is lost and
// `--index` rebuilds it from scratch. That is what separates it from the
// .bitgraph.log that was removed: a log accumulates its own history and can
// drift, a view cannot.
//
// Offline by construction: relative paths, no webfont, no script, no network.
// The folder's whole claim is that nothing leaves the machine, so its index
// must not phone anywhere either. That is also why the type is a system stack
// rather than the site's Acumin Pro, which would need Typekit.

// svg goes here rather than with the text types: a browser renders it as a
// picture in an <img>, which is what it is.
var IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif', 'bmp', 'tiff', 'tif', 'svg'];

// Anything the browser will display as text on its own. No thumbnail has to be
// generated for these either: an <iframe> shows the top of the file, which for
// a note or a CSV is a better identifier than the extension in grey capitals.
// Always sandboxed, so a recorded .html or .svg cannot run script in the page
// that embeds it.
var TEXT_EXT = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'xml', 'yml', 'yaml', 'html', 'htm', 'rtf'];

// A <video> paints its first frame once metadata loads, which is a real
// thumbnail for free. preload=metadata so a folder of films does not pull whole
// files in just to draw the sheet.
var VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm', 'ogv'];

// Audio has no frame to show, so the cell keeps a label; the export's own page
// gets a player, where listening is the point.
var AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'aiff', 'aif', 'flac', 'oga', 'ogg'];

// Viewer controls off, so an embedded PDF reads as the document rather than as
// an application. Ampersands are escaped because this goes in an attribute.
var PDF_VIEW = '#toolbar=0&amp;navpanes=0&amp;scrollbar=0&amp;view=FitH';

/**
 * One document, shared by the contact sheet and the per-export pages so they
 * cannot drift apart.
 *
 * Square corners, brand blue reserved for actions, no button slabs: the site's
 * rules, restated here because these files ship alone and can never reach a
 * stylesheet. The wrapper class is `wrap` rather than `w`, which previously
 * collided with the time line's class and silently cancelled the page's
 * `margin:0 auto`.
 */
function pageShell(title, extraCss, bodyHtml) {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    // These pages are rewritten in place at the same path every time a file is
    // dropped, which is the case a browser cache gets wrong: you reload and see
    // the sheet as it was before the drop. Nothing here is worth caching, and a
    // stale contact sheet is worse than no contact sheet.
    '<meta http-equiv="cache-control" content="no-cache, no-store, must-revalidate">' +
    '<meta http-equiv="pragma" content="no-cache"><meta http-equiv="expires" content="0">' +
    '<title>' + esc(title) + '</title><style>' +
    '*{box-sizing:border-box}' +
    'body{margin:0;padding:48px 24px 80px;background:#f5f5f5;color:#111827;' +
    'font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;' +
    '-webkit-font-smoothing:antialiased}' +
    '.wrap{max-width:800px;margin:0 auto}' +
    'h1{margin:0 0 4px;font-size:28px;font-weight:600;letter-spacing:-.03em;overflow-wrap:anywhere}' +
    '.s{margin:0 0 40px;color:#4b5563;font-size:14px}' +
    '.l{margin:8px 0 0}' +
    '.l a{color:#0065A4;font-weight:600;font-size:14px;text-decoration:none}' +
    '.sep{display:inline-block;width:18px}' +
    '.a{display:inline-block;transition:transform .18s ease}' +
    '@media (hover:hover){.l a:hover .a{transform:translateX(3px)}}' +
    '@media (max-width:520px){body{padding:32px 16px 64px}}' +
    extraCss +
    '</style></head><body><div class="wrap">' +
    bodyHtml +
    '</div></body></html>\n'
  );
}

function esc(s) {
  return String(s)
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;');
}

/** Percent-encode each path segment, leaving the separators intact. */
function encodePath(p) {
  return String(p).split('/').map(encodeURIComponent).join('/');
}

function extOf(name) {
  var i = String(name).lastIndexOf('.');
  return i === -1 ? '' : String(name).slice(i + 1).toLowerCase();
}

/** The recorded file in an export: not the proof, the anchors, or a marker. */
function artifactIn(dir) {
  var listing = sh('ls -1 ' + quote(dir) + ' 2>/dev/null');
  if (!listing) return null;
  var names = listing.split('\r').join('\n').split('\n').filter(Boolean);
  for (var i = 0; i < names.length; i++) {
    var n = names[i];
    // index.html is written BY this script, so it must never be mistaken for
    // the thing that was recorded. Held aside rather than discarded: see below.
    if (n === 'proof.json' || n === ANCHOR_DIR || n === PENDING || n === 'index.html') continue;
    if (n.charAt(0) === '.' || n.indexOf('Icon') === 0) continue;
    return n;
  }
  return null;
}

var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---- Time ------------------------------------------------------------------
//
// A BitGraph proof carries no clock reading. Its time statement is the pair of
// Ethereum anchors that bracket it, so the only honest rendering is a window:
// recorded after one block was mined and before the next. Printing a single
// instant would be the "proves when it was taken" claim this project refuses to
// make, which is why the row says "between ... and ..." and never "at".
//
// The block times are not stored as fields anywhere in the export. They live
// inside headerRlpHex in ethereum-anchors/*-witness.json, as field 12 of the
// RLP block header, so getting them means decoding the header here. That is
// what the three functions below do, walking only as far as item 11 rather
// than decoding the whole structure.
//
// Deriving it from the witness rather than trusting a stored number is also
// the stronger construction: the witness is the block header itself, and its
// hash is the anchor the proof commits to.

function hexToBytes(hex) {
  var s = String(hex).replace(/^0x/, '');
  if (s.length % 2 !== 0) return null;
  var out = [];
  for (var i = 0; i < s.length; i += 2) {
    var b = parseInt(s.substr(i, 2), 16);
    if (isNaN(b)) return null;
    out.push(b);
  }
  return out;
}

/**
 * Bounds of the RLP item starting at i: where its payload begins, how long it
 * is, and where the next item starts. A byte under 0x80 encodes itself, so its
 * payload is the byte at i and its length is 1, which lets callers read every
 * item the same way.
 */
function rlpItemAt(b, i) {
  var p = b[i];
  if (p === undefined) return null;
  if (p < 0x80) return { start: i, len: 1, next: i + 1, list: false };
  if (p <= 0xb7) return { start: i + 1, len: p - 0x80, next: i + 1 + (p - 0x80), list: false };
  if (p <= 0xbf) {
    var n = p - 0xb7, len = 0;
    for (var k = 0; k < n; k++) len = len * 256 + b[i + 1 + k];
    return { start: i + 1 + n, len: len, next: i + 1 + n + len, list: false };
  }
  if (p <= 0xf7) return { start: i + 1, len: p - 0xc0, next: i + 1 + (p - 0xc0), list: true };
  var m = p - 0xf7, plen = 0;
  for (var j = 0; j < m; j++) plen = plen * 256 + b[i + 1 + j];
  return { start: i + 1 + m, len: plen, next: i + 1 + m + plen, list: true };
}

/**
 * Unix seconds from an RLP-encoded Ethereum block header, or 0.
 *
 * Header field order is fixed and the first twelve have never changed across
 * forks: parentHash, uncleHash, coinbase, stateRoot, txRoot, receiptRoot,
 * logsBloom, difficulty, number, gasLimit, gasUsed, timestamp. So walk eleven
 * items and read the twelfth. A timestamp is about 1.7e9, far inside the
 * range JavaScript integers hold exactly.
 */
function rlpHeaderTimestamp(hex) {
  var b = hexToBytes(hex);
  if (!b) return 0;
  var outer = rlpItemAt(b, 0);
  if (!outer || !outer.list) return 0;

  var i = outer.start;
  for (var idx = 0; idx < 11; idx++) {
    var it = rlpItemAt(b, i);
    if (!it) return 0;
    i = it.next;
  }
  var ts = rlpItemAt(b, i);
  if (!ts || ts.len > 8) return 0;

  var v = 0;
  for (var q = 0; q < ts.len; q++) v = v * 256 + b[ts.start + q];
  return v;
}

/**
 * The anchors bracketing this export: block time and block number for each.
 * Either side may be absent, which is what a pending seal looks like.
 *
 * The time is decoded from the witness header rather than read from a field,
 * because the witness IS the block header and its hash is what the proof
 * commits to. The block number is taken from the witness too, so both numbers
 * on a row come from the same artifact.
 */
function anchorInfo(dir) {
  function read(which) {
    var raw = readFile(dir + '/' + ANCHOR_DIR + '/anchor-' + which + '-witness.json');
    if (raw === null) return { ts: 0, block: 0 };
    try {
      var w = JSON.parse(raw);
      return {
        ts: w && w.headerRlpHex ? rlpHeaderTimestamp(w.headerRlpHex) : 0,
        block: (w && w.blockNumber) || 0,
      };
    } catch (e) {
      return { ts: 0, block: 0 };
    }
  }
  return { before: read('before'), after: read('after') };
}

function clockOf(d) {
  var h = d.getHours();
  var h12 = h % 12 === 0 ? 12 : h % 12;
  var mm = d.getMinutes() < 10 ? '0' + d.getMinutes() : String(d.getMinutes());
  // Seconds are not optional. Anchors land every 12 seconds, so both bounds of
  // a window usually fall inside the same minute and would print identically
  // without them, making a real interval look like a rendering fault.
  var ss = d.getSeconds() < 10 ? '0' + d.getSeconds() : String(d.getSeconds());
  return h12 + ':' + mm + ':' + ss + (h >= 12 ? 'pm' : 'am');
}

// The site prints "12:54:11 PM EDT": uppercase meridiem, spaced, with the
// zone named. clockOf's compact "12:54:11pm" is for the contact sheet's cells,
// where the row has to fit on one line.
var TZ = sh('date +%Z') || '';

function clock12(d) {
  var h = d.getHours();
  var h12 = h % 12 === 0 ? 12 : h % 12;
  var mm = d.getMinutes() < 10 ? '0' + d.getMinutes() : String(d.getMinutes());
  var ss = d.getSeconds() < 10 ? '0' + d.getSeconds() : String(d.getSeconds());
  return h12 + ':' + mm + ':' + ss + ' ' + (h >= 12 ? 'PM' : 'AM');
}

function dateOf(d) {
  return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

/**
 * The row's time. Shown in local time, since this sheet is read on the machine
 * that holds the folder.
 *
 * Falls back to the filesystem time only when the window cannot be built,
 * which means a still-pending seal or a missing witness. That case is labelled
 * "added" rather than given a bare timestamp, so a local clock reading is never
 * dressed up as the proof's claim.
 */
function rowTime(info, mtime) {
  var w = { before: info.before.ts, after: info.after.ts };

  if (w.before && w.after) {
    var b = new Date(w.before * 1000);
    var a = new Date(w.after * 1000);
    var sameDay = dateOf(b) === dateOf(a);

    // Compact enough to survive one line in a grid cell. The full form,
    // "Aug 3, 2026 . between 11:49:35pm and 11:49:47pm", is 46 characters and
    // clipped at about 298px of text, which cut off the closing bound: the
    // half that makes this a window rather than an instant. So the year goes
    // (the export's own page states it in full) and the opening meridiem goes
    // when both bounds share one, which is the normal way to set a range.
    // Nothing that carries meaning is dropped.
    var sameHalf = (b.getHours() < 12) === (a.getHours() < 12);
    var open = sameDay && sameHalf ? clockOf(b).replace(/(am|pm)$/, '') : clockOf(b);

    return MONTHS[b.getMonth()] + ' ' + b.getDate() + ' &middot; between ' + open + ' and ' +
      (sameDay ? '' : MONTHS[a.getMonth()] + ' ' + a.getDate() + ' ') + clockOf(a);
  }
  if (w.before) {
    // The upper anchor has not landed yet, so there is only a lower bound.
    // Same compaction as the settled case: no year, since the export's own
    // page carries it in full.
    var lo = new Date(w.before * 1000);
    return MONTHS[lo.getMonth()] + ' ' + lo.getDate() + ' &middot; after ' + clockOf(lo) + ', sealing';
  }
  var n = parseInt(mtime, 10);
  if (!isFinite(n) || n <= 0) return '';
  var f = new Date(n * 1000);
  return 'added ' + dateOf(f) + ' at ' + clockOf(f);
}

function indexRow(folder, name, mtime) {
  var dir = folder + '/' + name;
  var raw = readFile(dir + '/proof.json');
  if (raw === null) return null;

  var proof;
  try {
    proof = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  var digest = proof && proof.artifact && proof.artifact.digestB64;
  if (!digest) return null;

  var counter = (proof.commit && proof.commit.counter) || '';
  var file = artifactIn(dir);
  var rel = file ? encodePath(name + '/' + file) : null;
  var isImage = file && IMAGE_EXT.indexOf(extOf(file)) !== -1;

  var isPdf = file && extOf(file) === 'pdf';

  // The thumbnail opens the file's own page, not the raw bytes. Everything
  // about a recording lives on that page, the file among it, so sending the
  // most obvious click straight to the artifact skipped past the thing you
  // actually wanted.
  var page = encodePath(name) + '/index.html';

  var thumb = isImage
    // loading=lazy so a folder with hundreds of recordings still opens at once.
    ? '<a class="t" href="' + page + '"><img src="' + rel + '" alt="" loading="lazy"></a>'
    : isPdf
      ? '<a class="t pdf" href="' + page + '"><embed src="' + rel + PDF_VIEW + '" type="application/pdf"></a>'
      : file && VIDEO_EXT.indexOf(extOf(file)) !== -1
        ? '<a class="t" href="' + page + '"><video src="' + rel +
          '" preload="metadata" muted playsinline tabindex="-1"></video></a>'
      : file && TEXT_EXT.indexOf(extOf(file)) !== -1
        ? '<a class="t doc" href="' + page + '"><iframe src="' + rel +
          '" sandbox loading="lazy" tabindex="-1" scrolling="no"></iframe></a>'
        // An empty box when there is no artifact to name, not a dash. The house
        // rule is no em dashes anywhere, and this one was also the character
        // that exposed the encoding bug above.
        : '<a class="t none" href="' + page + '">' + esc(file ? (extOf(file) || 'FILE').toUpperCase() : '') + '</a>';

  // Two links, in the order you would use them: the file first, because that
  // is what you came to look at, then the proof. A third link straight to the
  // raw bytes was cut, since the file's page already lists them along with
  // proof.json and the anchors.
  //
  // It points at index.html rather than at the directory on purpose. A browser
  // given a `file:` directory link renders its own unstyleable listing,
  // "Index of /private/tmp/…" in Times, headed by the absolute path. Naming
  // the file is what lets our page win. It still opens in a browser rather
  // than revealing the folder in Finder, which nothing in a web page can do
  // without a registered URL scheme, which needs an app bundle, which is the
  // one thing "a folder, not an app" rules out.
  var openFile = '<a href="' + page + '">Open file <span class="a">&rarr;</span></a>';

  var info = anchorInfo(dir);

  // Written here rather than at export time so it is rebuilt on every index
  // pass: a folder recorded before this version existed gets its page on the
  // next drop, and a deleted one comes back.
  try {
    writeProofPage(folder, name, file, digest, counter, info, mtime);
  } catch (e) {
    /* the row still works without it */
  }

  return (
    '<li>' +
    thumb +
    '<div class="m">' +
    // title carries the full name, since a long one is clipped to keep every
    // cell the same height.
    '<p class="n" title="' + esc(file || name) + '">' + esc(file || name) + '</p>' +
    '<p class="c">' + esc(name) + (counter ? ' &middot; #' + esc(counter) : '') + '</p>' +
    '<p class="tm">' + rowTime(info, mtime) + '</p>' +
    '<p class="l">' +
    openFile +
    '<span class="sep"></span>' +
    // The proof page is the one link that leaves the machine, so it opens in
    // its own tab: the sheet is a place you work through, and following a row
    // should not cost you your place in it.
    '<a href="' + API + '/proof/' + encodeURIComponent(toUrlSafe(digest)) +
    '" target="_blank" rel="noopener noreferrer">Open proof <span class="a">&rarr;</span></a>' +
    '</p></div></li>'
  );
}

/**
 * The page one export opens to, written inside the export as index.html.
 *
 * It exists because a browser handed a `file:` directory link renders its own
 * listing, and there is no styling it: "Index of /private/tmp/…" in Times, with
 * the full absolute path as a heading. Pointing the link at index.html instead
 * of at the directory means the browser renders this rather than that.
 *
 * ⚠️ This is the one thing in the export that the website's zip does not
 * contain, so a Folder export and a downloaded one are no longer byte-identical.
 * It is inert: derived, rewritten on every index pass, ignored by the auditor
 * (which finds proofs by schema shape, not by filename), and deletable with no
 * loss. Nothing verifies against it.
 */
function writeProofPage(folder, name, file, digest, counter, info, mtime) {
  var dir = folder + '/' + name;

  // NEVER write over the artifact. The page has to be called index.html, since
  // that is what makes a browser render it instead of generating its own
  // directory listing, so an export whose recorded file is itself named
  // index.html cannot have one: writing it would destroy the very bytes the
  // proof describes. The 2026-08-04 feedback loop recorded the sheet six times
  // and this function overwrote all six artifacts before the collision was
  // noticed. The hot folder now skips index.html so nothing new can land in
  // that state, and this guard means the generator cannot do the damage even
  // if something does.
  if (exists(dir + '/index.html')) {
    var existingHash = sh(
      'openssl dgst -sha256 -binary ' + quote(dir + '/index.html') + ' 2>/dev/null | openssl base64 -A 2>/dev/null'
    );
    if (existingHash && String(existingHash).trim() === String(digest).trim()) return;
  }

  var proofRaw = readFile(dir + '/proof.json');
  var proof = null;
  try { proof = proofRaw ? JSON.parse(proofRaw) : null; } catch (e) { proof = null; }

  var ext = file ? extOf(file) : '';
  var isImage = file && IMAGE_EXT.indexOf(ext) !== -1;
  var isPdf = file && ext === 'pdf';
  var isVideo = file && VIDEO_EXT.indexOf(ext) !== -1;
  var isAudio = file && AUDIO_EXT.indexOf(ext) !== -1;
  var isText = file && TEXT_EXT.indexOf(ext) !== -1;

  // Answered here rather than by sending someone to the site to drop the file
  // in by hand: this script has the bytes, so it hashes them and compares
  // against what the proof commits to. Silent when they match, which is every
  // normal page; announcing a match would promise a contrast the page cannot
  // show and train the reader to skim past the one time it mattered.
  var binding = null;
  if (file) {
    var got = sh(
      'openssl dgst -sha256 -binary ' + quote(dir + '/' + file) + ' 2>/dev/null | openssl base64 -A 2>/dev/null'
    );
    if (got) binding = String(got).trim() === String(digest).trim();
  }

  var sizeStr = '';
  if (file) {
    var b = parseInt(sh('stat -f%z ' + quote(dir + '/' + file) + ' 2>/dev/null'), 10);
    if (isFinite(b) && b > 0) {
      sizeStr = b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB'
        : b >= 1024 ? Math.round(b / 1024) + ' KB' : b + ' bytes';
    }
  }

  /* ---- the proof page's own components, rebuilt in plain HTML ---- */

  // Every field is tap-to-copy and swaps its value for "Copied!", which is what
  // that page does and the reason neither has a copy button.
  function field(label, value, opts) {
    if (value === undefined || value === null || value === '') return '';
    opts = opts || {};
    var cls = 'f' + (opts.mono ? ' mono' : '') + (opts.hl ? ' hl' : '');
    if (opts.link) {
      return '<div class="f"><span class="fl">' + esc(label) + '</span>' +
        '<a class="fv lnk" href="' + esc(value) + '" target="_blank" rel="noopener noreferrer">' +
        esc(value) + '</a></div>';
    }
    return '<div class="' + cls + '" data-copy="' + esc(value) + '">' +
      '<span class="fl">' + esc(label) + '</span>' +
      '<span class="fv">' + esc(value) + '</span></div>';
  }

  function card(title, inner, plain) {
    if (!inner) return '';
    // A plain card has NO header. The proof page passes a title and then
    // renders nothing for it, because the h1 above already says it and the
    // card's contents are the point of the page. Drawing the header here
    // printed "BitGraph Recorded" twice, once as the heading and once in blue
    // inside the box beneath it.
    if (plain) return '<section class="cd">' + inner + '</section>';
    return '<section class="cd"><details><summary class="hd">' +
      '<span>' + esc(title) + '</span>' +
      '<span class="chev" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="square" ' +
      'stroke-linejoin="miter"><path d="M9 6 L15 12 L9 18"/></svg></span>' +
      '</summary><div class="bd">' + inner + '</div></details></section>';
  }

  var rel = file ? encodePath(file) : null;
  var media = isImage
    ? '<div class="hero"><a href="' + rel + '"><img src="' + rel + '" alt=""></a></div>'
    : isPdf
      ? '<div class="hero"><embed class="doc" src="' + rel + '" type="application/pdf"></div>'
      : isVideo
        ? '<div class="hero"><video class="av" src="' + rel + '" controls preload="metadata" playsinline></video></div>'
        : isAudio
          ? '<div class="hero"><audio class="au" src="' + rel + '" controls preload="metadata"></audio></div>'
          : isText
            ? '<div class="hero"><iframe class="doc" src="' + rel + '" sandbox></iframe></div>'
            : '';

  // "BitGraph Recorded", the page's one always-open card, exactly as the proof
  // page treats it: the artifact, what it is called, and the hash that binds
  // them. Everything else is collapsed beneath it.
  // The window, written the way that page writes it: the date as the heading,
  // the interval beneath it in the data font. It leads the card rather than
  // being a section of its own, because it is what the recording IS.
  var whenRow = '';
  if (info.before.ts && info.after.ts) {
    var wb = new Date(info.before.ts * 1000);
    var wa = new Date(info.after.ts * 1000);
    whenRow = '<div class="when"><div class="wd">' + dateOf(wb) + '</div>' +
      '<div class="wt">between ' + clock12(wb) + ' and ' + clock12(wa) + ' ' + TZ + '</div></div>';
  } else if (info.before.ts) {
    var wo = new Date(info.before.ts * 1000);
    whenRow = '<div class="when"><div class="wd">' + dateOf(wo) + '</div>' +
      '<div class="wt">after ' + clock12(wo) + ' ' + TZ + ', sealing</div></div>';
  }

  var head =
    whenRow +
    media +
    '<div class="fn">' +
    '<span>' + esc(file || name) + (sizeStr ? ' &middot; ' + esc(sizeStr) : '') + '</span>' +
    (rel ? '<a class="op" href="' + rel + '">Open <span class="arrow">&rarr;</span></a>' : '') +
    '</div>' +
    field('File Hash', digest, { mono: true });

  var slot = (proof && proof.slotAllocation) || null;
  var commit = (proof && proof.commit) || {};
  var signer = (proof && proof.signer) || {};
  var env = (proof && proof.environment) || {};
  var attr = (proof && proof.attribution) || null;

  function anchorCard(title, side) {
    if (!side.block && !side.ts) return '';
    var inner = field('Block', side.block ? '#' + side.block : '', { hl: true });
    if (side.ts) {
      var d = new Date(side.ts * 1000);
      inner += field('Block Time', clockOf(d) + ' on ' + dateOf(d));
    }
    if (side.block) inner += field('Etherscan', 'https://etherscan.io/block/' + side.block, { link: true });
    return card(title, inner);
  }

  // The proof page's order, which is the construction's order: what was
  // reserved, what was committed into it, who signed it, where it ran, and only
  // then the blocks that bracket it. The anchors are a bound placed on the
  // whole thing afterwards, so they come after the thing they bound, not first.
  //
  // Two of that page's cards cannot exist here: Content Credentials needs the
  // C2PA toolkit, and Recordings needs the ledger to know the other positions.
  var body =
    card('BitGraph Recorded', head, true) +
    (slot
      ? card('Reserved Slot',
          field('Slot Counter', slot.counter ? '#' + slot.counter : '', { hl: true }) +
          field('Nonce', slot.nonceB64, { mono: true }) +
          field('Slot Signature', slot.signatureB64, { mono: true }) +
          field('Epoch ID', slot.epochId, { mono: true }))
      : '') +
    card('Artifact Commit',
      field('Artifact Counter', commit.counter ? '#' + commit.counter : '', { hl: true }) +
      field('Epoch ID', slot ? '' : commit.epochId, { mono: true }) +
      field('Previous Hash', commit.prevB64, { mono: true }) +
      field('Slot Hash', commit.slotHashB64, { mono: true })) +
    card('Signature',
      field("This BitGraph's Hash", proof && proof.proofHash, { mono: true }) +
      field('Signature', signer.signatureB64, { mono: true }) +
      field('Public Key', signer.publicKeyB64, { mono: true })) +
    card(env.enforcement === 'software' ? 'Software' : 'Hardware Enclave',
      field('PCR0 Measurement', env.measurement, { mono: true }) +
      field('Attestation Format', env.attestation && env.attestation.format)) +
    anchorCard('Recorded after this block', info.before) +
    anchorCard('Recorded before this block', info.after) +
    (attr
      ? card("Submitter's Note",
          field('Submitted by', attr.name) +
          field('Note', attr.message, { mono: true }))
      : '') +
    (proofRaw ? card('Raw JSON', '<pre class="copy" title="Click to copy">' + esc(proofRaw) + '</pre>') : '');

  writeFile(
    dir + '/index.html',
    pageShell(
      file || name,
      proofPageCss(),
      // The site's nav bar, with the back link standing where the wordmark
      // stands there. Same slot, same weight: on a page inside a folder the
      // way out is what the logo is on the site.
      '<nav class="nv">' +
        (SIBLINGS > 1
          ? '<a class="hm" href="../index.html"><span class="arrow">&larr;</span> All recordings</a>'
          : '<span></span>') +
        '</nav>' +
        '<h1>BitGraph Recorded</h1>' +
        (binding === false
          ? '<p class="bind"><b>This file does not match the proof.</b> Its SHA-256 differs from the ' +
            'file hash below, so these are not the same bytes. Either the file changed after it was ' +
            'recorded, or it is not the file this proof describes.' +
            '<span class="audit">npx @mikeargento/bitgraph-audit ' + esc(name) + '</span></p>'
          : '') +
        body +
        '<div id="c">Copied!</div>' +
        copyScript()
    )
  );
}

/** "In this folder", as one more card in the stack. */
function filesCard(dir, artifact) {
  var listed = [];
  var seen = {};
  function add(rel) {
    if (seen[rel] || !exists(dir + '/' + rel)) return;
    seen[rel] = true;
    listed.push(rel);
  }
  // Ordered by what each thing IS, not by name: the recorded file, then its
  // proof, then the anchor evidence, lower bound first with each witness after
  // the anchor it witnesses.
  if (artifact) add(artifact);
  add('proof.json');
  ['anchor-before.json', 'anchor-before-witness.json', 'anchor-after.json', 'anchor-after-witness.json']
    .forEach(function (a) { add(ANCHOR_DIR + '/' + a); });

  var out = listed.map(function (rel) {
    return '<div class="f"><span class="fl">' + esc(rel) + '</span>' +
      '<a class="fv lnk" href="' + encodePath(rel) + '">Open</a></div>';
  }).join('');
  return out ? cardStatic('In this folder', out) : '';
}

function cardStatic(title, inner) {
  return '<section class="cd"><details><summary class="hd">' +
    '<span>' + esc(title) + '</span>' +
    '<span class="chev" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" ' +
    'fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="square" ' +
    'stroke-linejoin="miter"><path d="M9 6 L15 12 L9 18"/></svg></span>' +
    '</summary><div class="bd">' + inner + '</div></details></section>';
}

/** Values lifted from the proof page so the two read as one design. */
function proofPageCss() {
  return (
    '.nv{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 34px}' +
    '.hm{color:#0065A4;font-weight:600;font-size:14px;text-decoration:none}' +
    '@media (hover:hover){.hm:hover .arrow{transform:translateX(-3px)}}' +
    '.nn{color:#4b5563;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;' +
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    // The proof page's own values for this heading, which is a 20px/800 line
    // rather than the shell's 28px/600 page title: it asserts the recording
    // happened, it does not name the document.
    'h1{margin:0 0 10px;font-size:20px;font-weight:800;letter-spacing:-.02em;color:#111827}' +
    '.when{display:flex;flex-direction:column;gap:5px;padding:14px 16px;' +
    'border-bottom:1px solid #e2e5e9}' +
    '.wd{font-size:14px;font-weight:700;color:#111827;letter-spacing:-.01em}' +
    '.wt{font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#1f2937}' +
    '.cd{background:#fff;border:1px solid #d0d5dd;overflow:hidden;margin:0 0 10px}' +
    '.hd{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;' +
    'font-size:14px;font-weight:700;letter-spacing:.04em;color:#0065A4;padding:14px 16px;' +
    'background:#fff;cursor:pointer;list-style:none}' +
    '.hd::-webkit-details-marker{display:none}' +
    '.hd.plain{cursor:default}' +
    'details[open]>.hd{background:rgba(0,101,164,.07);border-bottom:1px solid #e2e5e9}' +
    '@media (hover:hover){summary.hd:hover{background:rgba(0,101,164,.07)}}' +
    '.chev{flex-shrink:0;display:inline-flex;transition:transform .18s}' +
    'details[open]>.hd .chev{transform:rotate(90deg)}' +
    '.f{display:flex;flex-direction:column;gap:5px;padding:14px 16px;' +
    'border-bottom:1px solid #e2e5e9;cursor:pointer}' +
    '.f:last-child{border-bottom:0}' +
    '.fl{font-size:14px;color:#374151;font-weight:700}' +
    '.fv{font-size:14px;color:#1f2937;line-height:1.6;word-break:break-all}' +
    // Long fixed-length strings stay on one line and scroll, rather than being
    // shredded across ragged wrapped lines. Still tap-to-copy, so nobody has to
    // scroll to grab one.
    '.mono .fv{font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;' +
    'white-space:nowrap;overflow-x:auto;word-break:normal}' +
    '.hl .fv{color:#0065A4;font-weight:700}' +
    '.lnk{color:#0065A4;text-decoration:none;font-size:13px}' +
    // The proof page's PhotoCard, values and all: 20px of padding inside the
    // card, the artwork centred in it, and a min(70vh,640px) ceiling with
    // object-fit contain. Edge-to-edge at a smaller cap was the difference
    // that made this look like a different page.
    '.hero{background:#fff;padding:20px;display:flex;align-items:center;justify-content:center}' +
    '.hero img{max-width:100%;max-height:min(70vh,640px);width:auto;height:auto;' +
    'display:block;object-fit:contain}' +
    '.hero .doc{width:100%;height:min(70vh,640px);border:0;display:block;background:#fff}' +
    '.hero .av{max-width:100%;max-height:min(70vh,640px);display:block;background:#111827}' +
    '.hero .au{width:100%;display:block}' +
    '.fn{display:flex;align-items:center;justify-content:space-between;gap:12px;' +
    'padding:14px 16px;border-top:1px solid #e2e5e9;font-size:14px;font-weight:600;color:#111827}' +
    '.op{color:#0065A4;font-weight:600;text-decoration:none;flex-shrink:0}' +
    '.arrow{display:inline-block;transition:transform .18s}' +
    '@media (hover:hover){.op:hover .arrow{transform:translateX(3px)}}' +
    '.bd pre.copy{margin:0;padding:14px 16px;background:#fff;border:0;' +
    'font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#374151;' +
    'white-space:pre-wrap;word-break:break-all;cursor:pointer;max-height:420px;overflow:auto}' +
    '.bind{margin:0 0 16px;padding:14px 16px;border:1px solid #dc2626;font-size:14px;color:#111827}' +
    '.bind b{font-weight:600;color:#dc2626}' +
    '.bind .audit{display:block;margin-top:8px;color:#4b5563;' +
    'font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}' +
    '#c{display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:50;' +
    'padding:10px 22px;font-size:14px;font-weight:700;color:#fff;background:#0065A4;' +
    'pointer-events:none;box-shadow:0 4px 20px rgba(0,0,0,.22)}'
  );
}

/** Tap a field or a JSON block to copy it, the proof page's own affordance. */
function copyScript() {
  return '<script>(function(){var c=document.getElementById("c");' +
    'function ok(){c.style.display="block";setTimeout(function(){c.style.display="none"},1500)}' +
    'function put(t){if(navigator.clipboard&&navigator.clipboard.writeText){' +
    'navigator.clipboard.writeText(t).then(ok,function(){ok()})}else{ok()}}' +
    'Array.prototype.forEach.call(document.querySelectorAll("[data-copy]"),function(f){' +
    'f.addEventListener("click",function(){var v=f.querySelector(".fv");var o=v.textContent;' +
    'put(f.getAttribute("data-copy"));v.textContent="Copied!";v.style.color="#0065A4";' +
    'setTimeout(function(){v.textContent=o;v.style.color=""},1500)})});' +
    'Array.prototype.forEach.call(document.querySelectorAll("pre.copy"),function(p){' +
    'p.addEventListener("click",function(){put(p.textContent)})});' +
    '})();</script>';
}

/** Rebuild index.html from whatever is on disk, newest first. */
function writeIndex(folder) {
  // One stat call for order and fallback time together. Newest first, by
  // modification time: counters cannot do this job because they reset every
  // epoch, so a folder from today and one from last week are not comparable by
  // number alone. The glob is expanded by the shell, so `folder` is quoted and
  // the pattern is not.
  var listing = sh('cd ' + quote(folder) + ' && stat -f "%m %N" bitgraph-proof-* 2>/dev/null');
  var lines = listing ? listing.split('\r').join('\n').split('\n').filter(Boolean) : [];

  var entries = [];
  lines.forEach(function (line) {
    var gap = line.indexOf(' ');
    if (gap === -1) return;
    var name = line.slice(gap + 1);
    if (name.indexOf('bitgraph-proof-') !== 0) return;
    entries.push({ name: name, mtime: parseInt(line.slice(0, gap), 10) || 0 });
  });
  entries.sort(function (x, y) { return y.mtime - x.mtime; });

  SIBLINGS = entries.length;

  var rows = [];
  entries.forEach(function (e) {
    var row = indexRow(folder, e.name, e.mtime);
    if (row) rows.push(row);
  });

  var body = rows.length
    ? '<ul>' + rows.join('') + '</ul>'
    : '<p class="empty">Nothing recorded yet. Drop a file into this folder.</p>';

  writeFile(
    folder + '/index.html',
    pageShell(
      // The product's own name, not just "BitGraph". This is the one page that
      // names it, since each export page is titled by its filename, and the
      // string is the browser tab too: with the site and a few proof pages
      // open, half the tabs otherwise read "BitGraph" and none of them are
      // this. Not "BitGraph Desktop Folder", which was rejected because
      // "Desktop" reads as desktop app.
      'BitGraph Folder',
      // A contact sheet, so it reflows: auto-fill with a 230px minimum gives
      // three across the 800px column, two around 520px, one on a phone, with
      // no breakpoints to maintain. A single column was fine at nine
      // recordings and unusable at several hundred.
      //
      // The thumbnail goes on top at the cell's full width rather than beside
      // the text, because at 230px a side-by-side row leaves the filename
      // about eleven characters.
      // The contact sheet ignores the 800px reading column the rest of the
      // site keeps. 800px is a measure for prose; this page is pictures, and
      // capping it wasted most of a wide display while forcing the text under
      // each one to wrap.
      '.wrap{max-width:none}' +
        // 300px, not 230px, because the cell has to hold the full time window
        // on one line: "Aug 3, 2026 . between 10:57:47pm and 10:58:11pm" is
        // about 46 characters, and truncating it would cut off one of the two
        // bounds, which is the half that makes it a window at all.
        'ul{list-style:none;margin:0;padding:0;display:grid;gap:34px 24px;' +
        'grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}' +
        // Each cell is the site's card: white, 1px #d0d5dd, square corners.
        // At five or seven columns the caption needs something tying it to its
        // own thumbnail, and the page background alone was not doing it.
        'li{display:block;min-width:0;background:#fff;border:1px solid #d0d5dd}' +
        // Nothing wraps. Long filenames get an ellipsis rather than a second
        // line, so every cell is the same height and the grid stays a grid;
        // the full name is on the element's title for hovering.
        '.n,.c,.tm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        // Overrides the shared 88px square: fills the cell, fixed aspect so
        // the grid stays even whatever shape the pictures are.
        // The thumbnail. Only this page has one, which is why these live here
        // rather than in the shared shell. Flush to the card's edges so the
        // card's border is the only one and the picture is not a framed thing
        // inside a framed thing; a bottom rule divides picture from caption.
        '.t{display:flex;align-items:center;justify-content:center;overflow:hidden;' +
        'width:100%;aspect-ratio:4/3;background:#fff;border-bottom:1px solid #d0d5dd}' +
        '.t img,.t video{width:100%;height:100%;object-fit:cover;display:block;background:#111827}' +
        // A PDF cannot go in an <img>, but the browser's own viewer renders it
        // through <embed>, fitted to width with its controls off so it reads
        // as the document rather than as an application.
        '.t.pdf,.t.doc{position:relative;display:block}' +
        '.t.pdf embed{position:absolute;top:0;left:0;width:100%;height:100%;border:0}' +
        // Text renders at the browser's own default size, which in a 330px box
        // is two or three words. Laid out wide and scaled down instead, so the
        // cell shows the opening of the file rather than its first line
        // chopped. pointer-events off so the click reaches the link.
        '.t.doc iframe{position:absolute;top:0;left:0;width:780px;height:590px;border:0;' +
        'background:#fff;transform:scale(.42);transform-origin:top left;pointer-events:none}' +
        // Sized for the cell it now sits in. 11px was set when this box was an
        // 88px square; in a 330px card it read as a stray word floating in
        // white rather than as the label for the thing.
        '.none{color:#6b7280;font:600 17px/1 ui-monospace,SFMono-Regular,Menlo,monospace;' +
        'letter-spacing:.14em;text-decoration:none}' +
        // The scaled-down PDF trick is for an 88px box. At cell width the
        // viewer can simply fill it, fitted to width, which also adapts as the
        // column count changes.
        '.t.pdf embed{position:absolute;top:0;left:0;width:100%;height:100%;transform:none}' +
        '.m{min-width:0;padding:14px 16px 16px}' +
        '.n{margin:0;font-weight:600;overflow-wrap:anywhere}' +
        '.c{margin:2px 0 0;color:#4b5563;font:11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}' +
        '.tm{margin:3px 0 0;color:#4b5563;font-size:12px;line-height:1.45}' +
        '.l{margin:10px 0 0}' +
        '.l a{font-size:13.5px}' +
        '.sep{width:14px}' +
        '.empty{color:#4b5563}',
      '<h1>BitGraph Folder</h1>' +
        '<p class="s">' + rows.length + (rows.length === 1 ? ' recording' : ' recordings') + ', newest first.</p>' +
        body
    )
  );
  return rows.length;
}

// ---------------------------------------------------------------------------

function run(argv) {
  try {
    if (argv[0] === '--index') {
      return 'ok: indexed ' + writeIndex(argv[1]);
    }
    if (argv[0] === '--json') {
      var body = readFile(argv[2]);
      if (body === null) return argv[1] === 'commit' ? 'fail' : 'error';
      return argv[1] === 'batch' ? parseBatch(body) : parseCommit(body);
    }
    if (argv[0] === '--complete') {
      return completePending(argv[1]);
    }
    if (argv.length < 4) {
      return 'error: usage: export.js <file> <digestB64> <counter> <epochUrlSafe>';
    }
    return buildExport(argv[0], argv[1], argv[2], argv[3]);
  } catch (e) {
    return 'error: ' + (e && e.message ? e.message : String(e));
  }
}
