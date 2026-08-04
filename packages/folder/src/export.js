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

function writeFile(path, text) {
  if (badPath(path)) throw new Error('refusing to write to an empty path');
  var f = app.openForAccess(Path(path), { writePermission: true });
  try {
    app.setEof(f, { to: 0 });
    app.write(text, { to: f });
  } finally {
    app.closeAccess(f);
  }
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

var IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif', 'bmp', 'tiff', 'tif'];

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
    '<title>' + esc(title) + '</title><style>' +
    '*{box-sizing:border-box}' +
    'body{margin:0;padding:48px 24px 80px;background:#f5f5f5;color:#111827;' +
    'font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;' +
    '-webkit-font-smoothing:antialiased}' +
    '.wrap{max-width:800px;margin:0 auto}' +
    'h1{margin:0 0 4px;font-size:28px;font-weight:600;letter-spacing:-.03em;overflow-wrap:anywhere}' +
    '.s{margin:0 0 40px;color:#4b5563;font-size:14px}' +
    '.t{flex:0 0 88px;width:88px;height:88px;display:flex;align-items:center;' +
    'justify-content:center;background:#fff;border:1px solid #d0d5dd;overflow:hidden}' +
    '.t img{width:100%;height:100%;object-fit:cover;display:block}' +
    // A PDF cannot go in an <img>, but the browser's own viewer can render it
    // through <embed>. At 88px that viewer's chrome would be the whole picture,
    // so it is laid out at a readable width and scaled down, which yields the
    // top of page one as a real thumbnail. #toolbar=0 removes the controls,
    // and pointer-events:none lets the click reach the link wrapping it.
    '.t.pdf{position:relative;display:block}' +
    '.t.pdf embed{position:absolute;top:0;left:0;width:620px;height:800px;border:0;' +
    'transform:scale(.142);transform-origin:top left;pointer-events:none}' +
    '.none{color:#9aa3ae;font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;' +
    'letter-spacing:.1em;text-decoration:none}' +
    '.l{margin:8px 0 0}' +
    '.l a{color:#0065A4;font-weight:600;font-size:14px;text-decoration:none}' +
    '.sep{display:inline-block;width:18px}' +
    '.a{display:inline-block;transition:transform .18s ease}' +
    '@media (hover:hover){.l a:hover .a{transform:translateX(3px)}}' +
    '@media (max-width:520px){body{padding:32px 16px 64px}' +
    '.t{flex-basis:64px;width:64px;height:64px}}' +
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
    // the thing that was recorded.
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
    return dateOf(b) + ' &middot; between ' + clockOf(b) + ' and ' +
      (sameDay ? '' : dateOf(a) + ' ') + clockOf(a);
  }
  if (w.before) {
    // Sealed by an anchor that has not landed yet; the lower bound is real.
    var lo = new Date(w.before * 1000);
    return dateOf(lo) + ' &middot; after ' + clockOf(lo) + ', upper bound pending';
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
      : '<a class="t none" href="' + page + '">' + esc(file ? (extOf(file) || 'file').toUpperCase() : '—') + '</a>';

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
    '<p class="n">' + esc(file || name) + '</p>' +
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
  var isImage = file && IMAGE_EXT.indexOf(extOf(file)) !== -1;

  // Answer the artifact-binding question here rather than sending someone to
  // the site to drop the file in by hand.
  //
  // Handing the file to the proof page automatically is not possible: a file:
  // page cannot read its own sibling files (CORS forbids it), a file input
  // cannot be set programmatically, and embedding the bytes as a data URI at
  // write time would inflate the page by a third of the photo's size and still
  // need bitgraph.ing to accept content from whatever page opened it.
  //
  // None of that is needed, because this script HAS the file. It hashes it and
  // compares against the digest the proof commits to, which is the same
  // question the drop zone answers. Scope is exactly that and no more: it says
  // the bytes in this folder are the bytes this proof describes. It does not
  // check the enclave signature or the anchor chain, so the page names the
  // audit command for the full check rather than implying it did one.
  var binding = null;
  if (file) {
    var got = sh(
      'openssl dgst -sha256 -binary ' + quote(dir + '/' + file) + ' 2>/dev/null | openssl base64 -A 2>/dev/null'
    );
    if (got) binding = String(got).trim() === String(digest).trim();
  }

  // A PDF gets the browser's viewer at a size you can actually read, since on
  // this page the artifact is the point. Controls stay on here, unlike the
  // thumbnail: at full size paging and zoom are useful rather than clutter.
  var hero = isImage
    ? '<p class="hero"><a href="' + encodePath(file) + '"><img src="' + encodePath(file) + '" alt=""></a></p>'
    : file && extOf(file) === 'pdf'
      ? '<p class="hero"><embed class="pdfdoc" src="' + encodePath(file) + '" type="application/pdf"></p>'
      : '';

  function line(label, value) {
    return value ? '<div><dt>' + label + '</dt><dd>' + value + '</dd></div>' : '';
  }
  function anchorSide(side) {
    if (!side.ts && !side.block) return '';
    var when = side.ts
      ? clockOf(new Date(side.ts * 1000)) + ' on ' + dateOf(new Date(side.ts * 1000))
      : 'time unavailable';
    return (side.block ? 'block ' + esc(side.block) + ' &middot; ' : '') + when;
  }

  // Everything actually in the export, so this page answers the question the
  // directory listing was answering, just legibly.
  //
  // FLATTENED ON PURPOSE: ethereum-anchors/ is expanded into its four files
  // rather than linked as a directory. A directory link hands the browser back
  // to its own generated listing, which is the exact page this one exists to
  // replace, so there must be no directory link anywhere on it.
  function entries(prefix) {
    var out = sh('cd ' + quote(dir + (prefix ? '/' + prefix : '')) + ' && ls -1 2>/dev/null');
    return out ? out.split('\r').join('\n').split('\n').filter(Boolean) : [];
  }
  var rowsOut = [];
  entries('')
    .filter(function (n) { return n !== 'index.html' && n.charAt(0) !== '.' && n.indexOf('Icon') !== 0; })
    .forEach(function (n) {
      if (n === ANCHOR_DIR) {
        entries(ANCHOR_DIR).forEach(function (a) {
          if (a.charAt(0) === '.') return;
          var rel = ANCHOR_DIR + '/' + a;
          rowsOut.push('<li><a href="' + encodePath(rel) + '">' + esc(rel) + '</a></li>');
        });
        return;
      }
      rowsOut.push('<li><a href="' + encodePath(n) + '">' + esc(n) + '</a></li>');
    });
  var files = rowsOut.join('');

  writeFile(
    dir + '/index.html',
    pageShell(
      file || name,
      '.hero{margin:0 0 32px}' +
        // Capped on BOTH axes, not just width. A portrait or square image
        // constrained only by width runs to full column height and pushes
        // every proof fact below the fold, which defeats the page: it exists
        // to show the file and its proof together. width/height auto keeps the
        // aspect ratio while the two maxima do the fitting. Left-aligned, like
        // everything else on the site.
        '.hero img{max-width:100%;max-height:min(60vh,520px);width:auto;height:auto;' +
        'display:block;border:1px solid #d0d5dd;background:#fff}' +
        '.hero .pdfdoc{width:100%;height:min(64vh,560px);border:1px solid #d0d5dd;background:#fff;display:block}' +
        'dl{margin:0 0 28px;display:grid;gap:14px}' +
        'dt{font:600 10.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;' +
        'text-transform:uppercase;color:#9aa3ae}' +
        'dd{margin:2px 0 0;font-size:14px;color:#1f2937;overflow-wrap:anywhere}' +
        'dd.mono{font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}' +
        '.files{list-style:none;margin:0;padding:0;border-top:1px solid #e5e7eb}' +
        '.files li{padding:10px 0;border-bottom:1px solid #e5e7eb}' +
        // Blue by default, not on hover: these were dark and read as plain
        // text, so nothing said they could be opened. Monospace because they
        // are filenames, and no arrow on each: an arrow is this site's mark of
        // an action, and eight of them would drown the one real action below.
        '.files a{color:#0065A4;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;text-decoration:none}' +
        '@media (hover:hover){.files a:hover{text-decoration:underline}}' +
        '.bind{margin:0 0 28px;padding:14px 16px;border:1px solid #dc2626;font-size:14px;color:#111827}' +
        '.bind b{font-weight:600;color:#dc2626}' +
        '.bind .audit{display:block;margin-top:8px;color:#4b5563;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}' +
        '.back{margin:0 0 28px;font-size:14px}' +
        '.back a{color:#0065A4;font-weight:600;text-decoration:none}',
      '<p class="back"><a href="../index.html"><span class="a">&larr;</span> All recordings</a></p>' +
        '<h1>' + esc(file || name) + '</h1>' +
        '<p class="s">' + esc(name) + (counter ? ' &middot; #' + esc(counter) : '') + '</p>' +
        hero +
        '<dl>' +
        line('Recorded after', anchorSide(info.before)) +
        line('And before', anchorSide(info.after)) +
        '</dl>' +
        // "File Hash", the name the proof page gives this exact field, not
        // "Digest". A proof carries three other hashes (proofHash, the hash of
        // the signed body, and the chain hash), so a generic label invites
        // confusing the file's own SHA-256 with one of them.
        '<dl><div><dt>File Hash</dt><dd class="mono">' + esc(digest) + '</dd></div></dl>' +
        // Silent when the bytes match, which is every normal page. Announcing
        // a match would promise a contrast the page cannot show and plant the
        // doubt it was meant to remove, the same way a reassurance caption
        // does. The expected state needs no words; only the alarming one does.
        //
        // Red is correct here and nowhere else on this page: site-wide it means
        // exactly one thing, that something did not verify.
        (binding === false
          ? '<p class="bind"><b>This file does not match the proof.</b> Its SHA-256 differs from the ' +
            'file hash above, so these are not the same bytes. Either the file changed after it was ' +
            'recorded, or it is not the file this proof describes.' +
            '<span class="audit">npx @mikeargento/bitgraph-audit ' + esc(name) + '</span></p>'
          : '') +
        '<h2 class="s" style="margin:0 0 4px;color:#111827;font-size:14px;font-weight:600">In this folder</h2>' +
        '<ul class="files">' + files + '</ul>' +
        '<p class="l"><a href="' + API + '/proof/' + encodeURIComponent(toUrlSafe(digest)) +
        '" target="_blank" rel="noopener noreferrer">' +
        'Open proof on bitgraph.ing <span class="a">&rarr;</span></a></p>'
    )
  );
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
      'BitGraph',
      'ul{list-style:none;margin:0;padding:0}' +
        'li{display:flex;gap:20px;align-items:center;padding:18px 0;border-bottom:1px solid #e5e7eb}' +
        'li:first-child{border-top:1px solid #e5e7eb}' +
        '.m{min-width:0;flex:1}' +
        '.n{margin:0;font-weight:600;overflow-wrap:anywhere}' +
        '.c{margin:2px 0 0;color:#4b5563;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}' +
        '.tm{margin:2px 0 0;color:#4b5563;font-size:12.5px}' +
        '.empty{color:#4b5563}' +
        '@media (max-width:520px){li{gap:14px}}',
      '<h1>BitGraph</h1>' +
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
