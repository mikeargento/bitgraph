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
// a folder built here and a zip downloaded from a proof page are the same
// thing:
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

function run(argv) {
  try {
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
